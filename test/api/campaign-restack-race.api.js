// Real-Postgres race checks for the campaign restack (CIT-69 follow-up).
//
// The first restack parks after writing clear_triggers, where its next
// command asks for the campaign row lock (poolThatPausesAfterClear). The
// competitor — an advance_turn or a second restack — then either finishes
// inside that window (the old one-commit-per-command loop at 51ce1db) or
// waits on the campaign row lock (the restack as one locked transaction). The assertions only hold when the
// competitor is serialized behind or ahead of the whole restack.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commitTurn, createCampaign, getCampaign } from '../../server/campaigns.js';
import { restackCampaignTriggers } from '../../server/campaignRestack.js';
import {
  FULL_BURN,
  WAGE,
  insertLiveTrigger,
  ledgerTypes,
  migratedDatabase,
  poolThatPausesAfterClear,
  poolThatPausesAtFirstLock,
  settledOrBlocked,
} from '../model/restack-fixture.js';

async function campaignWithWage(pool, seed) {
  const campaign = await createCampaign(pool, { seed });
  await commitTurn(pool, campaign.id, { type: 'apply_trigger', trigger: WAGE });
  return campaign;
}

describe('campaign restack races', { concurrency: 1, timeout: 120_000 }, () => {
  test('an advance_turn racing a restack is billed on a full stack', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await campaignWithWage(db.pool, 'race-advance');
      const paused = poolThatPausesAfterClear(db.pool);
      const restack = restackCampaignTriggers(paused.pool, campaign.id);
      await paused.reached;

      const advance = commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      const competitor = await settledOrBlocked(db.pool, advance);
      paused.release();
      const [, advanced] = await Promise.all([restack, advance]);

      assert.equal(
        advanced.state.company.burnRate,
        FULL_BURN,
        `month billed at ${advanced.state.company.burnRate}, not the full-stack 2376 (advance ${competitor} inside the restack window)`,
      );
      assert.equal(advanced.state.company.cash, 15000 - FULL_BURN / 12, 'cash drains by 2376/12');
      const now = await getCampaign(db.pool, campaign.id);
      assert.deepEqual(now.state.activeTriggers.map((trigger) => trigger.id), [WAGE.id]);
      assert.deepEqual(
        await ledgerTypes(db.pool, campaign.id),
        ['apply_trigger', 'clear_triggers', 'apply_trigger', 'advance_turn'],
        'the advance commits after the whole restack, never between its clear and apply',
      );
    } finally {
      await db.close();
    }
  });

  test('two restacks racing on one campaign never interleave', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await campaignWithWage(db.pool, 'race-restack');
      const paused = poolThatPausesAfterClear(db.pool);
      const first = restackCampaignTriggers(paused.pool, campaign.id);
      await paused.reached;

      const second = restackCampaignTriggers(db.pool, campaign.id);
      const competitor = await settledOrBlocked(db.pool, second);
      paused.release();
      await Promise.all([first, second]);

      assert.deepEqual(
        await ledgerTypes(db.pool, campaign.id),
        ['apply_trigger', 'clear_triggers', 'apply_trigger', 'clear_triggers', 'apply_trigger'],
        `each restack is one contiguous clear + full apply set (second restack ${competitor} inside the first's window)`,
      );
      const now = await getCampaign(db.pool, campaign.id);
      assert.deepEqual(now.state.activeTriggers.map((trigger) => trigger.id), [WAGE.id], 'exactly one full stack');
      const advanced = await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      assert.equal(advanced.state.company.burnRate, FULL_BURN, 'the next month bills the full-stack 2376');
    } finally {
      await db.close();
    }
  });

  test('a restack that started before a newer ingest cannot put back the older selection', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await campaignWithWage(db.pool, 'race-stale');
      // First restack is under way but has not taken the campaign lock yet.
      const paused = poolThatPausesAtFirstLock(db.pool);
      const first = restackCampaignTriggers(paused.pool, campaign.id);
      await paused.reached;

      // A newer ingest stores a second trigger and restacks to both.
      await insertLiveTrigger(db.pool, 'evt-rent-live', 'Rent ordinance', 0.05);
      const second = await restackCampaignTriggers(db.pool, campaign.id);
      assert.deepEqual([...second.appliedTriggerIds].sort(), ['evt-rent-live', WAGE.id]);
      paused.release();
      await first;

      const now = await getCampaign(db.pool, campaign.id);
      assert.deepEqual(
        now.state.activeTriggers.map((trigger) => trigger.id).sort(),
        ['evt-rent-live', WAGE.id],
        'the restack that commits last read the triggers under the lock, so the newer selection survives',
      );
    } finally {
      await db.close();
    }
  });
});
