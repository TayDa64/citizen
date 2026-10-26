import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SAMPLE_TRIGGERS } from '../../src/triggerContract.js';
import { clearTriggers, createTrigger, deleteTrigger, listCompanies } from '../../server/triggers.js';
import { startServer } from '../../server/index.js';
import { applyMigration } from '../../server/migrate.js';
import { createThrowawayDatabase } from './throwaway-db.js';

const [POLICY, , MARKET] = SAMPLE_TRIGGERS;

describe('company API talent multiplier', { concurrency: 1, timeout: 120_000 }, () => {
  test('GET /api/companies reports the mix, base burn, and effective burn', async () => {
    const db = await createThrowawayDatabase();
    try {
      await applyMigration(db.pool, 'migrations/001_initial_schema.sql', 'up');
      await applyMigration(db.pool, 'migrations/002_real_world_trigger_effects.sql', 'up');
      await applyMigration(db.pool, 'migrations/003_trigger_contract_v1.sql', 'up');
      const inserted = await db.pool.query(
        `INSERT INTO companies (name, cash, burn_rate, hype)
         VALUES ('Citizen', 15000, 2000, 0.3)
         RETURNING id`
      );
      const companyId = inserted.rows[0].id;
      await db.pool.query(
        `INSERT INTO employees (company_id, name, department, skill_tech, skill_marketing, skill_sales, is_active)
         VALUES
           ($1, 'Ada', 'tech', 1, 0.2, 0.2, true),
           ($1, 'Grace', 'tech', 1, 0.2, 0.2, true),
           ($1, 'Lin', 'marketing', 0.2, 0.5, 0.2, true),
           ($1, 'Mae', 'sales', 0.2, 0.2, 0, true),
           ($1, 'Ops', 'research', 0.5, 0.5, 0.5, true),
           ($1, 'Nil', NULL, 0, 0, 0, true),
           ($1, 'Gone', 'sales', 1, 1, 1, false)`,
        [companyId]
      );

      const [company] = await listCompanies(db.pool);
      assert.equal(company.baseBurnRate, 2000);
      assert.equal(company.talentMultiplier, 1.12);
      assert.equal(company.talentCostFactor, 1);
      assert.equal(company.effectiveMultiplier, 1.12);
      assert.equal(company.burnRate, 2240);
      assert.equal(company.baselines.talentMultiplier, undefined);
      const contributionSum = company.talentMix.reduce((total, group) => total + group.contribution, 0);
      assert.equal(Math.round(contributionSum * 10000) / 10000, company.talentMultiplier);
      assert.deepEqual(
        company.talentMix.map((group) => group.department),
        ['tech', 'marketing', 'sales', 'research', null]
      );

      const server = await startServer({ pool: db.pool, port: 0, host: '127.0.0.1' });
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/companies`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body[0].burnRate, 2240);
        assert.equal(body[0].talentMultiplier, company.talentMultiplier);
      } finally {
        await new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }

      await createTrigger(db.pool, POLICY);
      const [after] = await listCompanies(db.pool);
      assert.equal(after.talentCost, 4480);
      assert.equal(after.talentMultiplier, company.talentMultiplier);
      assert.equal(after.talentCostFactor, 1.12);
      assert.equal(after.effectiveMultiplier, 1.2544);
      assert.equal(after.burnRate, 2509);
      assert.equal(after.burnRate, Math.round(2000 * 1.2544));
      assert.equal(after.baseBurnRate, 2000);
      const contributionAfter = after.talentMix.reduce((total, group) => total + group.contribution, 0);
      assert.equal(Math.round(contributionAfter * 10000) / 10000, after.talentMultiplier);
      const stored = await db.pool.query(
        'SELECT cash, burn_rate FROM companies WHERE id = $1',
        [companyId]
      );
      assert.equal(Number(stored.rows[0].cash), 15000);
      assert.equal(Number(stored.rows[0].burn_rate), 2000);
      await deleteTrigger(db.pool, POLICY.id);
      const [restored] = await listCompanies(db.pool);
      assert.equal(restored.talentCost, 4000);
      assert.equal(restored.talentMultiplier, 1.12);
      assert.equal(restored.talentCostFactor, 1);
      assert.equal(restored.effectiveMultiplier, 1.12);
      assert.equal(restored.burnRate, 2240);
    } finally {
      await db.close();
    }
  });

  test('NULL hype and talent_cost fall back to the baseline or the column default', async () => {
    const db = await createThrowawayDatabase();
    try {
      await applyMigration(db.pool, 'migrations/001_initial_schema.sql', 'up');
      await applyMigration(db.pool, 'migrations/002_real_world_trigger_effects.sql', 'up');
      await applyMigration(db.pool, 'migrations/003_trigger_contract_v1.sql', 'up');
      await db.pool.query(
        `INSERT INTO companies (name, cash, burn_rate, hype, talent_cost)
         VALUES ('Blank', 15000, NULL, NULL, NULL)`
      );
      await db.pool.query(
        `INSERT INTO companies (name, cash, burn_rate, hype, talent_cost, hype_baseline, talent_cost_baseline)
         VALUES ('Based', 15000, 2000, NULL, NULL, 0.42, 4100)`
      );
      const companies = await listCompanies(db.pool);
      const blank = companies.find((company) => company.name === 'Blank');
      const based = companies.find((company) => company.name === 'Based');
      assert.equal(blank.hype, 0.3);
      assert.equal(blank.talentCost, 4000);
      assert.equal(blank.baselines.hype, 0.3);
      assert.equal(blank.baselines.talentCost, 4000);
      assert.equal(blank.talentMultiplier, 1);
      assert.equal(blank.talentCostFactor, 1);
      assert.equal(blank.effectiveMultiplier, 1);
      assert.deepEqual(blank.talentMix, []);
      assert.equal(blank.baseBurnRate, 0);
      assert.equal(blank.burnRate, 0);
      assert.equal(based.hype, 0.42);
      assert.equal(based.talentCost, 4100);
      assert.equal(based.baselines.hype, 0.42);
      assert.equal(based.baselines.talentCost, 4100);
      assert.equal(based.baseBurnRate, 2000);
      assert.equal(based.burnRate, 2000);
      for (const company of [blank, based]) {
        for (const key of [
          'cash',
          'hype',
          'talentCost',
          'burnRate',
          'baseBurnRate',
          'talentMultiplier',
          'talentCostFactor',
          'effectiveMultiplier'
        ]) {
          assert.equal(Number.isFinite(company[key]), true, `${company.name} ${key}`);
        }
        const encoded = JSON.parse(JSON.stringify(company));
        assert.equal(encoded.hype, company.hype);
        assert.equal(encoded.talentCost, company.talentCost);
        assert.equal(encoded.burnRate, company.burnRate);
        assert.equal(encoded.baseBurnRate, company.baseBurnRate);
        assert.equal(encoded.talentMultiplier, company.talentMultiplier);
      }
    } finally {
      await db.close();
    }
  });

  test('no employees and a policy trigger burn round(2000 * 1.12), then stack, floor, and clear', async () => {
    const db = await createThrowawayDatabase();
    try {
      await applyMigration(db.pool, 'migrations/001_initial_schema.sql', 'up');
      await applyMigration(db.pool, 'migrations/002_real_world_trigger_effects.sql', 'up');
      await applyMigration(db.pool, 'migrations/003_trigger_contract_v1.sql', 'up');
      await db.pool.query(
        `INSERT INTO companies (name, cash, burn_rate, hype)
         VALUES ('Citizen', 15000, 2000, 0.3)`
      );
      const [before] = await listCompanies(db.pool);
      assert.equal(before.talentMultiplier, 1);
      assert.equal(before.talentCostFactor, 1);
      assert.equal(before.burnRate, 2000);

      await createTrigger(db.pool, POLICY);
      const [policy] = await listCompanies(db.pool);
      assert.equal(policy.talentCost, 4480);
      assert.equal(policy.talentCostFactor, 1.12);
      assert.equal(policy.effectiveMultiplier, 1.12);
      assert.equal(policy.burnRate, 2240);
      const stored = await db.pool.query('SELECT burn_rate, cash FROM companies');
      assert.equal(Number(stored.rows[0].burn_rate), 2000);
      assert.equal(Number(stored.rows[0].cash), 15000);

      await createTrigger(db.pool, { ...POLICY, effect: { talentCost: 0.2 } });
      const [replaced] = await listCompanies(db.pool);
      assert.equal(replaced.talentCost, 4800);
      assert.equal(replaced.talentCostFactor, 1.2);
      assert.equal(replaced.burnRate, 2400);
      assert.notEqual(replaced.talentCostFactor, 1.12 * 1.2);

      await createTrigger(db.pool, POLICY);
      await createTrigger(db.pool, MARKET);
      const [stacked] = await listCompanies(db.pool);
      assert.equal(stacked.talentCost, 4121.6);
      assert.equal(stacked.talentCostFactor, 1.0304);
      assert.equal(stacked.burnRate, Math.round(2000 * 1.0304));
      assert.ok(Math.abs(stacked.hype - 0.25) < 1e-9);

      await createTrigger(db.pool, {
        id: 'evt-shock',
        type: 'market_shift',
        label: 'Shock',
        source: 'mock:local',
        timestamp: '2026-06-01T00:00:00.000Z',
        effect: { talentCost: -5 }
      });
      const [floored] = await listCompanies(db.pool);
      assert.equal(floored.talentCost, 0);
      assert.equal(floored.talentCostFactor, 0.1);
      assert.equal(floored.talentCostFactorClamped, true);
      assert.equal(floored.effectiveMultiplier, 0.1);
      assert.equal(floored.burnRate, 200);

      await clearTriggers(db.pool);
      const [cleared] = await listCompanies(db.pool);
      assert.equal(cleared.talentCost, 4000);
      assert.equal(cleared.talentCostFactor, 1);
      assert.equal(cleared.talentCostFactorClamped, false);
      assert.equal(cleared.effectiveMultiplier, 1);
      assert.equal(cleared.burnRate, 2000);
      assert.equal(cleared.hype, 0.3);
    } finally {
      await db.close();
    }
  });

  test('three +100 triggers clamp the read factor to 3 and clear restores 1', async () => {
    const db = await createThrowawayDatabase();
    try {
      await applyMigration(db.pool, 'migrations/001_initial_schema.sql', 'up');
      await applyMigration(db.pool, 'migrations/002_real_world_trigger_effects.sql', 'up');
      await applyMigration(db.pool, 'migrations/003_trigger_contract_v1.sql', 'up');
      await db.pool.query(
        `INSERT INTO companies (name, cash, burn_rate, hype)
         VALUES ('Citizen', 15000, 2000, 0.3)`
      );
      for (const id of ['evt-max-a', 'evt-max-b', 'evt-max-c']) {
        await createTrigger(db.pool, {
          id,
          type: 'policy_change',
          label: id,
          source: 'mock:local',
          timestamp: '2026-06-01T00:00:00.000Z',
          effect: { talentCost: 100 }
        });
      }
      const [company] = await listCompanies(db.pool);
      assert.equal(company.talentCost, 4121204000);
      assert.equal(company.talentCostFactor, 3);
      assert.equal(company.talentCostFactorClamped, true);
      assert.equal(company.talentMultiplier, 1);
      assert.equal(company.effectiveMultiplier, 3);
      assert.equal(company.burnRate, 6000);
      assert.equal(company.hype, 0.3);
      assert.equal(Number.isFinite(company.burnRate), true);
      assert.ok(company.burnRate > 0);
      assert.ok(company.burnRate <= 2000 * 3);
      const stored = await db.pool.query('SELECT talent_cost, burn_rate, hype FROM companies');
      assert.equal(Number(stored.rows[0].talent_cost), 4121204000);
      assert.equal(Number(stored.rows[0].burn_rate), 2000);
      assert.equal(Number(stored.rows[0].hype), 0.3);

      const server = await startServer({ pool: db.pool, port: 0, host: '127.0.0.1' });
      try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/companies`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body[0].talentCostFactor, 3);
        assert.equal(body[0].talentCostFactorClamped, true);
        assert.equal(body[0].burnRate, 6000);
        assert.equal(body[0].talentCost, 4121204000);
      } finally {
        await new Promise((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }

      await clearTriggers(db.pool);
      const [cleared] = await listCompanies(db.pool);
      assert.equal(cleared.talentCost, 4000);
      assert.equal(cleared.talentCostFactor, 1);
      assert.equal(cleared.talentCostFactorClamped, false);
      assert.equal(cleared.burnRate, 2000);
    } finally {
      await db.close();
    }
  });
});
