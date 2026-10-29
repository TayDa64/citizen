import { describe, expect, test } from 'vitest';
import { CAUSAL_RULES, TAX_BURN_RULE } from './causalGraph.js';
import { PATHWAY_BUDGET_HEADROOM_TO_HYPE } from './pathways.js';
import {
  CAUSAL_HUB_FOCUS,
  INFLUENCE_NEGATIVE,
  INFLUENCE_POSITIVE,
  INFLUENCE_SIGNED,
  influenceClassName,
  influencePolarity,
  liveEffectDelta,
  projectCausalHub,
} from './causalInfluence.js';

describe('causalInfluence (CIT-114)', () => {
  test('projects every CAUSAL_RULES edge with hub focus on burnRate', () => {
    const hub = projectCausalHub({ taxRate: 0.25, activeTriggers: [] });
    expect(hub.hubFocus).toBe(CAUSAL_HUB_FOCUS);
    expect(hub.edges.map((edge) => edge.id)).toEqual(CAUSAL_RULES.map((rule) => rule.id));
    expect(hub.nodes.some((node) => node.path === CAUSAL_HUB_FOCUS && node.hub)).toBe(true);
    expect(hub.edges).toHaveLength(4);
  });

  test('tax→burn is red pressure; pathway polarity follows live tax bias', () => {
    expect(influencePolarity(TAX_BURN_RULE)).toBe(INFLUENCE_NEGATIVE);
    expect(influenceClassName(INFLUENCE_NEGATIVE)).toBe('causal-edge--negative');

    const atDefault = influencePolarity(PATHWAY_BUDGET_HEADROOM_TO_HYPE, { taxRate: 0.25 });
    expect(atDefault).toBe(INFLUENCE_SIGNED);

    const lowTax = influencePolarity(PATHWAY_BUDGET_HEADROOM_TO_HYPE, { taxRate: 0 });
    expect(lowTax).toBe(INFLUENCE_POSITIVE);

    const highTax = influencePolarity(PATHWAY_BUDGET_HEADROOM_TO_HYPE, { taxRate: 1 });
    expect(highTax).toBe(INFLUENCE_NEGATIVE);
  });

  test('trigger effect polarity follows live deltas (talentCost inverted)', () => {
    const hypeRule = CAUSAL_RULES.find((rule) => rule.id === 'effect.hype');
    const talentRule = CAUSAL_RULES.find((rule) => rule.id === 'effect.talentCost');
    expect(influencePolarity(hypeRule, { activeTriggers: [] })).toBe(INFLUENCE_POSITIVE);
    expect(influencePolarity(talentRule, { activeTriggers: [] })).toBe(INFLUENCE_NEGATIVE);

    const negativeHype = [{ effect: { hype: -0.1 } }];
    expect(influencePolarity(hypeRule, { activeTriggers: negativeHype })).toBe(INFLUENCE_NEGATIVE);
    expect(liveEffectDelta(negativeHype, 'hype')).toBe(-0.1);

    const wageSpike = [{ effect: { talentCost: 0.12 } }];
    expect(influencePolarity(talentRule, { activeTriggers: wageSpike })).toBe(INFLUENCE_NEGATIVE);

    const relief = [{ effect: { talentCost: -0.05 } }];
    expect(influencePolarity(talentRule, { activeTriggers: relief })).toBe(INFLUENCE_POSITIVE);
  });

  test('edge class names match polarity tokens', () => {
    const hub = projectCausalHub({ taxRate: 0, activeTriggers: [{ effect: { hype: 0.1 } }] });
    const taxEdge = hub.edges.find((edge) => edge.id === TAX_BURN_RULE.id);
    const pathwayEdge = hub.edges.find((edge) => edge.id === PATHWAY_BUDGET_HEADROOM_TO_HYPE.id);
    expect(taxEdge.polarity).toBe(INFLUENCE_NEGATIVE);
    expect(taxEdge.className).toBe('causal-edge--negative');
    expect(pathwayEdge.polarity).toBe(INFLUENCE_POSITIVE);
    expect(pathwayEdge.className).toBe('causal-edge--positive');
  });
});
