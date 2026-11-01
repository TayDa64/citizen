/**
 * CIT-120 Rank-1 — retrieval indexes + ingest batch recompute + lean ingest runs.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { ingestAndPersist, listIngestRuns } from '../../server/eventIngest.js';
import { listCompanies } from '../../server/triggers.js';
import { startServer } from '../../server/index.js';
import { createThrowawayDatabase } from './throwaway-db.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { applyTrigger, clearTriggers, initialState } from '../../src/simulation.js';
import { TriggerValidationError } from '../../src/triggerContract.js';

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

describe('CIT-120 ingest sanitize + retrieval', { concurrency: 1, timeout: 120_000 }, () => {
  test('migration 008 creates hot-read indexes', async () => {
    const db = await createThrowawayDatabase();
    try {
      await migrateAll(db.pool);
      const indexes = await db.pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname = ANY($1::text[])
         ORDER BY indexname`,
        [[
          'idx_scheduled_meetings_jurisdiction_starts',
          'idx_real_world_triggers_jurisdiction',
          'idx_ingest_runs_scheduled_meeting',
        ]],
      );
      assert.deepEqual(
        indexes.rows.map((row) => row.indexname),
        [
          'idx_ingest_runs_scheduled_meeting',
          'idx_real_world_triggers_jurisdiction',
          'idx_scheduled_meetings_jurisdiction_starts',
        ],
      );
    } finally {
      await db.close();
    }
  });

  test('fixture ingest still lands wage 1.08 / burn path; lean list omits result', async () => {
    const db = await migratedDatabase();
    try {
      const first = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      assert.equal(first.changed, true);
      assert.equal(first.triggers[0].effect.talentCost, 0.08);

      const companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCostFactor, 1.08);
      assert.equal(companies[0].burnRate, 2160);

      let state = { ...initialState, taxRate: 0.25 };
      state = applyTrigger(state, first.triggers[0]);
      assert.equal(effectiveBurnRate(state), 2376);
      state = clearTriggers(state);
      assert.equal(effectiveBurnRate(state), 2200);

      const lean = await listIngestRuns(db.pool, { limit: 5 });
      assert.equal(lean.length, 1);
      assert.equal(lean[0].result, null);
      assert.equal(lean[0].status, 'success');

      const full = await listIngestRuns(db.pool, { limit: 5, includeResult: true });
      assert.ok(full[0].result);
      assert.ok(Array.isArray(full[0].result.triggerIds));
    } finally {
      await db.close();
    }
  });

  test('GET /api/ingest/runs omits result unless includeResult=1', async () => {
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

      const lean = await fetch(`${base}/api/ingest/runs?limit=5`);
      assert.equal(lean.status, 200);
      const leanRows = await lean.json();
      assert.equal(leanRows[0].result, null);

      const full = await fetch(`${base}/api/ingest/runs?limit=5&includeResult=1`);
      assert.equal(full.status, 200);
      const fullRows = await full.json();
      assert.ok(fullRows[0].result);

      const bad = await fetch(`${base}/api/triggers/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adapter: 'http_stub',
          observations: [
            {
              id: 'obs-attacker',
              sourceUrl: 'https://evil.example/x',
              observedAt: '2026-06-01T00:00:00.000Z',
              evidence: 'nope',
              hints: { type: 'news_spike', label: 'x', effect: { hype: 0.1 } },
            },
          ],
        }),
      });
      assert.equal(bad.status, 400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  });

  test('firecrawl still rejected on ingestAndPersist', async () => {
    const db = await migratedDatabase();
    try {
      await assert.rejects(
        () => ingestAndPersist(db.pool, { adapter: 'firecrawl' }),
        (error) => error instanceof TriggerValidationError,
      );
    } finally {
      await db.close();
    }
  });
});
