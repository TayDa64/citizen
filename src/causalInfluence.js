/**
 * Campaign causal hub projection (CIT-114).
 *
 * Views CAUSAL_RULES as Democracy-inspired green/red influence edges.
 * Does not invent rules — polarity is derived from registry semantics and
 * optional live trigger/tax signals already on GameState.
 */

import { CAUSAL_RULES } from './causalGraph.js';
import { pathwayBiasFromSource, pathwaySourceFromTax } from './pathways.js';

export const INFLUENCE_POSITIVE = 'positive';
export const INFLUENCE_NEGATIVE = 'negative';
export const INFLUENCE_SIGNED = 'signed';

/** Campaign hub focus: burn is a real registry target (unemployment-style). */
export const CAUSAL_HUB_FOCUS = 'company.burnRate';

function nodeIdFromPath(path) {
  return String(path || 'unknown').replace(/[^a-zA-Z0-9._→-]/g, '_');
}

function labelFromPath(path) {
  const raw = String(path || 'unknown');
  const leaf = raw.includes('.') ? raw.split('.').pop() : raw;
  return leaf;
}

/**
 * Sum live trigger deltas for a registered effect key (0 when none).
 */
export function liveEffectDelta(activeTriggers, effectKey) {
  const list = Array.isArray(activeTriggers) ? activeTriggers : [];
  let sum = 0;
  let seen = false;
  for (const trigger of list) {
    const value = Number(trigger?.effect?.[effectKey]);
    if (!Number.isFinite(value)) continue;
    sum += value;
    seen = true;
  }
  return seen ? sum : null;
}

function signedFromNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return INFLUENCE_SIGNED;
  return numeric > 0 ? INFLUENCE_POSITIVE : INFLUENCE_NEGATIVE;
}

/**
 * Green = supportive / helpful for company or politics signals.
 * Red = cost / pressure. Signed = direction depends on live value.
 */
export function influencePolarity(rule, context = {}) {
  const kind = rule?.kind;
  const operator = rule?.operator;

  // Pathways may omit kind until folded into CAUSAL_RULES — operator is authoritative.
  if (kind === 'pathway' || operator === 'linear_bias') {
    const taxRate = context.taxRate;
    if (taxRate == null || !Number.isFinite(Number(taxRate))) {
      return INFLUENCE_SIGNED;
    }
    const source = pathwaySourceFromTax(rule, taxRate);
    const bias = pathwayBiasFromSource(rule, source);
    return signedFromNumber(bias);
  }

  switch (kind) {
    case 'formula':
      // tax → burn: higher tax raises burn (pressure).
      return INFLUENCE_NEGATIVE;
    case 'trigger_effect': {
      const key = rule.effectKey;
      const delta = liveEffectDelta(context.activeTriggers, key);
      if (delta == null) {
        // Registry default: hype gains are supportive; talentCost rises are pressure.
        if (key === 'hype') return INFLUENCE_POSITIVE;
        if (key === 'talentCost') return INFLUENCE_NEGATIVE;
        return INFLUENCE_SIGNED;
      }
      if (key === 'talentCost') {
        // Higher talent cost = pressure (red); lower = relief (green).
        // Invert so a positive contract delta maps to negative influence.
        return signedFromNumber(-delta);
      }
      return signedFromNumber(delta);
    }
    default: {
      const _exhaustive = kind;
      void _exhaustive;
      return INFLUENCE_SIGNED;
    }
  }
}

export function influenceClassName(polarity) {
  switch (polarity) {
    case INFLUENCE_POSITIVE:
      return 'causal-edge--positive';
    case INFLUENCE_NEGATIVE:
      return 'causal-edge--negative';
    case INFLUENCE_SIGNED:
      return 'causal-edge--signed';
    default: {
      const _exhaustive = polarity;
      void _exhaustive;
      return 'causal-edge--signed';
    }
  }
}

export function influenceLabel(polarity) {
  switch (polarity) {
    case INFLUENCE_POSITIVE:
      return 'green (+)';
    case INFLUENCE_NEGATIVE:
      return 'red (−)';
    case INFLUENCE_SIGNED:
      return 'signed';
    default: {
      const _exhaustive = polarity;
      void _exhaustive;
      return 'signed';
    }
  }
}

function sourcePathOf(rule) {
  if (rule?.source?.path) return rule.source.path;
  if (rule?.kind === 'trigger_effect') return 'real_world_triggers';
  return 'unknown';
}

function targetPathOf(rule) {
  if (rule?.target?.path) return rule.target.path;
  return 'unknown';
}

/**
 * Project CAUSAL_RULES into hub nodes + signed edges for the campaign desk.
 */
export function projectCausalHub(context = {}, rules = CAUSAL_RULES) {
  const list = Array.isArray(rules) ? rules : [];
  const nodesById = new Map();

  function ensureNode(path, { hub = false } = {}) {
    const id = nodeIdFromPath(path);
    const existing = nodesById.get(id);
    if (existing) {
      if (hub) existing.hub = true;
      return existing;
    }
    const node = {
      id,
      path,
      label: labelFromPath(path),
      hub: hub || path === CAUSAL_HUB_FOCUS,
    };
    nodesById.set(id, node);
    return node;
  }

  const edges = list.map((rule) => {
    const sourcePath = sourcePathOf(rule);
    const targetPath = targetPathOf(rule);
    ensureNode(sourcePath);
    ensureNode(targetPath, { hub: targetPath === CAUSAL_HUB_FOCUS });
    const polarity = influencePolarity(rule, context);
    return {
      id: rule.id,
      kind: rule.kind ?? 'rule',
      source: nodeIdFromPath(sourcePath),
      target: nodeIdFromPath(targetPath),
      sourcePath,
      targetPath,
      polarity,
      polarityLabel: influenceLabel(polarity),
      className: influenceClassName(polarity),
      explanation: rule.explanation ?? rule.description ?? '',
      diagramEdgeId: rule.diagram?.edgeId ?? null,
    };
  });

  // Ensure hub focus exists even if a future registry omits it.
  ensureNode(CAUSAL_HUB_FOCUS, { hub: true });

  return {
    hubFocus: CAUSAL_HUB_FOCUS,
    nodes: [...nodesById.values()],
    edges,
  };
}
