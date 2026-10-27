import {
  TurnCommandError,
  applyTurnCommand,
  createGameState,
  normalizeGameState,
  parseTurnCommand,
  toGameStateView,
} from '../src/turnEngine.js';
import { ledgerEntriesFromApiCommits, ledgerResultPayload } from '../src/turnLedger.js';

function badRequest(message, issues = []) {
  const error = new TurnCommandError(message, issues);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  error.issues = [];
  return error;
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.issues = [];
  return error;
}

function asStatePayload(row) {
  const state = normalizeGameState({
    ...row.state_json,
    campaignId: row.id,
    turn: row.turn,
    seed: row.seed,
    ruleVersion: row.rule_version,
    stateVersion: row.state_version,
    taxRate: Number(row.tax_rate),
  });
  return {
    id: row.id,
    seed: row.seed,
    ruleVersion: row.rule_version,
    stateVersion: row.state_version,
    turn: row.turn,
    taxRate: Number(row.tax_rate),
    state,
    view: toGameStateView(state),
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

function seedFromBody(body) {
  if (body == null || body === undefined) return 'default';
  if (typeof body.seed === 'string' && body.seed.trim() !== '') return body.seed.trim().slice(0, 200);
  return 'default';
}

function initialFromBody(body) {
  const seed = seedFromBody(body);
  const partial = body?.state && typeof body.state === 'object' && !Array.isArray(body.state)
    ? body.state
    : {};
  // Never trust a caller-supplied companies-API cash confuse: seed from
  // explicit campaign state or the local Slice 1 defaults.
  return createGameState({
    ...partial,
    seed,
    campaignId: null,
    turn: Number.isInteger(partial.turn) ? partial.turn : 0,
  });
}

export async function createCampaign(pool, body = {}) {
  const state = initialFromBody(body);
  const result = await pool.query(
    `INSERT INTO campaigns (seed, rule_version, state_version, turn, tax_rate, state_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [
      state.seed ?? 'default',
      state.ruleVersion,
      state.stateVersion,
      state.turn,
      state.taxRate,
      JSON.stringify({ ...state, campaignId: null }),
    ],
  );
  const row = result.rows[0];
  const withId = normalizeGameState({ ...state, campaignId: row.id });
  await pool.query(
    `UPDATE campaigns SET state_json = $2::jsonb WHERE id = $1`,
    [row.id, JSON.stringify(withId)],
  );
  row.state_json = withId;
  return asStatePayload(row);
}

export async function getCampaign(pool, campaignId) {
  const result = await pool.query(`SELECT * FROM campaigns WHERE id = $1`, [campaignId]);
  if (result.rowCount === 0) throw notFound('Campaign not found');
  return asStatePayload(result.rows[0]);
}

export async function listTurnCommits(pool, campaignId, { limit = 50 } = {}) {
  // Most recent N by seq, returned in ascending seq order for replay/UI.
  const capped = Math.max(1, Math.min(200, Number(limit) || 50));
  const exists = await pool.query(`SELECT 1 FROM campaigns WHERE id = $1`, [campaignId]);
  if (exists.rowCount === 0) throw notFound('Campaign not found');
  const result = await pool.query(
    `SELECT seq, turn_before, turn_after, command_json, result_json, created_at
     FROM (
       SELECT seq, turn_before, turn_after, command_json, result_json, created_at
       FROM turn_commits
       WHERE campaign_id = $1
       ORDER BY seq DESC
       LIMIT $2
     ) recent
     ORDER BY seq ASC`,
    [campaignId, capped],
  );
  const rows = result.rows.map((row) => ({
    seq: row.seq,
    turnBefore: row.turn_before,
    turnAfter: row.turn_after,
    command: row.command_json,
    result: row.result_json,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  }));
  // Normalized ledger entries (same shape as offline append path).
  return ledgerEntriesFromApiCommits(rows);
}

/**
 * Atomically apply one TurnCommand. Failed commits leave no partial row.
 */
export async function commitTurn(pool, campaignId, commandBody) {
  let command;
  try {
    command = parseTurnCommand(commandBody);
  } catch (error) {
    if (error instanceof TurnCommandError) throw error;
    throw badRequest(error.message, error.issues || []);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT * FROM campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId],
    );
    if (locked.rowCount === 0) {
      await client.query('ROLLBACK');
      throw notFound('Campaign not found');
    }
    const row = locked.rows[0];
    const before = normalizeGameState({
      ...row.state_json,
      campaignId: row.id,
      turn: row.turn,
      seed: row.seed,
      ruleVersion: row.rule_version,
      stateVersion: row.state_version,
      taxRate: Number(row.tax_rate),
    });

    let turnResult;
    try {
      turnResult = applyTurnCommand(before, command);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof TurnCommandError) throw error;
      throw badRequest(error.message, error.issues || []);
    }

    const next = turnResult.state;
    const seqResult = await client.query(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM turn_commits WHERE campaign_id = $1`,
      [campaignId],
    );
    const seq = Number(seqResult.rows[0].next_seq);

    const resultPayload = ledgerResultPayload(turnResult, toGameStateView(next));
    await client.query(
      `INSERT INTO turn_commits
         (campaign_id, seq, turn_before, turn_after, command_json, result_json)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        campaignId,
        seq,
        before.turn,
        next.turn,
        JSON.stringify(command),
        JSON.stringify(resultPayload),
      ],
    );

    const updated = await client.query(
      `UPDATE campaigns
       SET turn = $2,
           tax_rate = $3,
           state_version = $4,
           rule_version = $5,
           seed = $6,
           state_json = $7::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        campaignId,
        next.turn,
        next.taxRate,
        next.stateVersion,
        next.ruleVersion,
        next.seed ?? row.seed,
        JSON.stringify({ ...next, campaignId }),
      ],
    );

    await client.query('COMMIT');
    const payload = asStatePayload(updated.rows[0]);
    return {
      ...payload,
      commit: {
        seq,
        turnBefore: before.turn,
        turnAfter: next.turn,
        command,
        before: turnResult.before,
        after: turnResult.after,
        deltas: turnResult.deltas,
        appliedEffects: turnResult.appliedEffects,
        explanations: turnResult.explanations,
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // already rolled back or connection broken
    }
    if (error?.code === '23505') throw conflict('Turn commit conflict');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Test helper: abort after computing the next state but before INSERT, to prove
 * atomicity. Not used by HTTP routes.
 */
export async function commitTurnFailBeforePersist(pool, campaignId, commandBody) {
  const command = parseTurnCommand(commandBody);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT * FROM campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId],
    );
    if (locked.rowCount === 0) {
      await client.query('ROLLBACK');
      throw notFound('Campaign not found');
    }
    const row = locked.rows[0];
    const before = normalizeGameState({
      ...row.state_json,
      campaignId: row.id,
      turn: row.turn,
      seed: row.seed,
      ruleVersion: row.rule_version,
      stateVersion: row.state_version,
      taxRate: Number(row.tax_rate),
    });
    applyTurnCommand(before, command);
    await client.query('ROLLBACK');
    return getCampaign(pool, campaignId);
  } finally {
    client.release();
  }
}
