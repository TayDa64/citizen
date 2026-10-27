// Client simulation façade.
// Mutations route through the authoritative turn engine so Advance Month / tax
// / trigger commands share one deterministic path with the server.
//
// Authority boundary:
// - GET /api/companies: never copy cash / burnRate onto the client sim.
// - Campaign TurnResult (when connected): owns cash, burn history, tax, turn.
// - Trigger create/clear still uses /api/triggers and refreshes hype/talent.

export {
  BASE_BURN,
  BASE_HYPE,
  BASE_TALENT_COST,
  GAME_STATE_VERSION,
  RULE_VERSION,
  initialState,
  computeBurnRate,
  previewBurnRate,
  baselineBurnRate,
  readApiSnapshot,
  hydrateFromApi,
} from './simulationCore.js';

import {
  applyEffects as coreApplyEffects,
  applyTrigger as coreApplyTrigger,
  clearTriggers as coreClearTriggers,
  hireEmployee as coreHireEmployee,
  removeTrigger as coreRemoveTrigger,
  setTaxRate as coreSetTaxRate,
} from './simulationCore.js';
import { applyTurnCommand } from './turnEngine.js';

/** Advance one month (cash drain + burn history). Prefer TurnCommand `advance_turn`. */
export function applyEffects(state) {
  return applyTurnCommand(state, { type: 'advance_turn' }).state;
}

/** Clamp tax without draining cash. Prefer TurnCommand `set_tax`. */
export function setTaxRate(state, taxRate) {
  return applyTurnCommand(state, { type: 'set_tax', taxRate }).state;
}

export function applyTrigger(state, trigger) {
  return applyTurnCommand(state, { type: 'apply_trigger', trigger }).state;
}

export function removeTrigger(state, triggerId) {
  return applyTurnCommand(state, { type: 'remove_trigger', triggerId }).state;
}

export function clearTriggers(state) {
  return applyTurnCommand(state, { type: 'clear_triggers' }).state;
}

/** Hire one employee; refreshes talent/burn preview, no cash drain. Prefer TurnCommand `hire_employee`. */
export function hireEmployee(state, options = {}) {
  return applyTurnCommand(state, {
    type: 'hire_employee',
    department: options.department ?? 'tech',
    skill: options.skill ?? 1,
    ...(options.id != null ? { id: options.id } : {}),
  }).state;
}

/** Escape hatch for callers that need the pre-engine mutation only. */
export const __core = {
  applyEffects: coreApplyEffects,
  setTaxRate: coreSetTaxRate,
  applyTrigger: coreApplyTrigger,
  removeTrigger: coreRemoveTrigger,
  clearTriggers: coreClearTriggers,
  hireEmployee: coreHireEmployee,
};
