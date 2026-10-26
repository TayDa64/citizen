// Client-side simulation.
// Slice 1: taxRate increases burn, then cash falls on each tick.
// Slice 2: real-world triggers move hype and talent cost. With no active
// trigger, talent cost stays 1 and burn matches the Slice 1 formula.
// API mode uses dollar talent cost and does not multiply burn. That choice
// lives only in talentCostMultipliesBurn (src/dataSource.js). OPEN DECISION.
// `appliedAtIndex` on an active trigger is client runtime for the chart, not
// part of the RealWorldTrigger payload in triggers.js.

import { talentCostMultipliesBurn } from './dataSource';
import { assertValidTrigger, describeTrigger } from './triggers';

export const BASE_BURN = 2000;
export const BASE_HYPE = 0.3;
export const BASE_TALENT_COST = 1;

export const initialState = {
  taxRate: 0.25,
  company: {
    cash: 15000,
    burnRate: BASE_BURN,
    hype: BASE_HYPE,
    productQuality: 0.4,
    talentCost: BASE_TALENT_COST,
  },
  history: {
    cash: [15000],
    burnRate: [BASE_BURN],
  },
  baselines: {
    hype: BASE_HYPE,
    talentCost: BASE_TALENT_COST,
  },
  dataSource: 'local',
  activeTriggers: [],
  lastTriggerChange: null,
};

// Minimal safe formula evaluator: supports {var} substitution + basic + - * /
function evalFormula(formula, context) {
  let expr = formula;
  for (const [k, v] of Object.entries(context)) {
    expr = expr.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  // Very limited: only numbers, operators, parentheses. No eval of arbitrary code.
  if (!/^[0-9.+\-*/()\s]+$/.test(expr)) {
    console.warn('Unsafe formula rejected:', formula);
    return 0;
  }
  try {
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${expr})`)();
  } catch {
    return 0;
  }
}

function dataSourceOf(state) {
  return state?.dataSource === 'api' ? 'api' : 'local';
}

export function computeBurnRate(taxRate, talentCost = BASE_TALENT_COST, dataSource = 'local') {
  const talentFactor = talentCostMultipliesBurn(dataSource) ? (talentCost ?? BASE_TALENT_COST) : 1;
  const formula = '{baseBurn} * (1 + {taxRate} * 0.4) * {talentFactor}';
  return Math.round(
    evalFormula(formula, {
      baseBurn: BASE_BURN,
      taxRate,
      talentFactor,
    })
  );
}

export function previewBurnRate(state) {
  return computeBurnRate(
    state.taxRate,
    state.company.talentCost ?? BASE_TALENT_COST,
    dataSourceOf(state)
  );
}

export function baselineBurnRate(state) {
  const talent = state.baselines?.talentCost ?? state.company?.talentCost ?? BASE_TALENT_COST;
  return computeBurnRate(state.taxRate, talent, dataSourceOf(state));
}

export function applyEffects(state) {
  const next = structuredClone(state);
  const talentCost = next.company.talentCost ?? BASE_TALENT_COST;
  next.company.burnRate = computeBurnRate(next.taxRate, talentCost, dataSourceOf(next));
  next.company.cash = Math.max(0, next.company.cash - next.company.burnRate / 12);
  next.history.cash.push(Math.round(next.company.cash));
  next.history.burnRate.push(next.company.burnRate);
  if (next.history.cash.length > 24) {
    next.history.cash.shift();
    next.history.burnRate.shift();
    next.activeTriggers = (next.activeTriggers ?? []).map((trigger) => ({
      ...trigger,
      appliedAtIndex: Math.max(0, (trigger.appliedAtIndex ?? 0) - 1),
    }));
  }
  return next;
}

export function setTaxRate(state, taxRate) {
  return { ...state, taxRate: Math.max(0, Math.min(1, taxRate)) };
}

function cloneTriggerState(state) {
  const next = structuredClone(state);
  if (!next.baselines) {
    next.baselines = {
      hype: next.company.hype,
      talentCost: next.company.talentCost ?? BASE_TALENT_COST,
    };
  }
  if (next.company.talentCost == null) {
    next.company.talentCost = next.baselines.talentCost;
  }
  if (!Array.isArray(next.activeTriggers)) next.activeTriggers = [];
  return next;
}

function combinedEffects(baselines, activeTriggers) {
  let hype = baselines.hype;
  let talentCost = baselines.talentCost;
  for (const trigger of activeTriggers) {
    if (typeof trigger.effect.hype === 'number') hype += trigger.effect.hype;
    if (typeof trigger.effect.talentCost === 'number') {
      talentCost *= 1 + trigger.effect.talentCost;
    }
  }
  return {
    hype: Math.min(1, Math.max(0, hype)),
    talentCost: Math.max(0, talentCost),
  };
}

function storeTrigger(trigger, appliedAtIndex) {
  const effect = {};
  if (typeof trigger.effect?.hype === 'number') effect.hype = trigger.effect.hype;
  if (typeof trigger.effect?.talentCost === 'number') effect.talentCost = trigger.effect.talentCost;
  return {
    id: trigger.id,
    type: trigger.type,
    label: trigger.label,
    source: trigger.source,
    timestamp: trigger.timestamp,
    effect,
    appliedAtIndex,
  };
}

export function hydrateFromApi(prev, snapshot) {
  const company = snapshot?.company;
  const baselines = company?.baselines;
  if (baselines == null) throw new TypeError('Company baselines are required');
  const nextBaselines = {
    hype: Number(baselines.hype),
    talentCost: Number(baselines.talentCost),
  };
  if (!Number.isFinite(nextBaselines.hype) || !Number.isFinite(nextBaselines.talentCost)) {
    throw new TypeError('Company baselines must be finite numbers');
  }
  const triggers = Array.isArray(snapshot.triggers) ? snapshot.triggers : [];
  for (const trigger of triggers) assertValidTrigger(trigger);
  const index = Math.max(0, (prev.history?.cash?.length ?? 1) - 1);
  const previousById = new Map((prev.activeTriggers ?? []).map((item) => [item.id, item]));
  const activeTriggers = triggers.map((trigger) => {
    const prior = previousById.get(trigger.id);
    return storeTrigger(trigger, prior?.appliedAtIndex ?? index);
  });
  const chartStarted = (prev.history?.cash?.length ?? 1) > 1;
  const cash = Number(company.cash);
  const burnRate = Number(company.burnRate);
  return {
    ...prev,
    dataSource: 'api',
    baselines: nextBaselines,
    activeTriggers,
    company: {
      ...prev.company,
      hype: Number(company.hype),
      talentCost: Number(company.talentCost),
      ...(chartStarted ? {} : { cash, burnRate }),
    },
    history: chartStarted
      ? prev.history
      : {
          cash: [Math.round(cash)],
          burnRate: [burnRate],
        },
  };
}

function applyActiveTriggers(next, before, change) {
  const after = combinedEffects(next.baselines, next.activeTriggers);
  next.company.hype = after.hype;
  next.company.talentCost = after.talentCost;
  next.lastTriggerChange = change
    ? {
        ...change,
        before,
        after: { hype: after.hype, talentCost: after.talentCost },
      }
    : null;
  return next;
}

export function applyTrigger(state, trigger) {
  assertValidTrigger(trigger);
  const next = cloneTriggerState(state);
  const before = { hype: next.company.hype, talentCost: next.company.talentCost };
  const appliedAtIndex = Math.max(0, (next.history?.cash?.length ?? 1) - 1);
  next.activeTriggers = [
    ...next.activeTriggers.filter((item) => item.id !== trigger.id),
    storeTrigger(trigger, appliedAtIndex),
  ];
  return applyActiveTriggers(next, before, {
    triggerId: trigger.id,
    label: trigger.label,
    type: trigger.type,
    announcement: describeTrigger(trigger),
  });
}

export function removeTrigger(state, triggerId) {
  if (typeof triggerId !== 'string' || triggerId.trim() === '') {
    throw new TypeError('triggerId must be a non-empty string');
  }
  const next = cloneTriggerState(state);
  const before = { hype: next.company.hype, talentCost: next.company.talentCost };
  next.activeTriggers = next.activeTriggers.filter((item) => item.id !== triggerId);
  if (next.activeTriggers.length === 0) {
    return applyActiveTriggers(next, before, null);
  }
  return applyActiveTriggers(next, before, {
    triggerId,
    label: triggerId,
    type: next.activeTriggers[0].type,
    announcement: 'Trigger removed. Remaining world events still apply.',
  });
}

export function clearTriggers(state) {
  const next = cloneTriggerState(state);
  const before = { hype: next.company.hype, talentCost: next.company.talentCost };
  next.activeTriggers = [];
  return applyActiveTriggers(next, before, null);
}
