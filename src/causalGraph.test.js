import { describe, expect, test } from 'vitest';
import {
  CAUSAL_RULES,
  EFFECT_KEY_RULES,
  KNOWN_EFFECT_KEYS,
  PATHWAY_BUDGET_HEADROOM_TO_HYPE,
  TAX_BURN_RULE,
  assertCausalEffect,
  assertKnownEffectKeys,
  getCausalRule,
  previewCausalEffect,
  staticDiagramEdgesFromRegistry,
} from './causalGraph.js';
import { SAMPLE_TRIGGERS, TRIGGER_CONTRACT, assertValidTrigger } from './triggers.js';
import { applyTurnCommand, parseTurnCommand } from './turnEngine.js';
import { applyTrigger, initialState } from './simulation.js';

describe('causal graph registry', () => {
  test('registry includes tax burn, pathway, and effect keys', () => {
    expect(CAUSAL_RULES.map((rule) => rule.id)).toEqual([
      TAX_BURN_RULE.id,
      PATHWAY_BUDGET_HEADROOM_TO_HYPE.id,
      'effect.hype',
      'effect.talentCost',
    ]);
    expect(getCausalRule(PATHWAY_BUDGET_HEADROOM_TO_HYPE.id)?.diagram.edgeId).toBe('ecivic-hype');
    expect(getCausalRule(TAX_BURN_RULE.id)?.diagram.edgeId).toBe('etax-7');
    expect(KNOWN_EFFECT_KEYS).toEqual(['hype', 'talentCost']);
    expect(EFFECT_KEY_RULES).toHaveLength(2);
  });

  test('TRIGGER_CONTRACT.effectFields is derived from the registry', () => {
    for (const key of KNOWN_EFFECT_KEYS) {
      expect(TRIGGER_CONTRACT.effectFields[key]).toBeTruthy();
    }
    expect(Object.keys(TRIGGER_CONTRACT.effectFields).sort()).toEqual(
      [...KNOWN_EFFECT_KEYS].sort(),
    );
  });

  test('static diagram edges are a view of non-ephemeral rules', () => {
    const edges = staticDiagramEdgesFromRegistry();
    expect(edges.map((edge) => edge.id).sort()).toEqual(
      ['ecivic-hype', 'einfra-7', 'etax-7'].sort(),
    );
    expect(edges.find((edge) => edge.id === 'ecivic-hype')).toMatchObject({
      source: 'civic-tax',
      target: 'hype',
      label: 'hype bias',
    });
    expect(edges.some((edge) => edge.id === 'e5-hype')).toBe(false);
  });

  test('unknown effect keys are rejected at assert and preview', () => {
    expect(() => assertKnownEffectKeys({ hype: 0.1, morale: 1 })).toThrow(
      /Trigger\.effect\.morale/,
    );
    expect(() => assertCausalEffect({ revenue: 10 })).toThrow(/revenue/);
    expect(() => previewCausalEffect({ cash: 1 })).toThrow(/cash/);
    expect(() => assertValidTrigger({
      id: 'bad-effect',
      type: 'news_spike',
      label: 'Bad',
      source: 'mock:local',
      timestamp: '2026-01-01T00:00:00.000Z',
      effect: { hype: 0.1, unknownField: 1 },
    })).toThrow(/unknownField/);
  });

  test('engine apply_trigger rejects unknown effect keys before stacking', () => {
    expect(() => parseTurnCommand({
      type: 'apply_trigger',
      trigger: {
        id: 'evt-bad',
        type: 'news_spike',
        label: 'Bad',
        source: 'mock:local',
        timestamp: '2026-01-01T00:00:00.000Z',
        effect: { hype: 0.05, inventMe: 1 },
      },
    })).toThrow(/inventMe/);

    expect(() => applyTurnCommand(initialState, {
      type: 'apply_trigger',
      trigger: {
        id: 'evt-bad',
        type: 'policy_change',
        label: 'Bad',
        source: 'mock:local',
        timestamp: '2026-01-01T00:00:00.000Z',
        effect: { talentCost: 0.1, bonus: 2 },
      },
    })).toThrow(/bonus/);

    expect(initialState.company.hype).toBe(0.3);
    expect(initialState.activeTriggers ?? []).toEqual([]);
  });

  test('known pathway and trigger effects still work', () => {
    const preview = previewCausalEffect({ hype: 0.1, talentCost: 0.12 });
    expect(preview.keys.sort()).toEqual(['hype', 'talentCost']);
    expect(preview.ruleIds).toEqual(['effect.hype', 'effect.talentCost']);

    const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.id.includes('policy'))
      ?? SAMPLE_TRIGGERS[0];
    const applied = applyTrigger(initialState, policy);
    expect(applied.company.talentCost).not.toBe(initialState.company.talentCost);

    const taxed = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0 });
    expect(taxed.state.company.hype).toBe(0.35);
    expect(taxed.pathwayPreview.pathwayId).toBe(PATHWAY_BUDGET_HEADROOM_TO_HYPE.id);

    const advanced = applyTurnCommand(taxed.state, { type: 'advance_turn' });
    expect(advanced.state.company.burnRate).toBe(2000);

    const mid = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0.25 }).state;
    expect(applyTurnCommand(mid, { type: 'advance_turn' }).state.company.burnRate).toBe(2200);
    const max = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 1 }).state;
    expect(applyTurnCommand(max, { type: 'advance_turn' }).state.company.burnRate).toBe(2800);
  });
});
