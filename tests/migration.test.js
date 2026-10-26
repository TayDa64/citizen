import assert from 'node:assert/strict';
import pg from 'pg';
import { describe, test } from 'node:test';
import { applyMigration } from '../server/migrate.js';
import { createThrowawayDatabase } from './throwaway-db.js';

const MIGRATION_001 = 'migrations/001_initial_schema.sql';
const MIGRATION_002 = 'migrations/002_real_world_trigger_effects.sql';
const MIGRATION_003 = 'migrations/003_trigger_contract_v1.sql';

async function columnExists(pool, table, column) {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return result.rowCount === 1;
}

async function assertSlice2Shape(pool, present) {
  assert.equal(await columnExists(pool, 'companies', 'talent_cost'), present);
  assert.equal(await columnExists(pool, 'real_world_triggers', 'trigger_type'), present);
  assert.equal(await columnExists(pool, 'real_world_triggers', 'label'), present);
  assert.equal(await columnExists(pool, 'effects', 'trigger_id'), present);

  const index = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_effects_trigger'`
  );
  assert.equal(index.rowCount === 1, present);

  const constraint = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'real_world_triggers_type_check'`
  );
  assert.equal(constraint.rowCount === 1, present);
}

describe('migration 002', { concurrency: 1, timeout: 120_000 }, () => {
  test('applies, rolls back, and reapplies on a throwaway local database', async () => {
    const db = await createThrowawayDatabase();
    try {
      await applyMigration(db.pool, MIGRATION_001, 'up');
      await db.pool.query(
        `INSERT INTO companies (name, cash, burn_rate, hype)
         VALUES ('Citizen', 15000, 2000, 0.3)`
      );

      await applyMigration(db.pool, MIGRATION_002, 'up');
      await assertSlice2Shape(db.pool, true);

      const withDefault = await db.pool.query(
        'SELECT talent_cost, cash, burn_rate, hype FROM companies WHERE name = $1',
        ['Citizen']
      );
      assert.equal(Number(withDefault.rows[0].talent_cost), 4000);
      assert.equal(Number(withDefault.rows[0].cash), 15000);
      assert.equal(Number(withDefault.rows[0].burn_rate), 2000);
      assert.equal(Number(withDefault.rows[0].hype), 0.3);

      await db.pool.query(
        `INSERT INTO real_world_triggers (source_url, trigger_type, label)
         VALUES ('mock:press-cycle', 'news', 'headline')`
      );
      await assert.rejects(() =>
        db.pool.query(
          `INSERT INTO real_world_triggers (trigger_type, label) VALUES ('nope', 'bad')`
        )
      );
      await db.pool.query(
        `INSERT INTO real_world_triggers (source_url) VALUES ('https://example.test/legacy')`
      );

      await applyMigration(db.pool, MIGRATION_002, 'down');
      await assertSlice2Shape(db.pool, false);
      for (const table of [
        'simulation_objects',
        'effects',
        'companies',
        'employees',
        'real_world_triggers'
      ]) {
        const found = await db.pool.query(`SELECT to_regclass($1) AS name`, [`public.${table}`]);
        assert.ok(found.rows[0].name, table);
      }
      assert.equal(await columnExists(db.pool, 'simulation_objects', 'embedding'), true);

      const preserved = await db.pool.query(
        'SELECT name, cash, burn_rate FROM companies WHERE name = $1',
        ['Citizen']
      );
      assert.equal(preserved.rows.length, 1);
      assert.equal(Number(preserved.rows[0].cash), 15000);
      assert.equal(Number(preserved.rows[0].burn_rate), 2000);
      await db.pool.query(
        `INSERT INTO companies (name) VALUES ('After rollback')`
      );
      await db.pool.query(
        `INSERT INTO real_world_triggers (source_url, extracted)
         VALUES ('https://example.test/still-works', '{"ok":true}'::jsonb)`
      );

      await applyMigration(db.pool, MIGRATION_002, 'up');
      await assertSlice2Shape(db.pool, true);
      const reapplied = await db.pool.query(
        'SELECT talent_cost FROM companies WHERE name = $1',
        ['Citizen']
      );
      assert.equal(Number(reapplied.rows[0].talent_cost), 4000);
    } finally {
      const name = db.name;
      await db.close();
      const admin = new pg.Client({ host: '/var/run/postgresql', database: 'postgres' });
      await admin.connect();
      try {
        const left = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
        assert.equal(left.rowCount, 0);
      } finally {
        await admin.end();
      }
    }
  });
});

describe('migration 003', { concurrency: 1, timeout: 120_000 }, () => {
  test('keeps legacy trigger types, adds v1 types, and rolls back', async () => {
    const db = await createThrowawayDatabase();
    try {
      await applyMigration(db.pool, MIGRATION_001, 'up');
      await applyMigration(db.pool, MIGRATION_002, 'up');
      await db.pool.query(
        `INSERT INTO companies (name, cash, burn_rate, hype)
         VALUES ('Citizen', 15000, 2000, 0.3)`
      );
      await applyMigration(db.pool, MIGRATION_003, 'up');

      assert.equal(await columnExists(db.pool, 'real_world_triggers', 'client_id'), true);
      assert.equal(await columnExists(db.pool, 'companies', 'hype_baseline'), true);
      assert.equal(await columnExists(db.pool, 'companies', 'talent_cost_baseline'), true);

      await db.pool.query(
        `INSERT INTO real_world_triggers (source_url, trigger_type, label)
         VALUES ('legacy', 'news', 'headline')`
      );
      await db.pool.query(
        `INSERT INTO real_world_triggers (source_url, trigger_type, label, client_id)
         VALUES ('mock:local', 'news_spike', 'News spike', 'evt-news-sector-spike')`
      );
      await db.pool.query(
        `INSERT INTO real_world_triggers (source_url) VALUES ('https://example.test/null-a')`
      );
      await db.pool.query(
        `INSERT INTO real_world_triggers (source_url) VALUES ('https://example.test/null-b')`
      );
      await assert.rejects(() =>
        db.pool.query(
          `INSERT INTO real_world_triggers (trigger_type, label, client_id)
           VALUES ('news_spike', 'dup', 'evt-news-sector-spike')`
        )
      );
      await assert.rejects(() =>
        db.pool.query(
          `INSERT INTO real_world_triggers (trigger_type, label) VALUES ('nope', 'bad')`
        )
      );

      const talent = await db.pool.query(
        'SELECT talent_cost FROM companies WHERE name = $1',
        ['Citizen']
      );
      assert.equal(Number(talent.rows[0].talent_cost), 4000);

      await applyMigration(db.pool, MIGRATION_003, 'down');
      assert.equal(await columnExists(db.pool, 'real_world_triggers', 'client_id'), false);
      assert.equal(await columnExists(db.pool, 'companies', 'hype_baseline'), false);
      assert.equal(await columnExists(db.pool, 'companies', 'talent_cost_baseline'), false);
      assert.equal(await columnExists(db.pool, 'companies', 'talent_cost'), true);

      const types = await db.pool.query(
        'SELECT trigger_type FROM real_world_triggers ORDER BY source_url'
      );
      assert.deepEqual(
        types.rows.map((row) => row.trigger_type),
        [null, null, 'news', null]
      );
      await db.pool.query(
        `INSERT INTO real_world_triggers (trigger_type, label) VALUES ('policy', 'still-legacy')`
      );
      await assert.rejects(() =>
        db.pool.query(
          `INSERT INTO real_world_triggers (trigger_type, label) VALUES ('news_spike', 'gone')`
        )
      );

      await applyMigration(db.pool, MIGRATION_003, 'up');
      assert.equal(await columnExists(db.pool, 'real_world_triggers', 'client_id'), true);
      await db.pool.query(
        `INSERT INTO real_world_triggers (trigger_type, label, client_id)
         VALUES ('market_shift', 'Market shift', 'evt-market-cooling')`
      );
    } finally {
      await db.close();
    }
  });
});
