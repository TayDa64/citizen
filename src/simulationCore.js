// Core client simulation mutations (no turn-engine wrapper).
// Slice 1: taxRate increases burn, then cash falls on each tick.
// Slice 2: real-world triggers move hype and talent cost. With no active
// trigger, talent cost stays at the $4,000 baseline and burn matches Slice 1.
// baseBurnRate = round(2000 * (1 + taxRate * 0.4)).
// Burn is round(baseBurnRate * talentMultiplier * talentCostFactor), once.
//
// Imported by `turnEngine.js` and re-exported through `simulation.js`.
// Prefer `simulation.js` / TurnCommand from app code.
//
// Authority boundary:
// - GET /api/companies owns: hype, talentCost, baselines, talent mix/factors.
// - Campaign turn commits (when used) own cash / burn history / tax / turn.
// - readApiSnapshot / hydrateFromApi never copy company.cash or company.burnRate
//   from the companies payload.
//
// `appliedAtIndex` on an active trigger is client runtime for the chart, not
// part of the RealWorldTrigger payload in triggers.js.

import {
  announceTrigger,
  assertValidTrigger,
  clampHype,
  clampTalentCost,
  describeTrigger,
  hypeOutOfRange,
  roundTo,
  talentCostOutOfRange,
} from './triggers.js';
import {
  burnRateFromMultiplier,
  composeTalentMultiplier,
  effectiveBurnRate,
  readOptionalFactor,
  talentCostFactorClampOf,
  readTalentMix,
  readTalentMultiplier,
  baseBurnRate as taxOnlyBurnRate,
} from './talentMultiplier.js';
import { applyCivicFeedback, computeCivicFromTax } from './civicFeedback.js';
import { defaultPolitics } from './politicalObjectives.js';

export const BASE_BURN = 2000;
export const BASE_HYPE = 0.3;
export const BASE_TALENT_COST = 4000;

export const GAME_STATE_VERSION = 1;
export const RULE_VERSION = 'citizen-civic-v1';

const INITIAL_CIVIC = computeCivicFromTax(0.25);

export const initialState = {
  stateVersion: GAME_STATE_VERSION,
  campaignId: null,
  turn: 0,
  seed: null,
  ruleVersion: RULE_VERSION,
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
  // Neutral tax 0.25 → headroom 0.75 → hypeBias 0 (Slice 1 default).
  civic: INITIAL_CIVIC,
  // P1-5: voterSupport from headroom + hype; survival evaluated on advance_turn.
  politics: defaultPolitics(INITIAL_CIVIC, BASE_HYPE),
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

function refreshTalentFromEmployees(state) {
  const profile = composeTalentMultiplier({ employees: state.employees });
  const next = state;
  next.talentMultiplier = profile.talentMultiplier;
  next.talentMix = profile.talentMix;
  if (next.dataSource !== 'api') {
    next.talentCostFactor = null;
    next.effectiveMultiplier = null;
  } else {
    // Keep API talentCostFactor; clear cached effective so readers recompute.
    next.effectiveMultiplier = null;
  }
  next.company.talentMultiplier = profile.talentMultiplier;
  next.company.talentMix = profile.talentMix;
  next.company.baseBurnRate = baselineBurnRate(next);
  next.company.burnRate = previewBurnRate(next);
  return next;
}

export function applyEffects(state) {
  const next = structuredClone(state);
  // API mode keeps the fetched multiplier, mix, and any talentCostFactor.
  // An empty (or mismatched) employee list must not reset the server
  // multiplier — hire_employee writes talent fields explicitly. Local mode
  // recomputes the employee multiplier only.
  if (next.dataSource !== 'api') {
    refreshTalentFromEmployees(next);
  } else {
    next.company.talentMultiplier = next.talentMultiplier;
    next.company.talentMix = next.talentMix;
    next.company.baseBurnRate = baselineBurnRate(next);
    next.company.burnRate = previewBurnRate(next);
  }
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
  const next = structuredClone(state);
  next.taxRate = Math.max(0, Math.min(1, taxRate));
  // Tax → budget headroom → hype bias (same committed turn path as set_tax).
  return applyCivicFeedback(next);
}

const HIRE_DEPARTMENTS = Object.freeze(['tech', 'marketing', 'sales']);

/**
 * Append one employee and refresh talent multiplier / burn preview.
 * Does not drain cash (same pattern as set_tax / triggers).
 */
export function hireEmployee(state, { department = 'tech', skill = 1, id = null } = {}) {
  const dept = typeof department === 'string' ? department.trim().toLowerCase() : '';
  if (!HIRE_DEPARTMENTS.includes(dept)) {
    throw new TypeError(`department must be one of: ${HIRE_DEPARTMENTS.join(', ')}`);
  }
  const skillValue = Number(skill);
  if (!Number.isFinite(skillValue)) {
    throw new TypeError('skill must be a finite number');
  }
  const clampedSkill = Math.min(1, Math.max(0, skillValue));
  const next = structuredClone(state);
  if (!Array.isArray(next.employees)) next.employees = [];
  const hireId = typeof id === 'string' && id.trim() !== ''
    ? id.trim()
    : `hire-${dept}-${next.employees.length + 1}`;
  const employee = {
    id: hireId,
    department: dept,
    isActive: true,
  };
  if (dept === 'tech') employee.skillTech = clampedSkill;
  else if (dept === 'marketing') employee.skillMarketing = clampedSkill;
  else employee.skillSales = clampedSkill;
  next.employees = [...next.employees, employee];
  return refreshTalentFromEmployees(next);
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
  const hypeBaseline = Number.isFinite(Number(baselines?.hype)) ? Number(baselines.hype) : BASE_HYPE;
  const talentBaseline = Number.isFinite(Number(baselines?.talentCost))
    ? Number(baselines.talentCost)
    : BASE_TALENT_COST;
  const ordered = [...activeTriggers].sort((left, right) => {
    if (String(left.id) < String(right.id)) return -1;
    if (String(left.id) > String(right.id)) return 1;
    return 0;
  });
  let hype = hypeBaseline;
  let factor = 1;
  for (const trigger of ordered) {
    if (typeof trigger.effect?.hype === 'number') hype += trigger.effect.hype;
    if (typeof trigger.effect?.talentCost === 'number') factor *= 1 + trigger.effect.talentCost;
  }
  const talent = talentBaseline * factor;
  const talentCost = roundTo(Math.max(0, Number.isFinite(talent) ? talent : 0), 2);
  return {
    hype: roundTo(clampHype(hype), 4),
    talentCost: clampTalentCost(talentCost),
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

  const hypeReading = clampMetric(finiteNumber(company.hype), clampHype, hypeOutOfRange);
  const talentReading = clampMetric(finiteNumber(company.talentCost), clampTalentCost, talentCostOutOfRange);
  const baselineHypeReading = clampMetric(baselineHype, clampHype, hypeOutOfRange);
  const baselineTalentReading = clampMetric(baselineTalent, clampTalentCost, talentCostOutOfRange);
  const hype = hypeReading.value;
  const talentCost = talentReading.value;
  const index = Math.max(0, (prev.history?.cash?.length ?? 1) - 1);
  const previousById = new Map((prev.activeTriggers ?? []).map((item) => [item.id, item]));
  const activeTriggers = accepted.map((trigger) => {
    const prior = previousById.get(trigger.id);
    return storeTrigger(trigger, prior?.appliedAtIndex ?? index);
  });

  const apiEmployees = readProvidedEmployees(snapshot, company);
  // Campaign GameState owns the roster after hire_employee. Do not wipe hires
  // when refreshing companies/triggers.
  const campaignOwnsRoster = Boolean(prev.campaignId)
    && Array.isArray(prev.employees)
    && prev.employees.length > 0;
  const employees = campaignOwnsRoster ? prev.employees.map((row) => ({ ...row })) : apiEmployees;
  const talentMultiplier = campaignOwnsRoster
    ? readTalentMultiplier(prev.talentMultiplier)
    : readTalentMultiplier(company.talentMultiplier);
  const talentMix = campaignOwnsRoster
    ? (Array.isArray(prev.talentMix) ? prev.talentMix.map((row) => ({ ...row })) : [])
    : readTalentMix(company.talentMix);
  const talentCostFactor = readOptionalFactor(company.talentCostFactor, 'talentCostFactor');
  const effectiveMultiplier = campaignOwnsRoster
    ? null
    : readOptionalFactor(company.effectiveMultiplier, 'effectiveMultiplier');
  const talentCostFactorClamped = typeof company.talentCostFactorClamped === 'boolean'
    ? company.talentCostFactorClamped
    : null;
  const resolvedHype = hype ?? baselineHypeReading.value;
  const resolvedTalent = talentCost ?? baselineTalentReading.value;
  // Keep client cash / burnRate / productQuality / history. Ignore any
  // company.cash or company.burnRate on the API payload (authority boundary).
  // Fold civic hype bias from the client taxRate onto API stacked hype.
  const hydrated = {
    ...prev,
    dataSource: 'api',
    baselines: { hype: baselineHypeReading.value, talentCost: baselineTalentReading.value },
    activeTriggers,
    employees,
    talentMultiplier,
    talentMix,
    talentCostFactor,
    talentCostFactorClamped,
    effectiveMultiplier,
    company: {
      ...prev.company,
      cash: prev.company.cash,
      burnRate: prev.company.burnRate,
      hype: resolvedHype,
      talentCost: resolvedTalent,
      talentMultiplier,
      talentMix,
    },
  };
  applyCivicFeedback(hydrated, resolvedHype);
  return {
    state: hydrated,
    skipped,
    missingHype: hype == null,
    missingTalent: talentCost == null,
    clampedHype: hypeReading.clamped || baselineHypeReading.clamped || hypeOutOfRange(hydrated.company.hype),
    clampedTalent: talentReading.clamped || baselineTalentReading.clamped || talentCostOutOfRange(resolvedTalent),
  };
}

function clampMetric(value, clamp, outOfRange) {
  if (value == null) return { value: null, clamped: false };
  if (!outOfRange(value)) return { value, clamped: false };
  return { value: clamp(value), clamped: true };
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
  next.company.talentCost = after.talentCost;
  // Stacked trigger hype, then civic bias from current tax (budget headroom).
  applyCivicFeedback(next, after.hype);
  next.lastTriggerChange = change
    ? {
        ...change,
        before,
        after: { hype: next.company.hype, talentCost: after.talentCost },
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
  const applied = applyActiveTriggers(next, before, {
    triggerId: trigger.id,
    label: trigger.label,
    type: trigger.type,
    announcement: describeTrigger(trigger),
  });
  applied.lastTriggerChange.announcement = announceTrigger(
    trigger,
    'apply',
    effectiveBurnRate(applied),
    talentCostFactorClampOf(applied),
  );
  return applied;
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
