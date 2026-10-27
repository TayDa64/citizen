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


  test('apply_trigger then advance_turn drains at policy burn 2464', async () => {
    const db = await createThrowawayDatabase();
    try {
      await migrateAll(db.pool);
      const created = await createCampaign(db.pool, {
        seed: 'trigger-coherence-1',
        state: { activeTriggers: [] },
      });
      assert.equal(created.state.activeTriggers.length, 0);

      const applied = await commitTurn(db.pool, created.id, {
        type: 'apply_trigger',
        trigger: policy,
      });
      assert.equal(applied.state.company.talentCost, 4480);
      assert.equal(applied.state.activeTriggers.length, 1);

      const advanced = await commitTurn(db.pool, created.id, { type: 'advance_turn' });
      assert.equal(advanced.state.company.burnRate, 2464);
      assert.equal(Math.round(advanced.state.company.cash), Math.round(15000 - 2464 / 12));

      const reloaded = await getCampaign(db.pool, created.id);
      assert.equal(reloaded.state.company.burnRate, 2464);
      assert.equal(reloaded.state.activeTriggers.length, 1);
      assert.equal(reloaded.state.activeTriggers[0].id, policy.id);
    } finally {
      await db.close();
    }
  });

  test('restack empty campaign then advance matches UI policy preview burn', async () => {
    const db = await createThrowawayDatabase();
    try {
      await migrateAll(db.pool);
      // Campaign seeded without triggers while UI would already show policy.
      const created = await createCampaign(db.pool, { seed: 'restack-1' });
      const restack = [
        { type: 'clear_triggers' },
        { type: 'apply_trigger', trigger: policy },
        { type: 'advance_turn' },
      ];
      let last = created;
      for (const command of restack) {
        last = await commitTurn(db.pool, created.id, command);
      }
      assert.equal(last.state.company.burnRate, 2464);
      assert.ok(last.state.company.cash < 15000 - 2200 / 12);
    } finally {
      await db.close();
    }
  });

  test('hire_employee then advance_turn drains at hired burn and reloads roster', async () => {
    const db = await createThrowawayDatabase();
    try {
      await migrateAll(db.pool);
      const created = await createCampaign(db.pool, { seed: 'hire-1' });
      const hired = await commitTurn(db.pool, created.id, {
        type: 'hire_employee',
        department: 'tech',
        skill: 1,
      });
      assert.equal(hired.state.employees.length, 1);
      assert.equal(hired.state.talentMultiplier, 1.75);
      assert.equal(hired.state.company.burnRate, 3850);
      assert.equal(hired.state.company.cash, 15000);

      const advanced = await commitTurn(db.pool, created.id, { type: 'advance_turn' });
      assert.equal(advanced.state.company.burnRate, 3850);
      assert.equal(Math.round(advanced.state.company.cash), Math.round(15000 - 3850 / 12));

      const reloaded = await getCampaign(db.pool, created.id);
      assert.equal(reloaded.state.employees.length, 1);
      assert.equal(reloaded.state.talentMultiplier, 1.75);
      assert.equal(reloaded.state.company.burnRate, 3850);
    } finally {
      await db.close();
    }
  });
});
