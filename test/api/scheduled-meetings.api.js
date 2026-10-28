import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import {
  processDueMeeting,
  runPhaseACalendarSync,
  sweepDueRows,
} from '../../server/dueRowSweep.js';
import { listIngestRuns } from '../../server/eventIngest.js';
import {
  getScheduledMeetingByNaturalKey,
  listDueScheduledMeetings,
  seedWagePublicationRow,
  upsertScheduledMeeting,
} from '../../server/scheduledMeetings.js';
import {
  mvCouncilAgenda3367,
  mvCouncilMorning3367,
  mvLibraryMinutes3458,
  mvCouncilMinutes3363,
  seedAgendaSeen3367,
  seedConfirmed3367,
  seedRow3363MinutesWait,
  seedRow3458MinutesWait,
  civicWageBulletinPublication,
} from '../../src/calendar/fixtures.js';
import { createCampaign } from '../../server/campaigns.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { applyTrigger, clearTriggers, initialState } from '../../src/simulation.js';
import { collectFixtureObservations } from '../../src/adapters/fixtureAdapter.js';
import { ingestObservation, toContractTrigger } from '../../src/eventPipeline.js';
import { TriggerValidationError } from '../../src/triggerContract.js';
import { ingestAndPersist } from '../../server/eventIngest.js';
import { createThrowawayDatabase } from './throwaway-db.js';

async function migrateAll(pool) {
  for (const file of UP_MIGRATIONS) {
    await applyMigration(pool, file, 'up');
  }
}

async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  await migrateAll(db.pool);
  await db.pool.query(
    `INSERT INTO companies (name, cash, burn_rate, hype)
     VALUES ('Citizen', 15000, 2000, 0.3)`,
  );
  return db;
}

describe('CIT-81 scheduled_meetings + due-row sweep', { concurrency: 1, timeout: 120_000 }, () => {
  test('migration 007 creates scheduled_meetings + ingest_runs.scheduled_meeting_id', async () => {
    const db = await migratedDatabase();
    try {
      const table = await db.pool.query(`SELECT to_regclass('public.scheduled_meetings') AS name`);
      assert.equal(table.rows[0].name, 'scheduled_meetings');

      const cols = await db.pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'scheduled_meetings'
         ORDER BY ordinal_position`,
      );
      const names = cols.rows.map((row) => row.column_name);
      for (const required of [
        'id',
        'jurisdiction_id',
        'source_id',
        'external_event_id',
        'kind',
        'starts_at',
        'timezone',
        'next_check_at',
        'phase',
        'status',
        'fixture_id',
        'expected_url',
        'agenda_url',
        'agenda_published_at',
        'minutes_url',
        'minutes_published_at',
        'observed_source_url',
        'last_error',
      ]) {
        assert.equal(names.includes(required), true, required);
      }

      const uniq = await db.pool.query(
        `SELECT 1 FROM pg_constraint
         WHERE conrelid = 'scheduled_meetings'::regclass
           AND contype = 'u'`,
      );
      assert.ok(uniq.rowCount >= 1);

      const idx = await db.pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'scheduled_meetings' AND indexname = 'idx_scheduled_meetings_due'`,
      );
      assert.equal(idx.rowCount, 1);

      const ingestCols = await db.pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'ingest_runs' AND column_name = 'scheduled_meeting_id'`,
      );
      assert.equal(ingestCols.rowCount, 1);
    } finally {
      await db.close();
    }
  });

  test('Phase A seed upserts MV council events; due sweep agenda_seen writes changed=false run', async () => {
    const db = await migratedDatabase();
    try {
      const phaseA = await runPhaseACalendarSync(db.pool);
      assert.equal(phaseA.upserted, 3);
      assert.equal(phaseA.changed, false);

      const row3367 = await getScheduledMeetingByNaturalKey(
        db.pool,
        'legistar:mountainview',
        '3367',
      );
      assert.ok(row3367);
      assert.equal(row3367.status, 'scheduled');
      assert.equal(row3367.jurisdictionId, 'mv');

      const outcome = await processDueMeeting(
        db.pool,
        row3367,
        mvCouncilAgenda3367.frozenNowFirstPost,
        { signal: mvCouncilAgenda3367.signalFirst },
      );
      assert.equal(outcome.meeting.status, 'agenda_seen');
      assert.equal(outcome.triggerChanged, false);
      assert.equal(outcome.ingestRunChanged, false);

      const runs = await listIngestRuns(db.pool, { limit: 5 });
      assert.ok(runs.length >= 1);
      const linked = runs.find((run) => run.scheduledMeetingId === row3367.id);
      assert.ok(linked);
      assert.equal(linked.changed, false);
      assert.equal(linked.status, 'success');
      assert.deepEqual(linked.triggerClientIds, []);
    } finally {
      await db.close();
    }
  });

  test('Final+null minutes stay wait; library file ingests pointer without commitTurn; peers unbound', async () => {
    const db = await migratedDatabase();
    try {
      const nullFile = await upsertScheduledMeeting(db.pool, seedRow3363MinutesWait());
      const waited = await processDueMeeting(
        db.pool,
        nullFile,
        mvCouncilMinutes3363.frozenNowTPlus1,
        { signal: mvCouncilMinutes3363.signalFinalNullFile },
      );
      assert.equal(waited.meeting.status, 'minutes_wait');
      assert.equal(waited.triggerChanged, false);

      const library = await upsertScheduledMeeting(db.pool, seedRow3458MinutesWait(4));
      const withFile = await processDueMeeting(
        db.pool,
        library,
        mvLibraryMinutes3458.frozenNowFile,
        { signal: mvLibraryMinutes3458.signalFile },
      );
      assert.equal(withFile.meeting.status, 'ingested');
      assert.ok(withFile.meeting.minutesUrl);
      assert.equal(withFile.triggerChanged, false);
      assert.equal(withFile.restack, null);

      // Peer sunnyvale still does not bind mv burn pack.
      const observations = collectFixtureObservations('civic-wage-bulletin');
      const trigger = toContractTrigger(ingestObservation(observations[1]));
      let state = applyTrigger(initialState, { ...trigger, jurisdictionId: 'mv' });
      assert.equal(effectiveBurnRate(state), 2376);
      state = clearTriggers(state);
      assert.equal(effectiveBurnRate(state), 2200);
    } finally {
      await db.close();
    }
  });

  test('publication Phase C wage ingest links scheduled_meeting_id; optional restack only when changed', async () => {
    const db = await migratedDatabase();
    try {
      const pub = await seedWagePublicationRow(db.pool);
      assert.equal(pub.kind, 'publication');

      const campaign = await createCampaign(db.pool, { seed: 'cit-81-restack' });

      const noRestack = await processDueMeeting(
        db.pool,
        pub,
        civicWageBulletinPublication.frozenNow,
        { signal: civicWageBulletinPublication.signalBody },
      );
      assert.equal(noRestack.meeting.status, 'ingested');
      assert.equal(noRestack.triggerChanged, true);
      assert.equal(noRestack.restack, null);

      const runs = await listIngestRuns(db.pool, { limit: 5 });
      const wageRun = runs.find((run) => run.fixtureId === 'civic-wage-bulletin' && run.changed);
      assert.ok(wageRun);
      assert.equal(wageRun.scheduledMeetingId, pub.id);

      // Re-seed a fresh publication-like row for restack path (natural key already ingested).
      await db.pool.query(
        `UPDATE scheduled_meetings
         SET status = 'scheduled', phase = 'A', next_check_at = $2, minutes_published_at = NULL,
             observed_source_url = NULL
         WHERE id = $1`,
        [pub.id, civicWageBulletinPublication.observedAt],
      );
      const again = await getScheduledMeetingByNaturalKey(
        db.pool,
        'fixture:civic-wage-bulletin',
        'obs-civic-wage-bulletin-2026-04',
      );
      const withRestack = await processDueMeeting(
        db.pool,
        again,
        civicWageBulletinPublication.frozenNow,
        {
          signal: civicWageBulletinPublication.signalBody,
          campaignId: campaign.id,
        },
      );
      assert.equal(withRestack.triggerChanged, true);
      assert.ok(withRestack.restack);
      assert.equal(withRestack.restack.campaignId, campaign.id);

      // Morning confirmed → no triggers / no commitTurn.
      const confirmed = await upsertScheduledMeeting(db.pool, seedConfirmed3367());
      const morning = await processDueMeeting(
        db.pool,
        { ...confirmed, status: 'agenda_seen', nextCheckAt: mvCouncilMorning3367.frozenNow },
        mvCouncilMorning3367.frozenNow,
        { signal: mvCouncilMorning3367.signalStillOn },
      );
      assert.equal(morning.meeting.status, 'confirmed');
      assert.equal(morning.triggerChanged, false);

      await assert.rejects(
        () => ingestAndPersist(db.pool, { adapter: 'firecrawl' }),
        (error) => error instanceof TriggerValidationError,
      );
    } finally {
      await db.close();
    }
  });

  test('sweepDueRows selects next_check_at <= now with frozen now; 60d unchanged stays closed', async () => {
    const db = await migratedDatabase();
    try {
      await runPhaseACalendarSync(db.pool);
      const dueBefore = await listDueScheduledMeetings(
        db.pool,
        mvCouncilAgenda3367.frozenNowFirstPost,
        { forUpdate: false },
      );
      assert.ok(dueBefore.length >= 1);

      const swept = await sweepDueRows(db.pool, {
        now: mvCouncilAgenda3367.frozenNowFirstPost,
        signalOverrides: {
          '3367': mvCouncilAgenda3367.signalFirst,
          '3363': mvCouncilAgenda3367.signalEmpty,
          '3458': mvCouncilAgenda3367.signalEmpty,
        },
      });
      assert.ok(swept.processed >= 1);
      assert.equal(swept.changed, false);

      const closed = await upsertScheduledMeeting(db.pool, {
        ...seedRow3363MinutesWait(),
        status: 'unchanged',
        phase: 'C',
        nextCheckAt: '2026-01-01T00:00:00.000Z',
      });
      const replay = await processDueMeeting(
        db.pool,
        closed,
        '2026-12-01T00:00:00.000Z',
        {
          signal: {
            type: 'minutes_check',
            outcome: 'ok',
            minutesUrl: 'https://example.local/late.pdf',
            minutesPublishedAt: '2026-12-01T00:00:00.000Z',
          },
        },
      );
      assert.equal(replay.meeting.status, 'unchanged');
      assert.equal(replay.triggerChanged, false);
      assert.equal(replay.ingestRunChanged, false);
    } finally {
      await db.close();
    }
  });
});
