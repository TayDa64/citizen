// Client-side simulation.
// Slice 1: taxRate increases burn, then cash falls on each tick.
// Slice 2: real-world triggers move hype and talent cost. With no active
// trigger, talent cost stays 1 and burn matches the Slice 1 formula.
// Burn is round(2000 * (1 + taxRate * 0.4) * talentMultiplier). The multiplier
// comes from employees locally and from company.talentMultiplier on the API.
// OPEN DECISION: APPLY_TALENT_COST_TO_BURN in src/talentMultiplier.js is
// false, matching the backend: effect.talentCost does not scale burn.
// The service is the source of truth for hype, talentCost, baselines, and
// talentMultiplier. Cash and burn stay on the client simulation.
// `appliedAtIndex` on an active trigger is client runtime for the chart, not
// part of the RealWorldTrigger payload in triggers.js.

import { assertValidTrigger, describeTrigger } from './triggers';
import {
  burnRateFromMultiplier,
  composeTalentMultiplier,
  effectiveBurnRate,
  readTalentMix,
  readTalentMultiplier,
  talentCostFactor,
  baseBurnRate as taxOnlyBurnRate,
} from './talentMultiplier';

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
  employees: [],
  talentMultiplier: 1,
  talentMix: [],
  activeTriggers: [],
  lastTriggerChange: null,
};

export function computeBurnRate(taxRate, talentMultiplier = 1) {
  return burnRateFromMultiplier(taxRate, talentMultiplier);
}

export function previewBurnRate(state) {
  return effectiveBurnRate(state);
}

export function baselineBurnRate(state) {
  return taxOnlyBurnRate(state.taxRate);
}

export function applyEffects(state) {
  const next = structuredClone(state);
  // API mode keeps the fetched multiplier, mix, and employees. Burn changes
  // only with tax. Recomputing from the employee list would turn an empty
  // list into ×1 and the Slice 1 burn. Those fields update on the next fetch.
  // Local mode uses the type-weighted employee rule. Talent cost scales burn
  // only when APPLY_TALENT_COST_TO_BURN is on.
  if (next.dataSource !== 'api') {
    const profile = composeTalentMultiplier({
      employees: next.employees,
      triggerFactor: talentCostFactor(next.company?.talentCost, next.baselines?.talentCost),
    });
    next.talentMultiplier = profile.talentMultiplier;
    next.talentMix = profile.talentMix;
  }
  next.company.talentMultiplier = next.talentMultiplier;
  next.company.talentMix = next.talentMix;
  next.company.baseBurnRate = baselineBurnRate(next);
  next.company.burnRate = previewBurnRate(next);
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

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unreadableCompany() {
  const error = new TypeError('Company payload could not be read');
  error.code = 'unreadable-company';
  return error;
}

export function readApiSnapshot(prev, snapshot) {
  const company = snapshot?.company;
  const baselines = company?.baselines;
  const baselineHype = finiteNumber(baselines?.hype);
  const baselineTalent = finiteNumber(baselines?.talentCost);
  if (
    company == null
    || typeof company !== 'object'
    || Array.isArray(company)
    || baselineHype == null
    || baselineTalent == null
  ) {
    throw unreadableCompany();
  }

  const rawTriggers = snapshot?.triggers;
  const triggerList = Array.isArray(rawTriggers) ? rawTriggers : [];
  const accepted = [];
  let skipped = Array.isArray(rawTriggers) || rawTriggers == null ? 0 : 1;
  for (const trigger of triggerList) {
    try {
      assertValidTrigger(trigger);
      accepted.push(trigger);
    } catch {
      skipped += 1;
    }
  }

  const hype = finiteNumber(company.hype);
  const talentCost = finiteNumber(company.talentCost);
  const index = Math.max(0, (prev.history?.cash?.length ?? 1) - 1);
  const previousById = new Map((prev.activeTriggers ?? []).map((item) => [item.id, item]));
  const activeTriggers = accepted.map((trigger) => {
    const prior = previousById.get(trigger.id);
    return storeTrigger(trigger, prior?.appliedAtIndex ?? index);
  });

  const talentMultiplier = readTalentMultiplier(company.talentMultiplier);
  const talentMix = readTalentMix(company.talentMix);
  return {
    state: {
      ...prev,
      dataSource: 'api',
      baselines: { hype: baselineHype, talentCost: baselineTalent },
      activeTriggers,
      employees: readProvidedEmployees(snapshot, company),
      talentMultiplier,
      talentMix,
      company: {
        ...prev.company,
        hype: hype ?? baselineHype,
        talentCost: talentCost ?? baselineTalent,
        talentMultiplier,
        talentMix,
      },
    },
    skipped,
    missingHype: hype == null,
    missingTalent: talentCost == null,
  };
}

function readProvidedEmployees(snapshot, company) {
  const raw = Array.isArray(company?.employees)
    ? company.employees
    : Array.isArray(snapshot?.employees)
      ? snapshot.employees
      : [];
  return raw
    .filter((employee) => employee != null && typeof employee === 'object' && !Array.isArray(employee))
    .map((employee) => ({ ...employee }));
}

export function hydrateFromApi(prev, snapshot) {
  return readApiSnapshot(prev, snapshot).state;
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
