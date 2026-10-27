/**
 * First civic feedback loop (P0-4) + pathway execution (P0-5).
 *
 * Formulas come from the typed pathway registry (`pathways.js`):
 *   budgetHeadroom = clamp(1 - taxRate, 0, 1)          // tax ↑ → headroom ↓
 *   hypeBias       = (budgetHeadroom - 0.75) * 0.2     // 0 at default 25% tax
 *   company.hype   = clamp(stackedTriggerHype + hypeBias)
 *
 * Neutral tax 0.25 → headroom 0.75 → bias 0, so Slice 1 burn baselines and
 * default hype 0.3 stay put. Civic never multiplies burn / talentCostFactor.
 */

import {
  PATHWAY_BUDGET_HEADROOM_TO_HYPE,
  pathwayBiasFromSource,
  pathwaySourceFromTax,
} from './pathways.js';
import { clampHype, roundTo } from './triggers.js';

/** Pathway id executed on set_tax (registry is truth; this module applies it). */
export const CIVIC_HYPE_PATHWAY_ID = PATHWAY_BUDGET_HEADROOM_TO_HYPE.id;

/** Default tax where civic hype bias is zero (Slice 1 starting tax). */
export const CIVIC_NEUTRAL_TAX = 0.25;
export const CIVIC_NEUTRAL_HEADROOM = PATHWAY_BUDGET_HEADROOM_TO_HYPE.bounds.neutralSource;
/** Scale from headroom delta → hype points on the 0..1 scale. */
export const CIVIC_HYPE_BIAS_SCALE = PATHWAY_BUDGET_HEADROOM_TO_HYPE.bounds.scale;

export function budgetHeadroomFromTax(taxRate) {
  return pathwaySourceFromTax(PATHWAY_BUDGET_HEADROOM_TO_HYPE, taxRate);
}

export function hypeBiasFromHeadroom(budgetHeadroom) {
  return pathwayBiasFromSource(PATHWAY_BUDGET_HEADROOM_TO_HYPE, budgetHeadroom);
}

export function computeCivicFromTax(taxRate) {
  const budgetHeadroom = budgetHeadroomFromTax(taxRate);
  return {
    budgetHeadroom,
    hypeBias: hypeBiasFromHeadroom(budgetHeadroom),
  };
}

export function formatBudgetHeadroom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0%';
  return `${Math.round(numeric * 100)}%`;
}

export function formatHypeBias(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.00005) return '0';
  const signed = numeric > 0 ? `+${numeric.toFixed(2)}` : numeric.toFixed(2);
  return signed;
}

/**
 * Strip prior civic bias and apply next bias onto a stacked/API hype value.
 */
export function rebiasHype(hype, prevCivic, nextCivic) {
  const prevBias = Number.isFinite(Number(prevCivic?.hypeBias)) ? Number(prevCivic.hypeBias) : 0;
  const nextBias = Number.isFinite(Number(nextCivic?.hypeBias)) ? Number(nextCivic.hypeBias) : 0;
  const base = Number(hype);
  const stacked = Number.isFinite(base) ? base - prevBias : 0;
  return roundTo(clampHype(stacked + nextBias), 4);
}

/**
 * Ensure `state.civic` matches taxRate and fold bias into company.hype.
 * `stackedHype` is trigger/API hype before civic (omit to strip current bias).
 */
export function applyCivicFeedback(state, stackedHype = null) {
  const next = state;
  const civic = computeCivicFromTax(next.taxRate);
  const prevCivic = next.civic;
  const currentHype = Number(next.company?.hype);
  const preCivic = stackedHype != null && Number.isFinite(Number(stackedHype))
    ? Number(stackedHype)
    : (Number.isFinite(currentHype)
      ? currentHype - (Number.isFinite(Number(prevCivic?.hypeBias)) ? Number(prevCivic.hypeBias) : 0)
      : 0.3);
  next.civic = civic;
  if (!next.company || typeof next.company !== 'object') {
    next.company = { hype: roundTo(clampHype(preCivic + civic.hypeBias), 4) };
  } else {
    next.company.hype = roundTo(clampHype(preCivic + civic.hypeBias), 4);
  }
  return next;
}
