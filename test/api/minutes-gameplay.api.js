/**
 * CIT-101 — minutes→gameplay vertical (compound).
 * Due-sweep Phase C minutes file → ingestAndPersist → triggers / nest / restack.
 * Locks: Final+null, agenda-seen, wage 2376/clear 2200, peers, firecrawl, 60d.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import {
  processDueMeeting,
  shouldPersistTriggers,
} from '../../server/dueRowSweep.js';
import { ingestAndPersist, listIngestRuns } from '../../server/eventIngest.js';
import { upsertScheduledMeeting } from '../../server/scheduledMeetings.js';
import { createCampaign, getCampaign, listTurnCommits } from '../../server/campaigns.js';
import { listCompanies, listTriggers, recomputeCompanies } from '../../server/triggers.js';
import {
  mvCouncilAgenda3367,
  mvCouncilMinutes3363,
  mvCouncilMorning3367,
  mvLibraryMinutes3458,
  seedAgendaSeen3367,
  seedRow3363MinutesWait,
  seedRow3367Scheduled,
  seedRow3458MinutesWait,
} from '../../src/calendar/fixtures.js';
import { reduceMeetingRow } from '../../src/calendar/calendarReducer.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { applyTrigger, clearTriggers, initialState } from '../../src/simulation.js';
import { collectFixtureObservations } from '../../src/adapters/fixtureAdapter.js';
import { ingestObservation, toContractTrigger } from '../../src/eventPipeline.js';
import { TriggerValidationError } from '../../src/triggerContract.js';
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

async function ensureTalentMetric(pool) {
  const talent = await pool.query(
    `INSERT INTO simulation_objects (name, type, default_value, min_value, max_value)
     VALUES ('talent_cost', 'metric', 4000, 0, 9999999999.99)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  return talent.rows[0].id;
}

async function insertTriggerWithTalentEffect(
  pool,
  { clientId, jurisdictionId, delta, label = clientId },
) {
  const inserted = await pool.query(
    `INSERT INTO real_world_triggers
       (client_id, source_url, trigger_type, label, scraped_at, processed, jurisdiction_id)
     VALUES ($1, $2, 'policy_change', $3, now(), true, $4)
     RETURNING id`,
    [clientId, `mock:${clientId}`, label, jurisdictionId],
  );
  const targetId = await ensureTalentMetric(pool);
  await pool.query(
    `INSERT INTO effects (target_id, trigger_id, formula, direction, is_active)
     VALUES ($1, $2, $3::jsonb, 'output', true)`,
    [targetId, inserted.rows[0].id, JSON.stringify({ op: 'mul', delta })],
  );
  return inserted.rows[0].id;
}

describe('CIT-101 minutes→gameplay vertical', { concurrency: 1, timeout: 120_000 }, () => {
  test('due-sweep library minutes → triggers + ingest_run; identical timestamp → changed=false', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'cit-101-minutes' });
      const library = await upsertScheduledMeeting(db.pool, seedRow3458MinutesWait(4));

      const first = await processDueMeeting(
        db.pool,
        library,
        mvLibraryMinutes3458.frozenNowFile,
        {
          signal: mvLibraryMinutes3458.signalFile,
          campaignId: campaign.id,
        },
      );
      assert.equal(first.meeting.status, 'ingested');
      assert.equal(first.triggerChanged, true);
      assert.equal(first.triggers.length, 1);
      assert.equal(first.triggers[0].id, 'evt-pipeline-obs-mv-library-minutes-3458');
      assert.equal(first.triggers[0].effect.talentCost, 0.05);
      assert.equal(first.triggers[0].effect.hype, 0.04);
      assert.ok(first.restack);
      assert.equal(first.restack.campaignId, campaign.id);

      const runs = await listIngestRuns(db.pool, { limit: 5 });
      const minutesRun = runs.find((run) => run.fixtureId === 'mv-library-minutes-3458');
      assert.ok(minutesRun);
      assert.equal(minutesRun.changed, true);
      assert.equal(minutesRun.status, 'success');
      assert.equal(minutesRun.scheduledMeetingId, library.id);
      assert.deepEqual(minutesRun.triggerClientIds, [
        'evt-pipeline-obs-mv-library-minutes-3458',
      ]);

      const reloaded = await getCampaign(db.pool, campaign.id);
      assert.equal(reloaded.state.activeTriggers.length, 1);
      assert.equal(reloaded.state.activeTriggers[0].effect.talentCost, 0.05);

      const commitsBefore = await listTurnCommits(db.pool, campaign.id, { limit: 20 });
      const commitCountBefore = commitsBefore.length;

      const second = await ingestAndPersist(
        db.pool,
        {
          adapter: 'fixture',
          fixtureId: 'mv-library-minutes-3458',
          campaignId: campaign.id,
        },
        { scheduledMeetingId: library.id },
      );
      assert.equal(second.changed, false);
      assert.equal(second.restack, undefined);
      assert.equal(second.triggers.length, 1);

      const commitsAfter = await listTurnCommits(db.pool, campaign.id, { limit: 20 });
      assert.equal(commitsAfter.length, commitCountBefore);

      const runs2 = await listIngestRuns(db.pool, { limit: 2 });
      assert.equal(runs2[0].changed, false);
      assert.equal(runs2[0].fixtureId, 'mv-library-minutes-3458');
    } finally {
      await db.close();
    }
  });

  test('Final+null → minutes_wait / no trigger; agenda-seen → zero triggers / no restack', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'cit-101-neg' });

      const nullFile = await upsertScheduledMeeting(db.pool, seedRow3363MinutesWait());
      const waited = await processDueMeeting(
        db.pool,
        nullFile,
        mvCouncilMinutes3363.frozenNowTPlus1,
        {
          signal: mvCouncilMinutes3363.signalFinalNullFile,
          campaignId: campaign.id,
        },
      );
      assert.equal(waited.meeting.status, 'minutes_wait');
      assert.equal(waited.triggerChanged, false);
      assert.equal(waited.triggers.length, 0);
      assert.equal(waited.restack, null);
      assert.equal(shouldPersistTriggers(nullFile, waited.meeting), false);

      const agendaRow = await upsertScheduledMeeting(db.pool, seedRow3367Scheduled());
      const agenda = await processDueMeeting(
        db.pool,
        agendaRow,
        mvCouncilAgenda3367.frozenNowFirstPost,
        {
          signal: mvCouncilAgenda3367.signalFirst,
          campaignId: campaign.id,
        },
      );
      assert.equal(agenda.meeting.status, 'agenda_seen');
      assert.equal(agenda.triggerChanged, false);
      assert.equal(agenda.triggers.length, 0);
      assert.equal(agenda.restack, null);

      const morningSeed = await upsertScheduledMeeting(db.pool, seedAgendaSeen3367());
      const morning = await processDueMeeting(
        db.pool,
        {
          ...morningSeed,
          status: 'agenda_seen',
          nextCheckAt: mvCouncilMorning3367.frozenNow,
        },
        mvCouncilMorning3367.frozenNow,
        {
          signal: mvCouncilMorning3367.signalStillOn,
          campaignId: campaign.id,
        },
      );
      assert.equal(morning.meeting.status, 'confirmed');
      assert.equal(morning.triggerChanged, false);

      assert.equal((await listTriggers(db.pool)).length, 0);
      assert.equal((await getCampaign(db.pool, campaign.id)).state.activeTriggers.length, 0);
    } finally {
      await db.close();
    }
  });

  test('wage 2376 / clear 2200; wage+minutes stack; Sunnyvale peer unbound; firecrawl; 60d', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'cit-101-locks' });
      assert.equal(campaign.state.taxRate, 0.25);

      const wage = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
        campaignId: campaign.id,
      });
      assert.equal(wage.changed, true);
      let reloaded = await getCampaign(db.pool, campaign.id);
      assert.equal(effectiveBurnRate(reloaded.state), 2376);
      assert.equal(effectiveBurnRate(clearTriggers(reloaded.state)), 2200);

      const library = await upsertScheduledMeeting(db.pool, seedRow3458MinutesWait(4));
      const minutes = await processDueMeeting(
        db.pool,
        library,
        mvLibraryMinutes3458.frozenNowFile,
        {
          signal: mvLibraryMinutes3458.signalFile,
          campaignId: campaign.id,
        },
      );
      assert.equal(minutes.triggerChanged, true);
      reloaded = await getCampaign(db.pool, campaign.id);
      assert.ok(reloaded.state.activeTriggers.length >= 2);
      // wage 1.08 × minutes 1.05 = 1.134 → burn round(2200 * 1.134) = 2495
      assert.equal(effectiveBurnRate(reloaded.state), 2495);

      const companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCostFactor, 1.134);
      assert.equal(companies[0].talentCostFactorClamped, false);

      await insertTriggerWithTalentEffect(db.pool, {
        clientId: 'evt-sunnyvale-peer-minutes',
        jurisdictionId: 'sunnyvale',
        delta: 0.5,
        label: 'Sunnyvale peer minutes',
      });
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await recomputeCompanies(client);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const afterPeer = await listCompanies(db.pool);
      assert.equal(afterPeer[0].talentCostFactor, 1.134);
      assert.notEqual(afterPeer[0].talentCostFactor, 1.134 * 1.5);

      // County ancestor still stacks (dampening measurement input).
      await insertTriggerWithTalentEffect(db.pool, {
        clientId: 'evt-sc-county-fee-minutes',
        jurisdictionId: 'sc_county',
        delta: 0.02,
        label: 'County operating fee',
      });
      const client2 = await db.pool.connect();
      try {
        await client2.query('BEGIN');
        await recomputeCompanies(client2);
        await client2.query('COMMIT');
      } finally {
        client2.release();
      }
      const withCounty = await listCompanies(db.pool);
      // 1.08 × 1.05 × 1.02 = 1.15668 → listCompanies publishes round4 1.1567
      assert.equal(withCounty[0].talentCostFactor, 1.1567);
      assert.equal(withCounty[0].talentCostFactorClamped, false);

      await insertTriggerWithTalentEffect(db.pool, {
        clientId: 'evt-null-jur-minutes',
        jurisdictionId: null,
        delta: 0.9,
        label: 'Null jurisdiction',
      });
      const client3 = await db.pool.connect();
      try {
        await client3.query('BEGIN');
        await recomputeCompanies(client3);
        await client3.query('COMMIT');
      } finally {
        client3.release();
      }
      const afterNull = await listCompanies(db.pool);
      assert.equal(afterNull[0].talentCostFactor, 1.1567);

      await assert.rejects(
        () => ingestAndPersist(db.pool, { adapter: 'firecrawl' }),
        (error) => error instanceof TriggerValidationError,
      );

      const closed = await upsertScheduledMeeting(db.pool, {
        ...seedRow3363MinutesWait(),
        status: 'unchanged',
        phase: 'C',
        nextCheckAt: '2026-01-01T00:00:00.000Z',
        externalEventId: '3363-closed',
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

      const observations = collectFixtureObservations('civic-wage-bulletin');
      const trigger = toContractTrigger(ingestObservation(observations[1]));
      let state = applyTrigger(initialState, trigger);
      assert.equal(effectiveBurnRate(state), 2376);
      state = clearTriggers(state);
      assert.equal(effectiveBurnRate(state), 2200);
    } finally {
      await db.close();
    }
  });

  test('reducer: library minutes=ingested is persistable; Final+null is not', () => {
    const library = seedRow3458MinutesWait(4);
    const after = reduceMeetingRow(
      library,
      mvLibraryMinutes3458.frozenNowFile,
      mvLibraryMinutes3458.signalFile,
    );
    assert.equal(after.status, 'ingested');
    assert.equal(shouldPersistTriggers(library, after), true);

    const nullRow = seedRow3363MinutesWait();
    const waited = reduceMeetingRow(
      nullRow,
      mvCouncilMinutes3363.frozenNowTPlus1,
      mvCouncilMinutes3363.signalFinalNullFile,
    );
    assert.equal(waited.status, 'minutes_wait');
    assert.equal(shouldPersistTriggers(nullRow, waited), false);
  });
});
