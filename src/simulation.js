import {
  applyDelta,
  HYPE_BOUNDS,
  TALENT_COST_BOUNDS,
  TriggerValidationError,
  validateTriggerRecord
} from './triggerContract.js';

// Tax → burn rate is Slice 1 and stays on its own formula.
// Real-world triggers adjust hype and talent cost only.

export const initialState = {
  taxRate: 0.25,
  company: {
    cash: 15000,
    burnRate: 2000,
    hype: 0.3,
    productQuality: 0.4,
    talentCost: 4000
  },
  history: {
    cash: [15000],
    burnRate: [2000],
    hype: [0.3],
    talentCost: [4000]
  },
  triggers: []
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

export function applyEffects(state) {
  const next = structuredClone(state);
  // Effect: taxRate increases burnRate (example formula)
  const formula = '{baseBurn} * (1 + {taxRate} * 0.4)';
  const baseBurn = 2000;
  next.company.burnRate = Math.round(
    evalFormula(formula, { baseBurn, taxRate: next.taxRate })
  );
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
  const effect = validated.value.effect;
  if (effect.hype != null) {
    next.company.hype = applyDelta(next.company.hype, effect.hype, HYPE_BOUNDS);
  }
  if (effect.talentCost != null) {
    next.company.talentCost = applyDelta(
      next.company.talentCost,
      effect.talentCost,
      TALENT_COST_BOUNDS
    );
  }
  next.triggers = [validated.value, ...(next.triggers || [])];
  next.history.hype = appendHistory(next.history.hype, next.company.hype);
  next.history.talentCost = appendHistory(next.history.talentCost, next.company.talentCost);
  return next;
}