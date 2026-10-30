// Regressions for the trigger-math model findings (test/model/trigger-math.model.api.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTurnCommand, createGameState } from '../../src/turnEngine.js';
import { effectiveBurnRate, talentCostFactorOf } from '../../src/talentMultiplier.js';
import { stackTriggerEffects } from '../../src/triggerContract.js';

function trigger(id, effect) {
  return { id, type: 'policy_change', label: id, source: 'mock:test', timestamp: '2026-01-01T00:00:00.000Z', effect };
}

function applyAll(state, triggers) {
  return triggers.reduce((s, t) => applyTurnCommand(s, { type: 'apply_trigger', trigger: t }).state, state);
}

test('CostEffectsAreMonotone: two -200% cuts stay at $0 instead of multiplying back to the $4000 baseline', () => {
  const cuts = [trigger('cut-a', { talentCost: -2 }), trigger('cut-b', { talentCost: -2 })];
  const state = applyAll(createGameState(), cuts);
  assert.equal(state.company.talentCost, 0);
  assert.equal(talentCostFactorOf(state), 0.1);
  assert.equal(effectiveBurnRate(state), 220);
  assert.equal(stackTriggerEffects({ hype: 0.3, talentCost: 4000 }, cuts).talentCost, 0);
});

test('CostEffectsAreMonotone: two -300% cuts do not hit the 3x cap (was $16000, burn 6600)', () => {
  const cuts = [trigger('cut-a', { talentCost: -3 }), trigger('cut-b', { talentCost: -3 })];
  const state = applyAll(createGameState(), cuts);
  assert.equal(state.company.talentCost, 0);
  assert.equal(effectiveBurnRate(state), 220);
  assert.equal(stackTriggerEffects({ hype: 0.3, talentCost: 4000 }, cuts).talentCost, 0);
});

test('TaxAndEventsCommute: a tax round trip does not invent hype at the 0 floor', () => {
  let state = applyAll(createGameState(), [trigger('slump', { hype: -0.4051 })]);
  assert.equal(state.company.hype, 0);
  state = applyTurnCommand(state, { type: 'set_tax', taxRate: 0.5 }).state;
  assert.equal(state.company.hype, 0);
  state = applyTurnCommand(state, { type: 'set_tax', taxRate: 0.25 }).state;
  assert.equal(state.company.hype, 0); // was 0.05
});

test('TaxAndEventsCommute: a tax round trip does not lose hype at the 1 ceiling', () => {
  let state = applyAll(createGameState(), [trigger('boom', { hype: 0.69 })]);
  state = applyTurnCommand(state, { type: 'set_tax', taxRate: 0 }).state;
  assert.equal(state.company.hype, 1);
  state = applyTurnCommand(state, { type: 'set_tax', taxRate: 0.25 }).state;
  assert.equal(state.company.hype, 0.99); // was 0.95
});

test('set_tax keeps the old rule when hype was set some other way', () => {
  const state = createGameState({ company: { hype: 0.5 } });
  const taxed = applyTurnCommand(state, { type: 'set_tax', taxRate: 0 }).state;
  assert.equal(taxed.company.hype, 0.55);
});
