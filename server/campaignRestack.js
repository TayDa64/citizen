/**
 * CIT-69 — one-campaign server restack after ingest.
 *
 * Optional campaignId (default off). When set and ingest changed with real
 * triggers: nest-filter + tier-sort, then clear_triggers + apply_trigger via
 * commitTurn. Does not write companies.cash / burn_rate / morale. Does not
 * introduce RESTACK_INGEST. Peers (e.g. sunnyvale) never apply to home mv.
 */

import { nestTriggersForRestack } from '../src/jurisdictionNest.js';
import { TRIGGER_TYPES } from '../src/triggerContract.js';
import { commitTurn, getCampaign } from './campaigns.js';
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

/**
 * Restack one campaign from nest-filtered triggers.
 * Reuses clear_triggers then apply_trigger (no RESTACK_INGEST).
 * Never copies companies cash/burn into state_json.
 *
 * @returns {Promise<{ campaignId: string, homeId: string, appliedTriggerIds: string[], commitCount: number }>}
 */
export async function restackCampaignTriggers(pool, campaignId) {
  const { homeId, triggers } = await applicableTriggersForCampaign(pool, campaignId);
  const commands = buildServerRestackCommands(triggers);
  for (const command of commands) {
    await commitTurn(pool, campaignId, command);
  }
  // Confirm campaign still readable; does not pull companies.cash.
  await getCampaign(pool, campaignId);
  return {
    campaignId,
    homeId,
    appliedTriggerIds: triggers.map((trigger) => trigger.id),
    commitCount: commands.length,
  };
}
