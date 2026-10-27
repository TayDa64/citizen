import { describe, expect, test } from 'vitest';
import {
  CIVIC_NEUTRAL_HEADROOM,
  applyCivicFeedback,
  budgetHeadroomFromTax,
  computeCivicFromTax,
  hypeBiasFromHeadroom,
  rebiasHype,
} from './civicFeedback.js';
import { applyTurnCommand, createGameState } from './turnEngine.js';
import { initialState } from './simulation.js';
import { SAMPLE_TRIGGERS } from './triggers.js';
import { mergeCampaignTurnState } from './turnCommands.js';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');
const news = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'news_spike');

describe('civic feedback formulas', () => {
  test('budgetHeadroom = clamp(1 - taxRate)', () => {
    expect(budgetHeadroomFromTax(0)).toBe(1);
    expect(budgetHeadroomFromTax(0.25)).toBe(0.75);
    expect(budgetHeadroomFromTax(1)).toBe(0);
    expect(CIVIC_NEUTRAL_HEADROOM).toBe(0.75);
  });

  test('hypeBias is 0 at neutral 25% tax', () => {
    expect(hypeBiasFromHeadroom(0.75)).toBe(0);
    expect(computeCivicFromTax(0.25)).toEqual({ budgetHeadroom: 0.75, hypeBias: 0 });
    expect(computeCivicFromTax(0)).toEqual({ budgetHeadroom: 1, hypeBias: 0.05 });
    expect(computeCivicFromTax(1)).toEqual({ budgetHeadroom: 0, hypeBias: -0.15 });
  });

  test('rebiasHype strips prior bias then applies next', () => {
    expect(rebiasHype(0.35, { hypeBias: 0.05 }, { hypeBias: 0 })).toBe(0.3);
    expect(rebiasHype(0.3, { hypeBias: 0 }, { hypeBias: -0.15 })).toBe(0.15);
  });
});

describe('civic feedback turn loop', () => {
  test('set_tax moves budget headroom and feeds hype; Slice 1 burn stays', () => {
    const zero = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0 });
    expect(zero.state.civic.budgetHeadroom).toBe(1);
    expect(zero.state.civic.hypeBias).toBe(0.05);
    expect(zero.state.company.hype).toBe(0.35);
    expect(zero.appliedEffects.some((effect) => effect.kind === 'civic.budget')).toBe(true);
    expect(zero.appliedEffects.some((effect) => effect.kind === 'civic.hype')).toBe(true);

    const advancedZero = applyTurnCommand(zero.state, { type: 'advance_turn' });
    expect(advancedZero.state.company.burnRate).toBe(2000);

    const mid = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0.25 });
    expect(mid.state.civic).toEqual({ budgetHeadroom: 0.75, hypeBias: 0 });
    expect(mid.state.company.hype).toBe(0.3);
    expect(applyTurnCommand(mid.state, { type: 'advance_turn' }).state.company.burnRate).toBe(2200);

    const max = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 1 });
    expect(max.state.civic.budgetHeadroom).toBe(0);
    expect(max.state.civic.hypeBias).toBe(-0.15);
    expect(max.state.company.hype).toBe(0.15);
    expect(applyTurnCommand(max.state, { type: 'advance_turn' }).state.company.burnRate).toBe(2800);
  });

  test('civic bias composes with trigger stacked hype', () => {
    const taxed = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0 }).state;
    const withNews = applyTurnCommand(taxed, { type: 'apply_trigger', trigger: news }).state;
    // baseline 0.3 + news 0.1 + civic bias 0.05
    expect(withNews.company.hype).toBe(0.45);
    expect(withNews.civic.hypeBias).toBe(0.05);

    const back = applyTurnCommand(withNews, { type: 'set_tax', taxRate: 0.25 }).state;
    expect(back.civic.hypeBias).toBe(0);
    expect(back.company.hype).toBe(0.4);
  });

  test('hire path still refreshes talent/burn; civic untouched at default tax', () => {
    const hired = applyTurnCommand(initialState, {
      type: 'hire_employee',
      department: 'tech',
      skill: 1,
    }).state;
    expect(hired.talentMultiplier).toBe(1.75);
    expect(hired.company.burnRate).toBe(3850);
    expect(hired.civic.budgetHeadroom).toBe(0.75);
    expect(hired.company.hype).toBe(0.3);
  });

  test('policy burn baselines stay after civic set_tax at 25%', () => {
    const taxed = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0.25 }).state;
    const triggered = applyTurnCommand(taxed, { type: 'apply_trigger', trigger: policy }).state;
    expect(triggered.company.talentCost).toBe(4480);
    expect(triggered.company.hype).toBe(0.3);
    expect(applyTurnCommand(triggered, { type: 'advance_turn' }).state.company.burnRate).toBe(2464);
  });

  test('API merge rebases civic hype bias when tax changes', () => {
    const prev = {
      ...initialState,
      dataSource: 'api',
      company: { ...initialState.company, hype: 0.55, talentCost: 4480 },
      civic: computeCivicFromTax(0.25),
    };
    const turnState = applyTurnCommand(createGameState({ seed: 'civic-merge' }), {
      type: 'set_tax',
      taxRate: 1,
    }).state;
    const merged = mergeCampaignTurnState(prev, turnState);
    expect(merged.civic.budgetHeadroom).toBe(0);
    expect(merged.civic.hypeBias).toBe(-0.15);
    // API stacked 0.55, then civic bias -0.15
    expect(merged.company.hype).toBe(0.4);
    expect(merged.company.talentCost).toBe(4480);
    expect(merged.dataSource).toBe('api');
  });
});

describe('applyCivicFeedback helper', () => {
  test('folds stacked hype + bias', () => {
    const state = {
      taxRate: 0,
      company: { hype: 0.3 },
      civic: { budgetHeadroom: 0.75, hypeBias: 0 },
    };
    applyCivicFeedback(state, 0.3);
    expect(state.civic.budgetHeadroom).toBe(1);
    expect(state.company.hype).toBe(0.35);
  });
});
