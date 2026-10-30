// Compensating entries for months billed on a torn stack (CIT-69 follow-up).
//
// The torn history is written the way the old one-commit-per-command restack
// at 51ce1db wrote it: clear_triggers commits on its own, the loop throws, and
// ingestAndPersist records ingest_runs status=error with restackFailed and the
// campaignId. A month advanced after that is billed at 2200, not 2376. The
// next restack that completes appends compensate_torn_month for it.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  commitTurn,
  createCampaign,
  getCampaign,
  listTurnCommits,
} from '../../server/campaigns.js';
import { restackCampaignTriggers } from '../../server/campaignRestack.js';
import { insertIngestRun } from '../../server/eventIngest.js';
import {
  EMPTY_BURN,
  FULL_BURN,
  WAGE,
  migratedDatabase,
  poolThatDiesOnCommit,
} from '../model/restack-fixture.js';

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

async function campaignWithWage(pool, seed) {
  const campaign = await createCampaign(pool, { seed });
  await commitTurn(pool, campaign.id, { type: 'apply_trigger', trigger: WAGE });
  return campaign;
}

const SHORTFALL = (FULL_BURN - EMPTY_BURN) / 12;

describe('compensate_torn_month', { concurrency: 1, timeout: 120_000 }, () => {
  test('a month billed at 2200 on a torn stack is charged the 176/12 difference once', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await campaignWithWage(db.pool, 'comp-once');
      await legacyTornRestack(db.pool, campaign.id);
      const torn = await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      assert.equal(torn.state.company.burnRate, EMPTY_BURN, 'setup: the torn month billed 2200');
      const tornRowBefore = await db.pool.query(
        `SELECT command_json, result_json FROM turn_commits WHERE campaign_id = $1 AND seq = $2`,
        [campaign.id, torn.commit.seq],
      );

      const restacked = await restackCampaignTriggers(db.pool, campaign.id);
      assert.deepEqual(restacked.compensatedSeqs, [torn.commit.seq]);
      const now = await getCampaign(db.pool, campaign.id);
      assert.equal(now.state.company.cash, 15000 - FULL_BURN / 12, 'cash now matches a month billed at 2376');
      assert.equal(now.turn, 1, 'compensation does not advance a month');

      const ledger = await listTurnCommits(db.pool, campaign.id);
      const entry = ledger.at(-1);
      assert.deepEqual(entry.command, {
        type: 'compensate_torn_month',
        sourceSeq: torn.commit.seq,
        month: 1,
        billedBurn: EMPTY_BURN,
        fullBurn: FULL_BURN,
      });
      assert.ok(Math.abs(entry.after.cash - entry.before.cash + SHORTFALL) < 1e-9, 'the entry charges 176/12');
      const tornRowAfter = await db.pool.query(
        `SELECT command_json, result_json FROM turn_commits WHERE campaign_id = $1 AND seq = $2`,
        [campaign.id, torn.commit.seq],
      );
      assert.deepEqual(tornRowAfter.rows, tornRowBefore.rows, 'the billed month itself is never rewritten');

      const again = await restackCampaignTriggers(db.pool, campaign.id);
      assert.deepEqual(again.compensatedSeqs, [], 'a second restack finds nothing left to compensate');
      const later = await getCampaign(db.pool, campaign.id);
      assert.equal(later.state.company.cash, 15000 - FULL_BURN / 12, 'charged once, not twice');
      const compensations = (await listTurnCommits(db.pool, campaign.id))
        .filter((row) => row.command.type === 'compensate_torn_month');
      assert.equal(compensations.length, 1);
    } finally {
      await db.close();
    }
  });

  test('a deliberate clear with no restack evidence is not compensated', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await campaignWithWage(db.pool, 'comp-deliberate');
      await commitTurn(db.pool, campaign.id, { type: 'clear_triggers' });
      await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      const restacked = await restackCampaignTriggers(db.pool, campaign.id);
      assert.deepEqual(restacked.compensatedSeqs, []);
      const now = await getCampaign(db.pool, campaign.id);
      assert.equal(now.state.company.cash, 15000 - EMPTY_BURN / 12, 'the player chose an empty stack; 2200 stands');
    } finally {
      await db.close();
    }
  });

  test('the torn window ends at the next stack change by someone else', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await campaignWithWage(db.pool, 'comp-window');
      await legacyTornRestack(db.pool, campaign.id);
      const torn = await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      // A player rebuilds the stack, then clears it on purpose and plays a month.
      await commitTurn(db.pool, campaign.id, { type: 'apply_trigger', trigger: WAGE });
      await commitTurn(db.pool, campaign.id, { type: 'clear_triggers' });
      await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });

      const restacked = await restackCampaignTriggers(db.pool, campaign.id);
      assert.deepEqual(restacked.compensatedSeqs, [torn.commit.seq], 'only the month inside the torn window');
      const now = await getCampaign(db.pool, campaign.id);
      assert.equal(
        now.state.company.cash,
        15000 - FULL_BURN / 12 - EMPTY_BURN / 12,
        'torn month re-billed at 2376; the deliberate empty month stays 2200',
      );
    } finally {
      await db.close();
    }
  });

  test('a failed restack does not compensate; the next successful one does', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await campaignWithWage(db.pool, 'comp-rollback');
      await legacyTornRestack(db.pool, campaign.id);
      const torn = await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      await assert.rejects(
        () => restackCampaignTriggers(poolThatDiesOnCommit(db.pool, 3), campaign.id),
        (error) => error?.message === 'connection lost mid-restack',
        'the compensation INSERT is the third in the transaction and it throws',
      );
      const mid = await getCampaign(db.pool, campaign.id);
      assert.equal(mid.state.company.cash, 15000 - EMPTY_BURN / 12, 'rolled back: no partial compensation');
      assert.deepEqual(mid.state.activeTriggers, [], 'rolled back: the torn stack is still what the old loop left');

      const restacked = await restackCampaignTriggers(db.pool, campaign.id);
      assert.deepEqual(restacked.compensatedSeqs, [torn.commit.seq]);
    } finally {
      await db.close();
    }
  });

  test('POST /turns cannot commit compensate_torn_month', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'comp-client' });
      await assert.rejects(
        () => commitTurn(db.pool, campaign.id, {
          type: 'compensate_torn_month', sourceSeq: 1, month: 1, billedBurn: 9999, fullBurn: 0,
        }),
        (error) => error?.status === 400 && /server restack only/.test(error.message),
      );
      const now = await getCampaign(db.pool, campaign.id);
      assert.equal(now.state.company.cash, 15000);
    } finally {
      await db.close();
    }
  });
});
