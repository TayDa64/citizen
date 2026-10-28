import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { ingestAndPersist } from '../../server/eventIngest.js';
import { listCompanies } from '../../server/triggers.js';
import {
  FILTER_TRIGGERS_FOR_HOME_SQL,
  JURISDICTION_SEED,
} from '../../src/jurisdictionNest.js';
import { TriggerValidationError } from '../../src/triggerContract.js';
import { createThrowawayDatabase } from './throwaway-db.js';

async function migrateThrough(pool, throughFile) {
  for (const file of UP_MIGRATIONS) {
    await applyMigration(pool, file, 'up');
    if (file === throughFile) break;
  }
}

async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  await migrateThrough(db.pool, 'migrations/006_jurisdiction_nest.sql');
  await db.pool.query(
    `INSERT INTO companies (name, cash, burn_rate, hype)
     VALUES ('Citizen', 15000, 2000, 0.3)`,
  );
  return db;
}

describe('CIT-80 jurisdiction nest (006)', { concurrency: 1, timeout: 120_000 }, () => {
  test('seeds nest rows and adds home/trigger FK columns', async () => {
    const db = await migratedDatabase();
    try {
      const rows = await db.pool.query(
        `SELECT id, tier, parent_id FROM jurisdictions ORDER BY id`,
      );
      assert.deepEqual(
        rows.rows.map((row) => [row.id, row.tier, row.parent_id]),
        [
          ['ca', 'state', 'us'],
          ['mv', 'city', 'sc_county'],
          ['sc_county', 'county', 'ca'],
          ['sunnyvale', 'city', 'sc_county'],
          ['us', 'federal', null],
        ],
      );
      assert.equal(JURISDICTION_SEED.length, 5);

      const campaignCols = await db.pool.query(
        `SELECT column_name, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'campaigns'
           AND column_name = 'home_jurisdiction_id'`,
      );
      assert.equal(campaignCols.rowCount, 1);
      assert.match(String(campaignCols.rows[0].column_default), /mv/);

      const triggerCols = await db.pool.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'real_world_triggers'
           AND column_name = 'jurisdiction_id'`,
      );
      assert.equal(triggerCols.rowCount, 1);

      const meetings = await db.pool.query(`SELECT to_regclass('public.scheduled_meetings') AS name`);
      assert.equal(meetings.rows[0].name, null);
    } finally {
      await db.close();
    }
  });

  test('backfill + ingest stamp wage bulletin to mv; SQL chain excludes sunnyvale peer', async () => {
    const db = await createThrowawayDatabase();
    try {
      await migrateThrough(db.pool, 'migrations/005_ingest_runs.sql');
      await db.pool.query(
        `INSERT INTO companies (name, cash, burn_rate, hype)
         VALUES ('Citizen', 15000, 2000, 0.3)`,
      );
      await db.pool.query(
        `INSERT INTO real_world_triggers
           (client_id, source_url, trigger_type, label, scraped_at, processed)
         VALUES
           ('evt-pipeline-obs-civic-wage-bulletin-pre-006',
            'https://example.local/pre',
            'policy_change',
            'Wage pre',
            now(),
            true)`,
      );

      await applyMigration(db.pool, 'migrations/006_jurisdiction_nest.sql', 'up');
      // CIT-81: ingest_runs.scheduled_meeting_id lands in 007; apply before ingestAndPersist.
      await applyMigration(db.pool, 'migrations/007_scheduled_meetings.sql', 'up');

      const backfilled = await db.pool.query(
        `SELECT jurisdiction_id FROM real_world_triggers
         WHERE client_id = 'evt-pipeline-obs-civic-wage-bulletin-pre-006'`,
      );
      assert.equal(backfilled.rows[0].jurisdiction_id, 'mv');

      const ingested = await ingestAndPersist(db.pool, {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      assert.equal(ingested.triggers.length, 1);
      const stamped = await db.pool.query(
        `SELECT jurisdiction_id FROM real_world_triggers
         WHERE client_id = $1`,
        [ingested.triggers[0].id],
      );
      assert.equal(stamped.rows[0].jurisdiction_id, 'mv');

      const companies = await listCompanies(db.pool);
      assert.equal(companies[0].talentCostFactor, 1.08);
      // API burnRate untaxed base×factor; offline sim at tax 0.25 is 2376.
      assert.equal(companies[0].burnRate, 2160);

      await db.pool.query(
        `INSERT INTO real_world_triggers
           (client_id, source_url, trigger_type, label, scraped_at, processed, jurisdiction_id)
         VALUES
           ('evt-sunnyvale-peer-api',
            'mock:sunnyvale',
            'policy_change',
            'Sunnyvale peer',
            now(),
            true,
            'sunnyvale')`,
      );

      const chain = await db.pool.query(FILTER_TRIGGERS_FOR_HOME_SQL, ['mv']);
      const ids = chain.rows.map((row) => row.client_id).sort();
      assert.ok(ids.includes(ingested.triggers[0].id));
      assert.ok(ids.includes('evt-pipeline-obs-civic-wage-bulletin-pre-006'));
      assert.equal(ids.includes('evt-sunnyvale-peer-api'), false);

      const nullRows = await db.pool.query(
        `INSERT INTO real_world_triggers
           (client_id, source_url, trigger_type, label, scraped_at, processed, jurisdiction_id)
         VALUES
           ('evt-null-jurisdiction-api', 'mock:null', 'policy_change', 'Null', now(), true, NULL)
         RETURNING client_id`,
      );
      assert.equal(nullRows.rowCount, 1);
      const afterNull = await db.pool.query(FILTER_TRIGGERS_FOR_HOME_SQL, ['mv']);
      assert.equal(
        afterNull.rows.some((row) => row.client_id === 'evt-null-jurisdiction-api'),
        false,
      );
    } finally {
      await db.close();
    }
  });

  test('new campaign defaults home_jurisdiction_id to mv', async () => {
    const db = await migratedDatabase();
    try {
      const created = await db.pool.query(
        `INSERT INTO campaigns (seed, rule_version, state_version, turn, tax_rate, state_json)
         VALUES ('nest-default', 'citizen-slice2-v1', 1, 0, 0.25, '{}'::jsonb)
         RETURNING home_jurisdiction_id`,
      );
      assert.equal(created.rows[0].home_jurisdiction_id, 'mv');
    } finally {
      await db.close();
    }
  });

  test('firecrawl ingest still rejected and writes no triggers', async () => {
    const db = await migratedDatabase();
    try {
      await applyMigration(db.pool, 'migrations/007_scheduled_meetings.sql', 'up');
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
