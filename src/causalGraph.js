/**
 * Executable causal graph (P1-3).
 *
 * Extends the P0-5 pathway registry pattern: one frozen rule list is the
 * source of truth for causal / effect edges the turn engine executes.
 * React Flow edges and labels are a view of this registry — not a parallel
 * hardcode of simulation rules.
 *
 * Includes:
 *  - tax → burn (Slice 1 formula edge)
 *  - pathway.budgetHeadroom→company.hype (P0-5)
 *  - registered trigger effect keys (hype / talentCost)
 */

import {
  EFFECT_KEY_RULES,
  assertKnownEffectKeys,
  previewEffectKeys,
} from './effectKeys.js';
import {
  PATHWAY_BUDGET_HEADROOM_TO_HYPE,
  PATHWAY_RULES,
  diagramEdgeFromPathway,
} from './pathways.js';

export {
  EFFECT_KEY_RULES,
  KNOWN_EFFECT_KEYS,
  assertKnownEffectKeys,
  getEffectKeyRule,
  isKnownEffectKey,
  previewEffectKeys,
} from './effectKeys.js';

export {
  PATHWAY_BUDGET_HEADROOM_TO_HYPE,
  PATHWAY_RULES,
  diagramEdgeFromPathway,
  getPathway,
  previewPathway,
} from './pathways.js';

/** Slice 1 tax → burn edge (formula lives in simulationCore; registry owns the edge). */
export const TAX_BURN_RULE = Object.freeze({
  id: 'rule.tax→company.burnRate',
  kind: 'formula',
  source: Object.freeze({ path: 'taxRate', kind: 'civic' }),
  target: Object.freeze({ path: 'company.burnRate', kind: 'company' }),
  operator: 'base_burn_tax',
  explanation:
    'Base burn = round(2000 × (1 + taxRate × 0.4)); talent multiplier and talent-cost factor scale it.',
  diagram: Object.freeze({
    edgeId: 'etax-7',
    source: 'civic-tax',
    target: '7',
    label: 'burn rate',
  }),
});

function withPathwayKind(rule) {
  if (rule.kind) return rule;
  return Object.freeze({ ...rule, kind: 'pathway' });
}

/** Frozen causal registry — pathways + tax burn + registered effect keys. */
export const CAUSAL_RULES = Object.freeze([
  TAX_BURN_RULE,
  ...PATHWAY_RULES.map(withPathwayKind),
  ...EFFECT_KEY_RULES,
]);

export function getCausalRule(id) {
  return CAUSAL_RULES.find((rule) => rule.id === id) ?? null;
}

/** Build a React Flow edge from any registered rule that declares diagram metadata. */
export function diagramEdgeFromRule(rule, style = {}) {
  if (!rule?.diagram) return null;
  if (rule.kind === 'pathway' || rule.operator === 'linear_bias') {
    return diagramEdgeFromPathway(rule, style);
  }
  return {
    id: rule.diagram.edgeId,
    source: rule.diagram.source,
    target: rule.diagram.target,
    label: rule.diagram.label,
    ...style,
  };
}

/**
 * Static diagram edges derived from the registry (graph = view).
 * Skips ephemeral edges (e.g. trigger→hype) that overlays add when live.
 */
export function staticDiagramEdgesFromRegistry(style = {}) {
  return CAUSAL_RULES.filter((rule) => rule.diagram && !rule.diagram.ephemeral).map((rule) =>
    diagramEdgeFromRule(rule, style),
  );
}

/**
 * Preview a trigger effect payload against the registry.
 * Unknown keys throw (same as apply). Known pathway rules are untouched here.
 */
export function previewCausalEffect(effect) {
  const rules = previewEffectKeys(effect);
  return {
    keys: rules.map((rule) => rule.effectKey),
    ruleIds: rules.map((rule) => rule.id),
    rules,
  };
}

/** Apply-path guard used by the turn engine before stacking a trigger. */
export function assertCausalEffect(effect) {
  return assertKnownEffectKeys(effect);
}

export { PATHWAY_BUDGET_HEADROOM_TO_HYPE as PRIMARY_PATHWAY };
