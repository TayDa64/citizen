import { describe, expect, test } from 'vitest';
import {
  CIVIC_HYPE_BIAS_SCALE,
  CIVIC_HYPE_PATHWAY_ID,
  CIVIC_NEUTRAL_HEADROOM,
  budgetHeadroomFromTax,
  hypeBiasFromHeadroom,
} from './civicFeedback.js';
import {
  PATHWAY_BUDGET_HEADROOM_TO_HYPE,
  PATHWAY_RULES,
  diagramEdgeFromPathway,
  getPathway,
  pathwayDiagramOverlay,
  pathwayEdgeLabel,
  previewPathway,
} from './pathways.js';
import { applyTurnCommand } from './turnEngine.js';
import { initialState } from './simulation.js';

describe('pathway registry', () => {
  test('registers one typed civic↔business pathway', () => {
    expect(PATHWAY_RULES).toHaveLength(1);
    const rule = PATHWAY_BUDGET_HEADROOM_TO_HYPE;
    expect(getPathway(rule.id)).toBe(rule);
    expect(rule).toMatchObject({
      id: 'pathway.budgetHeadroom→company.hype',
      source: { path: 'civic.budgetHeadroom', kind: 'civic' },
      target: { path: 'company.hype', kind: 'company' },
      operator: 'linear_bias',
      bounds: {
        neutralSource: 0.75,
        scale: 0.2,
      },
    });
    expect(rule.explanation).toMatch(/hype/i);
    expect(rule.diagram).toEqual({
      edgeId: 'ecivic-hype',
      source: 'civic-tax',
      target: 'hype',
      label: 'hype bias',
    });
    expect(CIVIC_HYPE_PATHWAY_ID).toBe(rule.id);
    expect(CIVIC_NEUTRAL_HEADROOM).toBe(rule.bounds.neutralSource);
    expect(CIVIC_HYPE_BIAS_SCALE).toBe(rule.bounds.scale);
  });

  test('registry bounds drive civic formulas (0 / 0.25 / 1 tax)', () => {
    expect(budgetHeadroomFromTax(0)).toBe(1);
    expect(budgetHeadroomFromTax(0.25)).toBe(0.75);
    expect(budgetHeadroomFromTax(1)).toBe(0);
    expect(hypeBiasFromHeadroom(1)).toBe(0.05);
    expect(hypeBiasFromHeadroom(0.75)).toBe(0);
    expect(hypeBiasFromHeadroom(0)).toBe(-0.15);
  });

  test('previewPathway matches committed set_tax without mutating', () => {
    const preview = previewPathway(PATHWAY_BUDGET_HEADROOM_TO_HYPE, initialState, 0);
    expect(preview.pathwayId).toBe(PATHWAY_BUDGET_HEADROOM_TO_HYPE.id);
    expect(preview.sourceValue).toBe(1);
    expect(preview.biasValue).toBe(0.05);
    expect(preview.targetAfter).toBe(0.35);
    expect(preview.summary).toMatch(/budgetHeadroom/);
    expect(initialState.company.hype).toBe(0.3);
    expect(initialState.taxRate).toBe(0.25);

    const committed = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0 });
    expect(committed.state.company.hype).toBe(preview.targetAfter);
    expect(committed.state.civic.hypeBias).toBe(preview.biasValue);
    expect(committed.pathwayPreview.targetAfter).toBe(preview.targetAfter);
    expect(committed.pathwayPreview.pathwayId).toBe(PATHWAY_BUDGET_HEADROOM_TO_HYPE.id);
  });

  test('engine explanation after commit tags the pathway id', () => {
    const result = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 1 });
    const pathwayEffect = result.appliedEffects.find(
      (effect) => effect.pathwayId === PATHWAY_BUDGET_HEADROOM_TO_HYPE.id,
    );
    expect(pathwayEffect).toBeTruthy();
    expect(pathwayEffect.kind).toBe('pathway.civic_hype');
    expect(pathwayEffect.explanation).toBe(PATHWAY_BUDGET_HEADROOM_TO_HYPE.explanation);
    expect(result.explanations.some((line) => line.includes(PATHWAY_BUDGET_HEADROOM_TO_HYPE.id))).toBe(
      true,
    );
    expect(result.state.company.hype).toBe(0.15);
    expect(result.state.civic.budgetHeadroom).toBe(0);
  });

  test('diagram edge is derived from the registered rule', () => {
    const edge = diagramEdgeFromPathway(PATHWAY_BUDGET_HEADROOM_TO_HYPE);
    expect(edge).toEqual({
      id: 'ecivic-hype',
      source: 'civic-tax',
      target: 'hype',
      label: 'hype bias',
    });
    expect(pathwayEdgeLabel(PATHWAY_BUDGET_HEADROOM_TO_HYPE, { hypeBias: 0 })).toBe('hype bias');
    expect(pathwayEdgeLabel(PATHWAY_BUDGET_HEADROOM_TO_HYPE, { hypeBias: 0.05 })).toBe(
      'hype bias +0.05',
    );
    const overlay = pathwayDiagramOverlay({
      company: { hype: 0.35 },
      civic: { budgetHeadroom: 1, hypeBias: 0.05 },
    });
    expect(overlay.edgeLabels['ecivic-hype']).toBe('hype bias +0.05');
    expect(overlay.hypeNode.fromPathway).toBe(PATHWAY_BUDGET_HEADROOM_TO_HYPE.id);
    expect(overlay.hypeNode.label).toMatch(/35%/);
  });

  test('pathway preserves Slice 1 burn baselines on set_tax + advance', () => {
    const zero = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0 }).state;
    expect(applyTurnCommand(zero, { type: 'advance_turn' }).state.company.burnRate).toBe(2000);
    const mid = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0.25 }).state;
    expect(applyTurnCommand(mid, { type: 'advance_turn' }).state.company.burnRate).toBe(2200);
    const max = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 1 }).state;
    expect(applyTurnCommand(max, { type: 'advance_turn' }).state.company.burnRate).toBe(2800);
  });
});
