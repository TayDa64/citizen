// These tests assert the FIXED behavior of the campaign restack. They were
// first written as a finding against 0a7b22a / 51ce1db, where they asserted
// the torn state (stack emptied, burn 2376 → 2200, month billed at 2200).
//
// Model: .cursor/skills/citizen-campaign-restack/spec/CitizenRestack.tla
//   Playing, 1 world event → Restack failed, 1 world event (old stack kept)
//
// Code: server/campaignRestack.js restackCampaignTriggers() writes
// clear_triggers and one apply_trigger per event inside ONE transaction that
// holds the campaign row lock (withCampaignTransaction in server/campaigns.js).
// A throw anywhere in it rolls the whole restack back.
//
// The failure is injected inside the real loop: pool.connect() returns a
// client whose query throws on the Nth INSERT INTO turn_commits. With one
// live trigger the command list is [clear_triggers, apply_trigger], so N=2
// lets the clear's INSERT run and rejects the apply's.
//
// If the restack goes back to one commit per command, the first test fails
// on the trigger count (0, not 1) and burn (2200, not 2376), and the second
// on the month billed at 2200. Do not weaken the numbers to make it pass.
//
// Run: npm run check:restack
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commitTurn, createCampaign, getCampaign } from '../../server/campaigns.js';
import { restackCampaignTriggers } from '../../server/campaignRestack.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import {
  FULL_BURN,
  WAGE,
  ledgerTypes,
  migratedDatabase,
  poolThatDiesOnCommit,
} from './restack-fixture.js';

describe('campaign restack atomicity', { concurrency: 1, timeout: 120_000 }, () => {
  test('a restack that dies mid-rebuild leaves the previous stack and burn 2376', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'restack-torn' });
      await commitTurn(db.pool, campaign.id, { type: 'apply_trigger', trigger: WAGE });
      const before = await getCampaign(db.pool, campaign.id);
      assert.equal(before.state.activeTriggers.length, 1, 'setup: the campaign starts with the wage event');
      assert.equal(effectiveBurnRate(before.state), FULL_BURN, 'setup: wage event previews burn 2376');
      const ledgerBefore = await ledgerTypes(db.pool, campaign.id);

      // Real loop, one transaction. The apply's INSERT throws after the clear's ran.
      await assert.rejects(
        () => restackCampaignTriggers(poolThatDiesOnCommit(db.pool, 2), campaign.id),
        (error) => error?.message === 'connection lost mid-restack',
        'restackCampaignTriggers throws from inside the real commit loop',
      );

      const after = await getCampaign(db.pool, campaign.id);
      assert.deepEqual(
        after.state.activeTriggers.map((trigger) => trigger.id),
        [WAGE.id],
        'the failed rebuild rolled back whole: the previous stack is untouched',
      );
      assert.equal(effectiveBurnRate(after.state), FULL_BURN, 'burn stays 2376');
      assert.equal(after.state.company.talentCost, 4320, 'talent cost keeps the wage event (4000 × 1.08)');
      assert.equal(after.turn, before.turn, 'no month moved');
      assert.deepEqual(
        await ledgerTypes(db.pool, campaign.id),
        ledgerBefore,
        'no turn_commits row from the failed rebuild survives, not even clear_triggers',
      );
    } finally {
      await db.close();
    }
  });

  test('a month advanced after that failure bills 2376', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'restack-month' });
      await commitTurn(db.pool, campaign.id, { type: 'apply_trigger', trigger: WAGE });
      await assert.rejects(
        () => restackCampaignTriggers(poolThatDiesOnCommit(db.pool, 2), campaign.id),
        (error) => error?.message === 'connection lost mid-restack',
        'the restack throws partway through',
      );

      const advanced = await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      assert.equal(advanced.state.company.burnRate, FULL_BURN, 'the month is billed at the full-stack 2376');
      assert.equal(advanced.state.company.cash, 15000 - FULL_BURN / 12, 'cash drains by 2376/12');

      // A later restack that succeeds has nothing torn to compensate.
      const restacked = await restackCampaignTriggers(db.pool, campaign.id);
      assert.deepEqual(restacked.compensatedSeqs, [], 'no month was billed on a torn stack');
      const now = await getCampaign(db.pool, campaign.id);
      assert.equal(now.state.company.cash, 15000 - FULL_BURN / 12, 'cash unchanged by the healthy restack');
    } finally {
      await db.close();
    }
  });
});
