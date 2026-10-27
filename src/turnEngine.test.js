import { describe, expect, test } from 'vitest';
import { SAMPLE_TRIGGERS } from './triggers';
import {
  applyTurnCommand,
  createGameState,
  replayCommands,
  stableMetrics,
} from './turnEngine.js';
import { applyEffects, applyTrigger, initialState, setTaxRate } from './simulation.js';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

describe('turn engine determinism', () => {
  test('same seed + command sequence → same metrics', () => {
    const seed = createGameState({ seed: 'det-1' });
    const commands = [
      { type: 'set_tax', taxRate: 0 },
      { type: 'advance_turn' },
      { type: 'apply_trigger', trigger: policy },
      { type: 'set_tax', taxRate: 0.25 },
      { type: 'advance_turn' },
      { type: 'clear_triggers' },
      { type: 'advance_turn' },
    ];
    const a = replayCommands(seed, commands);
    const b = replayCommands(createGameState({ seed: 'det-1' }), commands);
    expect(stableMetrics(a.state)).toEqual(stableMetrics(b.state));
    expect(a.state.company.burnRate).toBe(2200);
    expect(a.results).toHaveLength(commands.length);
  });

  test('advance_turn matches Slice 1 burn baselines', () => {
    expect(applyTurnCommand(setTaxRate(initialState, 0), { type: 'advance_turn' }).state.company.burnRate).toBe(2000);
    expect(applyTurnCommand(initialState, { type: 'advance_turn' }).state.company.burnRate).toBe(2200);
    expect(applyTurnCommand(setTaxRate(initialState, 1), { type: 'advance_turn' }).state.company.burnRate).toBe(2800);
  });

  test('advance_turn is equivalent to applyEffects façade', () => {
    const viaEngine = applyTurnCommand(initialState, { type: 'advance_turn' }).state;
    const viaFacade = applyEffects(initialState);
    expect(viaFacade.company.cash).toBe(viaEngine.company.cash);
    expect(viaFacade.company.burnRate).toBe(viaEngine.company.burnRate);
    expect(viaFacade.turn).toBe(1);
    expect(viaEngine.turn).toBe(1);
  });

  test('apply_trigger then advance matches Slice 2 policy burn', () => {
    const triggered = applyTrigger(initialState, policy);
    const result = applyTurnCommand(triggered, { type: 'advance_turn' });
    expect(result.state.company.talentCost).toBe(4480);
    expect(result.state.company.burnRate).toBe(2464);
    expect(result.explanations.length).toBeGreaterThan(0);
  });

  test('TurnResult includes deltas and explanations', () => {
    const result = applyTurnCommand(initialState, { type: 'advance_turn' });
    expect(result.deltas.turn).toBe(1);
    expect(result.deltas.cash).toBeCloseTo(-2200 / 12);
    expect(result.appliedEffects.some((effect) => effect.kind === 'burn.tick')).toBe(true);
    expect(result.explanations[0]).toMatch(/Advanced to turn 1/);
  });
});
