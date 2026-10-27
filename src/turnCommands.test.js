import { describe, expect, test } from 'vitest';
import { initialState } from './simulation.js';
import { applyCommandsLocally, mergeCampaignTurnState } from './turnCommands.js';

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
});
