/**
 * CIT-69 — one-campaign server restack after ingest.
 *
 * Optional campaignId (default off). When set and ingest changed with real
 * triggers: nest-filter + tier-sort, then clear_triggers + apply_trigger in
 * one transaction under the campaign row lock. Does not write companies.cash /
 * burn_rate / morale. Does not introduce RESTACK_INGEST. Peers (e.g. sunnyvale)
 * never apply to home mv.
 */

import { nestTriggersForRestack } from '../src/jurisdictionNest.js';
import { TRIGGER_TYPES } from '../src/triggerContract.js';
import { applyTurnCommand } from '../src/turnEngine.js';
import { commitTurnOnClient, withCampaignTransaction } from './campaigns.js';
import { rowsToTriggerRecords } from './triggers.js';

/**
 * Server-safe restack command list (mirrors src/turnCommands.buildTriggerRestackCommands).
 * Avoids importing turnCommands → citizenApi (Vite extensionless) from Node API tests.
 * Snapshot fields only: id / type / label / source / timestamp / effect.
 */
export function buildServerRestackCommands(activeTriggers) {
  const list = Array.isArray(activeTriggers) ? activeTriggers : [];
  return [
    { type: 'clear_triggers' },
    ...list.map((trigger) => {
      const effect = {};
      if (trigger?.effect?.hype != null) effect.hype = trigger.effect.hype;
      if (trigger?.effect?.talentCost != null) effect.talentCost = trigger.effect.talentCost;
      return {
        type: 'apply_trigger',
        trigger: {
          id: trigger.id,
          type: trigger.type,
          label: trigger.label,
          source: trigger.source,
          timestamp: trigger.timestamp,
          effect,
        },
      };
    }),
  ];
}

const TRIGGER_SELECT_WITH_JURISDICTION = `
  SELECT t.client_id,
         t.trigger_type,
         t.label,
         t.source_url,
         t.scraped_at,
         t.jurisdiction_id,
         so.name AS target_name,
         e.formula
  FROM real_world_triggers t
  JOIN effects e ON e.trigger_id = t.id AND e.is_active
  JOIN simulation_objects so ON so.id = e.target_id
  WHERE t.client_id IS NOT NULL
    AND t.trigger_type = ANY($1::text[])
`;

/**
 * Whether ingest should restack one campaign.
 * Default off: missing/empty campaignId → false.
 * changed=false or zero triggers → false (agenda-seen / empty success).
 */
export function shouldRestackAfterIngest({ campaignId = null, changed = false, triggerCount = 0 } = {}) {
  if (campaignId == null || campaignId === '') return false;
  if (changed !== true) return false;
  if (!Number.isFinite(triggerCount) || triggerCount <= 0) return false;
  return true;
}

export async function loadCampaignHomeJurisdiction(pool, campaignId) {
  const result = await pool.query(
    `SELECT home_jurisdiction_id FROM campaigns WHERE id = $1`,
    [campaignId],
  );
  if (result.rowCount === 0) {
    const error = new Error(`Campaign not found: ${campaignId}`);
    error.status = 404;
    error.code = 'campaign_not_found';
    error.issues = [];
    throw error;
  }
  return result.rows[0].home_jurisdiction_id ?? 'mv';
}

/**
 * Load contract triggers plus jurisdictionId for nest filter (not on snapshot).
 */
export async function listTriggersForRestack(pool) {
  const result = await pool.query(
    `${TRIGGER_SELECT_WITH_JURISDICTION} ORDER BY t.scraped_at DESC, t.client_id DESC, so.name ASC`,
    [TRIGGER_TYPES],
  );
  const jurisdictionByClientId = new Map();
  for (const row of result.rows) {
    if (!jurisdictionByClientId.has(row.client_id)) {
      jurisdictionByClientId.set(row.client_id, row.jurisdiction_id ?? null);
    }
  }
  return rowsToTriggerRecords(result.rows).map((record) => ({
    ...record,
    jurisdictionId: jurisdictionByClientId.get(record.id) ?? null,
  }));
}

/**
 * Nest-filter + tier-sort the live trigger stack for one campaign home.
 */
export async function applicableTriggersForCampaign(pool, campaignId) {
  const homeId = await loadCampaignHomeJurisdiction(pool, campaignId);
  const listed = await listTriggersForRestack(pool);
  return {
    homeId,
    triggers: nestTriggersForRestack(listed, homeId),
  };
}

const RESTACK_COMMAND_TYPES = new Set(['clear_triggers', 'apply_trigger']);
const STACK_CHANGE_TYPES = new Set(['clear_triggers', 'apply_trigger', 'remove_trigger']);

/**
 * Ingest runs that restacked (or tried to restack) this campaign, oldest first.
 * The only durable evidence that a clear_triggers commit came from the server
 * restack rather than from a player or the client's own restack-before-advance.
 */
async function restackRunsForCampaign(client, campaignId) {
  const result = await client.query(
    `SELECT started_at, finished_at, status
     FROM ingest_runs
     WHERE finished_at IS NOT NULL
       AND (
         (status = 'error' AND result_json->>'restackFailed' = 'true'
            AND result_json->>'campaignId' = $1)
         OR (status = 'success' AND result_json->'restack'->>'campaignId' = $1)
       )
     ORDER BY started_at ASC`,
    [campaignId],
  );
  return result.rows;
}

async function commitsForCampaign(client, campaignId) {
  const result = await client.query(
    `SELECT seq, command_json, result_json, created_at
     FROM turn_commits
     WHERE campaign_id = $1
     ORDER BY seq ASC`,
    [campaignId],
  );
  return result.rows.map((row) => ({
    seq: row.seq,
    command: row.command_json,
    result: row.result_json,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  }));
}

/** Latest apply_trigger command for `triggerId` before `seq` (it carries source/timestamp). */
function lastApplyCommandBefore(commits, seq, triggerId) {
  for (let index = commits.length - 1; index >= 0; index -= 1) {
    const commit = commits[index];
    if (commit.seq >= seq) continue;
    if (commit.command?.type === 'apply_trigger' && commit.command.trigger?.id === triggerId) {
      return commit.command;
    }
  }
  return null;
}

/**
 * Burn the month at `advance` would have been billed at had the campaign held
 * `oldStack` (the stack before the torn restack), replayed through the turn
 * engine from the GameState view recorded on the commit just before it.
 * Returns null when the ledger cannot reproduce the billed burn exactly, so a
 * guess is never charged.
 */
function counterfactualBurn(commits, advance, oldStack, clearSeq) {
  const prior = commits.find((commit) => commit.seq === advance.seq - 1);
  const view = prior?.result?.view;
  const billed = Number(advance.result?.after?.burnRate);
  if (view == null || typeof view !== 'object' || !Number.isFinite(billed)) return null;
  try {
    const replayed = applyTurnCommand(view, { type: 'advance_turn' });
    if (replayed.after.burnRate !== billed) return null;
    let restored = applyTurnCommand(view, { type: 'clear_triggers' }).state;
    for (const trigger of oldStack) {
      const apply = lastApplyCommandBefore(commits, clearSeq, trigger.id);
      if (apply == null) return null;
      restored = applyTurnCommand(restored, apply).state;
    }
    return applyTurnCommand(restored, { type: 'advance_turn' }).after.burnRate;
  } catch {
    return null;
  }
}

function stackIdsOf(view) {
  return (Array.isArray(view?.activeTriggers) ? view.activeTriggers : [])
    .map((trigger) => trigger.id)
    .sort()
    .join('\u0000');
}

/**
 * Months billed while a server restack had the campaign on a torn stack.
 *
 * Evidence: an ingest_runs row that restacked this campaign (success, or
 * error with restackFailed). Its restack commits are the clear_triggers /
 * apply_trigger commits created between started_at and finished_at. Under the
 * old per-command loop those were separate transactions, so an advance_turn
 * could land after the clear:
 *   - success run: any advance between that clear and the run's last apply;
 *   - failed run: any advance after that clear and before the next commit
 *     that changes the stack (a player or client restack ends the window,
 *     because from there the stack is someone's deliberate choice).
 * The correct bill for such a month is the stack before the clear: an atomic
 * restack either had not started (old stack) or, when it failed, left the old
 * stack in place.
 *
 * Months whose stack already equals that old stack, or whose burn the ledger
 * cannot reproduce, are skipped. Months already compensated are skipped by
 * sourceSeq, which makes the repair idempotent.
 */
export async function findTornMonths(client, campaignId) {
  const runs = await restackRunsForCampaign(client, campaignId);
  if (runs.length === 0) return [];
  const commits = await commitsForCampaign(client, campaignId);
  const compensated = new Set(
    commits
      .filter((commit) => commit.command?.type === 'compensate_torn_month')
      .map((commit) => commit.command.sourceSeq),
  );
  const torn = new Map();
  for (const run of runs) {
    const startedAt = new Date(run.started_at);
    const finishedAt = new Date(run.finished_at);
    const inRun = commits.filter((commit) =>
      RESTACK_COMMAND_TYPES.has(commit.command?.type)
      && commit.createdAt >= startedAt
      && commit.createdAt <= finishedAt);
    const clear = inRun.find((commit) => commit.command.type === 'clear_triggers');
    if (!clear) continue;
    const lastOwn = inRun[inRun.length - 1];
    let endSeq;
    if (run.status === 'success') {
      endSeq = lastOwn.seq;
    } else {
      const nextChange = commits.find((commit) =>
        commit.seq > lastOwn.seq && STACK_CHANGE_TYPES.has(commit.command?.type));
      endSeq = nextChange ? nextChange.seq : Number.POSITIVE_INFINITY;
    }
    const beforeClear = commits.find((commit) => commit.seq === clear.seq - 1);
    const oldStack = Array.isArray(beforeClear?.result?.view?.activeTriggers)
      ? beforeClear.result.view.activeTriggers
      : [];
    const oldIds = stackIdsOf({ activeTriggers: oldStack });
    for (const commit of commits) {
      if (commit.seq <= clear.seq || commit.seq >= endSeq) continue;
      if (commit.command?.type !== 'advance_turn') continue;
      if (compensated.has(commit.seq) || torn.has(commit.seq)) continue;
      const prior = commits.find((row) => row.seq === commit.seq - 1);
      if (stackIdsOf(prior?.result?.view) === oldIds) continue;
      const fullBurn = counterfactualBurn(commits, commit, oldStack, clear.seq);
      const billedBurn = Number(commit.result?.after?.burnRate);
      if (fullBurn == null || fullBurn === billedBurn) continue;
      torn.set(commit.seq, {
        type: 'compensate_torn_month',
        sourceSeq: commit.seq,
        month: Number(commit.result?.after?.turn),
        billedBurn,
        fullBurn,
      });
    }
  }
  return [...torn.values()].sort((left, right) => left.sourceSeq - right.sourceSeq);
}

/**
 * Restack one campaign from nest-filtered triggers in ONE transaction.
 *
 * The campaign row is locked first (same lock commitTurn takes), then the
 * trigger list is read, then clear_triggers + apply_trigger x N are written,
 * each with its own turn_commits row, then any torn months from the old
 * per-command loop are compensated. Any throw rolls all of it back, so the
 * campaign holds either its previous stack or the full new one. A concurrent
 * restack or advance_turn for the same campaign waits for the lock.
 * Never copies companies cash/burn into state_json.
 *
 * @returns {Promise<{ campaignId: string, homeId: string, appliedTriggerIds: string[], commitCount: number, compensatedSeqs: number[] }>}
 */
export async function restackCampaignTriggers(pool, campaignId) {
  return withCampaignTransaction(pool, campaignId, async (client) => {
    const { homeId, triggers } = await applicableTriggersForCampaign(client, campaignId);
    const commands = buildServerRestackCommands(triggers);
    for (const command of commands) {
      await commitTurnOnClient(client, campaignId, command);
    }
    const compensations = await findTornMonths(client, campaignId);
    for (const command of compensations) {
      await commitTurnOnClient(client, campaignId, command, { allowLedgerOnly: true });
    }
    return {
      campaignId,
      homeId,
      appliedTriggerIds: triggers.map((trigger) => trigger.id),
      commitCount: commands.length + compensations.length,
      compensatedSeqs: compensations.map((command) => command.sourceSeq),
    };
  });
}
