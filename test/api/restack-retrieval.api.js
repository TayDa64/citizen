/**
 * CIT-125 Rank-3 — restack_campaign_id projection + bounded compensation window.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import {
  commitTurn,
  createCampaign,
  getCampaign,
  listTurnCommits,
} from '../../server/campaigns.js';
import { findTornMonths, restackCampaignTriggers } from '../../server/campaignRestack.js';
import {
  insertIngestRun,
  restackCampaignIdFromResult,
} from '../../server/eventIngest.js';
import {
  EMPTY_BURN,
  FULL_BURN,
  WAGE,
  migratedDatabase,
} from '../model/restack-fixture.js';
import { createThrowawayDatabase } from './throwaway-db.js';

async function migrateAll(pool) {
  for (const file of UP_MIGRATIONS) {
    await applyMigration(pool, file, 'up');
  }
}

/** What 51ce1db left behind when its restack died after clear_triggers. */
async function legacyTornRestack(pool, campaignId) {
  const startedAt = new Date();
  await commitTurn(pool, campaignId, { type: 'clear_triggers' });
  await insertIngestRun(pool, {
    startedAt,
    finishedAt: new Date(),
    adapter: 'fixture',
    fixtureId: 'civic-wage-bulletin',
    status: 'error',
    changed: false,
    error: 'connection lost mid-restack',
    triggerClientIds: [WAGE.id],
    resultJson: { triggerIds: [WAGE.id], restackFailed: true, campaignId },
  });
}

describe('CIT-125 restack audit retrieval', { concurrency: 1, timeout: 120_000 }, () => {
  test('migration 010 adds restack_campaign_id + partial index', async () => {
    const db = await createThrowawayDatabase();
    try {
      await migrateAll(db.pool);
      const columns = await db.pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'ingest_runs'
           AND column_name = 'restack_campaign_id'`,
      );
      assert.equal(columns.rowCount, 1);
      const indexes = await db.pool.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname = 'idx_ingest_runs_restack_campaign'`,
      );
      assert.equal(indexes.rowCount, 1);
    } finally {
      await db.close();
    }
  });

  test('restackCampaignIdFromResult reads success restack and failed shapes', () => {
    assert.equal(
      restackCampaignIdFromResult({ restack: { campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }),
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    assert.equal(
      restackCampaignIdFromResult({
        restackFailed: true,
        campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    assert.equal(restackCampaignIdFromResult({ events: [] }), null);
    assert.equal(
      restackCampaignIdFromResult({ events: [] }, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    );
  });

  test('insertIngestRun projects restack_campaign_id; compensation query Index Scans', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'restack-idx' });
      const noiseCampaign = '11111111-1111-4111-8111-111111111111';
      for (let index = 0; index < 80; index += 1) {
        await insertIngestRun(db.pool, {
          startedAt: new Date(Date.now() - index * 1000),
          finishedAt: new Date(Date.now() - index * 1000 + 10),
          adapter: 'fixture',
          fixtureId: 'civic-wage-bulletin',
          status: 'success',
          changed: false,
          error: null,
          triggerClientIds: [],
          resultJson: { events: [], triggerIds: [], noise: index },
        });
      }
      await insertIngestRun(db.pool, {
        startedAt: new Date(),
        finishedAt: new Date(),
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
        status: 'error',
        changed: false,
        error: 'torn',
        triggerClientIds: [WAGE.id],
        resultJson: {
          triggerIds: [WAGE.id],
          restackFailed: true,
          campaignId: campaign.id,
        },
      });
      await insertIngestRun(db.pool, {
        startedAt: new Date(),
        finishedAt: new Date(),
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
        status: 'success',
        changed: true,
        error: null,
        triggerClientIds: [WAGE.id],
        resultJson: {
          triggerIds: [WAGE.id],
          restack: { campaignId: noiseCampaign, homeId: 'mv', appliedTriggerIds: [WAGE.id] },
        },
      });

      const projected = await db.pool.query(
        `SELECT status, restack_campaign_id::text AS cid
         FROM ingest_runs
         WHERE restack_campaign_id IS NOT NULL
         ORDER BY status ASC`,
      );
      assert.deepEqual(
        projected.rows.map((row) => ({ status: row.status, cid: row.cid })),
        [
          { status: 'error', cid: campaign.id },
          { status: 'success', cid: noiseCampaign },
        ],
      );

      await db.pool.query('ANALYZE ingest_runs');
      // Tiny throwaway tables still prefer Seq Scan; disable it to prove the
      // partial index is selectable for the compensation predicate.
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL enable_seqscan = off');
        const explained = await client.query(
          `EXPLAIN (FORMAT TEXT)
           SELECT started_at, finished_at, status
           FROM ingest_runs
           WHERE restack_campaign_id = $1
             AND finished_at IS NOT NULL
           ORDER BY started_at ASC`,
          [campaign.id],
        );
        const plan = explained.rows.map((row) => row['QUERY PLAN']).join('\n');
        assert.match(plan, /Index .*Scan using idx_ingest_runs_restack_campaign/);
        assert.doesNotMatch(plan, /Seq Scan on ingest_runs/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    } finally {
      await db.close();
    }
  });

  test('compensation still charges 176/12 once with projected column + bounded ledger', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'restack-bound' });
      // Pre-restack history that must not force a full-ledger load to stay correct.
      for (let turn = 0; turn < 6; turn += 1) {
        await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      }
      await commitTurn(db.pool, campaign.id, { type: 'apply_trigger', trigger: WAGE });
      await legacyTornRestack(db.pool, campaign.id);
      const torn = await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      assert.equal(torn.state.company.burnRate, EMPTY_BURN);

      const projected = await db.pool.query(
        `SELECT restack_campaign_id::text AS cid FROM ingest_runs
         WHERE restack_campaign_id IS NOT NULL`,
      );
      assert.deepEqual(projected.rows.map((row) => row.cid), [campaign.id]);

      const restacked = await restackCampaignTriggers(db.pool, campaign.id);
      assert.deepEqual(restacked.compensatedSeqs, [torn.commit.seq]);
      const now = await getCampaign(db.pool, campaign.id);
      // 6 empty months before the wage apply + torn month re-billed at 2376.
      const expectedCash = 15000 - (EMPTY_BURN / 12) * 6 - FULL_BURN / 12;
      assert.ok(Math.abs(now.state.company.cash - expectedCash) < 1e-9);
      assert.equal(now.turn, 7);

      const compensations = (await listTurnCommits(db.pool, campaign.id))
        .filter((row) => row.command.type === 'compensate_torn_month');
      assert.equal(compensations.length, 1);

      const again = await findTornMonths(db.pool, campaign.id);
      assert.deepEqual(again, []);
    } finally {
      await db.close();
    }
  });
});
