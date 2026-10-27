import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { listIngestRuns } from '../../server/eventIngest.js';
import {
  formatChangedLine,
  runIngestOnce,
} from '../../server/ingestOnce.js';
import { listCompanies } from '../../server/triggers.js';
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

describe('CIT-67 ingest:once', { concurrency: 1, timeout: 120_000 }, () => {
  test('runIngestOnce writes success ingest_runs and prints changed=true', async () => {
    const db = await migratedDatabase();
    try {
      const first = await runIngestOnce(db.pool, {
        fixtureId: 'civic-wage-bulletin',
      });
      assert.equal(first.changed, true);
      assert.equal(formatChangedLine(first.changed), 'changed=true');
      assert.equal(first.triggers.length, 1);
      assert.equal(first.triggers[0].effect.talentCost, 0.08);

      const companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCostFactor, 1.08);
      // API burnRate untaxed base×factor; offline sim at tax 0.25 is 2376.
      assert.equal(companies[0].burnRate, 2160);

      const second = await runIngestOnce(db.pool, {
        fixtureId: 'civic-wage-bulletin',
      });
      // createTrigger still returns the active row → changed matches CIT-68 audit.
      assert.equal(second.changed, true);
      assert.equal(formatChangedLine(second.changed), 'changed=true');
      const afterSecond = await listCompanies(db.pool);
      assert.equal(afterSecond[0].talentCostFactor, 1.08);
      assert.equal(afterSecond[0].burnRate, 2160);

      const runs = await listIngestRuns(db.pool, { limit: 10 });
      assert.equal(runs.length, 2);
      assert.equal(runs[0].status, 'success');
      assert.equal(runs[0].changed, true);
      assert.equal(runs[0].fixtureId, 'civic-wage-bulletin');
      assert.equal(runs[0].adapter, 'fixture');
    } finally {
      await db.close();
    }
  });

  test('unknown fixture fails closed with changed=false and no success run', async () => {
    const db = await migratedDatabase();
    try {
      await assert.rejects(
        () => runIngestOnce(db.pool, { fixtureId: 'nope' }),
        (error) => error instanceof TriggerValidationError,
      );

      const runs = await listIngestRuns(db.pool, { limit: 5 });
      assert.equal(runs.length, 1);
      assert.equal(runs[0].status, 'error');
      assert.equal(runs[0].changed, false);
      assert.equal(formatChangedLine(false), 'changed=false');

      const triggerCount = await db.pool.query(
        'SELECT COUNT(*)::int AS n FROM real_world_triggers WHERE client_id IS NOT NULL',
      );
      assert.equal(triggerCount.rows[0].n, 0);
    } finally {
      await db.close();
    }
  });
});
