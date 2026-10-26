// Simple client-side simulation for Slice 1 (tax → burn rate)
// Matches the Postgres schema shape so it can later move server-side.

export const initialState = {
  taxRate: 0.25,
  company: {
    cash: 15000,
    burnRate: 2000,
    hype: 0.3,
    productQuality: 0.4
  },
  history: {
    cash: [15000],
    burnRate: [2000]
  }
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