import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createTrigger, listCompanies, listTriggers } from '../server/triggers.js';
import { startServer } from '../server/index.js';
import { applyMigration } from '../server/migrate.js';
import { createThrowawayDatabase } from './throwaway-db.js';

async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  await applyMigration(db.pool, 'migrations/001_initial_schema.sql', 'up');
  await applyMigration(db.pool, 'migrations/002_real_world_trigger_effects.sql', 'up');
  await db.pool.query(
    `INSERT INTO companies (name, cash, burn_rate, hype)
     VALUES ('Citizen', 15000, 2000, 0.3)`
  );
  return db;
}

describe('real-world trigger persistence', { concurrency: 1, timeout: 120_000 }, () => {
  test('mock hype trigger is stored from effects and does not change burn', async () => {
    const db = await migratedDatabase();
    try {
      const created = await createTrigger(db.pool, {
        type: 'news',
        label: 'Mock press cycle lifts founder hype',
        source: 'mock:press-cycle',
        effect: { hype: 0.1 }
      });
      assert.equal(created.type, 'news');
      assert.equal(created.label, 'Mock press cycle lifts founder hype');
      assert.equal(created.source, 'mock:press-cycle');
      assert.deepEqual(created.effect, { hype: 0.1 });
      assert.match(created.id, /^[0-9a-f-]{36}$/);
      assert.match(created.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.deepEqual(Object.keys(created).sort(), [
        'effect',
        'id',
        'label',
        'source',
        'timestamp',
        'type'
      ]);

      await db.pool.query(
        `UPDATE real_world_triggers SET extracted = '{"effect":{"hype":9}}'::jsonb WHERE id = $1`,
        [created.id]
      );
      const listed = await listTriggers(db.pool);
      assert.equal(listed.length, 1);
      assert.deepEqual(listed[0].effect, { hype: 0.1 });

      const effects = await db.pool.query(
        `SELECT formula, target_id IS NOT NULL AS has_target
         FROM effects WHERE trigger_id = $1`,
        [created.id]
      );
      assert.equal(effects.rowCount, 1);
      assert.equal(effects.rows[0].has_target, true);
      assert.equal(Number(effects.rows[0].formula.delta), 0.1);

      const companies = await listCompanies(db.pool);
      assert.equal(companies.length, 1);
      assert.ok(Math.abs(companies[0].hype - 0.4) < 1e-9);
      assert.equal(companies[0].talentCost, 4000);
      assert.equal(companies[0].cash, 15000);
      assert.equal(companies[0].burnRate, 2000);
    } finally {
      await db.close();
    }
  });

  test('talent and combined deltas update company metrics and clamp', async () => {
    const db = await migratedDatabase();
    try {
      await createTrigger(db.pool, {
        type: 'talent',
        label: 'Mock hiring surge raises talent cost',
        source: 'mock:labor-market',
        effect: { talentCost: 500 }
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
      await createTrigger(db.pool, {
        type: 'market',
        label: 'Both',
        source: 'mock:both',
        effect: { hype: 0.95, talentCost: -100000 }
      });

      const listed = await listTriggers(db.pool);
      assert.equal(listed.length, 2);
      assert.equal(listed[0].source, 'mock:both');
      assert.deepEqual(listed[0].effect, { hype: 0.95, talentCost: -100000 });
      assert.deepEqual(listed[1].effect, { talentCost: 500 });

      const [company] = await listCompanies(db.pool);
      assert.equal(company.hype, 1);
      assert.equal(company.talentCost, 0);
      assert.equal(company.burnRate, 2000);
    } finally {
      await db.close();
    }
  });

  test('invalid payloads and hostile labels do not change the schema data', async () => {
    const db = await migratedDatabase();
    try {
      await assert.rejects(() =>
        createTrigger(db.pool, {
          type: 'news',
          label: 'bad',
          source: 'mock:bad',
          effect: { burnRate: 99999 }
        })
      );
      const label = "'); DROP TABLE companies; --";
      const stored = await createTrigger(db.pool, {
        type: 'policy',
        label,
        source: 'mock:inject',
        effect: { hype: 0.05 }
      });
      assert.equal(stored.label, label);

      const triggers = await db.pool.query('SELECT label FROM real_world_triggers');
      assert.deepEqual(
        triggers.rows.map((row) => row.label),
        [label]
      );
      const companies = await db.pool.query('SELECT COUNT(*)::int AS n FROM companies');
      assert.equal(companies.rows[0].n, 1);
      const [company] = await listCompanies(db.pool);
      assert.ok(Math.abs(company.hype - 0.35) < 1e-9);
      assert.equal(company.burnRate, 2000);
    } finally {
      await db.close();
    }
  });

  test('HTTP mock trigger and validation errors', async () => {
    const db = await migratedDatabase();
    const server = await startServer({ pool: db.pool, port: 0, host: '127.0.0.1' });
    try {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;

      const created = await fetch(`${base}/api/triggers/mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'talent' })
      });
      assert.equal(created.status, 201);
      const trigger = await created.json();
      assert.equal(trigger.type, 'talent');
      assert.deepEqual(trigger.effect, { talentCost: 500 });
      assert.equal(Object.hasOwn(trigger.effect, 'hype'), false);

      const listed = await fetch(`${base}/api/triggers`);
      assert.equal(listed.status, 200);
      const triggers = await listed.json();
      assert.equal(triggers.length, 1);
      assert.equal(triggers[0].id, trigger.id);

      const companies = await fetch(`${base}/api/companies`);
      const companyList = await companies.json();
      assert.equal(companyList[0].talentCost, 4500);
      assert.equal(companyList[0].burnRate, 2000);
      assert.equal(companyList[0].cash, 15000);
      assert.equal(companyList[0].hype, 0.3);

      const rejected = await fetch(`${base}/api/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'news',
          label: 'nope',
          source: 'mock:nope',
          effect: { hype: 0.1 },
          extra: true
        })
      });
      assert.equal(rejected.status, 400);
      const errorBody = await rejected.json();
      assert.equal(errorBody.error, 'Invalid trigger payload');
      assert.ok(errorBody.issues.some((issue) => issue.path === 'extra'));

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
