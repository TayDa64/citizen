import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyMigration, UP_MIGRATIONS } from '../../server/migrate.js';
import {
  commitTurn,
  commitTurnFailBeforePersist,
  createCampaign,
  getCampaign,
  listTurnCommits,
} from '../../server/campaigns.js';
import { createThrowawayDatabase } from './throwaway-db.js';
import { SAMPLE_TRIGGERS } from '../../src/triggerContract.js';
import { stableMetrics, replayCommands, createGameState } from '../../src/turnEngine.js';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

async function migrateAll(pool) {
  for (const file of UP_MIGRATIONS) {
    await applyMigration(pool, file, 'up');
  }
}

describe('campaign turns persistence', { concurrency: 1, timeout: 120_000 }, () => {
  test('atomic commit advances turn; failed commit leaves no partial row', async () => {
    const db = await createThrowawayDatabase();
    try {
      await migrateAll(db.pool);
      const created = await createCampaign(db.pool, { seed: 'api-det-1' });
      assert.equal(created.turn, 0);
      assert.equal(created.state.company.cash, 15000);

      const committed = await commitTurn(db.pool, created.id, { type: 'advance_turn' });
      assert.equal(committed.turn, 1);
      assert.equal(committed.state.company.burnRate, 2200);
      assert.ok(committed.commit.seq >= 1);

      const reloaded = await getCampaign(db.pool, created.id);
      assert.equal(reloaded.turn, 1);
      assert.deepEqual(
        stableMetrics(reloaded.state),
        stableMetrics(committed.state),
      );

      const ledger = await listTurnCommits(db.pool, created.id);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0].command.type, 'advance_turn');

      const beforeFail = await getCampaign(db.pool, created.id);
      const afterRollback = await commitTurnFailBeforePersist(db.pool, created.id, {
        type: 'advance_turn',
      });
      assert.equal(afterRollback.turn, beforeFail.turn);
      assert.equal(afterRollback.state.company.cash, beforeFail.state.company.cash);
      const ledgerAfter = await listTurnCommits(db.pool, created.id);
      assert.equal(ledgerAfter.length, 1);
    } finally {
      await db.close();
    }
  });

  test('reload reproduces last committed state for a command sequence', async () => {
    const db = await createThrowawayDatabase();
    try {
      await migrateAll(db.pool);
      const created = await createCampaign(db.pool, { seed: 'replay-1' });
      const commands = [
        { type: 'set_tax', taxRate: 1 },
        { type: 'advance_turn' },
        { type: 'apply_trigger', trigger: policy },
        { type: 'advance_turn' },
      ];
      let last = created;
      for (const command of commands) {
        last = await commitTurn(db.pool, created.id, command);
      }
      const offline = replayCommands(createGameState({ seed: 'replay-1' }), commands);
      const reloaded = await getCampaign(db.pool, created.id);
      assert.deepEqual(stableMetrics(reloaded.state), stableMetrics(last.state));
      assert.equal(reloaded.state.company.burnRate, offline.state.company.burnRate);
      assert.equal(Math.round(reloaded.state.company.cash), Math.round(offline.state.company.cash));
    } finally {
      await db.close();
    }
  });
});
