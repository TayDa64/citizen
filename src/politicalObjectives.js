/**
 * Political survival objective (P1-5).
 *
 * One real metric driven by existing civic feedback signals
 * (tax → budgetHeadroom → hype pathway), not a decorative counter:
 *
 *   voterSupport = clamp(
 *     0.5 * budgetHeadroom + 0.5 * company.hype,
 *     0, 1
 *   )
 *
 * Survival rule (evaluated only on `advance_turn`):
 *   voterSupport < VOTER_SUPPORT_FLOOR (0.25) → survivalStatus = 'ousted'
 *   otherwise                                → survivalStatus = 'incumbent'
 *
 * `set_tax` / triggers refresh `voterSupport` immediately; the win/lose
 * threshold flips only after a turn advances so survival is observable on
 * the committed turn path. Recovery is allowed on a later advance if
 * support rises back above the floor (e.g. lower tax then advance).
 *
 * Politics never multiplies burn / talentCostFactor (Slice 1/2 baselines).
 */

import { roundTo } from './triggers.js';

/** Floor below which an advance_turn ousts the incumbent. */
export const VOTER_SUPPORT_FLOOR = 0.25;
export const VOTER_SUPPORT_HEADROOM_WEIGHT = 0.5;
export const VOTER_SUPPORT_HYPE_WEIGHT = 0.5;

export const SURVIVAL_INCUMBENT = 'incumbent';
export const SURVIVAL_OUSTED = 'ousted';

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

/**
 * Voter support from civic headroom + company hype (0..1).
 */
export function voterSupportFromSignals({ budgetHeadroom, hype }) {
  const headroom = clamp01(budgetHeadroom);
  const companyHype = clamp01(hype);
  return roundTo(
    headroom * VOTER_SUPPORT_HEADROOM_WEIGHT + companyHype * VOTER_SUPPORT_HYPE_WEIGHT,
    4,
  );
}

/**
 * Survival status after an advance_turn given current voterSupport.
 */
export function evaluatePoliticalSurvival(voterSupport) {
  const support = Number(voterSupport);
  if (!Number.isFinite(support) || support < VOTER_SUPPORT_FLOOR) {
    return SURVIVAL_OUSTED;
  }
  return SURVIVAL_INCUMBENT;
}

export function normalizeSurvivalStatus(value) {
  return value === SURVIVAL_OUSTED ? SURVIVAL_OUSTED : SURVIVAL_INCUMBENT;
}

/**
 * Refresh politics from civic + hype. When `evaluateSurvival` is true
 * (advance_turn), recompute survivalStatus from the floor rule; otherwise
 * preserve the prior status.
 */
export function refreshPolitics(state, { evaluateSurvival = false } = {}) {
  const budgetHeadroom = Number(state?.civic?.budgetHeadroom);
  const hype = Number(state?.company?.hype);
  const voterSupport = voterSupportFromSignals({ budgetHeadroom, hype });
  const prior = normalizeSurvivalStatus(state?.politics?.survivalStatus);
  const survivalStatus = evaluateSurvival
    ? evaluatePoliticalSurvival(voterSupport)
    : prior;
  return {
    voterSupport,
    survivalStatus,
    survivalFloor: VOTER_SUPPORT_FLOOR,
  };
}

export function formatVoterSupport(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0%';
  return `${Math.round(numeric * 100)}%`;
}

export function formatSurvivalStatus(status) {
  return normalizeSurvivalStatus(status) === SURVIVAL_OUSTED ? 'ousted' : 'incumbent';
}

/** Default politics at Slice 1 starting tax (headroom 0.75, hype 0.3 → 0.525). */
export function defaultPolitics(civic, hype) {
  return refreshPolitics(
    { civic, company: { hype }, politics: { survivalStatus: SURVIVAL_INCUMBENT } },
    { evaluateSurvival: false },
  );
}
