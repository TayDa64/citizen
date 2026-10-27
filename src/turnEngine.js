/**
 * Authoritative turn engine (P0-2).
 *
 * Shared by the client sim and the server campaign commit path. Pure and
 * deterministic: same GameState + TurnCommand sequence → same TurnResult.
 *
 * Effect order for every command:
 *  1. Validate / normalize the TurnCommand.
 *  2. Apply command mutation (tax clamp, trigger stack, or none).
 *  3. On `advance_turn` only: refresh local talent profile, recompute burn,
 *     drain cash by burn/12, append history (24-month window), bump `turn`.
 *  4. Build metric deltas, applied-effects list, and short explanations.
 *
 * `set_tax` / trigger commands do not drain cash (matches Slice 1/2). The UI
 * tax slider still advances a month by issuing `set_tax` then `advance_turn`.
 *
 * Authority: campaign TurnResult owns cash/burn history when committed.
 * GET /api/companies cash/burnRate must never be copied onto the client sim.
 */

import {
  GAME_STATE_VERSION,
  RULE_VERSION,
  applyEffects as tickEffects,
  applyTrigger as simApplyTrigger,
  clearTriggers as simClearTriggers,
  initialState,
  removeTrigger as simRemoveTrigger,
  setTaxRate as simSetTaxRate,
} from './simulationCore.js';

export { GAME_STATE_VERSION, RULE_VERSION };

export const TURN_COMMAND_TYPES = Object.freeze([
  'set_tax',
  'advance_turn',
  'apply_trigger',
  'remove_trigger',
  'clear_triggers',
]);

export class TurnCommandError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'TurnCommandError';
    this.status = 400;
    this.issues = issues;
  }
}

function issue(path, code, message) {
  return { path, code, message };
}

export function createGameState(partial = {}) {
  const base = structuredClone(initialState);
  return normalizeGameState({
    ...base,
    ...partial,
    company: { ...base.company, ...partial.company },
    history: { ...base.history, ...partial.history },
    baselines: { ...base.baselines, ...partial.baselines },
  });
}

export function normalizeGameState(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TurnCommandError('GameState must be an object', [
      issue('', 'invalid_type', 'GameState must be an object'),
    ]);
  }
  const company = raw.company;
  if (company == null || typeof company !== 'object' || Array.isArray(company)) {
    throw new TurnCommandError('GameState.company is required', [
      issue('company', 'required', 'company is required'),
    ]);
  }
  const taxRate = Number(raw.taxRate);
  if (!Number.isFinite(taxRate)) {
    throw new TurnCommandError('GameState.taxRate must be finite', [
      issue('taxRate', 'invalid_type', 'taxRate must be a finite number'),
    ]);
  }
  const turn = Number.isInteger(raw.turn) && raw.turn >= 0
    ? raw.turn
    : Math.max(0, (Array.isArray(raw.history?.cash) ? raw.history.cash.length : 1) - 1);
  const stateVersion = Number.isInteger(raw.stateVersion) ? raw.stateVersion : GAME_STATE_VERSION;
  return {
    ...raw,
    stateVersion,
    campaignId: typeof raw.campaignId === 'string' ? raw.campaignId : raw.campaignId ?? null,
    turn,
    seed: raw.seed == null ? null : String(raw.seed),
    ruleVersion: typeof raw.ruleVersion === 'string' ? raw.ruleVersion : RULE_VERSION,
    taxRate: Math.max(0, Math.min(1, taxRate)),
    company: { ...company },
    history: {
      cash: Array.isArray(raw.history?.cash) ? [...raw.history.cash] : [Number(company.cash) || 0],
      burnRate: Array.isArray(raw.history?.burnRate) ? [...raw.history.burnRate] : [Number(company.burnRate) || 0],
    },
    baselines: {
      hype: Number.isFinite(Number(raw.baselines?.hype)) ? Number(raw.baselines.hype) : 0.3,
      talentCost: Number.isFinite(Number(raw.baselines?.talentCost))
        ? Number(raw.baselines.talentCost)
        : 4000,
    },
    employees: Array.isArray(raw.employees) ? raw.employees.map((row) => ({ ...row })) : [],
    activeTriggers: Array.isArray(raw.activeTriggers)
      ? raw.activeTriggers.map((row) => ({ ...row, effect: { ...row.effect } }))
      : [],
    talentMix: Array.isArray(raw.talentMix) ? raw.talentMix.map((row) => ({ ...row })) : [],
  };
}

export function toGameStateView(state) {
  const normalized = normalizeGameState(state);
  return {
    stateVersion: normalized.stateVersion,
    campaignId: normalized.campaignId,
    turn: normalized.turn,
    seed: normalized.seed,
    ruleVersion: normalized.ruleVersion,
    taxRate: normalized.taxRate,
    company: {
      cash: normalized.company.cash,
      burnRate: normalized.company.burnRate,
      hype: normalized.company.hype,
      productQuality: normalized.company.productQuality,
      talentCost: normalized.company.talentCost,
    },
    baselines: { ...normalized.baselines },
    talentMultiplier: normalized.talentMultiplier ?? 1,
    talentCostFactor: normalized.talentCostFactor ?? null,
    effectiveMultiplier: normalized.effectiveMultiplier ?? null,
    activeTriggers: (normalized.activeTriggers ?? []).map((trigger) => ({
      id: trigger.id,
      type: trigger.type,
      label: trigger.label,
      effect: { ...trigger.effect },
    })),
    history: {
      cash: [...normalized.history.cash],
      burnRate: [...normalized.history.burnRate],
    },
  };
}

export function parseTurnCommand(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TurnCommandError('TurnCommand must be an object', [
      issue('', 'invalid_type', 'TurnCommand must be an object'),
    ]);
  }
  const type = raw.type;
  if (!TURN_COMMAND_TYPES.includes(type)) {
    throw new TurnCommandError('Unknown TurnCommand type', [
      issue('type', 'invalid_value', `type must be one of: ${TURN_COMMAND_TYPES.join(', ')}`),
    ]);
  }
  switch (type) {
    case 'set_tax': {
      const taxRate = Number(raw.taxRate);
      if (!Number.isFinite(taxRate)) {
        throw new TurnCommandError('set_tax requires a finite taxRate', [
          issue('taxRate', 'invalid_type', 'taxRate must be a finite number'),
        ]);
      }
      return { type, taxRate };
    }
    case 'advance_turn':
      return { type };
    case 'apply_trigger': {
      if (raw.trigger == null || typeof raw.trigger !== 'object' || Array.isArray(raw.trigger)) {
        throw new TurnCommandError('apply_trigger requires trigger', [
          issue('trigger', 'required', 'trigger is required'),
        ]);
      }
      return { type, trigger: raw.trigger };
    }
    case 'remove_trigger': {
      if (typeof raw.triggerId !== 'string' || raw.triggerId.trim() === '') {
        throw new TurnCommandError('remove_trigger requires triggerId', [
          issue('triggerId', 'required', 'triggerId must be a non-empty string'),
        ]);
      }
      return { type, triggerId: raw.triggerId };
    }
    case 'clear_triggers':
      return { type };
    default: {
      const neverType = type;
      throw new TurnCommandError(`Unhandled TurnCommand type: ${String(neverType)}`);
    }
  }
}

function metricSnapshot(state) {
  return {
    turn: state.turn ?? 0,
    taxRate: state.taxRate,
    cash: state.company.cash,
    burnRate: state.company.burnRate,
    hype: state.company.hype,
    talentCost: state.company.talentCost,
    activeTriggerCount: (state.activeTriggers ?? []).length,
  };
}

function deltasBetween(before, after) {
  return {
    turn: after.turn - before.turn,
    taxRate: after.taxRate - before.taxRate,
    cash: after.cash - before.cash,
    burnRate: after.burnRate - before.burnRate,
    hype: after.hype - before.hype,
    talentCost: after.talentCost - before.talentCost,
    activeTriggerCount: after.activeTriggerCount - before.activeTriggerCount,
  };
}

function formatMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `$${Math.round(numeric).toLocaleString('en-US')}`;
}

function explanationsFor(command, before, after, appliedEffects) {
  const lines = [];
  switch (command.type) {
    case 'set_tax':
      lines.push(`Tax set to ${(after.taxRate * 100).toFixed(0)}%.`);
      break;
    case 'advance_turn':
      lines.push(
        `Advanced to turn ${after.turn}. Burn ${formatMoney(after.burnRate)}/mo; cash ${formatMoney(before.cash)} → ${formatMoney(after.cash)}.`,
      );
      break;
    case 'apply_trigger':
      lines.push(
        `Applied trigger ${command.trigger?.label ?? command.trigger?.id ?? ''}: hype ${before.hype} → ${after.hype}, talent cost ${formatMoney(before.talentCost)} → ${formatMoney(after.talentCost)}.`,
      );
      break;
    case 'remove_trigger':
      lines.push(`Removed trigger ${command.triggerId}.`);
      break;
    case 'clear_triggers':
      lines.push('Cleared world events; hype and talent cost returned toward baseline.');
      break;
    default: {
      const neverType = command.type;
      throw new TurnCommandError(`Unhandled TurnCommand type: ${String(neverType)}`);
    }
  }
  for (const effect of appliedEffects) {
    if (effect.summary) lines.push(effect.summary);
  }
  return lines;
}

function applyCommandMutation(state, command) {
  switch (command.type) {
    case 'set_tax':
      return simSetTaxRate(state, command.taxRate);
    case 'advance_turn': {
      const next = tickEffects(state);
      return {
        ...next,
        turn: (Number.isInteger(state.turn) ? state.turn : 0) + 1,
        stateVersion: state.stateVersion ?? GAME_STATE_VERSION,
        campaignId: state.campaignId ?? null,
        seed: state.seed ?? null,
        ruleVersion: state.ruleVersion ?? RULE_VERSION,
      };
    }
    case 'apply_trigger':
      return simApplyTrigger(state, command.trigger);
    case 'remove_trigger':
      return simRemoveTrigger(state, command.triggerId);
    case 'clear_triggers':
      return simClearTriggers(state);
    default: {
      const neverType = command.type;
      throw new TurnCommandError(`Unhandled TurnCommand type: ${String(neverType)}`);
    }
  }
}

function appliedEffectsFor(command, before, after) {
  const effects = [];
  if (command.type === 'set_tax' && before.taxRate !== after.taxRate) {
    effects.push({
      kind: 'policy.tax',
      summary: `taxRate ${before.taxRate} → ${after.taxRate}`,
    });
  }
  if (command.type === 'advance_turn') {
    effects.push({
      kind: 'burn.tick',
      summary: `cash drained by burn/12 (${formatMoney(before.burnRate)} preview → ${formatMoney(after.burnRate)} applied)`,
    });
  }
  if (command.type === 'apply_trigger' || command.type === 'remove_trigger' || command.type === 'clear_triggers') {
    if (before.hype !== after.hype || before.talentCost !== after.talentCost) {
      effects.push({
        kind: 'trigger.stack',
        summary: `hype ${before.hype} → ${after.hype}; talentCost ${before.talentCost} → ${after.talentCost}`,
      });
    }
  }
  return effects;
}

/**
 * Apply one TurnCommand to a GameState (or legacy sim state). Returns TurnResult.
 */
export function applyTurnCommand(state, commandInput) {
  const beforeState = normalizeGameState(state);
  const command = parseTurnCommand(commandInput);
  const before = metricSnapshot(beforeState);
  const nextState = normalizeGameState(applyCommandMutation(beforeState, command));
  const after = metricSnapshot(nextState);
  const appliedEffects = appliedEffectsFor(command, before, after);
  return {
    state: nextState,
    deltas: deltasBetween(before, after),
    appliedEffects,
    explanations: explanationsFor(command, before, after, appliedEffects),
    command,
  };
}

/**
 * Replay a command sequence from a seed state. Deterministic offline.
 */
export function replayCommands(initial, commands) {
  let state = normalizeGameState(initial);
  const results = [];
  for (const command of commands) {
    const result = applyTurnCommand(state, command);
    results.push(result);
    state = result.state;
  }
  return { state, results };
}

export function stableMetrics(state) {
  const view = toGameStateView(state);
  return {
    turn: view.turn,
    taxRate: view.taxRate,
    cash: view.company.cash,
    burnRate: view.company.burnRate,
    hype: view.company.hype,
    talentCost: view.company.talentCost,
    activeTriggerIds: view.activeTriggers.map((trigger) => trigger.id).sort(),
    historyCash: view.history.cash,
    historyBurn: view.history.burnRate,
  };
}
