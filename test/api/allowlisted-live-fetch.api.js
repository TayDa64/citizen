/**
 * CIT-107 — allowlisted live fetch compound (Postgres).
 * Recorded body → reducer → http_stub ingestAndPersist; locks + firecrawl reject.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import {
  applyCalendarSignal,
  applyMinutesPath,
  mapEnvelope,
} from '../../server/allowlistedFetch.js';
import {
  ingestAndPersist,
  listIngestRuns,
  validateIngestRequest,
} from '../../server/eventIngest.js';
import { loadRecordedBody } from '../../src/adapters/allowlistedHttps.js';
import { listTriggers } from '../../server/triggers.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { TriggerValidationError } from '../../src/triggerContract.js';
import { applyTrigger, clearTriggers, initialState } from '../../src/simulation.js';
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

describe('CIT-107 allowlisted live fetch', () => {
  test('recorded calendar → Phase A reducer; blocked keeps pointers changed=false', async () => {
    const db = await migratedDatabase();
    try {
      const okMapped = mapEnvelope({ kind: 'calendar' }, loadRecordedBody('calendar'));
      const phaseA = await applyCalendarSignal(db.pool, okMapped.calendarSignal);
      assert.equal(phaseA.changed, false);
      assert.ok(phaseA.upserted >= 1);

      const blockedMapped = mapEnvelope(
        { kind: 'blocked' },
        loadRecordedBody('calendarBlocked'),
      );
      const blocked = await applyCalendarSignal(db.pool, blockedMapped.calendarSignal);
      assert.equal(blocked.changed, false);

      const rows = await db.pool.query(
        `SELECT status, expected_url, last_error FROM scheduled_meetings
         WHERE external_event_id = '3367'`,
      );
      assert.equal(rows.rows.length, 1);
      assert.equal(rows.rows[0].status, 'scheduled');
      assert.ok(rows.rows[0].expected_url.includes('MeetingDetail.aspx?ID=3367'));
      // Blocked sync may set last_error but must not clear expected_url.
      assert.ok(rows.rows[0].expected_url);

      const runs = await listIngestRuns(db.pool, { limit: 20 });
      assert.ok(runs.every((run) => run.changed === false || run.status === 'success'));
    } finally {
      await db.close();
    }
  });

  test('recorded minutes → http_stub ingestAndPersist; identical re-run changed=false', async () => {
    const db = await migratedDatabase();
    try {
      const mapped = mapEnvelope({ kind: 'minutes' }, loadRecordedBody('minutes3458'));
      assert.equal(mapped.observations.length, 1);

      const first = await applyMinutesPath(db.pool, mapped, { ingestStub: true });
      assert.equal(first.after.status, 'ingested');
      assert.equal(first.ingest.changed, true);
      assert.equal(first.ingest.adapter, 'http_stub');
      assert.equal(first.ingest.triggers.length, 1);
      assert.equal(first.ingest.triggers[0].effect.talentCost, 0.05);
      assert.equal(first.ingest.triggers[0].effect.hype, 0.04);

      const triggers = await listTriggers(db.pool);
      assert.ok(triggers.some((t) => t.id.includes('mv-library-minutes-3458')));

      // Identical document timestamp → changed=false; no delete.
      const second = await ingestAndPersist(
        db.pool,
        { adapter: 'http_stub', observations: mapped.observations },
        { scheduledMeetingId: first.meeting.id },
      );
      assert.equal(second.changed, false);
      assert.equal(second.triggers.length, 1);

      const afterSecond = await listTriggers(db.pool);
      assert.equal(
        afterSecond.filter((t) => t.id.includes('mv-library-minutes-3458')).length,
        1,
      );
    } finally {
      await db.close();
    }
  });

  test('blocked/empty minutes → changed=false; no trigger delete', async () => {
    const db = await migratedDatabase();
    try {
      // Seed a trigger first to prove we do not delete on blocked fetch.
      await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      const before = await listTriggers(db.pool);
      assert.ok(before.length >= 1);

      const blockedEnv = {
        kind: 'minutes_fetch',
        ok: false,
        status: 0,
        error: 'legistar_unreachable',
        fetchedUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3458',
        bodyText: '',
        externalEventId: '3458',
      };
      const mapped = mapEnvelope({ kind: 'minutes' }, blockedEnv);
      assert.equal(mapped.observations.length, 0);

      const result = await applyMinutesPath(db.pool, mapped, { ingestStub: true });
      assert.equal(result.ingest.changed, false);
      assert.equal(result.after.status, 'minutes_wait');
      assert.equal(result.after.stdout, 'minutes=blocked');
      assert.ok(result.after.agendaUrl);

      const after = await listTriggers(db.pool);
      assert.equal(after.length, before.length);

      const emptyMapped = mapEnvelope(
        { kind: 'minutes' },
        {
          kind: 'minutes_fetch',
          ok: true,
          status: 200,
          fetchedUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3458',
          bodyText: '',
          externalEventId: '3458',
        },
      );
      const empty = await applyMinutesPath(db.pool, emptyMapped, { ingestStub: true });
      assert.equal(empty.ingest.changed, false);
      assert.equal((await listTriggers(db.pool)).length, before.length);
    } finally {
      await db.close();
    }
  });

  test('locks: wage 2376/clear 2200; firecrawl rejected; peers unbound via nest home', async () => {
    const db = await migratedDatabase();
    try {
      assert.equal(validateIngestRequest({ adapter: 'firecrawl' }).ok, false);
      await assert.rejects(
        () => ingestAndPersist(db.pool, { adapter: 'firecrawl' }),
        (error) => error instanceof TriggerValidationError,
      );

      let state = { ...initialState, taxRate: 0.25 };
      const wage = (await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      })).triggers[0];
      state = applyTrigger(state, wage);
      assert.equal(effectiveBurnRate(state), 2376);
      state = clearTriggers(state);
      assert.equal(effectiveBurnRate(state), 2200);

      // Allowlisted MV minutes stamp → mv home (not sunnyvale peer).
      const mapped = mapEnvelope({ kind: 'minutes' }, loadRecordedBody('minutes3458'));
      await applyMinutesPath(db.pool, mapped, { ingestStub: true });
      const triggers = await listTriggers(db.pool);
      const minutes = triggers.find((t) => t.id.includes('mv-library-minutes'));
      assert.ok(minutes);
      const stamped = await db.pool.query(
        `SELECT jurisdiction_id FROM real_world_triggers WHERE client_id = $1`,
        [minutes.id],
      );
      assert.equal(stamped.rows[0]?.jurisdiction_id, 'mv');
      assert.notEqual(stamped.rows[0]?.jurisdiction_id, 'sunnyvale');
    } finally {
      await db.close();
    }
  });

  test('POST ingest remains 201 sync write shape via ingestAndPersist return', async () => {
    // API route sendJson(res, 201, await ingestAndPersist(...)) — prove sync write.
    const db = await migratedDatabase();
    try {
      const mapped = mapEnvelope({ kind: 'minutes' }, loadRecordedBody('minutes3458'));
      const result = await ingestAndPersist(db.pool, {
        adapter: 'http_stub',
        observations: mapped.observations,
      });
      assert.equal(result.adapter, 'http_stub');
      assert.equal(result.changed, true);
      assert.ok(Array.isArray(result.triggers));
      const runs = await listIngestRuns(db.pool, { limit: 1 });
      assert.equal(runs[0].status, 'success');
      assert.equal(runs[0].adapter, 'http_stub');
    } finally {
      await db.close();
    }
  });
});
