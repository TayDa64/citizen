/**
 * Client helpers that apply TurnCommands locally or via the campaign API.
 * Preserves the companies-API authority boundary: never copy companies.cash /
 * companies.burnRate. When a campaign commit succeeds, cash/burn/tax/turn come
 * from TurnResult; API-owned hype/talent stay from the prior state.
 *
 * Campaign GameState must carry the same activeTriggers stack the UI shows so
 * advance_turn burn/cash match the preview. Use buildTriggerRestackCommands
 * before advance (and seed createCampaign) — do not leave triggers only on
 * /api/triggers while state_json stays empty.
 */

import { toTriggerPayload } from './citizenApi.js';
import { applyTurnCommand } from './turnEngine.js';

export function toCampaignTrigger(trigger) {
  return toTriggerPayload(trigger);
}

/**
 * Rebuild campaign trigger stack from the UI/API list: clear, then apply each.
 * Strips client-only fields (e.g. appliedAtIndex) via the trigger contract.
 */
export function buildTriggerRestackCommands(activeTriggers) {
  const list = Array.isArray(activeTriggers) ? activeTriggers : [];
  return [
    { type: 'clear_triggers' },
    ...list.map((trigger) => ({
      type: 'apply_trigger',
      trigger: toCampaignTrigger(trigger),
    })),
  ];
}

export function commandsWithTriggerRestack(state, commands) {
  const list = Array.isArray(commands) ? commands : [commands];
  const needsRestack = list.some((command) => command?.type === 'advance_turn');
  if (!needsRestack) return list;
  return [...buildTriggerRestackCommands(state?.activeTriggers), ...list];
}

export function mergeCampaignTurnState(prev, turnState) {
  if (prev?.dataSource !== 'api') {
    return {
      ...turnState,
      dataSource: prev?.dataSource ?? turnState.dataSource ?? 'local',
      campaignId: turnState.campaignId ?? prev?.campaignId ?? null,
    };
  }
  return {
    ...prev,
    ...turnState,
    dataSource: 'api',
    campaignId: turnState.campaignId ?? prev.campaignId ?? null,
    baselines: prev.baselines,
    // Display stack stays API-owned; campaign cash/burn already used that stack
    // when restacked before advance_turn.
    activeTriggers: prev.activeTriggers,
    employees: prev.employees,
    talentMultiplier: prev.talentMultiplier,
    talentMix: prev.talentMix,
    talentCostFactor: prev.talentCostFactor,
    talentCostFactorClamped: prev.talentCostFactorClamped,
    effectiveMultiplier: prev.effectiveMultiplier,
    lastTriggerChange: prev.lastTriggerChange,
    company: {
      ...turnState.company,
      hype: prev.company.hype,
      talentCost: prev.company.talentCost,
      talentMultiplier: prev.company.talentMultiplier ?? prev.talentMultiplier,
      talentMix: prev.company.talentMix ?? prev.talentMix,
    },
  };
}

export function applyCommandsLocally(state, commands) {
  let next = state;
  let last = null;
  for (const command of commands) {
    last = applyTurnCommand(next, command);
    next = last.state;
  }
  return { state: next, result: last };
}

/**
 * Run commands through the campaign API when available; otherwise local engine.
 * Returns { state, mode: 'api'|'local', results? }.
 * Callers that advance should pass commandsWithTriggerRestack so campaign
 * state_json matches the UI trigger stack before burn drains cash.
 */
export async function dispatchTurnCommands(state, commands, { api = null, campaignId = null } = {}) {
  const list = Array.isArray(commands) ? commands : [commands];
  if (!api || !campaignId) {
    const local = applyCommandsLocally(state, list);
    return { state: local.state, mode: 'local', result: local.result };
  }

  let next = state;
  const results = [];
  try {
    for (const command of list) {
      const payload = await api.commitTurn(campaignId, command);
      results.push(payload);
      const turnState = payload?.state;
      if (turnState == null || typeof turnState !== 'object') {
        throw new Error('Campaign turn response missing state');
      }
      next = mergeCampaignTurnState(next, turnState);
    }
    return { state: next, mode: 'api', results };
  } catch {
    const local = applyCommandsLocally(state, list);
    return { state: local.state, mode: 'local', result: local.result, fallback: true };
  }
}
