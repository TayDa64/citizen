import {
  DEFAULT_HYPE,
  DEFAULT_TALENT_COST,
  TriggerValidationError,
  stackTriggerEffects,
  validateTriggerRecord
} from './triggerContract.js';
import { burnFromTax, composeTalentMultiplier, talentCostFactor } from './talentBurn.js';

// Tax → burn is Slice 1, then the employee talent multiplier and the talent-cost factor.
// burnRate = round(2000 * (1 + taxRate * 0.4) * talentMultiplier * talentCostFactor), once.
// baseBurnRate = round(2000 * (1 + taxRate * 0.4)).
// talentMultiplier is the employee mean (exactly 1 with no employees).
// talentCostFactor is talentCost / baselines.talentCost (exactly 1 with no trigger).
// effectiveMultiplier is that product. A second tick recomputes this product;
// it does not multiply the previous burnRate again.

export const initialState = {
  taxRate: 0.25,
  company: {
    cash: 15000,
    burnRate: 2000,
    baseBurnRate: 2000,
    talentMultiplier: 1,
    talentCostFactor: 1,
    effectiveMultiplier: 1,
    talentMix: [],
    hype: 0.3,
    productQuality: 0.4,
    talentCost: 4000
  },
  employees: [],
  history: {
    cash: [15000],
    burnRate: [2000],
    hype: [0.3],
    talentCost: [4000]
  },
  baselines: {
    hype: 0.3,
    talentCost: 4000
  },
  triggers: []
};

function assignBurn(next) {
  const { talentMultiplier, talentMix } = composeTalentMultiplier({
    employees: next.employees
  });
  const factor = talentCostFactor(next.company.talentCost, next.baselines?.talentCost);
  const burn = burnFromTax(next.taxRate, talentMultiplier, factor);
  next.company.talentMultiplier = talentMultiplier;
  next.company.talentMix = talentMix;
  next.company.talentCostFactor = burn.talentCostFactor;
  next.company.effectiveMultiplier = burn.effectiveMultiplier;
  next.company.baseBurnRate = burn.baseBurnRate;
  next.company.burnRate = burn.burnRate;
}

export function applyEffects(state) {
  const next = structuredClone(state);
  assignBurn(next);
  // Simple tick: cash decreases by burn
  next.company.cash = Math.max(0, next.company.cash - next.company.burnRate / 12);
  next.history.cash.push(Math.round(next.company.cash));
  next.history.burnRate.push(next.company.burnRate);
  if (next.history.cash.length > 24) {
    next.history.cash.shift();
    next.history.burnRate.shift();
  }
  return next;
}

export function setTaxRate(state, taxRate) {
  return { ...state, taxRate: Math.max(0, Math.min(1, taxRate)) };
}

function appendHistory(series, value) {
  const next = [...(series || []), value];
  if (next.length > 24) next.splice(0, next.length - 24);
  return next;
}

export function applyTriggerEffect(state, trigger) {
  const validated = validateTriggerRecord(trigger);
  if (!validated.ok) {
    throw new TriggerValidationError('Invalid trigger payload', validated.issues);
  }
  const next = structuredClone(state);
  const baselines = next.baselines ?? { hype: DEFAULT_HYPE, talentCost: DEFAULT_TALENT_COST };
  const triggers = [
    validated.value,
    ...(next.triggers || []).filter((item) => item.id !== validated.value.id)
  ];
  const stacked = stackTriggerEffects(baselines, triggers);
  next.baselines = { hype: baselines.hype, talentCost: baselines.talentCost };
  next.company.hype = stacked.hype;
  next.company.talentCost = stacked.talentCost;
  next.triggers = triggers;
  next.history.hype = appendHistory(next.history.hype, next.company.hype);
  next.history.talentCost = appendHistory(next.history.talentCost, next.company.talentCost);
  assignBurn(next);
  return next;
}