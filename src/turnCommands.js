/**
 * Client helpers that apply TurnCommands locally or via the campaign API.
 * Preserves the companies-API authority boundary: never copy companies.cash /
 * companies.burnRate. When a campaign commit succeeds, cash/burn/tax/turn come
 * from TurnResult; API-owned trigger stack / talent-cost stay from the prior
 * state. Civic budget headroom travels with the campaign turn; hype is
 * rebiased (API stacked hype ± civic hypeBias) so tax→city→hype survives merge.
 * After hire_employee, campaign GameState owns the employee roster and
 * talentMultiplier / talentMix (taken from TurnResult when non-empty).
 *
 * Campaign GameState must carry the same activeTriggers stack the UI shows so
 * advance_turn burn/cash match the preview. Use buildTriggerRestackCommands
 * before advance (and seed createCampaign) — do not leave triggers only on
 * /api/triggers while state_json stays empty.
 */

import { toTriggerPayload } from './citizenApi.js';
import { computeCivicFromTax, rebiasHype } from './civicFeedback.js';
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
  const turnRoster = Array.isArray(turnState?.employees) ? turnState.employees : [];
  const campaignOwnsRoster = turnRoster.length > 0;
  const employees = campaignOwnsRoster ? turnRoster : prev.employees;
  const talentMultiplier = campaignOwnsRoster
    ? (turnState.talentMultiplier ?? prev.talentMultiplier)
    : prev.talentMultiplier;
  const talentMix = campaignOwnsRoster
    ? (turnState.talentMix ?? prev.talentMix)
    : prev.talentMix;
  const prevCivic = prev.civic ?? computeCivicFromTax(prev.taxRate);
  const nextCivic = turnState.civic ?? computeCivicFromTax(turnState.taxRate ?? prev.taxRate);
  return {
    ...prev,
    ...turnState,
    dataSource: 'api',
    campaignId: turnState.campaignId ?? prev.campaignId ?? null,
    baselines: prev.baselines,
    // Display stack stays API-owned; campaign cash/burn already used that stack
    // when restacked before advance_turn.
    activeTriggers: prev.activeTriggers,
    employees,
    talentMultiplier,
    talentMix,
    talentCostFactor: prev.talentCostFactor,
    talentCostFactorClamped: prev.talentCostFactorClamped,
    // Recompute from campaign talent × API cost factor after hire.
    effectiveMultiplier: campaignOwnsRoster ? null : prev.effectiveMultiplier,
    lastTriggerChange: prev.lastTriggerChange,
    civic: nextCivic,
    company: {
      ...turnState.company,
      // Keep API trigger-stacked hype, then fold campaign civic bias from tax.
      hype: rebiasHype(prev.company.hype, prevCivic, nextCivic),
      talentCost: prev.company.talentCost,
      talentMultiplier,
      talentMix,
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
 *
 * Server-backed failure: when a campaign is live and a commit throws, the
 * commands are NOT re-run locally. A local re-run would put a month and a
 * world event on screen that the campaign never recorded (UI burn 2464 /
 * turn 1 while the server stayed at 2200 / turn 0). Instead this returns
 * { failed: true, state, pending } where `state` is the last server-confirmed
 * state (the prior state merged with every commit that did succeed) and
 * `pending.commands` is the failed command plus the ones never sent. Use
 * retryTurnCommands to recover. Offline play (no api / campaign) is unchanged.
 */
export async function dispatchTurnCommands(state, commands, { api = null, campaignId = null } = {}) {
  const list = Array.isArray(commands) ? commands : [commands];
  if (!api || !campaignId) {
    const local = applyCommandsLocally(state, list);
    return { state: local.state, mode: 'local', result: local.result };
  }

  let next = state;
  const results = [];
  let index = 0;
  try {
    for (; index < list.length; index += 1) {
      const payload = await api.commitTurn(campaignId, list[index]);
      const turnState = payload?.state;
      if (turnState == null || typeof turnState !== 'object') {
        throw new Error('Campaign turn response missing state');
      }
      results.push(payload);
      next = mergeCampaignTurnState(next, turnState);
    }
    return { state: next, mode: 'api', results };
  } catch (error) {
    return {
      state: next,
      mode: 'api',
      results,
      failed: true,
      error,
      pending: { commands: list.slice(index) },
    };
  }
}

function rosterLength(state) {
  return Array.isArray(state?.employees) ? state.employees.length : 0;
}

/**
 * Whether the server already applied `command`, judged from a fresh campaign
 * read against the last state the client saw confirmed. Only commands that
 * are not idempotent need this: a lost reply on advance_turn or
 * hire_employee must not be sent twice (that bills a second month or hires a
 * second person). set_tax and the trigger stack commands are idempotent, so
 * they are simply sent again.
 */
export function commandAlreadyApplied(command, confirmedState, serverState) {
  if (command?.type === 'advance_turn') {
    return Number(serverState?.turn) > Number(confirmedState?.turn ?? 0);
  }
  if (command?.type === 'hire_employee') {
    return rosterLength(serverState) > rosterLength(confirmedState);
  }
  return false;
}

/**
 * Retry after a failed server-backed dispatch: re-read the campaign first,
 * show that state, skip the failed command when the server already applied
 * it, then send the rest. Throws when the campaign cannot be read (the caller
 * keeps the failure on screen). Returns the same shape as dispatchTurnCommands.
 */
export async function retryTurnCommands(state, pending, { api, campaignId }) {
  const list = Array.isArray(pending?.commands) ? pending.commands : [];
  const payload = await api.getCampaign(campaignId);
  const serverState = payload?.state;
  if (serverState == null || typeof serverState !== 'object') {
    throw new Error('Campaign response missing state');
  }
  const refreshed = mergeCampaignTurnState(state, serverState);
  const [first, ...rest] = list;
  const remaining = first && commandAlreadyApplied(first, state, serverState) ? rest : list;
  if (remaining.length === 0) {
    return { state: refreshed, mode: 'api', results: [], refetched: true };
  }
  const dispatched = await dispatchTurnCommands(refreshed, remaining, { api, campaignId });
  return { ...dispatched, refetched: true };
}
