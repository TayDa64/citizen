/**
 * Campaign turn ledger shaping (P1-1).
 *
 * Dual path:
 *  - Offline / unit: shape TurnResult → ledger entries (append-only in memory).
 *  - API: normalize GET /api/campaigns/{id}/turns rows (turn_commits) into the
 *    same entry shape. Chart history remains a 24-month ring buffer; the ledger
 *    is the durable decision/effects/outcome log.
 */

export const LEDGER_ENTRY_VERSION = 1;

const METRIC_KEYS = Object.freeze([
  'turn',
  'taxRate',
  'cash',
  'burnRate',
  'hype',
  'talentCost',
  'talentMultiplier',
  'employeeCount',
  'activeTriggerCount',
  'budgetHeadroom',
  'hypeBias',
  'voterSupport',
]);

function asFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeLedgerMetrics(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const out = {};
  for (const key of METRIC_KEYS) {
    out[key] = asFiniteNumber(raw[key], key === 'talentMultiplier' ? 1 : 0);
  }
  return out;
}

function metricsFromView(view) {
  if (view == null || typeof view !== 'object') return null;
  const company = view.company ?? {};
  const civic = view.civic ?? {};
  const politics = view.politics ?? {};
  return normalizeLedgerMetrics({
    turn: view.turn,
    taxRate: view.taxRate,
    cash: company.cash,
    burnRate: company.burnRate,
    hype: company.hype,
    talentCost: company.talentCost,
    talentMultiplier: view.talentMultiplier,
    employeeCount: Array.isArray(view.employees) ? view.employees.length : 0,
    activeTriggerCount: Array.isArray(view.activeTriggers) ? view.activeTriggers.length : 0,
    budgetHeadroom: civic.budgetHeadroom,
    hypeBias: civic.hypeBias,
    voterSupport: politics.voterSupport,
  });
}

function subtractMetrics(after, deltas) {
  if (after == null) return null;
  if (deltas == null || typeof deltas !== 'object') return { ...after };
  const before = { ...after };
  for (const key of METRIC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(deltas, key)) {
      before[key] = asFiniteNumber(after[key] - asFiniteNumber(deltas[key]));
    }
  }
  return before;
}

/**
 * Shape one append-only ledger entry from a TurnResult or a stored turn_commits
 * result_json (+ row metadata).
 */
export function shapeLedgerEntry({
  seq,
  turnBefore,
  turnAfter,
  command,
  result = null,
  createdAt = null,
} = {}) {
  const safeCommand = command != null && typeof command === 'object' ? { ...command } : { type: 'unknown' };
  const appliedEffects = Array.isArray(result?.appliedEffects)
    ? result.appliedEffects.map((effect) => ({ ...effect }))
    : [];
  const explanations = Array.isArray(result?.explanations)
    ? result.explanations.map((line) => String(line))
    : [];

  let after = normalizeLedgerMetrics(result?.after)
    ?? metricsFromView(result?.view);
  let before = normalizeLedgerMetrics(result?.before);
  if (before == null && after != null) {
    before = subtractMetrics(after, result?.deltas);
  }
  if (after == null && before != null && result?.deltas != null) {
    after = { ...before };
    for (const key of METRIC_KEYS) {
      if (Object.prototype.hasOwnProperty.call(result.deltas, key)) {
        after[key] = asFiniteNumber(before[key] + asFiniteNumber(result.deltas[key]));
      }
    }
  }

  const resolvedTurnAfter = Number.isInteger(turnAfter)
    ? turnAfter
    : (after?.turn ?? (Number.isInteger(turnBefore) ? turnBefore : 0));
  const resolvedTurnBefore = Number.isInteger(turnBefore)
    ? turnBefore
    : (before?.turn ?? Math.max(0, resolvedTurnAfter - (result?.deltas?.turn ?? 0)));

  return {
    version: LEDGER_ENTRY_VERSION,
    seq: Number.isInteger(seq) && seq >= 1 ? seq : 1,
    turn: resolvedTurnAfter,
    turnBefore: resolvedTurnBefore,
    turnAfter: resolvedTurnAfter,
    command: safeCommand,
    appliedEffects,
    explanations,
    before,
    after,
    deltas: result?.deltas != null && typeof result.deltas === 'object'
      ? { ...result.deltas }
      : null,
    createdAt: createdAt == null ? null : String(createdAt),
  };
}

/**
 * Shape a TurnResult (from applyTurnCommand) into a ledger entry.
 */
export function ledgerEntryFromTurnResult(turnResult, { seq = 1, createdAt = null } = {}) {
  if (turnResult == null || typeof turnResult !== 'object') {
    throw new TypeError('turnResult is required');
  }
  const beforeTurn = turnResult.before?.turn;
  const afterTurn = turnResult.after?.turn;
  return shapeLedgerEntry({
    seq,
    turnBefore: Number.isInteger(beforeTurn) ? beforeTurn : 0,
    turnAfter: Number.isInteger(afterTurn) ? afterTurn : 0,
    command: turnResult.command,
    result: {
      before: turnResult.before,
      after: turnResult.after,
      deltas: turnResult.deltas,
      appliedEffects: turnResult.appliedEffects,
      explanations: turnResult.explanations,
      view: null,
    },
    createdAt,
  });
}

/**
 * Append TurnResults onto an existing ledger (offline / local engine path).
 * Returns a new array; does not mutate `ledger`.
 */
export function appendLedgerFromTurnResults(ledger, turnResults, { startSeq } = {}) {
  const prior = Array.isArray(ledger) ? ledger : [];
  const results = Array.isArray(turnResults) ? turnResults : [turnResults];
  const nextSeq = Number.isInteger(startSeq) && startSeq >= 1
    ? startSeq
    : (prior.reduce((max, entry) => Math.max(max, Number(entry?.seq) || 0), 0) + 1);
  const appended = [];
  let seq = nextSeq;
  for (const result of results) {
    if (result == null) continue;
    appended.push(ledgerEntryFromTurnResult(result, { seq }));
    seq += 1;
  }
  return [...prior, ...appended];
}

/**
 * Normalize API turn_commits rows (GET /api/campaigns/{id}/turns) into ledger
 * entries. Accepts raw commits (`result` blob) or already-shaped ledger rows.
 */
export function ledgerEntriesFromApiCommits(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (row == null || typeof row !== 'object') {
      return shapeLedgerEntry({ seq: 1, turnBefore: 0, turnAfter: 0, command: { type: 'unknown' } });
    }
    const nested = row.result != null && typeof row.result === 'object' ? row.result : null;
    const result = nested ?? {
      before: row.before,
      after: row.after,
      deltas: row.deltas,
      appliedEffects: row.appliedEffects,
      explanations: row.explanations,
      view: row.view,
    };
    return shapeLedgerEntry({
      seq: row.seq,
      turnBefore: row.turnBefore,
      turnAfter: row.turnAfter,
      command: row.command,
      result,
      createdAt: row.createdAt ?? null,
    });
  });
}

/**
 * Persistable result_json payload written into turn_commits (and returned on commit).
 */
export function ledgerResultPayload(turnResult, view = null) {
  return {
    before: turnResult.before,
    after: turnResult.after,
    deltas: turnResult.deltas,
    appliedEffects: turnResult.appliedEffects,
    explanations: turnResult.explanations,
    view,
  };
}

export function summarizeLedgerCommand(entry) {
  const type = entry?.command?.type ?? 'unknown';
  switch (type) {
    case 'set_tax':
      return `Tax → ${Math.round((Number(entry.command.taxRate) || 0) * 100)}%`;
    case 'advance_turn':
      return `Advance → turn ${entry.turnAfter}`;
    case 'apply_trigger':
      return `Event: ${entry.command.trigger?.label ?? entry.command.trigger?.id ?? 'trigger'}`;
    case 'remove_trigger':
      return `Remove event ${entry.command.triggerId}`;
    case 'clear_triggers':
      return 'Clear world events';
    case 'hire_employee':
      return `Hire ${entry.command.department ?? 'staff'}`;
    case 'compensate_torn_month':
      return `Correct month ${entry.command.month ?? '?'} burn`;
    default: {
      const neverType = type;
      return `Command: ${String(neverType)}`;
    }
  }
}
