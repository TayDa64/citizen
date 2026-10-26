import { describe, expect, test } from 'vitest';
import {
  applyEffects,
  applyTrigger,
  baselineBurnRate,
  clearTriggers,
  computeBurnRate,
  hydrateFromApi,
  initialState,
  previewBurnRate,
  removeTrigger,
  setTaxRate,
} from './simulation';
import { SAMPLE_TRIGGERS } from './triggers';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');
const news = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'news_spike');
const market = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'market_shift');

function slice1Burn(taxRate, talentCost = 1) {
  return Math.round(2000 * (1 + taxRate * 0.4) * talentCost);
}

describe('Slice 1 baseline with no trigger', () => {
  test('one tick matches the original tax burn formula and cash history', () => {
    const next = applyEffects(initialState);
    const burn = slice1Burn(0.25);

    expect(burn).toBe(2200);
    expect(next.company.burnRate).toBe(burn);
    expect(next.company.cash).toBeCloseTo(15000 - burn / 12);
    expect(next.history.cash).toEqual([15000, Math.round(15000 - burn / 12)]);
    expect(next.history.burnRate).toEqual([2000, burn]);
    expect(next.company.hype).toBe(0.3);
    expect(next.company.productQuality).toBe(0.4);
    expect(next.taxRate).toBe(0.25);
    expect(next.activeTriggers).toEqual([]);
    expect(initialState.company.burnRate).toBe(2000);
    expect(initialState.history.cash).toEqual([15000]);
  });

  test('the visible history window still keeps 24 months', () => {
    let state = initialState;
    for (let i = 0; i < 30; i += 1) state = applyEffects(state);
    expect(state.history.cash).toHaveLength(24);
    expect(state.history.burnRate).toHaveLength(24);
    expect(state.company.hype).toBe(0.3);
    expect(state.company.talentCost).toBe(1);
  });

  test('setTaxRate still clamps and does not tick on its own', () => {
    const high = setTaxRate(initialState, 2);
    const low = setTaxRate(initialState, -1);
    expect(high.taxRate).toBe(1);
    expect(low.taxRate).toBe(0);
    expect(high.company.cash).toBe(15000);
    expect(high.history.cash).toEqual([15000]);
    expect(high.company.burnRate).toBe(2000);
  });
});

describe('applyTrigger', () => {
  test('policy change raises talent cost 12% and leaves Slice 1 cash and burn untouched', () => {
    const snapshot = structuredClone(initialState);
    const next = applyTrigger(initialState, policy);

    expect(initialState).toEqual(snapshot);
    expect(next.company.talentCost).toBeCloseTo(1.12);
    expect(next.company.hype).toBe(0.3);
    expect(next.company.cash).toBe(15000);
    expect(next.company.burnRate).toBe(2000);
    expect(next.history).toEqual(initialState.history);
    expect(next.taxRate).toBe(0.25);
    expect(next.activeTriggers.map((trigger) => trigger.id)).toEqual([policy.id]);
    expect(next.activeTriggers[0].appliedAtIndex).toBe(0);
    expect(next.lastTriggerChange.announcement).toBe('Policy change: talent cost +12%');
    expect(next.lastTriggerChange.before).toEqual({ hype: 0.3, talentCost: 1 });
    expect(next.lastTriggerChange.after.hype).toBe(0.3);
    expect(next.lastTriggerChange.after.talentCost).toBeCloseTo(1.12);
    expect(previewBurnRate(next)).toBe(2200);
    expect(previewBurnRate(initialState)).toBe(2200);
  });

  test('reapplying the same id replaces the effect instead of stacking it', () => {
    const once = applyTrigger(initialState, policy);
    const twice = applyTrigger(once, policy);
    const replaced = applyTrigger(twice, { ...policy, effect: { talentCost: 0.2 } });

    expect(twice.company.talentCost).toBeCloseTo(1.12);
    expect(twice.activeTriggers).toHaveLength(1);
    expect(replaced.company.talentCost).toBeCloseTo(1.2);
    expect(replaced.activeTriggers).toHaveLength(1);
  });

  test('different triggers stack from the baseline', () => {
    const stacked = applyTrigger(applyTrigger(initialState, policy), market);

    expect(stacked.company.talentCost).toBeCloseTo(1.12 * 0.92);
    expect(stacked.company.hype).toBeCloseTo(0.25);
    expect(stacked.activeTriggers.map((trigger) => trigger.id)).toEqual([
      policy.id,
      market.id,
    ]);
    expect(stacked.company.cash).toBe(15000);
    expect(stacked.company.burnRate).toBe(2000);
  });

  test('news spike adds hype and a huge spike clamps at 1', () => {
    expect(applyTrigger(initialState, news).company.hype).toBeCloseTo(0.4);
    expect(
      applyTrigger(initialState, { ...news, id: 'huge-news', effect: { hype: 0.8 } }).company.hype
    ).toBe(1);
    expect(() =>
      applyTrigger(initialState, { ...news, id: 'illegal-news', effect: { hype: 5 } })
    ).toThrow(TypeError);
  });

  test('a negative talent shock cannot drive talent cost below zero', () => {
    const crash = applyTrigger(initialState, {
      ...market,
      id: 'talent-crash',
      effect: { talentCost: -5 },
    });
    expect(crash.company.talentCost).toBe(0);
  });

  test('rejects an invalid trigger', () => {
    expect(() => applyTrigger(initialState, { id: 'nope' })).toThrow(TypeError);
  });

  test('with the trigger flag off, the next month ignores talent cost', () => {
    const baseline = applyEffects(initialState);
    const triggered = applyEffects(applyTrigger(initialState, policy));

    expect(baseline.company.burnRate).toBe(2200);
    expect(triggered.company.burnRate).toBe(2200);
    expect(triggered.company.cash).toBe(baseline.company.cash);
    expect(triggered.history.cash[0]).toBe(15000);
    expect(triggered.history.burnRate).toEqual([2000, 2200]);
    expect(baseline.history.burnRate).toEqual([2000, 2200]);
  });

  test('tax and talent cost compose on the following tick', () => {
    const state = applyEffects(setTaxRate(applyTrigger(initialState, policy), 0.5));
    expect(state.taxRate).toBe(0.5);
    expect(state.company.talentCost).toBeCloseTo(1.12);
    expect(state.company.burnRate).toBe(slice1Burn(0.5));
  });

  test('the chart marker stays inside the 24-month window', () => {
    let state = initialState;
    for (let i = 0; i < 20; i += 1) state = applyEffects(state);
    state = applyTrigger(state, policy);
    expect(state.activeTriggers[0].appliedAtIndex).toBe(20);

    for (let i = 0; i < 5; i += 1) state = applyEffects(state);
    expect(state.history.cash).toHaveLength(24);
    expect(state.activeTriggers[0].appliedAtIndex).toBe(18);
    expect(state.company.talentCost).toBeCloseTo(1.12);
  });
});

describe('removeTrigger and clearTriggers', () => {
  test('removing one stacked trigger keeps the other', () => {
    const stacked = applyTrigger(applyTrigger(initialState, policy), news);
    const remaining = removeTrigger(stacked, policy.id);

    expect(remaining.activeTriggers.map((trigger) => trigger.id)).toEqual([news.id]);
    expect(remaining.company.hype).toBeCloseTo(0.4);
    expect(remaining.company.talentCost).toBeCloseTo(1);
    expect(remaining.company.cash).toBe(stacked.company.cash);
  });

  test('api mode keeps the Slice 1 burn formula and the dollar baseline', () => {
    const apiState = hydrateFromApi(initialState, {
      company: {
        id: 'company-1',
        name: 'Northwind',
        cash: 15000,
        burnRate: 2000,
        hype: 0.3,
        talentCost: 4480,
        baselines: { hype: 0.3, talentCost: 4000 },
      },
      triggers: [policy],
    });

    expect(apiState.dataSource).toBe('api');
    expect(apiState.baselines).toEqual({ hype: 0.3, talentCost: 4000 });
    expect(apiState.company.talentCost).toBe(4480);
    expect(apiState.company.cash).toBe(15000);
    expect(apiState.company.burnRate).toBe(2000);
    expect(apiState.activeTriggers[0].appliedAtIndex).toBe(0);
    expect(apiState.activeTriggers[0].appliedAtIndex).not.toBeUndefined();
    expect(Object.keys(apiState.activeTriggers[0])).not.toContain('chartNote');
    expect(previewBurnRate(apiState)).toBe(2200);
    expect(baselineBurnRate(apiState)).toBe(2200);
    expect(applyEffects(apiState).company.burnRate).toBe(2200);
    expect(applyEffects(apiState).history.burnRate).toEqual([2000, 2200]);
    expect(apiState.talentMultiplier).toBe(1);
    expect(computeBurnRate(0.25, 1)).toBe(2200);
    expect(computeBurnRate(0.25, 1.12)).toBe(2464);

    const stacked = applyTrigger(apiState, market);
    expect(stacked.baselines.talentCost).toBe(4000);
    expect(stacked.company.talentCost).toBeCloseTo(4480 * 0.92, 5);
    expect(previewBurnRate(stacked)).toBe(2200);
  });

  test('hydrate keeps client cash and burn and takes only hype, talent cost, and baselines', () => {
    const ticking = applyEffects(initialState);
    const snapshot = {
      company: {
        id: 'company-1',
        cash: 1,
        burnRate: 9,
        hype: 0.55,
        talentCost: 4480,
        baselines: { hype: 0.3, talentCost: 4000 },
      },
      triggers: [policy],
    };

    const firstLoad = hydrateFromApi(initialState, snapshot);
    expect(firstLoad.company.cash).toBe(initialState.company.cash);
    expect(firstLoad.company.burnRate).toBe(initialState.company.burnRate);
    expect(firstLoad.history).toEqual(initialState.history);
    expect(firstLoad.company.hype).toBe(0.55);
    expect(firstLoad.company.talentCost).toBe(4480);
    expect(firstLoad.baselines).toEqual({ hype: 0.3, talentCost: 4000 });

    const refreshed = hydrateFromApi(ticking, snapshot);
    expect(refreshed.company.cash).toBe(ticking.company.cash);
    expect(refreshed.company.burnRate).toBe(ticking.company.burnRate);
    expect(refreshed.history).toEqual(ticking.history);
    expect(refreshed.company.hype).toBe(0.55);
    expect(refreshed.company.talentCost).toBe(4480);
    expect(firstLoad.talentMultiplier).toBe(1);
    expect(previewBurnRate(firstLoad)).toBe(2200);
  });

  test('a supplied talentMultiplier scales burn and an invalid one is rejected', () => {
    const scaled = hydrateFromApi(initialState, {
      company: {
        id: 'company-1',
        cash: 1,
        burnRate: 9,
        hype: 0.3,
        talentCost: 4480,
        baselines: { hype: 0.3, talentCost: 4000 },
        talentMultiplier: 1.28,
        talentMix: [{ department: 'tech', headcount: 1, avgSkill: 0.53, weight: 1.25, contribution: 1.28 }],
      },
      triggers: [],
    });

    expect(scaled.company.cash).toBe(15000);
    expect(scaled.company.burnRate).toBe(2000);
    expect(scaled.talentMultiplier).toBe(1.28);
    expect(scaled.talentMix[0].department).toBe('tech');
    expect(previewBurnRate(scaled)).toBe(2816);
    expect(applyEffects(scaled).company.burnRate).toBe(2816);
    expect(applyEffects(scaled).history.cash[0]).toBe(15000);

    expect(() => hydrateFromApi(initialState, {
      company: {
        hype: 0.3,
        talentCost: 4000,
        baselines: { hype: 0.3, talentCost: 4000 },
        talentMultiplier: 1.12345,
      },
      triggers: [],
    })).toThrow(/4 decimal places/);
  });

  test('clearTriggers restores the Slice 1 hype and talent baseline without ticking', () => {
    const stacked = applyTrigger(applyTrigger(initialState, policy), market);
    const cleared = clearTriggers(stacked);

    expect(cleared.company.hype).toBe(0.3);
    expect(cleared.company.talentCost).toBe(1);
    expect(cleared.company.cash).toBe(15000);
    expect(cleared.company.burnRate).toBe(2000);
    expect(cleared.history).toEqual(initialState.history);
    expect(cleared.taxRate).toBe(0.25);
    expect(cleared.activeTriggers).toEqual([]);
    expect(cleared.lastTriggerChange).toBeNull();
    expect(applyEffects(cleared).company.burnRate).toBe(2200);
    expect(applyEffects(cleared).history.burnRate).toEqual([2000, 2200]);
  });
});
