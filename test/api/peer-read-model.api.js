import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { ingestAndPersist } from '../../server/eventIngest.js';
import { clearTriggers, listCompanies, recomputeCompanies } from '../../server/triggers.js';
import { COMPANIES_READ_MODEL_HOME } from '../../src/jurisdictionNest.js';
import { TriggerValidationError } from '../../src/triggerContract.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { applyTrigger, clearTriggers as clearSimTriggers, initialState } from '../../src/simulation.js';
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

describe('CIT-95 companies peer read-model filter', { concurrency: 1, timeout: 120_000 }, () => {
  test('mv home ignores sunnyvale peer on companies talent/hype recompute', async () => {
    const db = await migratedDatabase();
    try {
      assert.equal(COMPANIES_READ_MODEL_HOME, 'mv');

      await insertTriggerWithTalentEffect(db.pool, {
        clientId: 'evt-sunnyvale-peer-companies',
        jurisdictionId: 'sunnyvale',
        delta: 0.5,
        label: 'Sunnyvale peer wage',
      });

      const ingested = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      assert.equal(ingested.triggers.length, 1);

      const companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCostFactor, 1.08);
      // API burnRate untaxed base×factor; offline sim at tax 0.25 is 2376.
      assert.equal(companies[0].burnRate, 2160);
      assert.equal(companies[0].talentCost, 4320);

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await recomputeCompanies(client);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const after = await listCompanies(db.pool);
      assert.equal(after[0].talentCostFactor, 1.08);
      assert.equal(after[0].burnRate, 2160);
      assert.notEqual(after[0].talentCostFactor, 1.08 * 1.5);

      let state = applyTrigger(initialState, ingested.triggers[0]);
      assert.equal(effectiveBurnRate(state), 2376);
      state = clearSimTriggers(state);
      assert.equal(effectiveBurnRate(state), 2200);
    } finally {
      await db.close();
    }
  });

  test('chain ancestors still stack on companies read model', async () => {
    const db = await migratedDatabase();
    try {
      await insertTriggerWithTalentEffect(db.pool, {
        clientId: 'evt-sc-county-fee-companies',
        jurisdictionId: 'sc_county',
        delta: 0.02,
        label: 'County operating fee',
      });

      await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });

      const companies = await listCompanies(db.pool);
      // 1.08 (mv wage) × 1.02 (county) = 1.1016
      assert.equal(companies[0].talentCostFactor, 1.1016);
      assert.equal(companies[0].talentCost, 4406.4);
      assert.equal(companies[0].burnRate, Math.round(2000 * 1.1016));
    } finally {
      await db.close();
    }
  });

  test('NULL jurisdiction fail-closed: does not move companies stack', async () => {
    const db = await migratedDatabase();
    try {
      await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      const before = await listCompanies(db.pool);
      assert.equal(before[0].talentCostFactor, 1.08);

      await insertTriggerWithTalentEffect(db.pool, {
        clientId: 'evt-null-jurisdiction-companies',
        jurisdictionId: null,
        delta: 0.9,
        label: 'Null jurisdiction',
      });

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await recomputeCompanies(client);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const after = await listCompanies(db.pool);
      assert.equal(after[0].talentCostFactor, 1.08);
      assert.equal(after[0].talentCost, 4320);
    } finally {
      await db.close();
    }
  });

  test('clear restores baseline; firecrawl rejected; wage clear path 2200', async () => {
    const db = await migratedDatabase();
    try {
      const ingested = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      assert.equal((await listCompanies(db.pool))[0].talentCostFactor, 1.08);

      await clearTriggers(db.pool);
      const cleared = await listCompanies(db.pool);
      assert.equal(cleared[0].talentCostFactor, 1);
      assert.equal(cleared[0].burnRate, 2000);
      assert.equal(cleared[0].talentCost, 4000);

      let state = applyTrigger(initialState, ingested.triggers[0]);
      assert.equal(effectiveBurnRate(state), 2376);
      state = clearSimTriggers(state);
      assert.equal(effectiveBurnRate(state), 2200);

      await assert.rejects(
        () => ingestAndPersist(db.pool, { adapter: 'firecrawl' }),
        (error) => error instanceof TriggerValidationError,
      );
      const count = await db.pool.query(
        'SELECT COUNT(*)::int AS n FROM real_world_triggers WHERE client_id IS NOT NULL',
      );
      assert.equal(count.rows[0].n, 0);
    } finally {
      await db.close();
    }
  });
});
