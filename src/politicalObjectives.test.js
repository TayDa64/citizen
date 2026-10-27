import { describe, expect, test } from 'vitest';
import {
  SURVIVAL_INCUMBENT,
  SURVIVAL_OUSTED,
  VOTER_SUPPORT_FLOOR,
  evaluatePoliticalSurvival,
  formatSurvivalStatus,
  formatVoterSupport,
  refreshPolitics,
  voterSupportFromSignals,
} from './politicalObjectives.js';
import { applyTurnCommand, createGameState, stableMetrics } from './turnEngine.js';
import { initialState } from './simulation.js';

describe('P1-5 political objectives formulas', () => {
  test('voterSupport = 0.5*headroom + 0.5*hype (locked defaults)', () => {
    // Default Slice 1: headroom 0.75, hype 0.3 → 0.525
    expect(voterSupportFromSignals({ budgetHeadroom: 0.75, hype: 0.3 })).toBe(0.525);
    // Tax 0: headroom 1, hype 0.35 → 0.675
    expect(voterSupportFromSignals({ budgetHeadroom: 1, hype: 0.35 })).toBe(0.675);
    // Tax 1: headroom 0, hype 0.15 → 0.075 (below floor)
    expect(voterSupportFromSignals({ budgetHeadroom: 0, hype: 0.15 })).toBe(0.075);
  });

  test('survival floor is 0.25; ousted below, incumbent at/above', () => {
    expect(VOTER_SUPPORT_FLOOR).toBe(0.25);
    expect(evaluatePoliticalSurvival(0.2499)).toBe(SURVIVAL_OUSTED);
    expect(evaluatePoliticalSurvival(0.25)).toBe(SURVIVAL_INCUMBENT);
    expect(evaluatePoliticalSurvival(0.525)).toBe(SURVIVAL_INCUMBENT);
    expect(evaluatePoliticalSurvival(0.075)).toBe(SURVIVAL_OUSTED);
  });

  test('refreshPolitics updates support; survival only when evaluateSurvival', () => {
    const base = {
      civic: { budgetHeadroom: 0, hypeBias: -0.15 },
      company: { hype: 0.15 },
      politics: { survivalStatus: SURVIVAL_INCUMBENT },
    };
    const preview = refreshPolitics(base, { evaluateSurvival: false });
    expect(preview.voterSupport).toBe(0.075);
    expect(preview.survivalStatus).toBe(SURVIVAL_INCUMBENT);
    expect(preview.survivalFloor).toBe(0.25);

    const afterAdvance = refreshPolitics(base, { evaluateSurvival: true });
    expect(afterAdvance.voterSupport).toBe(0.075);
    expect(afterAdvance.survivalStatus).toBe(SURVIVAL_OUSTED);
  });

  test('formatters are human-readable', () => {
    expect(formatVoterSupport(0.525)).toBe('53%');
    expect(formatSurvivalStatus(SURVIVAL_OUSTED)).toBe('ousted');
    expect(formatSurvivalStatus('nope')).toBe('incumbent');
  });
});

describe('P1-5 political objectives via turn engine', () => {
  test('default GameState carries incumbent voterSupport 0.525', () => {
    const state = createGameState({ seed: 'politics-default' });
    expect(state.politics.voterSupport).toBe(0.525);
    expect(state.politics.survivalStatus).toBe(SURVIVAL_INCUMBENT);
    expect(state.politics.survivalFloor).toBe(0.25);
  });

  test('set_tax refreshes voterSupport without flipping survival', () => {
    const max = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 1 });
    expect(max.state.civic.budgetHeadroom).toBe(0);
    expect(max.state.company.hype).toBe(0.15);
    expect(max.state.politics.voterSupport).toBe(0.075);
    expect(max.state.politics.survivalStatus).toBe(SURVIVAL_INCUMBENT);
    expect(max.after.voterSupport).toBe(0.075);
  });

  test('advance_turn after max tax ousts; recovery after lower tax + advance', () => {
    const taxed = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 1 });
    const ousted = applyTurnCommand(taxed.state, { type: 'advance_turn' });
    expect(ousted.state.politics.voterSupport).toBe(0.075);
    expect(ousted.state.politics.survivalStatus).toBe(SURVIVAL_OUSTED);
    expect(ousted.appliedEffects.some((effect) => effect.kind === 'politics.survival')).toBe(true);
    expect(ousted.explanations.some((line) => /ousted/i.test(line))).toBe(true);
    // Slice 1 burn baseline still holds at tax 1
    expect(ousted.state.company.burnRate).toBe(2800);

    const eased = applyTurnCommand(ousted.state, { type: 'set_tax', taxRate: 0.25 });
    expect(eased.state.politics.voterSupport).toBe(0.525);
    expect(eased.state.politics.survivalStatus).toBe(SURVIVAL_OUSTED); // sticky until advance

    const recovered = applyTurnCommand(eased.state, { type: 'advance_turn' });
    expect(recovered.state.politics.survivalStatus).toBe(SURVIVAL_INCUMBENT);
    expect(recovered.state.company.burnRate).toBe(2200);
  });

  test('default advance keeps incumbent; politics never changes burn baselines', () => {
    const advanced = applyTurnCommand(initialState, { type: 'advance_turn' });
    expect(advanced.state.politics.survivalStatus).toBe(SURVIVAL_INCUMBENT);
    expect(advanced.state.company.burnRate).toBe(2200);

    expect(applyTurnCommand(
      applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0 }).state,
      { type: 'advance_turn' },
    ).state.company.burnRate).toBe(2000);
  });

  test('stableMetrics and ledger snapshot include voterSupport / survival', () => {
    const state = createGameState({ seed: 'politics-stable' });
    const metrics = stableMetrics(state);
    expect(metrics.voterSupport).toBe(0.525);
    expect(metrics.survivalStatus).toBe(SURVIVAL_INCUMBENT);
  });
});
