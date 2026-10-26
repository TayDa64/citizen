import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SAMPLE_TRIGGERS } from '../src/triggerContract.js';
import {
  applyEffects,
  applyTriggerEffect,
  initialState,
  setTaxRate
} from '../src/simulation.js';

const [POLICY, NEWS, MARKET] = SAMPLE_TRIGGERS;

function burnFor(taxRate) {
  return Math.round(2000 * (1 + taxRate * 0.4));
}

describe('Slice 1 tax to burn rate', () => {
  test('burn rate follows the base formula and does not compound', () => {
    assert.equal(burnFor(0), 2000);
    assert.equal(burnFor(0.25), 2200);
    assert.equal(burnFor(0.5), 2400);
    assert.equal(burnFor(1), 2800);

    const atDefault = applyEffects(initialState);
    assert.equal(atDefault.company.burnRate, 2200);
    assert.equal(atDefault.company.cash, 15000 - 2200 / 12);
    assert.deepEqual(atDefault.history.burnRate, [2000, 2200]);

    const second = applyEffects(atDefault);
    assert.equal(second.company.burnRate, 2200);
    assert.equal(second.company.cash, 15000 - 2200 / 12 - 2200 / 12);

    const atZero = applyEffects(setTaxRate(initialState, 0));
    assert.equal(atZero.taxRate, 0);
    assert.equal(atZero.company.burnRate, 2000);
    assert.equal(atZero.company.cash, 15000 - 2000 / 12);

    const atFull = applyEffects(setTaxRate(initialState, 1));
    assert.equal(atFull.company.burnRate, 2800);

    const clamped = setTaxRate(initialState, 2);
    assert.equal(clamped.taxRate, 1);
    assert.equal(clamped.company.burnRate, initialState.company.burnRate);
    assert.equal(setTaxRate(initialState, -1).taxRate, 0);
  });

  test('tax ticks do not change hype, talent cost, or recorded triggers', () => {
    const next = applyEffects(initialState);
    assert.equal(next.company.hype, initialState.company.hype);
    assert.equal(next.company.talentCost, initialState.company.talentCost);
    assert.deepEqual(next.triggers, []);
    assert.deepEqual(next.history.hype, initialState.history.hype);
    assert.deepEqual(next.history.talentCost, initialState.history.talentCost);
  });
});

describe('trigger effects on simulation state', () => {
  test('applies a hype delta without touching burn rate or cash', () => {
    const taxed = applyEffects(initialState);
    const next = applyTriggerEffect(taxed, NEWS);
    assert.equal(next.company.hype, 0.4);
    assert.equal(next.company.talentCost, taxed.company.talentCost);
    assert.equal(next.company.burnRate, taxed.company.burnRate);
    assert.equal(next.company.cash, taxed.company.cash);
    assert.equal(next.triggers.length, 1);
    assert.deepEqual(next.triggers[0].effect, { hype: 0.1 });
    assert.deepEqual(next.history.hype.at(-2), taxed.company.hype);
    assert.equal(next.history.hype.at(-1), 0.4);
    assert.equal(taxed.triggers.length, 0);
  });

  test('replaces the same id and multiplies talent cost from the baseline', () => {
    const once = applyTriggerEffect(initialState, POLICY);
    assert.equal(once.company.talentCost, 4480);
    assert.equal(once.company.hype, 0.3);
    assert.equal(once.triggers.length, 1);

    const twice = applyTriggerEffect(once, POLICY);
    assert.equal(twice.company.talentCost, 4480);
    assert.equal(twice.triggers.length, 1);
    assert.equal(twice.triggers[0].id, POLICY.id);

    const replaced = applyTriggerEffect(twice, { ...POLICY, effect: { talentCost: 0.2 } });
    assert.equal(replaced.company.talentCost, 4800);
    assert.equal(replaced.triggers.length, 1);
    assert.notEqual(replaced.company.talentCost, 4480 * 1.2);

    const stacked = applyTriggerEffect(replaced, MARKET);
    assert.equal(stacked.triggers.length, 2);
    assert.equal(stacked.triggers[0].id, MARKET.id);
    assert.equal(stacked.company.talentCost, 4416);
    assert.equal(stacked.company.hype, 0.25);
    assert.equal(stacked.company.burnRate, initialState.company.burnRate);

    const news = applyTriggerEffect(stacked, NEWS);
    assert.equal(news.company.hype, 0.35);
    assert.equal(news.company.talentCost, 4416);

    const newsAgain = applyTriggerEffect(news, { ...NEWS, effect: { hype: 0.05 } });
    assert.equal(newsAgain.company.hype, 0.3);
    assert.equal(newsAgain.triggers.filter((trigger) => trigger.id === NEWS.id).length, 1);

    const floored = applyTriggerEffect(newsAgain, {
      id: 'evt-shock',
      type: 'market_shift',
      label: 'Shock',
      source: 'mock:local',
      timestamp: '2026-06-01T00:00:00.000Z',
      effect: { talentCost: -5 }
    });
    assert.equal(floored.company.talentCost, 0);

    const recovered = applyTriggerEffect(floored, {
      id: 'evt-shock',
      type: 'market_shift',
      label: 'Shock',
      source: 'mock:local',
      timestamp: '2026-06-01T00:00:00.000Z',
      effect: { talentCost: 0.1 }
    });
    assert.equal(recovered.company.talentCost, 4857.6);
    assert.equal(recovered.triggers.length, 4);
  });

  test('rejects a bad trigger without mutating state', () => {
    const snapshot = structuredClone(initialState);
    assert.throws(() => applyTriggerEffect(initialState, { effect: { burnRate: 10 } }));
    assert.deepEqual(initialState, snapshot);
  });

  test('a later tax tick keeps the trigger effect and the burn formula', () => {
    const triggered = applyTriggerEffect(initialState, NEWS);
    const ticked = applyEffects(triggered);
    assert.equal(ticked.company.hype, 0.4);
    assert.equal(ticked.company.talentCost, initialState.company.talentCost);
    assert.equal(ticked.company.burnRate, 2200);
    assert.equal(ticked.triggers.length, 1);
    assert.equal(ticked.history.hype.at(-1), 0.4);
  });
});
