import { describe, expect, test, vi } from 'vitest';
import { SAMPLE_TRIGGERS } from './triggers.js';
import { createGameState, applyTurnCommand } from './turnEngine.js';
import { initialState } from './simulation.js';
import {
  applyCommandsLocally,
  buildTriggerRestackCommands,
  commandAlreadyApplied,
  commandsWithTriggerRestack,
  dispatchTurnCommands,
  mergeCampaignTurnState,
  retryTurnCommands,
} from './turnCommands.js';

const policy = SAMPLE_TRIGGERS.find((trigger) => trigger.type === 'policy_change');

function fakeApi({ failAt = -1, loseAt = -1, initial = null } = {}) {
  let server = initial
    ? { ...structuredClone(initial), campaignId: 'camp-1' }
    : { ...initialState, campaignId: 'camp-1' };
  let calls = 0;
  const api = {
    get server() { return server; },
    commitTurn: vi.fn(async (_id, command) => {
      const index = calls;
      calls += 1;
      if (index === failAt) throw Object.assign(new Error('boom'), { status: 503 });
      server = { ...applyTurnCommand(server, command).state, campaignId: 'camp-1' };
      if (index === loseAt) throw Object.assign(new Error('timeout'), { status: 504 });
      return { state: server, commit: { seq: calls } };
    }),
    getCampaign: vi.fn(async () => ({ id: 'camp-1', state: server })),
  };
  return api;
}

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

  test('mergeCampaignTurnState takes campaign roster after hire_employee', () => {
    const prev = {
      ...initialState,
      dataSource: 'api',
      talentMultiplier: 1,
      talentMix: [],
      company: { ...initialState.company, hype: 0.55, talentCost: 4480 },
    };
    const hired = applyTurnCommand(createGameState({ seed: 'hire-merge' }), {
      type: 'hire_employee',
      department: 'tech',
      skill: 1,
    }).state;
    const merged = mergeCampaignTurnState(prev, hired);
    expect(merged.employees).toHaveLength(1);
    expect(merged.talentMultiplier).toBe(1.75);
    expect(merged.company.burnRate).toBe(3850);
    expect(merged.company.hype).toBe(0.55);
    expect(merged.company.talentCost).toBe(4480);
    expect(merged.dataSource).toBe('api');
  });
});

describe('dispatchTurnCommands with a live campaign', () => {
  const apiState = {
    ...initialState,
    dataSource: 'api',
    campaignId: 'camp-1',
    baselines: { hype: 0.3, talentCost: 4000 },
  };

  test('a failed commit is not re-run locally; state stays server-confirmed', async () => {
    const api = fakeApi({ failAt: 0 });
    const out = await dispatchTurnCommands(apiState, [{ type: 'advance_turn' }], { api, campaignId: 'camp-1' });
    expect(out.mode).toBe('api');
    expect(out.failed).toBe(true);
    expect(out.state).toBe(apiState);
    expect(out.state.turn).toBe(0);
    expect(out.state.company.cash).toBe(15000);
    expect(out.pending.commands).toEqual([{ type: 'advance_turn' }]);
    expect(out).not.toHaveProperty('fallback');
  });

  test('commits before the failure stay; the failed one and the rest are pending', async () => {
    const api = fakeApi({ failAt: 1 });
    const out = await dispatchTurnCommands(
      apiState,
      [{ type: 'set_tax', taxRate: 0.25 }, { type: 'advance_turn' }],
      { api, campaignId: 'camp-1' },
    );
    expect(out.failed).toBe(true);
    expect(out.results).toHaveLength(1);
    expect(out.state.taxRate).toBe(0.25);
    expect(out.state.turn).toBe(0);
    expect(out.pending.commands).toEqual([{ type: 'advance_turn' }]);
  });

  test('retry re-reads the campaign and resends a rejected advance', async () => {
    const api = fakeApi({ failAt: 0 });
    const failed = await dispatchTurnCommands(apiState, [{ type: 'advance_turn' }], { api, campaignId: 'camp-1' });
    const out = await retryTurnCommands(failed.state, failed.pending, { api, campaignId: 'camp-1' });
    expect(api.getCampaign).toHaveBeenCalledTimes(1);
    expect(out.failed).toBeUndefined();
    expect(out.state.turn).toBe(1);
    expect(api.server.turn).toBe(1);
  });

  test('retry skips an advance the server already applied (lost reply)', async () => {
    const api = fakeApi({ loseAt: 0 });
    const failed = await dispatchTurnCommands(apiState, [{ type: 'advance_turn' }], { api, campaignId: 'camp-1' });
    expect(failed.failed).toBe(true);
    expect(failed.state.turn).toBe(0);
    expect(api.server.turn).toBe(1);
    const out = await retryTurnCommands(failed.state, failed.pending, { api, campaignId: 'camp-1' });
    expect(api.commitTurn).toHaveBeenCalledTimes(1);
    expect(out.state.turn).toBe(1);
    expect(out.state.company.cash).toBe(api.server.company.cash);
  });

  test('commandAlreadyApplied only skips non-idempotent commands', () => {
    expect(commandAlreadyApplied({ type: 'advance_turn' }, { turn: 0 }, { turn: 1 })).toBe(true);
    expect(commandAlreadyApplied({ type: 'advance_turn' }, { turn: 1 }, { turn: 1 })).toBe(false);
    expect(commandAlreadyApplied({ type: 'hire_employee' }, { employees: [] }, { employees: [{}] })).toBe(true);
    expect(commandAlreadyApplied({ type: 'set_tax', taxRate: 0.2 }, { turn: 0 }, { turn: 1 })).toBe(false);
    expect(commandAlreadyApplied({ type: 'clear_triggers' }, {}, {})).toBe(false);
  });

  test('without a campaign, commands still run on the local engine', async () => {
    const out = await dispatchTurnCommands(initialState, [{ type: 'advance_turn' }]);
    expect(out.mode).toBe('local');
    expect(out.state.turn).toBe(1);
    expect(out.state.company.cash).toBeCloseTo(15000 - 2200 / 12);
  });
});

function hypeTrigger(id, hype) {
  return {
    id,
    type: 'news_spike',
    label: id,
    source: 'mock:test',
    timestamp: '2026-01-01T00:00:00.000Z',
    effect: { hype },
  };
}

/**
 * Campaign client whose displayed hype was produced by the same stack the
 * server holds, which is how a seeded campaign starts and how a tax slider
 * commit continues. dataSource api forces mergeCampaignTurnState.
 */
function apiClientFrom(state) {
  return { ...structuredClone(state), dataSource: 'api', campaignId: 'camp-1' };
}

describe('campaign hype merge follows the server at the clamp', () => {
  test('a tax round trip through the API path restores ceiling hype', async () => {
    const seeded = applyTurnCommand(createGameState({ seed: 'hype-ceiling' }), {
      type: 'apply_trigger',
      trigger: hypeTrigger('boom', 0.69),
    }).state;
    expect(seeded.company.hype).toBe(0.99);

    const api = fakeApi({ initial: seeded });
    const raised = await dispatchTurnCommands(
      apiClientFrom(seeded),
      commandsWithTriggerRestack(apiClientFrom(seeded), [
        { type: 'set_tax', taxRate: 0 },
        { type: 'advance_turn' },
      ]),
      { api, campaignId: 'camp-1' },
    );
    expect(raised.state.company.hype).toBe(1);
    expect(api.server.company.hype).toBe(1);

    const returned = await dispatchTurnCommands(
      raised.state,
      commandsWithTriggerRestack(raised.state, [
        { type: 'set_tax', taxRate: 0.25 },
        { type: 'advance_turn' },
      ]),
      { api, campaignId: 'camp-1' },
    );
    expect(api.server.company.hype).toBe(0.99);
    expect(returned.state.company.hype).toBe(0.99);
    expect(returned.state.company.burnRate).toBe(2200);
  });

  test('a tax round trip through the API path does not invent hype at the floor', async () => {
    const seeded = applyTurnCommand(createGameState({ seed: 'hype-floor' }), {
      type: 'apply_trigger',
      trigger: hypeTrigger('slump', -0.4051),
    }).state;
    expect(seeded.company.hype).toBe(0);

    const api = fakeApi({ initial: seeded });
    const pressed = await dispatchTurnCommands(
      apiClientFrom(seeded),
      commandsWithTriggerRestack(apiClientFrom(seeded), [
        { type: 'set_tax', taxRate: 0.5 },
        { type: 'advance_turn' },
      ]),
      { api, campaignId: 'camp-1' },
    );
    expect(pressed.state.company.hype).toBe(0);
    expect(api.server.company.hype).toBe(0);

    const returned = await dispatchTurnCommands(
      pressed.state,
      commandsWithTriggerRestack(pressed.state, [
        { type: 'set_tax', taxRate: 0.25 },
        { type: 'advance_turn' },
      ]),
      { api, campaignId: 'camp-1' },
    );
    expect(api.server.company.hype).toBe(0);
    expect(returned.state.company.hype).toBe(0);
    expect(returned.state.company.burnRate).toBe(2200);
  });

  test('retry after a lost set_tax reply keeps the server ceiling hype', async () => {
    let seeded = applyTurnCommand(createGameState({ seed: 'hype-retry' }), {
      type: 'apply_trigger',
      trigger: hypeTrigger('boom', 0.69),
    }).state;
    seeded = applyTurnCommand(seeded, { type: 'set_tax', taxRate: 0 }).state;
    expect(seeded.company.hype).toBe(1);

    const api = fakeApi({ initial: seeded, loseAt: 0 });
    const failed = await dispatchTurnCommands(
      apiClientFrom(seeded),
      [{ type: 'set_tax', taxRate: 0.25 }],
      { api, campaignId: 'camp-1' },
    );
    expect(failed.failed).toBe(true);
    expect(failed.state.company.hype).toBe(1);
    expect(api.server.company.hype).toBe(0.99);

    const retried = await retryTurnCommands(failed.state, failed.pending, {
      api,
      campaignId: 'camp-1',
    });
    expect(retried.failed).toBeUndefined();
    expect(api.server.company.hype).toBe(0.99);
    expect(retried.state.company.hype).toBe(0.99);
  });

  test('an advance after another writer set the tax keeps the server ceiling hype', async () => {
    let seeded = applyTurnCommand(createGameState({ seed: 'hype-other-tab' }), {
      type: 'apply_trigger',
      trigger: hypeTrigger('boom', 0.69),
    }).state;
    seeded = applyTurnCommand(seeded, { type: 'set_tax', taxRate: 0 }).state;
    expect(seeded.company.hype).toBe(1);

    const api = fakeApi({ initial: seeded });
    await api.commitTurn('camp-1', { type: 'set_tax', taxRate: 0.25 });
    expect(api.server.company.hype).toBe(0.99);
    expect(api.server.taxRate).toBe(0.25);

    const advanced = await dispatchTurnCommands(
      apiClientFrom(seeded),
      commandsWithTriggerRestack(apiClientFrom(seeded), [{ type: 'advance_turn' }]),
      { api, campaignId: 'camp-1' },
    );
    expect(api.server.company.hype).toBe(0.99);
    expect(advanced.state.company.hype).toBe(0.99);
    expect(advanced.state.taxRate).toBe(0.25);
  });
});
