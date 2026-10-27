/**
 * Client helpers that apply TurnCommands locally or via the campaign API.
 * Preserves the companies-API authority boundary: never copy companies.cash /
 * companies.burnRate. When a campaign commit succeeds, cash/burn/tax/turn come
 * from TurnResult; API-owned hype/talent/triggers stay from the prior state.
 */

import { applyTurnCommand } from './turnEngine.js';

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
