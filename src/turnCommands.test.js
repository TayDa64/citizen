import { describe, expect, test } from 'vitest';
import { SAMPLE_TRIGGERS } from './triggers.js';
import { createGameState, applyTurnCommand } from './turnEngine.js';
import { initialState } from './simulation.js';
import {
  applyCommandsLocally,
  buildTriggerRestackCommands,
  commandsWithTriggerRestack,
  mergeCampaignTurnState,
} from './turnCommands.js';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

describe('turnCommands', () => {
  test('local command sequence advances turn and drains cash', () => {
    const { state } = applyCommandsLocally(initialState, [
      { type: 'set_tax', taxRate: 0.25 },
      { type: 'advance_turn' },
    ]);
    expect(state.turn).toBe(1);
    expect(state.company.burnRate).toBe(2200);
    expect(state.company.cash).toBeCloseTo(15000 - 2200 / 12);
  });

  test('mergeCampaignTurnState keeps API hype/talent and takes turn cash', () => {
    const prev = {
      ...initialState,
      dataSource: 'api',
      company: { ...initialState.company, cash: 15000, hype: 0.55, talentCost: 4480 },
      baselines: { hype: 0.3, talentCost: 4000 },
      talentMultiplier: 1.28,
      activeTriggers: [{ id: 'evt-policy-wage-ordinance' }],
    };
    const turnState = {
      ...initialState,
      turn: 2,
      campaignId: 'camp-1',
      company: { ...initialState.company, cash: 14000, hype: 0.3, talentCost: 4000, burnRate: 2200 },
    };
    const merged = mergeCampaignTurnState(prev, turnState);
    expect(merged.company.cash).toBe(14000);
    expect(merged.company.hype).toBe(0.55);
    expect(merged.company.talentCost).toBe(4480);
    expect(merged.talentMultiplier).toBe(1.28);
    expect(merged.activeTriggers).toEqual(prev.activeTriggers);
    expect(merged.campaignId).toBe('camp-1');
    expect(merged.dataSource).toBe('api');
  });

  test('buildTriggerRestackCommands clears then applies contract payloads', () => {
    const commands = buildTriggerRestackCommands([
      { ...policy, appliedAtIndex: 3, chartNote: 'x' },
    ]);
    expect(commands[0]).toEqual({ type: 'clear_triggers' });
    expect(commands[1].type).toBe('apply_trigger');
    expect(commands[1].trigger.id).toBe(policy.id);
    expect(commands[1].trigger.effect).toEqual(policy.effect);
    expect(commands[1].trigger).not.toHaveProperty('appliedAtIndex');
    expect(commands[1].trigger).not.toHaveProperty('chartNote');
  });

  test('commandsWithTriggerRestack prepends stack before advance_turn only', () => {
    const state = { activeTriggers: [policy] };
    expect(commandsWithTriggerRestack(state, [{ type: 'set_tax', taxRate: 0 }])).toEqual([
      { type: 'set_tax', taxRate: 0 },
    ]);
    const withAdvance = commandsWithTriggerRestack(state, [{ type: 'advance_turn' }]);
    expect(withAdvance[0].type).toBe('clear_triggers');
    expect(withAdvance.at(-1)).toEqual({ type: 'advance_turn' });
    expect(withAdvance).toHaveLength(3);
  });

  test('restack then advance drains at policy burn 2464 (API+campaign coherence)', () => {
    // Repro lock: UI/API shows policy (preview 2464) while campaign was seeded empty.
    const prev = {
      ...initialState,
      dataSource: 'api',
      company: { ...initialState.company, cash: 15000, hype: 0.3, talentCost: 4480 },
      baselines: { hype: 0.3, talentCost: 4000 },
      talentCostFactor: 1.12,
      activeTriggers: [{ ...policy, appliedAtIndex: 0 }],
    };
    let campaign = createGameState({ seed: 'coherence-1', activeTriggers: [] });
    expect(applyTurnCommand(campaign, { type: 'advance_turn' }).state.company.burnRate).toBe(2200);

    const commands = commandsWithTriggerRestack(prev, [{ type: 'advance_turn' }]);
    let next = campaign;
    for (const command of commands) {
      next = applyTurnCommand(next, command).state;
    }
    expect(next.company.burnRate).toBe(2464);
    expect(next.company.talentCost).toBe(4480);
    expect(next.company.cash).toBeCloseTo(15000 - 2464 / 12);

    const merged = mergeCampaignTurnState(prev, next);
    expect(merged.company.burnRate).toBe(2464);
    expect(merged.company.cash).toBeCloseTo(15000 - 2464 / 12);
    expect(merged.company.talentCost).toBe(4480);
    expect(merged.activeTriggers).toEqual(prev.activeTriggers);
    expect(merged.dataSource).toBe('api');
  });
});
