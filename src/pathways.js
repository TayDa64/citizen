/**
 * Causal pathway registry (P0-5; folded into P1-3 causal graph).
 *
 * One typed civic ↔ business rule the turn engine executes. React Flow edges
 * and labels are a view of this registry — not an independent source of truth.
 * The executable causal graph umbrella lives in `causalGraph.js` (pathways +
 * tax→burn + registered effect keys).
 *
 * Operator `linear_bias`:
 *   bias   = (source - neutralSource) * scale
 *   target = clamp(stackedTarget + bias, targetClamp)
 */

import { clampHype, roundTo } from './triggers.js';

/** Single P0 pathway: city budget headroom → company hype bias. */
export const PATHWAY_BUDGET_HEADROOM_TO_HYPE = Object.freeze({
  id: 'pathway.budgetHeadroom→company.hype',
  source: Object.freeze({
    path: 'civic.budgetHeadroom',
    kind: 'civic',
  }),
  target: Object.freeze({
    path: 'company.hype',
    kind: 'company',
  }),
  /** Intermediate field written on GameState.civic before folding into target. */
  biasPath: 'civic.hypeBias',
  operator: 'linear_bias',
  bounds: Object.freeze({
    /** Headroom at default 25% tax — bias is zero here (Slice 1 burn stays). */
    neutralSource: 0.75,
    scale: 0.2,
    sourceClamp: Object.freeze([0, 1]),
    targetClamp: Object.freeze([0, 1]),
  }),
  explanation:
    'Budget headroom above/below 75% adds/subtracts company hype at 0.2× (bias 0 at default 25% tax).',
  diagram: Object.freeze({
    edgeId: 'ecivic-hype',
    source: 'civic-tax',
    target: 'hype',
    label: 'hype bias',
  }),
});

/** Frozen pathway list — included in CAUSAL_RULES (`causalGraph.js`). */
export const PATHWAY_RULES = Object.freeze([PATHWAY_BUDGET_HEADROOM_TO_HYPE]);

export function getPathway(id) {
  return PATHWAY_RULES.find((rule) => rule.id === id) ?? null;
}

function formatBias(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.00005) return '0';
  return numeric > 0 ? `+${numeric.toFixed(2)}` : numeric.toFixed(2);
}

export function pathwaySourceFromTax(rule, taxRate) {
  const tax = Number(taxRate);
  const clampedTax = Number.isFinite(tax) ? Math.max(0, Math.min(1, tax)) : 0.25;
  const [lo, hi] = rule.bounds.sourceClamp;
  return roundTo(Math.max(lo, Math.min(hi, 1 - clampedTax)), 4);
}

export function pathwayBiasFromSource(rule, sourceValue) {
  if (rule.operator !== 'linear_bias') {
    const neverOp = rule.operator;
    throw new Error(`Unhandled pathway operator: ${String(neverOp)}`);
  }
  const source = Number(sourceValue);
  const value = Number.isFinite(source) ? source : rule.bounds.neutralSource;
  return roundTo((value - rule.bounds.neutralSource) * rule.bounds.scale, 4);
}

/**
 * Preview the pathway outcome for a proposed taxRate without mutating state.
 * Used before commit (UI / tests) and mirrored in TurnResult explanations after.
 */
export function previewPathway(
  rule = PATHWAY_BUDGET_HEADROOM_TO_HYPE,
  state,
  nextTaxRate = state?.taxRate,
) {
  const sourceValue = pathwaySourceFromTax(rule, nextTaxRate);
  const biasValue = pathwayBiasFromSource(rule, sourceValue);
  const prevBias = Number.isFinite(Number(state?.civic?.hypeBias))
    ? Number(state.civic.hypeBias)
    : 0;
  const currentHype = Number(state?.company?.hype);
  const stacked = Number.isFinite(currentHype) ? currentHype - prevBias : 0.3;
  const [lo, hi] = rule.bounds.targetClamp;
  const nextHype = roundTo(Math.max(lo, Math.min(hi, clampHype(stacked + biasValue))), 4);
  const biasText = formatBias(biasValue);
  return {
    pathwayId: rule.id,
    sourcePath: rule.source.path,
    targetPath: rule.target.path,
    operator: rule.operator,
    sourceValue,
    biasValue,
    targetBefore: Number.isFinite(currentHype) ? roundTo(currentHype, 4) : 0.3,
    targetAfter: nextHype,
    summary:
      `${rule.source.path} ${(sourceValue * 100).toFixed(0)}%` +
      ` → bias ${biasText} → ${rule.target.path} ${nextHype}`,
    explanation: rule.explanation,
  };
}

export function explainPathwayApplication(rule, beforeCivic, afterCivic, beforeHype, afterHype) {
  const beforeBias = Number(beforeCivic?.hypeBias) || 0;
  const afterBias = Number(afterCivic?.hypeBias) || 0;
  const beforeHeadroom = Number(beforeCivic?.budgetHeadroom) || 0;
  const afterHeadroom = Number(afterCivic?.budgetHeadroom) || 0;
  return {
    pathwayId: rule.id,
    kind: 'pathway.civic_hype',
    summary:
      `${rule.id}: ${rule.source.path} ${beforeHeadroom} → ${afterHeadroom};` +
      ` bias ${beforeBias} → ${afterBias}; ${rule.target.path} ${beforeHype} → ${afterHype}`,
    explanation: rule.explanation,
  };
}

/** Build the React Flow edge descriptor from a registered pathway (graph = view). */
export function diagramEdgeFromPathway(rule, style = {}) {
  const diagram = rule.diagram;
  return {
    id: diagram.edgeId,
    source: diagram.source,
    target: diagram.target,
    label: diagram.label,
    ...style,
  };
}

/** Live edge label: base registry label + current bias readout. */
export function pathwayEdgeLabel(rule, civic) {
  const base = rule.diagram.label;
  const bias = Number(civic?.hypeBias);
  if (!Number.isFinite(bias) || Math.abs(bias) < 0.00005) return base;
  return `${base} ${formatBias(bias)}`;
}

/**
 * Diagram overlay derived from the registered pathway (not a parallel hardcode).
 * Always exposes the hype target node so the pathway edge has a real endpoint.
 */
export function pathwayDiagramOverlay(state) {
  const rule = PATHWAY_BUDGET_HEADROOM_TO_HYPE;
  const label = pathwayEdgeLabel(rule, state?.civic);
  const hype = Number(state?.company?.hype);
  const hypeText = Number.isFinite(hype) ? `${Math.round(hype * 100)}%` : '—';
  return {
    edgeLabels: {
      [rule.diagram.edgeId]: label,
    },
    hypeNode: {
      id: rule.diagram.target,
      label: `Hype: ${hypeText}`,
      edgeLabel: label,
      fromPathway: rule.id,
    },
  };
}
