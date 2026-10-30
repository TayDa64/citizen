// These tests assert a FINDING. They pass while the bug exists.
// They are not tests of correct behavior. Do not "fix" a failure by
// weakening the numbers below — read the comment at the bottom of this
// header first.
//
// Model: .cursor/skills/citizen-campaign-restack/spec/CitizenRestack.tla
//   Playing, 1 world event → Rebuilding, no world events → Restack failed
//
// Code: server/campaignRestack.js restackCampaignTriggers() issues
// clear_triggers and one apply_trigger per event, each through its own
// commitTurn() transaction (server/campaigns.js). server/eventIngest.js
// records an ingest_runs error when that loop throws and does not repair
// the campaign. shouldRestackAfterIngest() is false when changed=false,
// so an identical re-run does not rebuild the stack either.
//
// The failure is injected inside the real loop: pool.connect() returns a
// client whose query throws on the Nth INSERT INTO turn_commits. With one
// live trigger the command list is [clear_triggers, apply_trigger], so N=2
// lets the clear commit and rejects the apply.
//
// When the restack is made atomic, invert these two tests so they assert
// the atomic behavior: a failed rebuild leaves the previous stack and burn
// 2376, and a month advanced after that failure is billed at 2376. If the
// rebuild becomes a single commit, assert.rejects fails first with
// "Missing expected rejection." because the second INSERT never happens.
//
// Run: npm run check:restack
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import { commitTurn, createCampaign, getCampaign } from '../../server/campaigns.js';
import { restackCampaignTriggers } from '../../server/campaignRestack.js';
import { effectiveBurnRate } from '../../src/talentMultiplier.js';
import { createThrowawayDatabase } from '../api/throwaway-db.js';

const WAGE = {
  id: 'evt-wage-live',
  type: 'policy_change',
  label: 'Wage ordinance',
  source: 'mock:test',
  timestamp: '2026-10-01T00:00:00.000Z',
  effect: { talentCost: 0.08 },
};

const FINDING = 'FINDING (passes while the bug exists, not a test of correct behavior)';

async function migratedDatabase() {
  const db = await createThrowawayDatabase();
  for (const file of UP_MIGRATIONS) {
    await applyMigration(db.pool, file, 'up');
  }
  await db.pool.query(
    `INSERT INTO companies (name, cash, burn_rate, hype)
     VALUES ('Citizen', 15000, 2000, 0.3)`,
  );
  await db.pool.query(
    `INSERT INTO real_world_triggers
       (client_id, source_url, trigger_type, label, scraped_at, processed, jurisdiction_id)
     VALUES ($1, 'mock:test', 'policy_change', 'Wage ordinance', now(), true, 'mv')`,
    [WAGE.id],
  );
  const target = await db.pool.query(
    `INSERT INTO simulation_objects (name, type, default_value, min_value, max_value)
     VALUES ('talent_cost', 'metric', 4000, 0, 9999999999.99)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const triggerRow = await db.pool.query(
    `SELECT id FROM real_world_triggers WHERE client_id = $1`,
    [WAGE.id],
  );
  await db.pool.query(
    `INSERT INTO effects (target_id, trigger_id, formula, direction, is_active)
     VALUES ($1, $2, $3::jsonb, 'output', true)`,
    [target.rows[0].id, triggerRow.rows[0].id, JSON.stringify({ op: 'mul', delta: 0.08 })],
  );
  return db;
}

/**
 * A pool whose Nth `INSERT INTO turn_commits` throws, as a crash mid-loop would.
 * Every other statement, including the ROLLBACK after the throw, is forwarded.
 */
function poolThatDiesOnCommit(pool, failAt) {
  let inserts = 0;
  return {
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect();
      return {
        query: async (text, params) => {
          if (typeof text === 'string' && text.includes('INSERT INTO turn_commits')) {
            inserts += 1;
            if (inserts === failAt) {
              throw new Error('connection lost mid-restack');
            }
          }
          return client.query(text, params);
        },
        release: () => client.release(),
      };
    },
  };
}

describe('campaign restack atomicity finding', { concurrency: 1, timeout: 120_000 }, () => {
  test('a restack that dies between commits leaves the campaign with no world events', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'restack-torn' });
      await commitTurn(db.pool, campaign.id, { type: 'apply_trigger', trigger: WAGE });
      const before = await getCampaign(db.pool, campaign.id);
      assert.equal(
        before.state.activeTriggers.length,
        1,
        'setup: the campaign starts with the wage event',
      );
      assert.equal(
        effectiveBurnRate(before.state),
        2376,
        'setup: wage event previews burn 2376',
      );

      // Real loop, real transactions. The clear commits; the apply's INSERT throws.
      const doomed = poolThatDiesOnCommit(db.pool, 2);
      await assert.rejects(
        () => restackCampaignTriggers(doomed, campaign.id),
        (error) => error?.message === 'connection lost mid-restack',
        `${FINDING}: restackCampaignTriggers throws from inside the real commit loop`,
      );

      const after = await getCampaign(db.pool, campaign.id);
      assert.equal(
        after.state.activeTriggers.length,
        0,
        `${FINDING}: clear_triggers committed and apply_trigger did not, so activeTriggers is empty`,
      );
      assert.equal(
        effectiveBurnRate(after.state),
        2200,
        `${FINDING}: burn dropped 2376 → 2200 because the torn stack has no world events`,
      );
      assert.equal(
        after.state.company.talentCost,
        4000,
        `${FINDING}: talent cost fell back to the 4000 baseline with the stack cleared`,
      );
    } finally {
      await db.close();
    }
  });

  test('a month advanced on that torn stack bills 2200 and is never corrected', async () => {
    const db = await migratedDatabase();
    try {
      const campaign = await createCampaign(db.pool, { seed: 'restack-month' });
      await commitTurn(db.pool, campaign.id, { type: 'apply_trigger', trigger: WAGE });
      await assert.rejects(
        () => restackCampaignTriggers(poolThatDiesOnCommit(db.pool, 2), campaign.id),
        (error) => error?.message === 'connection lost mid-restack',
        `${FINDING}: the restack throws after clear_triggers has committed`,
      );

      const advanced = await commitTurn(db.pool, campaign.id, { type: 'advance_turn' });
      assert.equal(
        advanced.state.company.burnRate,
        2200,
        `${FINDING}: the month advanced in the torn window is billed at 2200`,
      );
      assert.equal(
        advanced.state.company.cash,
        15000 - 2200 / 12,
        `${FINDING}: cash drains by 2200/12, the torn-stack burn, not 2376/12`,
      );

      // Putting the wage event back does not revisit the month already billed.
      await commitTurn(db.pool, campaign.id, { type: 'apply_trigger', trigger: WAGE });
      const now = await getCampaign(db.pool, campaign.id);
      assert.equal(
        now.state.activeTriggers.length,
        1,
        'the wage event can be applied again after the torn restack',
      );
      assert.equal(
        effectiveBurnRate(now.state),
        2376,
        're-applying the event restores the 2376 preview for later months',
      );
      assert.equal(
        now.state.company.cash,
        15000 - 2200 / 12,
        `${FINDING}: the month already billed at 2200 is never corrected`,
      );
      assert.equal(
        now.state.company.burnRate,
        2200,
        `${FINDING}: the committed burn for that month stays 2200 after the event returns`,
      );
    } finally {
      await db.close();
    }
  });
});
