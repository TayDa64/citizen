import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyEffects,
  applyTriggerEffect,
  initialState,
  setTaxRate
} from '../src/simulation.js';

function burnFor(taxRate) {
  return Math.round(2000 * (1 + taxRate * 0.4));
}

function record(effect, extra = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'news',
    label: 'Mock press cycle lifts founder hype',
    source: 'mock:press-cycle',
    timestamp: '2026-10-26T15:00:00.000Z',
    ...extra,
    effect
  };
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
    const next = applyTriggerEffect(taxed, record({ hype: 0.1 }));
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

  test('applies a talent-cost delta and clamps both metrics', () => {
    const talent = applyTriggerEffect(initialState, record({ talentCost: 500 }, { type: 'talent' }));
    assert.equal(talent.company.talentCost, initialState.company.talentCost + 500);
    assert.equal(talent.company.hype, initialState.company.hype);

    const both = applyTriggerEffect(initialState, record({ hype: 0.05, talentCost: 250.5 }));
    assert.equal(both.company.hype, 0.35);
    assert.equal(both.company.talentCost, initialState.company.talentCost + 250.5);

    const second = applyTriggerEffect(
      both,
      record({ talentCost: 500 }, {
        id: '22222222-2222-4222-8222-222222222222',
        type: 'talent'
      })
    );
    assert.equal(second.triggers[0].type, 'talent');
    assert.deepEqual(second.triggers[1].effect, { hype: 0.05, talentCost: 250.5 });

    const highHype = structuredClone(initialState);
    highHype.company.hype = 0.95;
    assert.equal(applyTriggerEffect(highHype, record({ hype: 0.1 })).company.hype, 1);

    const lowTalent = structuredClone(initialState);
    lowTalent.company.talentCost = 100;
    assert.equal(
      applyTriggerEffect(lowTalent, record({ talentCost: -500 })).company.talentCost,
      0
    );
  });

  test('rejects a bad trigger without mutating state', () => {
    const snapshot = structuredClone(initialState);
    assert.throws(() => applyTriggerEffect(initialState, { effect: { burnRate: 10 } }));
    assert.deepEqual(initialState, snapshot);
  });

  test('a later tax tick keeps the trigger effect and the burn formula', () => {
    const triggered = applyTriggerEffect(initialState, record({ hype: 0.1 }));
    const ticked = applyEffects(triggered);
    assert.equal(ticked.company.hype, 0.4);
    assert.equal(ticked.company.talentCost, initialState.company.talentCost);
    assert.equal(ticked.company.burnRate, 2200);
    assert.equal(ticked.triggers.length, 1);
    assert.equal(ticked.history.hype.at(-1), 0.4);
  });
});
