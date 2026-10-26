import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SAMPLE_TRIGGERS } from '../../src/triggerContract.js';
import { createTrigger, listCompanies } from '../../server/triggers.js';
import { startServer } from '../../server/index.js';
import { applyMigration } from '../../server/migrate.js';
import { createThrowawayDatabase } from './throwaway-db.js';

const [POLICY] = SAMPLE_TRIGGERS;

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
      assert.equal(after.burnRate, company.burnRate);
      assert.equal(after.baseBurnRate, 2000);
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
        for (const key of ['cash', 'hype', 'talentCost', 'burnRate', 'baseBurnRate', 'talentMultiplier']) {
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
});
