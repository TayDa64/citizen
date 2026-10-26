import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SAMPLE_TRIGGERS } from '../../src/triggerContract.js';
import {
  applyEffects,
  applyTriggerEffect,
  initialState,
  setTaxRate
} from '../../src/simulation.js';
import {
  APPLY_TALENT_COST_TO_BURN,
  composeTalentMultiplier,
  scaleTalentMultiplier,
  skillFactor
} from '../../src/talentBurn.js';
import { createTrigger, listCompanies } from '../../server/triggers.js';
import { startServer } from '../../server/index.js';
import { applyMigration } from '../../server/migrate.js';
import { createThrowawayDatabase } from './throwaway-db.js';

const [POLICY] = SAMPLE_TRIGGERS;

function burnFor(taxRate, talentMultiplier = 1) {
  return Math.round(2000 * (1 + taxRate * 0.4) * talentMultiplier);
}

function baseFor(taxRate) {
  return Math.round(2000 * (1 + taxRate * 0.4));
}

test('skill 0 is 0.6x, skill 0.5 is 1x, and skill 1 is 1.4x', () => {
  assert.equal(skillFactor(0), 0.6);
  assert.equal(skillFactor(0.5), 1);
  assert.equal(skillFactor(1), 1.4);
  assert.equal(skillFactor(-1), 0.6);
  assert.equal(skillFactor(2), 1.4);
});

test('no employees is exactly 1 and triggerFactor does not scale burn', () => {
  assert.equal(APPLY_TALENT_COST_TO_BURN, false);
  const empty = composeTalentMultiplier({ employees: [], triggerFactor: 1.12 });
  assert.equal(empty.talentMultiplier, 1);
  assert.deepEqual(empty.talentMix, []);
  const tech = composeTalentMultiplier({
    employees: [{ department: 'tech', skillTech: 1 }],
    triggerFactor: 2
  });
  assert.equal(tech.talentMultiplier, 1.75);
  const scaled = scaleTalentMultiplier(tech, 1.12);
  assert.equal(scaled.talentMultiplier, 1.96);
  assert.equal(scaled.talentMix[0].contribution, 1.96);
});

test('department weights, skill clamp, null department, and mean aggregation', () => {
  const tech = composeTalentMultiplier({
    employees: [
      { department: 'tech', skillTech: 1 },
      { department: 'Tech', skill_tech: 1 },
      { department: 'tech', skillTech: 1 },
      { department: 'tech', skillTech: 1 }
    ]
  });
  assert.equal(tech.talentMultiplier, 1.75);
  assert.deepEqual(tech.talentMix, [
    { department: 'tech', headcount: 4, avgSkill: 1, weight: 1.25, contribution: 1.75 }
  ]);

  assert.equal(
    composeTalentMultiplier({
      employees: [{ department: 'marketing', skillMarketing: 0.5 }]
    }).talentMultiplier,
    1.05
  );
  assert.equal(
    composeTalentMultiplier({
      employees: [{ department: 'sales', skillSales: 0.5 }]
    }).talentMultiplier,
    0.95
  );
  const missing = composeTalentMultiplier({
    employees: [{ department: null, skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 }]
  });
  assert.equal(missing.talentMultiplier, 1);
  assert.equal(missing.talentMix[0].department, null);
  assert.equal(missing.talentMix[0].weight, 1);
  assert.equal(missing.talentMix[0].avgSkill, 0.5);

  const clamped = composeTalentMultiplier({
    employees: [{ department: 'tech', skillTech: 1.8 }]
  });
  assert.equal(clamped.talentMultiplier, 1.75);
  assert.equal(clamped.talentMix[0].avgSkill, 1);
  assert.equal(
    composeTalentMultiplier({
      employees: [{ department: 'tech', skillTech: -3 }]
    }).talentMultiplier,
    0.75
  );
  assert.equal(
    composeTalentMultiplier({
      employees: [{ department: null, skillTech: 0, skillMarketing: 0, skillSales: 0 }]
    }).talentMultiplier,
    0.6
  );

  const inactive = composeTalentMultiplier({
    employees: [
      { department: 'tech', skillTech: 1, isActive: true },
      { department: 'sales', skillSales: 1, is_active: false }
    ]
  });
  assert.equal(inactive.talentMultiplier, 1.75);
  assert.equal(inactive.talentMix.length, 1);

  const thirds = composeTalentMultiplier({
    employees: [
      { department: 'c', skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 },
      { department: 'a', skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 },
      { department: 'b', skillTech: 0.5, skillMarketing: 0.5, skillSales: 0.5 }
    ]
  });
  assert.equal(thirds.talentMultiplier, 1);
  assert.deepEqual(
    thirds.talentMix.map((group) => group.department),
    ['a', 'b', 'c']
  );
  assert.deepEqual(
    thirds.talentMix.map((group) => group.contribution),
    [0.3333, 0.3333, 0.3334]
  );
  const sum = thirds.talentMix.reduce((total, group) => total + group.contribution, 0);
  assert.equal(Math.round(sum * 10000) / 10000, thirds.talentMultiplier);
});

describe('Slice 1 burn with the employee multiplier', () => {
  test('tax 0, 0.25, and 1 stay 2000, 2200, and 2800 with no employees', () => {
    for (const taxRate of [0, 0.25, 1]) {
      const next = applyEffects(setTaxRate(initialState, taxRate));
      assert.equal(next.company.baseBurnRate, baseFor(taxRate));
      assert.equal(next.company.burnRate, burnFor(taxRate));
      assert.equal(next.company.talentMultiplier, 1);
      assert.deepEqual(next.company.talentMix, []);
      assert.equal(next.company.burnRate, [2000, 2200, 2800][[0, 0.25, 1].indexOf(taxRate)]);
    }
    const second = applyEffects(applyEffects(setTaxRate(initialState, 0.25)));
    assert.equal(second.company.burnRate, 2200);
    assert.equal(second.company.cash, 15000 - 2200 / 12 - 2200 / 12);
  });

  test('a tech-heavy roster raises burn once and a second tick does not compound', () => {
    const staffed = {
      ...initialState,
      employees: [
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 }
      ]
    };
    const taxed = applyEffects(setTaxRate(staffed, 1));
    assert.equal(taxed.company.talentMultiplier, 1.75);
    assert.equal(taxed.company.baseBurnRate, 2800);
    assert.equal(taxed.company.burnRate, 4900);
    assert.equal(taxed.company.cash, 15000 - 4900 / 12);
    const second = applyEffects(taxed);
    assert.equal(second.company.burnRate, 4900);
    assert.equal(second.company.talentMultiplier, 1.75);
    assert.equal(second.company.cash, 15000 - 4900 / 12 - 4900 / 12);

    const triggered = applyTriggerEffect(taxed, POLICY);
    assert.equal(triggered.company.talentCost, 4480);
    assert.equal(triggered.company.burnRate, 4900);
    assert.equal(triggered.company.baseBurnRate, 2800);
    assert.equal(triggered.company.talentMultiplier, 1.75);
  });
});

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
});
