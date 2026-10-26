import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SAMPLE_TRIGGERS } from '../src/triggerContract.js';
import { createTrigger, listCompanies, listTriggers } from '../server/triggers.js';
import { startServer } from '../server/index.js';
import { applyMigration } from '../server/migrate.js';
import { createThrowawayDatabase } from './throwaway-db.js';

const [POLICY, NEWS, MARKET] = SAMPLE_TRIGGERS;

async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  await applyMigration(db.pool, 'migrations/001_initial_schema.sql', 'up');
  await applyMigration(db.pool, 'migrations/002_real_world_trigger_effects.sql', 'up');
  await applyMigration(db.pool, 'migrations/003_trigger_contract_v1.sql', 'up');
  await db.pool.query(
    `INSERT INTO companies (name, cash, burn_rate, hype)
     VALUES ('Citizen', 15000, 2000, 0.3)`
  );
  return db;
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);
}

describe('real-world trigger persistence', { concurrency: 1, timeout: 120_000 }, () => {
  test('news spike is stored from effects and does not change burn', async () => {
    const db = await migratedDatabase();
    try {
      const created = await createTrigger(db.pool, NEWS);
      assert.equal(created.id, NEWS.id);
      assert.equal(created.type, 'news_spike');
      assert.equal(created.label, NEWS.label);
      assert.equal(created.source, NEWS.source);
      assert.equal(created.timestamp, NEWS.timestamp);
      assert.deepEqual(created.effect, { hype: 0.1 });
      assert.deepEqual(Object.keys(created).sort(), [
        'effect',
        'id',
        'label',
        'source',
        'timestamp',
        'type'
      ]);

      await db.pool.query(
        `UPDATE real_world_triggers
         SET extracted = '{"effect":{"hype":9}}'::jsonb
         WHERE client_id = $1`,
        [created.id]
      );
      const listed = await listTriggers(db.pool);
      assert.equal(listed.length, 1);
      assert.deepEqual(listed[0].effect, { hype: 0.1 });

      const effects = await db.pool.query(
        `SELECT e.formula
         FROM effects e
         JOIN real_world_triggers t ON t.id = e.trigger_id
         WHERE t.client_id = $1`,
        [created.id]
      );
      assert.equal(effects.rowCount, 1);
      assert.equal(effects.rows[0].formula.op, 'add');
      assert.equal(Number(effects.rows[0].formula.delta), 0.1);

      const companies = await listCompanies(db.pool);
      assert.equal(companies.length, 1);
      closeTo(companies[0].hype, 0.4);
      assert.equal(companies[0].talentCost, 4000);
      assert.equal(companies[0].baselines.hype, 0.3);
      assert.equal(companies[0].baselines.talentCost, 4000);
      assert.equal(companies[0].cash, 15000);
      assert.equal(companies[0].burnRate, 2000);
    } finally {
      await db.close();
    }
  });

  test('the same id replaces and talent cost is a relative delta from baseline', async () => {
    const db = await migratedDatabase();
    try {
      await db.pool.query(
        `INSERT INTO companies (name, cash, burn_rate, hype, talent_cost)
         VALUES ('Other', 15000, 2000, 0.5, 8000)`
      );

      const first = await createTrigger(db.pool, POLICY);
      assert.deepEqual(first.effect, { talentCost: 0.12 });
      let companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCost, 4480);
      assert.equal(companies[1].talentCost, 8960);
      assert.equal(companies[0].baselines.talentCost, 4000);
      assert.equal(companies[1].baselines.talentCost, 8000);
      closeTo(companies[0].hype, 0.3);

      const second = await createTrigger(db.pool, POLICY);
      assert.equal(second.id, POLICY.id);
      assert.equal((await listTriggers(db.pool)).length, 1);
      companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCost, 4480);
      const policyEffects = await db.pool.query(
        `SELECT e.formula
         FROM effects e
         JOIN real_world_triggers t ON t.id = e.trigger_id
         WHERE t.client_id = $1`,
        [POLICY.id]
      );
      assert.equal(policyEffects.rowCount, 1);
      assert.equal(policyEffects.rows[0].formula.op, 'mul');
      assert.equal(Number(policyEffects.rows[0].formula.delta), 0.12);

      await createTrigger(db.pool, { ...POLICY, effect: { talentCost: 0.2 } });
      companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCost, 4800);
      assert.equal(companies[1].talentCost, 9600);
      assert.notEqual(companies[0].talentCost, 4480 * 1.2);
      assert.equal((await listTriggers(db.pool)).length, 1);

      await createTrigger(db.pool, NEWS);
      await createTrigger(db.pool, { ...NEWS, effect: { hype: 0.05 } });
      companies = await listCompanies(db.pool);
      closeTo(companies[0].hype, 0.35);
      closeTo(companies[1].hype, 0.55);
      assert.equal(companies[0].talentCost, 4800);
      assert.equal((await listTriggers(db.pool)).length, 2);

      await createTrigger(db.pool, MARKET);
      companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCost, 4416);
      assert.equal(companies[1].talentCost, 8832);
      closeTo(companies[0].hype, 0.3);
      closeTo(companies[1].hype, 0.5);
      const listed = await listTriggers(db.pool);
      assert.equal(listed.length, 3);
      assert.equal(listed[0].id, MARKET.id);
      assert.deepEqual(listed[0].effect, { talentCost: -0.08, hype: -0.05 });

      const shock = {
        id: 'evt-shock',
        type: 'market_shift',
        label: 'Shock',
        source: 'mock:local',
        timestamp: '2026-06-01T00:00:00.000Z',
        effect: { talentCost: -5 }
      };
      await createTrigger(db.pool, shock);
      companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCost, 0);
      assert.equal(companies[1].talentCost, 0);
      assert.equal(companies[0].baselines.talentCost, 4000);

      await createTrigger(db.pool, { ...shock, effect: { talentCost: 0.1 } });
      companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCost, 4857.6);
      assert.equal(companies[1].talentCost, 9715.2);
      assert.equal((await listTriggers(db.pool)).length, 4);
      assert.equal(companies[0].burnRate, 2000);
      assert.equal(companies[0].cash, 15000);

      await db.pool.query(
        `INSERT INTO real_world_triggers (source_url, trigger_type, label, client_id)
         VALUES ('legacy', 'news', 'old headline', 'legacy-news')`
      );
      await db.pool.query(
        `INSERT INTO effects (target_id, trigger_id, formula, direction, is_active)
         SELECT so.id, t.id, '{"op":"add","delta":500}'::jsonb, 'output', true
         FROM simulation_objects so
         JOIN real_world_triggers t ON t.client_id = 'legacy-news'
         WHERE so.name = 'talent_cost'`
      );
      await createTrigger(db.pool, { ...POLICY, effect: { talentCost: 0.2 } });
      companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCost, 4857.6);
      const visible = await listTriggers(db.pool);
      assert.equal(visible.length, 4);
      assert.equal(visible.some((trigger) => trigger.type === 'news'), false);

      await assert.rejects(
        () => createTrigger(db.pool, { ...NEWS, type: 'news' }),
        (error) => error.status === 400
      );
      const count = await db.pool.query(
        `SELECT COUNT(*)::int AS n FROM real_world_triggers WHERE trigger_type = 'news_spike'`
      );
      assert.equal(count.rows[0].n, 1);
    } finally {
      await db.close();
    }
  });

  test('invalid payloads and hostile labels do not change the schema data', async () => {
    const db = await migratedDatabase();
    try {
      await assert.rejects(() =>
        createTrigger(db.pool, {
          ...NEWS,
          effect: { burnRate: 99999 }
        })
      );
      const label = "'); DROP TABLE companies; --";
      const stored = await createTrigger(db.pool, { ...POLICY, label, effect: { hype: 0.05 } });
      assert.equal(stored.label, label);

      const triggers = await db.pool.query('SELECT label FROM real_world_triggers');
      assert.deepEqual(
        triggers.rows.map((row) => row.label),
        [label]
      );
      const companies = await db.pool.query('SELECT COUNT(*)::int AS n FROM companies');
      assert.equal(companies.rows[0].n, 1);
      const [company] = await listCompanies(db.pool);
      closeTo(company.hype, 0.35);
      assert.equal(company.talentCost, 4000);
      assert.equal(company.burnRate, 2000);
    } finally {
      await db.close();
    }
  });

  test('HTTP mock trigger is idempotent by id and validation errors do not insert', async () => {
    const db = await migratedDatabase();
    const server = await startServer({ pool: db.pool, port: 0, host: '127.0.0.1' });
    try {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;

      const created = await fetch(`${base}/api/triggers/mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'policy_change' })
      });
      assert.equal(created.status, 201);
      const trigger = await created.json();
      assert.equal(trigger.id, POLICY.id);
      assert.equal(trigger.type, 'policy_change');
      assert.deepEqual(trigger.effect, { talentCost: 0.12 });

      const again = await fetch(`${base}/api/triggers/mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'policy_change' })
      });
      assert.equal(again.status, 201);
      const repeated = await again.json();
      assert.equal(repeated.id, trigger.id);

      const listed = await fetch(`${base}/api/triggers`);
      assert.equal(listed.status, 200);
      const triggers = await listed.json();
      assert.equal(triggers.length, 1);
      assert.equal(triggers[0].id, POLICY.id);

      const companies = await fetch(`${base}/api/companies`);
      const companyList = await companies.json();
      assert.equal(companyList[0].talentCost, 4480);
      assert.equal(companyList[0].baselines.talentCost, 4000);
      assert.equal(companyList[0].burnRate, 2000);
      assert.equal(companyList[0].cash, 15000);
      closeTo(companyList[0].hype, 0.3);

      const replaced = await fetch(`${base}/api/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...POLICY, effect: { talentCost: 0.2 } })
      });
      assert.equal(replaced.status, 201);
      const afterReplace = await (await fetch(`${base}/api/companies`)).json();
      assert.equal(afterReplace[0].talentCost, 4800);
      const afterList = await (await fetch(`${base}/api/triggers`)).json();
      assert.equal(afterList.length, 1);
      assert.deepEqual(afterList[0].effect, { talentCost: 0.2 });

      const rejected = await fetch(`${base}/api/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...NEWS, extra: true })
      });
      assert.equal(rejected.status, 400);
      const errorBody = await rejected.json();
      assert.equal(errorBody.error, 'Invalid trigger payload');
      assert.ok(errorBody.issues.some((issue) => issue.path === 'extra'));

      const legacy = await fetch(`${base}/api/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...NEWS, type: 'news' })
      });
      assert.equal(legacy.status, 400);

      const count = await db.pool.query('SELECT COUNT(*)::int AS n FROM real_world_triggers');
      assert.equal(count.rows[0].n, 1);

      const huge = await fetch(`${base}/api/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: `{"label":"${'a'.repeat(20_000)}"}`
      });
      assert.equal(huge.status, 413);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await db.close();
    }
  });
});
