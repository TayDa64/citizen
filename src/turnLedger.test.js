import { describe, expect, test } from 'vitest';
import {
  SAMPLE_TRIGGERS,
} from './triggers';
import {
  applyTurnCommand,
  createGameState,
  replayCommands,
} from './turnEngine';
import {
  LEDGER_ENTRY_VERSION,
  appendLedgerFromTurnResults,
  ledgerEntriesFromApiCommits,
  ledgerEntryFromTurnResult,
  ledgerResultPayload,
  shapeLedgerEntry,
  summarizeLedgerCommand,
} from './turnLedger';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

describe('turn ledger shaping', () => {
  test('engine TurnResult shapes into append-only ledger entry with before/after', () => {
    const start = createGameState({ seed: 'ledger-1' });
    const result = applyTurnCommand(start, { type: 'advance_turn' });
    const entry = ledgerEntryFromTurnResult(result, { seq: 1 });

    expect(entry.version).toBe(LEDGER_ENTRY_VERSION);
    expect(entry.seq).toBe(1);
    expect(entry.command.type).toBe('advance_turn');
    expect(entry.turnBefore).toBe(0);
    expect(entry.turnAfter).toBe(1);
    expect(entry.turn).toBe(1);
    expect(entry.before.cash).toBe(15000);
    // Initial company.burnRate is the seed preview; advance recomputes at tax 25%.
    expect(entry.before.burnRate).toBe(start.company.burnRate);
    expect(entry.after.cash).toBeCloseTo(15000 - entry.after.burnRate / 12, 5);
    expect(entry.after.burnRate).toBe(2200);
    expect(entry.appliedEffects.some((effect) => effect.kind === 'burn.tick')).toBe(true);
    expect(entry.explanations[0]).toMatch(/Advanced to turn 1/);
    expect(summarizeLedgerCommand(entry)).toBe('Advance → turn 1');
  });

  test('offline replay builds a durable ledger beyond chart buffer authority', () => {
    const commands = [
      { type: 'set_tax', taxRate: 1 },
      { type: 'advance_turn' },
      { type: 'apply_trigger', trigger: policy },
      { type: 'hire_employee', department: 'tech', skill: 1 },
      { type: 'advance_turn' },
    ];
    const { results } = replayCommands(createGameState({ seed: 'ledger-replay' }), commands);
    const ledger = appendLedgerFromTurnResults([], results);

    expect(ledger).toHaveLength(5);
    expect(ledger.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(ledger.map((entry) => entry.command.type)).toEqual([
      'set_tax',
      'advance_turn',
      'apply_trigger',
      'hire_employee',
      'advance_turn',
    ]);
    expect(ledger[0].before.taxRate).toBe(0.25);
    expect(ledger[0].after.taxRate).toBe(1);
    expect(ledger[0].after.budgetHeadroom).toBe(0);
    expect(ledger[3].after.employeeCount).toBe(1);
    expect(ledger[3].after.talentMultiplier).toBe(1.75);
    // tax 1 → base 2800 × talent 1.75 × policy 1.12 = 5488
    expect(ledger[4].after.burnRate).toBe(5488);
    expect(ledger[4].explanations.length).toBeGreaterThan(0);
  });

  test('API commit rows normalize to the same ledger shape (including legacy deltas+view)', () => {
    const modern = ledgerEntriesFromApiCommits([
      {
        seq: 2,
        turnBefore: 0,
        turnAfter: 1,
        command: { type: 'advance_turn' },
        result: {
          before: { turn: 0, taxRate: 0.25, cash: 15000, burnRate: 2200, hype: 0.3, talentCost: 4000, talentMultiplier: 1, employeeCount: 0, activeTriggerCount: 0, budgetHeadroom: 0.75, hypeBias: 0, voterSupport: 0.525 },
          after: { turn: 1, taxRate: 0.25, cash: 14816.6667, burnRate: 2200, hype: 0.3, talentCost: 4000, talentMultiplier: 1, employeeCount: 0, activeTriggerCount: 0, budgetHeadroom: 0.75, hypeBias: 0, voterSupport: 0.525 },
          deltas: { turn: 1, cash: -183.3333 },
          appliedEffects: [{ kind: 'burn.tick', summary: 'cash drained' }],
          explanations: ['Advanced to turn 1.'],
        },
        createdAt: '2026-10-27T00:00:00.000Z',
      },
    ]);
    expect(modern[0].before.cash).toBe(15000);
    expect(modern[0].after.turn).toBe(1);
    expect(modern[0].appliedEffects[0].kind).toBe('burn.tick');

    const legacy = shapeLedgerEntry({
      seq: 1,
      turnBefore: 0,
      turnAfter: 1,
      command: { type: 'advance_turn' },
      result: {
        deltas: {
          turn: 1,
          taxRate: 0,
          cash: -183.33333333333334,
          burnRate: 0,
          hype: 0,
          talentCost: 0,
          talentMultiplier: 0,
          employeeCount: 0,
          activeTriggerCount: 0,
          budgetHeadroom: 0,
          hypeBias: 0,
        },
        appliedEffects: [{ kind: 'burn.tick', summary: 'cash drained' }],
        explanations: ['Advanced to turn 1.'],
        view: {
          turn: 1,
          taxRate: 0.25,
          company: { cash: 14816.666666666666, burnRate: 2200, hype: 0.3, talentCost: 4000 },
          talentMultiplier: 1,
          employees: [],
          activeTriggers: [],
          civic: { budgetHeadroom: 0.75, hypeBias: 0 },
        },
      },
    });
    expect(legacy.after.cash).toBeCloseTo(14816.666666666666, 5);
    expect(legacy.before.cash).toBeCloseTo(15000, 5);
    expect(legacy.before.turn).toBe(0);
  });

  test('ledgerResultPayload carries before/after for turn_commits persistence', () => {
    const result = applyTurnCommand(createGameState(), { type: 'set_tax', taxRate: 0 });
    const payload = ledgerResultPayload(result, { turn: 0 });
    expect(payload.before.taxRate).toBe(0.25);
    expect(payload.after.taxRate).toBe(0);
    expect(payload.after.budgetHeadroom).toBe(1);
    expect(payload.after.hype).toBe(0.35);
    expect(payload.explanations.length).toBeGreaterThan(0);
    expect(payload.view).toEqual({ turn: 0 });
  });

  test('already-shaped API ledger rows round-trip without losing metrics', () => {
    const result = applyTurnCommand(createGameState(), { type: 'advance_turn' });
    const entry = ledgerEntryFromTurnResult(result, { seq: 3 });
    const again = ledgerEntriesFromApiCommits([entry]);
    expect(again[0].seq).toBe(3);
    expect(again[0].before.cash).toBe(entry.before.cash);
    expect(again[0].after.cash).toBe(entry.after.cash);
    expect(again[0].command.type).toBe('advance_turn');
  });
});
