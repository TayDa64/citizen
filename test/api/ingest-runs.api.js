import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { ingestAndPersist, listIngestRuns } from '../../server/eventIngest.js';
import { listCompanies } from '../../server/triggers.js';
import { startServer } from '../../server/index.js';
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

describe('CIT-68 ingest_runs', { concurrency: 1, timeout: 120_000 }, () => {
  test('migration 005 creates ingest_runs without scheduled_meeting_id', async () => {
    const db = await migratedDatabase();
    try {
      const columns = await db.pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'ingest_runs'
         ORDER BY ordinal_position`,
      );
      const names = columns.rows.map((row) => row.column_name);
      assert.deepEqual(names, [
        'id',
        'started_at',
        'finished_at',
        'adapter',
        'fixture_id',
        'status',
        'changed',
        'error',
        'trigger_client_ids',
        'result_json',
      ]);
      assert.equal(names.includes('scheduled_meeting_id'), false);
    } finally {
      await db.close();
    }
  });

  test('fixture ingestAndPersist writes success run; factor 1.08 / no compound', async () => {
    const db = await migratedDatabase();
    try {
      const first = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      assert.equal(first.triggers.length, 1);
      assert.equal(first.triggers[0].effect.talentCost, 0.08);

      const companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCost, 4320);
      assert.equal(companies[0].talentCostFactor, 1.08);
      // API burnRate is untaxed base 2000 × factor; offline sim at tax 0.25 is 2376.
      assert.equal(companies[0].burnRate, 2160);

      const second = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      assert.equal(second.triggers.length, 1);
      const afterSecond = await listCompanies(db.pool);
      assert.equal(afterSecond[0].talentCostFactor, 1.08);
      assert.equal(afterSecond[0].burnRate, 2160);

      const runs = await listIngestRuns(db.pool, { limit: 10 });
      assert.equal(runs.length, 2);
      assert.equal(runs[0].status, 'success');
      assert.equal(runs[0].changed, true);
      assert.equal(runs[0].adapter, 'fixture');
      assert.equal(runs[0].fixtureId, 'civic-wage-bulletin');
      assert.deepEqual(runs[0].triggerClientIds, [
        'evt-pipeline-obs-civic-wage-bulletin-2026-04-revision',
      ]);
      assert.equal(runs[1].status, 'success');
    } finally {
      await db.close();
    }
  });

  test('validation failure writes status=error and does not insert triggers', async () => {
    const db = await migratedDatabase();
    try {
      await assert.rejects(
        () => ingestAndPersist(db.pool, { adapter: 'firecrawl' }),
        (error) => error instanceof TriggerValidationError,
      );

      const runs = await listIngestRuns(db.pool, { limit: 5 });
      assert.equal(runs.length, 1);
      assert.equal(runs[0].status, 'error');
      assert.equal(runs[0].changed, false);
      assert.equal(runs[0].adapter, 'firecrawl');
      assert.deepEqual(runs[0].triggerClientIds, []);
      assert.ok(runs[0].error);

      const triggerCount = await db.pool.query(
        'SELECT COUNT(*)::int AS n FROM real_world_triggers WHERE client_id IS NOT NULL',
      );
      assert.equal(triggerCount.rows[0].n, 0);
    } finally {
      await db.close();
    }
  });

  test('GET /api/ingest/runs returns recent rows on loopback', async () => {
    const db = await migratedDatabase();
    const server = await startServer({ pool: db.pool, port: 0, host: '127.0.0.1' });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const ingest = await fetch(`${base}/api/triggers/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter: 'fixture', fixtureId: 'civic-wage-bulletin' }),
      });
      assert.equal(ingest.status, 201);

      const rejected = await fetch(`${base}/api/triggers/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter: 'firecrawl' }),
      });
      assert.equal(rejected.status, 400);

      const listed = await fetch(`${base}/api/ingest/runs?limit=5`);
      assert.equal(listed.status, 200);
      const runs = await listed.json();
      assert.equal(runs.length, 2);
      assert.equal(runs[0].status, 'error');
      assert.equal(runs[0].changed, false);
      assert.equal(runs[1].status, 'success');
      assert.equal(runs[1].changed, true);

      const companies = await (await fetch(`${base}/api/companies`)).json();
      assert.equal(companies[0].talentCostFactor, 1.08);
      assert.equal(companies[0].burnRate, 2160);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.close();
    }
  });
});
