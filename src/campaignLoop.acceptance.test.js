/**
 * P1-4 — Campaign-loop acceptance suite.
 *
 * Deterministic offline path (and ledger dual-path shaping without Postgres):
 *   action → applied/persisted event → turn → metrics + explanation → reload.
 *
 * Live Postgres `npm run test:api` (atomic campaign commit + DB reload) is
 * skipped in this suite when no database is available — see the dual-path
 * note test and `test/api/campaign-turns.api.js`.
 */

import { describe, expect, test } from 'vitest';
import {
  assertCausalEffect,
  previewCausalEffect,
  staticDiagramEdgesFromRegistry,
} from './causalGraph.js';
import { ingestFixtureIntoState } from './pipelineIngest.js';
import { PATHWAY_BUDGET_HEADROOM_TO_HYPE } from './pathways.js';
import { SAMPLE_TRIGGERS } from './triggers.js';
import { clearTriggers, initialState, setTaxRate } from './simulation.js';
import { effectiveBurnRate } from './talentMultiplier.js';
import {
  applyTurnCommand,
  createGameState,
  normalizeGameState,
  replayCommands,
  stableMetrics,
  toGameStateView,
} from './turnEngine.js';
import {
  appendLedgerFromTurnResults,
  ledgerEntriesFromApiCommits,
  ledgerEntryFromTurnResult,
  ledgerResultPayload,
} from './turnLedger.js';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');
const SEED = 'p1-4-campaign-loop';

describe('P1-4 campaign-loop acceptance', () => {
  test('locks Slice 1 burn baselines 2000 / 2200 / 2800', () => {
    expect(applyTurnCommand(setTaxRate(initialState, 0), { type: 'advance_turn' }).state.company.burnRate)
      .toBe(2000);
    expect(applyTurnCommand(initialState, { type: 'advance_turn' }).state.company.burnRate)
      .toBe(2200);
    expect(applyTurnCommand(setTaxRate(initialState, 1), { type: 'advance_turn' }).state.company.burnRate)
      .toBe(2800);
  });

  test('locks hire ×1.75 / burn 3850 and Slice 2 policy burn 2464', () => {
    const hired = applyTurnCommand(initialState, {
      type: 'hire_employee',
      department: 'tech',
      skill: 1,
    });
    expect(hired.state.talentMultiplier).toBe(1.75);
    expect(hired.state.company.burnRate).toBe(3850);

    const triggered = applyTurnCommand(initialState, {
      type: 'apply_trigger',
      trigger: policy,
    });
    expect(triggered.state.company.talentCost).toBe(4480);
    const advanced = applyTurnCommand(triggered.state, { type: 'advance_turn' });
    expect(advanced.state.company.burnRate).toBe(2464);
  });

  test('locks pathway headroom→hype and causal diagram edges', () => {
    const zero = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 0 });
    expect(zero.state.civic.budgetHeadroom).toBe(1);
    expect(zero.state.civic.hypeBias).toBe(0.05);
    expect(zero.state.company.hype).toBe(0.35);
    expect(zero.pathwayPreview.pathwayId).toBe(PATHWAY_BUDGET_HEADROOM_TO_HYPE.id);

    const max = applyTurnCommand(initialState, { type: 'set_tax', taxRate: 1 });
    expect(max.state.civic.budgetHeadroom).toBe(0);
    expect(max.state.civic.hypeBias).toBe(-0.15);
    expect(max.state.company.hype).toBe(0.15);

    const edgeIds = staticDiagramEdgesFromRegistry().map((edge) => edge.id).sort();
    expect(edgeIds).toEqual(['ecivic-hype', 'einfra-7', 'etax-7']);
  });

  test('locks pipeline supersession burn 2376 and clear → 2200', () => {
    const ingested = ingestFixtureIntoState(initialState);
    expect(ingested.triggers).toHaveLength(1);
    expect(ingested.triggers[0].effect.talentCost).toBe(0.08);
    expect(effectiveBurnRate(ingested.state)).toBe(2376);

    const cleared = clearTriggers(ingested.state);
    expect(effectiveBurnRate(cleared)).toBe(2200);
  });

  test('causal graph rejects unknown effect keys at assert / preview / apply', () => {
    expect(() => assertCausalEffect({ hype: 0.1, morale: 1 })).toThrow(/morale/);
    expect(() => previewCausalEffect({ inventMe: 2 })).toThrow(/inventMe/);
    expect(() => applyTurnCommand(initialState, {
      type: 'apply_trigger',
      trigger: {
        id: 'evt-bad-accept',
        type: 'news_spike',
        label: 'Bad',
        source: 'mock:local',
        timestamp: '2026-01-01T00:00:00.000Z',
        effect: { hype: 0.05, bonus: 1 },
      },
    })).toThrow(/bonus/);
  });

  test('full loop: tax + hire + trigger → turn → metrics + explanation → reload', () => {
    const commands = [
      { type: 'set_tax', taxRate: 0 },
      { type: 'hire_employee', department: 'tech', skill: 1 },
      { type: 'apply_trigger', trigger: policy },
      { type: 'advance_turn' },
    ];

    const live = replayCommands(createGameState({ seed: SEED }), commands);
    const last = live.results.at(-1);

    // Metrics after the loop (tax 0 → base 2000 × hire 1.75 × policy 1.12 = 3920).
    expect(live.state.turn).toBe(1);
    expect(live.state.taxRate).toBe(0);
    expect(live.state.civic.budgetHeadroom).toBe(1);
    expect(live.state.company.hype).toBe(0.35);
    expect(live.state.talentMultiplier).toBe(1.75);
    expect(live.state.company.talentCost).toBe(4480);
    expect(live.state.company.burnRate).toBe(3920);
    expect(live.state.company.cash).toBeCloseTo(15000 - 3920 / 12);
    expect(live.state.employees).toHaveLength(1);
    expect(live.state.activeTriggers.map((row) => row.id)).toEqual([policy.id]);

    // Explanations + applied effects on the advance.
    expect(last.explanations.length).toBeGreaterThan(0);
    expect(last.explanations[0]).toMatch(/Advanced to turn 1/);
    expect(last.appliedEffects.some((effect) => effect.kind === 'burn.tick')).toBe(true);

    // Pathway explanation on set_tax.
    const taxResult = live.results[0];
    expect(taxResult.appliedEffects.some(
      (effect) => effect.pathwayId === PATHWAY_BUDGET_HEADROOM_TO_HYPE.id,
    )).toBe(true);

    // Durable ledger captures the command trail.
    const ledger = appendLedgerFromTurnResults([], live.results);
    expect(ledger).toHaveLength(4);
    expect(ledger.map((entry) => entry.command.type)).toEqual([
      'set_tax',
      'hire_employee',
      'apply_trigger',
      'advance_turn',
    ]);
    expect(ledger[3].after.burnRate).toBe(3920);
    expect(ledger[3].explanations[0]).toMatch(/Advanced to turn 1/);

    // Reload: JSON round-trip of committed view + same-seed replay reproduce metrics.
    const persisted = JSON.parse(JSON.stringify(toGameStateView(live.state)));
    const reloaded = normalizeGameState(persisted);
    expect(stableMetrics(reloaded)).toEqual(stableMetrics(live.state));

    const replayed = replayCommands(createGameState({ seed: SEED }), commands);
    expect(stableMetrics(replayed.state)).toEqual(stableMetrics(live.state));
    expect(replayed.state.company.burnRate).toBe(3920);
  });

  test('dual-path ledger: offline TurnResult shapes ≡ API commit row round-trip (no Postgres)', () => {
    // Documents API dual-path without requiring live Postgres. Live atomic
    // campaign reload remains under `npm run test:api` / campaign-turns.api.js.
    const result = applyTurnCommand(createGameState({ seed: 'dual-path' }), {
      type: 'advance_turn',
    });
    const offlineEntry = ledgerEntryFromTurnResult(result, { seq: 1 });
    const persistShape = ledgerResultPayload(result, { turn: 0 });

    const asApiCommit = {
      seq: 1,
      turnBefore: 0,
      turnAfter: 1,
      command: { type: 'advance_turn' },
      result: persistShape,
      createdAt: '2026-10-27T00:00:00.000Z',
    };
    const fromApi = ledgerEntriesFromApiCommits([asApiCommit]);

    expect(fromApi[0].after.burnRate).toBe(2200);
    expect(fromApi[0].after.cash).toBeCloseTo(offlineEntry.after.cash, 5);
    expect(fromApi[0].command.type).toBe('advance_turn');
    expect(fromApi[0].explanations[0]).toMatch(/Advanced to turn 1/);
    expect(fromApi[0].appliedEffects.some((effect) => effect.kind === 'burn.tick')).toBe(true);
  });

  test.skip(
    'API Postgres campaign reload (createCampaign → commitTurn → getCampaign) — needs DATABASE_URL; see test/api/campaign-turns.api.js',
    () => {
      // Live atomic campaign reload is covered by `npm run test:api` when Postgres
      // is available. Offline reload + ledger dual-path above cover P1-4 without DB.
    },
  );
});
