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
  readApiSnapshot,
  removeTrigger,
  setTaxRate,
} from './simulation';
import {
  burnFromStoredBase,
  effectiveMultiplierOf,
  talentCostFactorClampedOf,
  talentCostFactorOf,
  talentMultiplierOf,
} from './talentMultiplier';
import { SAMPLE_TRIGGERS, clampHype, roundTo } from './triggers';
import { hypeBiasFromHeadroom, budgetHeadroomFromTax } from './civicFeedback.js';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');
const news = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'news_spike');
const market = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'market_shift');

function slice1Burn(taxRate) {
  return Math.round(2000 * (1 + taxRate * 0.4));
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
    expect(state.company.talentCost).toBe(4000);
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

  test('no employees + no triggers → burn 2000 / 2200 / 2800 at tax 0 / 0.25 / 1', () => {
    expect(computeBurnRate(0, 1)).toBe(2000);
    expect(computeBurnRate(0.25, 1)).toBe(2200);
    expect(computeBurnRate(1, 1)).toBe(2800);
    expect(previewBurnRate(setTaxRate(initialState, 0))).toBe(2000);
    expect(previewBurnRate(initialState)).toBe(2200);
    expect(previewBurnRate(setTaxRate(initialState, 1))).toBe(2800);
    expect(applyEffects(setTaxRate(initialState, 0)).company.burnRate).toBe(2000);
    expect(applyEffects(initialState).company.burnRate).toBe(2200);
    expect(applyEffects(setTaxRate(initialState, 1)).company.burnRate).toBe(2800);
  });
});

describe('authority boundary', () => {
  test('readApiSnapshot never copies cash or burnRate from the company payload', () => {
    const ticking = applyEffects(setTaxRate(initialState, 1));
    const reading = readApiSnapshot(ticking, {
      company: {
        id: 'company-1',
        name: 'Northwind',
        cash: 1,
        burnRate: 9,
        hype: 0.55,
        talentCost: 4480,
        baselines: { hype: 0.3, talentCost: 4000 },
        talentMultiplier: 1.28,
      },
      triggers: [policy],
    });

    expect(reading.state.company.cash).toBe(ticking.company.cash);
    expect(reading.state.company.burnRate).toBe(ticking.company.burnRate);
    expect(reading.state.history).toEqual(ticking.history);
    expect(reading.state.company.cash).not.toBe(1);
    expect(reading.state.company.burnRate).not.toBe(9);
    // Tax was set to 1 before hydrate → civic bias -0.15 folds onto API hype 0.55.
    expect(reading.state.civic.hypeBias).toBe(-0.15);
    expect(reading.state.company.hype).toBe(0.4);
    expect(reading.state.company.talentCost).toBe(4480);
    expect(reading.state.talentMultiplier).toBe(1.28);
  });

  test('local trigger apply and clear leave client cash and stored burn untouched', () => {
    const cash = 12876.5;
    const seeded = {
      ...initialState,
      company: { ...initialState.company, cash, burnRate: 2200 },
      history: { cash: [15000, 12877], burnRate: [2000, 2200] },
    };
    const applied = applyTrigger(seeded, policy);
    expect(applied.company.cash).toBe(cash);
    expect(applied.company.burnRate).toBe(2200);
    expect(applied.history).toEqual(seeded.history);

    const cleared = clearTriggers(applied);
    expect(cleared.company.cash).toBe(cash);
    expect(cleared.company.burnRate).toBe(2200);
    expect(cleared.history).toEqual(seeded.history);
  });
});

describe('applyTrigger', () => {
  test('policy change raises talent cost 12% and leaves Slice 1 cash and burn untouched', () => {
    const snapshot = structuredClone(initialState);
    const next = applyTrigger(initialState, policy);

    expect(initialState).toEqual(snapshot);
    expect(next.company.talentCost).toBe(4480);
    expect(next.company.hype).toBe(0.3);
    expect(next.company.cash).toBe(15000);
    expect(next.company.burnRate).toBe(2000);
    expect(next.history).toEqual(initialState.history);
    expect(next.taxRate).toBe(0.25);
    expect(next.activeTriggers.map((trigger) => trigger.id)).toEqual([policy.id]);
    expect(next.activeTriggers[0].appliedAtIndex).toBe(0);
    expect(next.lastTriggerChange.announcement).toBe('Policy change: talent cost +12%, burn $2,464');
    expect(next.lastTriggerChange.before).toEqual({ hype: 0.3, talentCost: 4000 });
    expect(next.lastTriggerChange.after.hype).toBe(0.3);
    expect(next.lastTriggerChange.after.talentCost).toBe(4480);
    expect(previewBurnRate(next)).toBe(2464);
    expect(previewBurnRate(initialState)).toBe(2200);
    expect(next.talentMultiplier).toBe(1);
  });

  test('reapplying the same id replaces the effect instead of stacking it', () => {
    const once = applyTrigger(initialState, policy);
    const twice = applyTrigger(once, policy);
    const replaced = applyTrigger(twice, { ...policy, effect: { talentCost: 0.2 } });

    expect(twice.company.talentCost).toBe(4480);
    expect(twice.activeTriggers).toHaveLength(1);
    expect(replaced.company.talentCost).toBe(4800);
    expect(replaced.activeTriggers).toHaveLength(1);
  });

  test('different triggers stack from the baseline', () => {
    const stacked = applyTrigger(applyTrigger(initialState, policy), market);

    expect(stacked.company.talentCost).toBe(4121.6);
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
    expect(talentCostFactorOf(crash)).toBe(0.1);
    expect(effectiveMultiplierOf(crash)).toBe(0.1);
    expect(previewBurnRate(crash)).toBe(220);
  });

  test('a -100% talent-cost trigger floors the factor at 0.1 and keeps burn at $220', () => {
    const wiped = applyTrigger(initialState, {
      ...policy,
      id: 'talent-wipe',
      effect: { talentCost: -1 },
    });
    expect(wiped.company.talentCost).toBe(0);
    expect(talentCostFactorOf(wiped)).toBe(0.1);
    expect(talentCostFactorClampedOf(wiped)).toBe(true);
    expect(previewBurnRate(wiped)).toBe(220);
    expect(previewBurnRate(wiped)).toBeGreaterThan(0);
    expect(wiped.lastTriggerChange.announcement).toBe(
      'Policy change: talent cost -100%, floored at 0.1×, burn $220'
    );
  });

  test('a -90% talent-cost trigger is factor 0.1 with the flag false', () => {
    const eased = applyTrigger(initialState, {
      ...policy,
      id: 'talent-ease',
      effect: { talentCost: -0.9 },
    });
    expect(eased.company.talentCost).toBe(400);
    expect(talentCostFactorOf(eased)).toBe(0.1);
    expect(talentCostFactorClampedOf(eased)).toBe(false);
    expect(previewBurnRate(eased)).toBe(220);
    expect(eased.lastTriggerChange.announcement).toBe('Policy change: talent cost -90%, burn $220');
  });

  test('three stacked +100 talent-cost triggers cap the factor at exactly 3', () => {
    const plus100 = (id) => ({
      ...policy,
      id,
      effect: { talentCost: 100 },
    });
    const stacked = ['stack-a', 'stack-b', 'stack-c'].reduce(
      (state, id) => applyTrigger(state, plus100(id)),
      initialState,
    );
    expect(stacked.company.talentCost).toBeGreaterThan(3);
    expect(talentCostFactorOf(stacked)).toBe(3);
    expect(talentCostFactorClampedOf(stacked)).toBe(true);
    expect(effectiveMultiplierOf(stacked)).toBe(3);
    expect(previewBurnRate(stacked)).toBe(6600);
    expect(stacked.lastTriggerChange.announcement).toBe(
      'Policy change: talent cost +10000%, capped at 3×, burn $6,600'
    );
  });

  test('a +250% talent-cost trigger announces the 3× cap', () => {
    const next = applyTrigger(initialState, {
      ...policy,
      id: 'big-policy',
      effect: { talentCost: 2.5 },
    });
    expect(next.company.talentCost).toBe(14000);
    expect(talentCostFactorOf(next)).toBe(3);
    expect(previewBurnRate(next)).toBe(6600);
    expect(next.lastTriggerChange.announcement).toBe(
      'Policy change: talent cost +250%, capped at 3×, burn $6,600'
    );
  });

  test('rejects an invalid trigger', () => {
    expect(() => applyTrigger(initialState, { id: 'nope' })).toThrow(TypeError);
  });

  test('the next month includes the talent-cost factor in burn', () => {
    const baseline = applyEffects(initialState);
    const triggered = applyEffects(applyTrigger(initialState, policy));

    expect(baseline.company.burnRate).toBe(2200);
    expect(triggered.company.burnRate).toBe(2464);
    expect(triggered.company.cash).toBeCloseTo(15000 - 2464 / 12);
    expect(triggered.history.cash[0]).toBe(15000);
    expect(triggered.history.burnRate).toEqual([2000, 2464]);
    expect(triggered.talentMultiplier).toBe(1);
    expect(baseline.history.burnRate).toEqual([2000, 2200]);
  });

  test('a later tax tick scales burn by the talent-cost factor once', () => {
    const state = applyEffects(setTaxRate(applyTrigger(initialState, policy), 0.5));
    expect(state.taxRate).toBe(0.5);
    expect(state.company.talentCost).toBe(4480);
    expect(state.talentMultiplier).toBe(1);
    expect(state.company.burnRate).toBe(Math.round(2000 * (1 + 0.5 * 0.4) * 1.12));
    expect(state.company.burnRate).toBe(2688);
  });

  test('no employees plus a policy burns 2240 at the stored base and 2464 at 25%', () => {
    const policyState = applyTrigger(initialState, policy);
    expect(talentCostFactorOf(policyState)).toBe(1.12);
    expect(effectiveMultiplierOf(policyState)).toBe(1.12);
    expect(burnFromStoredBase(2000, effectiveMultiplierOf(policyState))).toBe(2240);
    const atZero = setTaxRate(policyState, 0);
    expect(previewBurnRate(atZero)).toBe(2240);
    expect(applyEffects(atZero).company.burnRate).toBe(2240);
    expect(previewBurnRate(policyState)).toBe(2464);
    expect(applyEffects(policyState).company.burnRate).toBe(2464);
  });

  test('four tech employees plus a policy stay at 1.75 and burn 5488 at tax 1', () => {
    const staffed = setTaxRate({
      ...initialState,
      employees: [
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 },
      ],
    }, 1);
    const triggered = applyTrigger(staffed, policy);
    expect(talentCostFactorOf(triggered)).toBe(1.12);
    expect(effectiveMultiplierOf(triggered)).toBe(1.96);
    expect(previewBurnRate(triggered)).toBe(5488);
    const ticked = applyEffects(triggered);
    expect(ticked.talentMultiplier).toBe(1.75);
    expect(ticked.company.talentMultiplier).toBe(1.75);
    expect(ticked.company.burnRate).toBe(5488);
  });

  test('policy then market uses talent-cost factor 1.0304', () => {
    const stacked = applyTrigger(applyTrigger(initialState, policy), market);
    expect(stacked.company.talentCost).toBe(4121.6);
    expect(talentCostFactorOf(stacked)).toBe(1.0304);
    expect(effectiveMultiplierOf(stacked)).toBe(1.0304);
    expect(previewBurnRate(stacked)).toBe(2267);

    const apiStacked = hydrateFromApi(initialState, {
      company: {
        id: 'company-1',
        hype: 0.25,
        talentCost: 4121.6,
        baselines: { hype: 0.3, talentCost: 4000 },
        talentMultiplier: 1,
        baseBurnRate: 2000,
        burnRate: 2061,
      },
      triggers: [policy, market],
    });
    expect(apiStacked.company.cash).toBe(15000);
    expect(apiStacked.company.burnRate).toBe(2000);
    expect(talentCostFactorOf(apiStacked)).toBe(1.0304);
    expect(effectiveMultiplierOf(apiStacked)).toBe(1.0304);
    expect(burnFromStoredBase(2000, 1.0304)).toBe(2061);
    expect(previewBurnRate(apiStacked)).toBe(2267);
  });

  test('the chart marker stays inside the 24-month window', () => {
    let state = initialState;
    for (let i = 0; i < 20; i += 1) state = applyEffects(state);
    state = applyTrigger(state, policy);
    expect(state.activeTriggers[0].appliedAtIndex).toBe(20);

    for (let i = 0; i < 5; i += 1) state = applyEffects(state);
    expect(state.history.cash).toHaveLength(24);
    expect(state.activeTriggers[0].appliedAtIndex).toBe(18);
    expect(state.company.talentCost).toBe(4480);
  });
});

describe('removeTrigger and clearTriggers', () => {
  test('removing one stacked trigger keeps the other', () => {
    const stacked = applyTrigger(applyTrigger(initialState, policy), news);
    const remaining = removeTrigger(stacked, policy.id);

    expect(remaining.activeTriggers.map((trigger) => trigger.id)).toEqual([news.id]);
    expect(remaining.company.hype).toBeCloseTo(0.4);
    expect(remaining.company.talentCost).toBe(4000);
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
    expect(previewBurnRate(apiState)).toBe(2464);
    expect(baselineBurnRate(apiState)).toBe(2200);
    expect(applyEffects(apiState).company.burnRate).toBe(2464);
    expect(applyEffects(apiState).history.burnRate).toEqual([2000, 2464]);
    expect(apiState.talentMultiplier).toBe(1);
    expect(apiState.talentCostFactor).toBeNull();
    expect(apiState.effectiveMultiplier).toBeNull();
    expect(computeBurnRate(0.25, 1)).toBe(2200);
    expect(computeBurnRate(0.25, 1.12)).toBe(2464);

    const stacked = applyTrigger(apiState, market);
    expect(stacked.baselines.talentCost).toBe(4000);
    expect(stacked.company.talentCost).toBeCloseTo(4480 * 0.92, 5);
    expect(previewBurnRate(stacked)).toBe(2267);
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
    expect(previewBurnRate(firstLoad)).toBe(2464);
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
    expect(previewBurnRate(scaled)).toBe(3154);
    expect(applyEffects(scaled).company.burnRate).toBe(3154);
    expect(applyEffects(scaled).talentMultiplier).toBe(1.28);
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

  test('four tech employees at skill 1 burn 4900 at tax 1 and a second tick does not compound', () => {
    const staffed = setTaxRate({
      ...initialState,
      employees: [
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 },
        { department: 'tech', skillTech: 1 },
      ],
    }, 1);
    const taxed = applyEffects(staffed);
    expect(taxed.company.talentMultiplier).toBe(1.75);
    expect(taxed.company.baseBurnRate).toBe(2800);
    expect(taxed.company.burnRate).toBe(4900);
    expect(taxed.company.cash).toBe(15000 - 4900 / 12);
    const second = applyEffects(taxed);
    expect(second.company.burnRate).toBe(4900);
    expect(second.company.talentMultiplier).toBe(1.75);
    expect(second.company.cash).toBe(15000 - 4900 / 12 - 4900 / 12);
    const triggered = applyTrigger(taxed, policy);
    expect(triggered.company.talentCost).toBe(4480);
    expect(triggered.company.burnRate).toBe(4900);
    expect(triggered.talentMultiplier).toBe(1.75);
    expect(previewBurnRate(triggered)).toBe(5488);
    const withPolicy = applyEffects(triggered);
    expect(withPolicy.company.burnRate).toBe(5488);
    expect(withPolicy.company.talentMultiplier).toBe(1.75);
    expect(withPolicy.talentMultiplier).toBe(1.75);
  });

  test('API mode keeps a loaded 1.75 multiplier across a tick and a tax change', () => {
    const employees = [
      { id: 'm1', department: 'marketing', skillMarketing: 0.5 },
    ];
    const talentMix = [
      { department: 'tech', headcount: 4, avgSkill: 1, weight: 1.25, contribution: 1.75 },
    ];
    const loaded = hydrateFromApi(initialState, {
      company: {
        id: 'company-1',
        cash: 1,
        burnRate: 4900,
        baseBurnRate: 2800,
        hype: 0.3,
        talentCost: 4480,
        baselines: { hype: 0.3, talentCost: 4000 },
        talentMultiplier: 1.75,
        talentMix,
        employees,
      },
    });

    expect(loaded.talentMultiplier).toBe(1.75);
    expect(loaded.company.talentMultiplier).toBe(1.75);
    expect(loaded.talentMix).toEqual(talentMix);
    expect(loaded.employees).toEqual(employees);
    expect(loaded.company.cash).toBe(15000);
    expect(loaded.company.burnRate).toBe(2000);
    expect(previewBurnRate(loaded)).toBe(4312);
    expect(loaded.talentCostFactor).toBeNull();
    expect(loaded.effectiveMultiplier).toBeNull();

    const ticked = applyEffects(loaded);
    expect(ticked.talentMultiplier).toBe(1.75);
    expect(ticked.company.talentMultiplier).toBe(1.75);
    expect(ticked.talentMix).toEqual(talentMix);
    expect(ticked.employees).toEqual(employees);
    expect(ticked.company.baseBurnRate).toBe(2200);
    expect(ticked.company.burnRate).toBe(4312);
    expect(ticked.company.cash).toBeCloseTo(15000 - 4312 / 12);

    const taxed = applyEffects(setTaxRate(ticked, 1));
    expect(taxed.taxRate).toBe(1);
    expect(taxed.talentMultiplier).toBe(1.75);
    expect(taxed.company.talentMultiplier).toBe(1.75);
    expect(taxed.talentMix).toEqual(talentMix);
    expect(taxed.employees).toEqual(employees);
    expect(taxed.company.baseBurnRate).toBe(2800);
    expect(taxed.company.burnRate).toBe(5488);
    expect(taxed.company.cash).toBeCloseTo(15000 - 4312 / 12 - 5488 / 12);

    const refreshed = hydrateFromApi(taxed, {
      company: {
        id: 'company-1',
        cash: 9,
        burnRate: 1,
        hype: 0.3,
        talentCost: 4000,
        baselines: { hype: 0.3, talentCost: 4000 },
        talentMultiplier: 1.05,
        talentMix: [{ department: 'marketing', headcount: 1, avgSkill: 0.5, weight: 1.05, contribution: 1.05 }],
        employees: [],
      },
    });
    expect(refreshed.company.cash).toBe(taxed.company.cash);
    expect(refreshed.company.burnRate).toBe(taxed.company.burnRate);
    expect(refreshed.talentMultiplier).toBe(1.05);
    expect(refreshed.employees).toEqual([]);
    expect(refreshed.talentCostFactor).toBeNull();
    expect(refreshed.effectiveMultiplier).toBeNull();
    expect(previewBurnRate(refreshed)).toBe(Math.round(2800 * 1.05));
  });

  test('clearTriggers restores the Slice 1 hype and talent baseline without ticking', () => {
    const stacked = applyTrigger(applyTrigger(initialState, policy), market);
    const cleared = clearTriggers(stacked);

    expect(cleared.company.hype).toBe(0.3);
    expect(cleared.company.talentCost).toBe(4000);
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

describe('API payload guards', () => {
  const apiCompany = {
    id: 'company-1',
    name: 'Northwind',
    cash: 1,
    burnRate: 9,
    hype: 0.55,
    talentCost: 4480,
    baselines: { hype: 0.3, talentCost: 4000 },
  };

  test('skips an unknown type and an extra effect key without dropping a valid trigger', () => {
    const state = hydrateFromApi(initialState, {
      company: apiCompany,
      triggers: [
        {
          id: 'evt-unknown',
          type: 'employees',
          label: 'Mystery',
          source: 'mock:local',
          timestamp: '2026-04-02T15:00:00.000Z',
          effect: { hype: 0.1 },
        },
        {
          ...policy,
          id: 'evt-extra',
          effect: { talentCost: 0.12, employees: 2 },
        },
        policy,
      ],
    });

    expect(state.activeTriggers.map((trigger) => trigger.id)).toEqual([policy.id]);
    expect(state.company.cash).toBe(15000);
    expect(state.company.hype).toBe(0.55);
    expect(state.company.talentCost).toBe(4480);
  });

  test('uses baselines when hype or talent cost is null or not finite, and keeps real zeroes', () => {
    const missing = hydrateFromApi(initialState, {
      company: { ...apiCompany, hype: null, talentCost: Number.POSITIVE_INFINITY },
      triggers: [],
    });
    expect(missing.company.hype).toBe(0.3);
    expect(missing.company.talentCost).toBe(4000);
    expect(missing.baselines).toEqual({ hype: 0.3, talentCost: 4000 });

    const zeroes = hydrateFromApi(initialState, {
      company: { ...apiCompany, hype: 0, talentCost: 0 },
      triggers: [],
    });
    expect(zeroes.company.hype).toBe(0);
    expect(zeroes.company.talentCost).toBe(0);
  });

  test('throws for a company whose baselines are not finite numbers', () => {
    expect(() => hydrateFromApi(initialState, {
      company: { hype: null, talentCost: null, baselines: { hype: null, talentCost: 4000 } },
      triggers: [policy],
    })).toThrow(TypeError);
  });

  test('clamps out-of-range hype and talent cost', () => {
    const low = readApiSnapshot(initialState, {
      company: {
        id: 'company-1',
        hype: -5,
        talentCost: -1,
        baselines: { hype: 0.3, talentCost: 4000 },
      },
      triggers: [],
    });
    expect(low.state.company.hype).toBe(0);
    expect(low.state.company.talentCost).toBe(0);
    expect(low.clampedHype).toBe(true);
    expect(low.clampedTalent).toBe(true);

    const huge = readApiSnapshot(initialState, {
      company: {
        id: 'company-1',
        hype: 0.3,
        talentCost: 1e308,
        baselines: { hype: 0.3, talentCost: 4000 },
      },
      triggers: [],
    });
    expect(huge.state.company.talentCost).toBe(9999999999.99);
    expect(huge.clampedTalent).toBe(true);
    expect(huge.clampedHype).toBe(false);
  });
});

describe('company payload shapes', () => {
  test('a 0.5.0 payload computes the talent-cost factor and keeps the employee multiplier', () => {
    const loaded = hydrateFromApi(initialState, {
      company: {
        id: 'company-1',
        cash: 1,
        burnRate: 9,
        hype: 0.3,
        talentCost: 4480,
        baselines: { hype: 0.3, talentCost: 4000 },
        talentMultiplier: 1,
      },
      triggers: [policy],
    });

    expect(loaded.talentCostFactor).toBeNull();
    expect(loaded.effectiveMultiplier).toBeNull();
    expect(loaded.talentMultiplier).toBe(1);
    expect(previewBurnRate(loaded)).toBe(2464);
    expect(previewBurnRate(setTaxRate(loaded, 0))).toBe(2240);

    const ticked = applyEffects(loaded);
    expect(ticked.talentMultiplier).toBe(1);
    expect(ticked.company.burnRate).toBe(2464);
    expect(ticked.talentCostFactor).toBeNull();
    expect(ticked.effectiveMultiplier).toBeNull();
  });

  test('a 0.6.0 payload prefers server factors across a tick and a tax change', () => {
    const loaded = hydrateFromApi(setTaxRate(initialState, 1), {
      company: {
        id: 'company-1',
        cash: 1,
        burnRate: 9,
        hype: 0.3,
        talentCost: 999,
        baselines: { hype: 0.3, talentCost: 4000 },
        talentMultiplier: 1.75,
        talentCostFactor: 1.12,
        effectiveMultiplier: 1.96,
        talentMix: [{ department: 'tech', headcount: 4, avgSkill: 1, weight: 1.25, contribution: 1.75 }],
        employees: [{ id: 'm1', department: 'marketing', skillMarketing: 0.5 }],
      },
      triggers: [policy],
    });

    expect(loaded.talentMultiplier).toBe(1.75);
    expect(loaded.talentCostFactor).toBe(1.12);
    expect(loaded.effectiveMultiplier).toBe(1.96);
    expect(previewBurnRate(loaded)).toBe(5488);

    const ticked = applyEffects(loaded);
    expect(ticked.talentMultiplier).toBe(1.75);
    expect(ticked.talentCostFactor).toBe(1.12);
    expect(ticked.effectiveMultiplier).toBe(1.96);
    expect(ticked.company.burnRate).toBe(5488);
    expect(ticked.employees).toEqual([{ id: 'm1', department: 'marketing', skillMarketing: 0.5 }]);

    const taxed = applyEffects(setTaxRate(ticked, 0.25));
    expect(taxed.talentMultiplier).toBe(1.75);
    expect(taxed.talentCostFactor).toBe(1.12);
    expect(taxed.effectiveMultiplier).toBe(1.96);
    expect(taxed.company.baseBurnRate).toBe(2200);
    expect(taxed.company.burnRate).toBe(4312);

    const disagreed = hydrateFromApi(setTaxRate(initialState, 1), {
      company: {
        id: 'company-1',
        hype: 0.3,
        talentCost: 4000,
        baselines: { hype: 0.3, talentCost: 4000 },
        talentMultiplier: 1.75,
        talentCostFactor: 1.12,
        effectiveMultiplier: 2,
      },
      triggers: [],
    });
    expect(effectiveMultiplierOf(disagreed)).toBe(1.96);
    expect(previewBurnRate(disagreed)).toBe(5488);
    expect(applyEffects(disagreed).effectiveMultiplier).toBe(2);
    expect(applyEffects(disagreed).talentCostFactor).toBe(1.12);
    expect(talentCostFactorOf(applyEffects(disagreed))).toBe(1.12);
  });
});

describe('local mode parity with the OpenAPI 0.7.0 simulation', () => {
  test('5,000 random trigger stacks match cent-rounded dollars, the factor, the flag, and burn', () => {
    function referenceRound(value, places) {
      const scale = 10 ** places;
      return Math.round((value + Math.sign(value) * 1e-10) * scale) / scale;
    }

    function referenceStack(triggers) {
      const ordered = [...triggers].sort((left, right) => {
        if (String(left.id) < String(right.id)) return -1;
        if (String(left.id) > String(right.id)) return 1;
        return 0;
      });
      let hype = 0.3;
      let factor = 1;
      for (const trigger of ordered) {
        if (typeof trigger.effect?.hype === 'number') hype += trigger.effect.hype;
        if (typeof trigger.effect?.talentCost === 'number') factor *= 1 + trigger.effect.talentCost;
      }
      const talent = 4000 * factor;
      return {
        hype: referenceRound(Math.min(1, Math.max(0, hype)), 4),
        talentCost: Math.min(9999999999.99, referenceRound(Math.max(0, Number.isFinite(talent) ? talent : 0), 2)),
      };
    }

    function referenceResolve(talentCost) {
      const raw = talentCost / 4000;
      const clamped = raw < 0.1 || raw > 3;
      return {
        factor: referenceRound(Math.min(3, Math.max(0.1, raw)), 4),
        clamped,
      };
    }

    function referenceBurn(taxRate, employee, factor) {
      const base = Math.round(2000 * (1 + taxRate * 0.4));
      return Math.round(base * employee * factor);
    }

    function mulberry32(seed) {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function decimalDelta(random, span) {
      const raw = (random() * 2 - 1) * span;
      const rounded = Math.round(raw * 10000) / 10000;
      if (rounded === 0) return raw < 0 ? -0.0001 : 0.0001;
      return Math.max(-100, Math.min(100, rounded));
    }

    const random = mulberry32(0x0cc0b661);
    const departments = ['tech', 'marketing', 'sales', 'ops'];
    for (let draw = 0; draw < 5000; draw += 1) {
      const count = 1 + Math.floor(random() * 4);
      const triggers = [];
      for (let index = 0; index < count; index += 1) {
        const effect = {};
        if (random() < 0.85) effect.talentCost = decimalDelta(random, random() < 0.2 ? 5 : 0.95);
        if (random() < 0.35) {
          effect.hype = Math.round((random() * 0.4 - 0.2) * 10000) / 10000;
        }
        if (effect.talentCost == null && (effect.hype == null || effect.hype === 0)) {
          effect.talentCost = -0.9;
        }
        triggers.push({
          id: `${random() < 0.5 ? 'z' : 'a'}-${draw}-${index}`,
          type: 'policy_change',
          label: 'Policy change',
          source: 'mock:local',
          timestamp: '2026-04-02T15:00:00.000Z',
          effect,
        });
      }

      const employees = [];
      const headcount = Math.floor(random() * 5);
      for (let index = 0; index < headcount; index += 1) {
        const department = departments[Math.floor(random() * departments.length)];
        employees.push({
          department,
          skillTech: random(),
          skillMarketing: random(),
          skillSales: random(),
        });
      }

      let state = {
        ...initialState,
        taxRate: Math.round(random() * 10000) / 10000,
        employees,
      };
      for (const trigger of triggers) state = applyTrigger(state, trigger);

      const stacked = referenceStack(state.activeTriggers);
      const resolved = referenceResolve(stacked.talentCost);
      const employee = talentMultiplierOf(state);
      const civicHype = roundTo(
        clampHype(stacked.hype + hypeBiasFromHeadroom(budgetHeadroomFromTax(state.taxRate))),
        4,
      );
      expect(state.company.talentCost, `draw ${draw} talent cost`).toBe(stacked.talentCost);
      expect(state.company.hype, `draw ${draw} hype`).toBe(civicHype);
      expect(talentCostFactorOf(state), `draw ${draw} factor`).toBe(resolved.factor);
      expect(talentCostFactorClampedOf(state), `draw ${draw} flag`).toBe(resolved.clamped);
      expect(previewBurnRate(state), `draw ${draw} burn`).toBe(
        referenceBurn(state.taxRate, employee, resolved.factor)
      );
    }
  });
});
