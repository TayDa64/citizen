/**
 * Server-side real-world ingest: fixture (or http stub) → pipeline → createTrigger.
 * Network-free by default so CI stays deterministic. Firecrawl can later plug in
 * behind the same Observation → interpretation → TRIGGER_CONTRACT path.
 * Every ingestAndPersist attempt inserts an ingest_runs audit row (CIT-68).
 * CIT-69: optional campaignId (default off) restacks one campaign after a
 * changed ingest — nest filter before clear_triggers / apply_trigger.
 */

import { collectFixtureObservations, listFixtureIds } from '../src/adapters/fixtureAdapter.js';
import { collectHttpStubObservations } from '../src/adapters/httpStubAdapter.js';
import {
  activeTriggersFromRegistry,
  describePipelineEvent,
  emptyPipelineRegistry,
  ingestObservationsIntoRegistry,
} from '../src/eventPipeline.js';
import { stampTriggerJurisdictions } from '../src/jurisdictionNest.js';
import { TriggerValidationError } from '../src/triggerContract.js';
import {
  restackCampaignTriggers,
  shouldRestackAfterIngest,
} from './campaignRestack.js';
import {
  createTrigger,
  isIdenticalTriggerDocument,
  listTriggersByClientIds,
} from './triggers.js';

const CAMPAIGN_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function issue(path, code, message) {
  return { path, code, message };
}

function requestHints(request) {
  if (request == null || typeof request !== 'object' || Array.isArray(request)) {
    return { adapter: null, fixtureId: null, campaignId: null };
  }
  return {
    adapter: typeof request.adapter === 'string' ? request.adapter : null,
    fixtureId: typeof request.fixtureId === 'string' ? request.fixtureId : null,
    campaignId: typeof request.campaignId === 'string' ? request.campaignId : null,
  };
}

function parseOptionalCampaignId(input, issues) {
  if (!Object.prototype.hasOwnProperty.call(input, 'campaignId')) {
    return null;
  }
  if (input.campaignId == null) {
    return null;
  }
  if (typeof input.campaignId !== 'string' || input.campaignId.trim() === '') {
    issues.push(
      issue('campaignId', 'invalid_type', 'campaignId must be a non-empty UUID string when set'),
    );
    return null;
  }
  const campaignId = input.campaignId.trim();
  if (!CAMPAIGN_ID_RE.test(campaignId)) {
    issues.push(issue('campaignId', 'invalid_value', 'campaignId must be a UUID'));
    return null;
  }
  return campaignId;
}

export function validateIngestRequest(input) {
  if (input == null) {
    return {
      ok: true,
      value: { adapter: 'fixture', fixtureId: 'civic-wage-bulletin', campaignId: null },
    };
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      issues: [issue('', 'invalid_type', 'Ingest request must be a JSON object')],
    };
  }
  const issues = [];
  const allowed = new Set(['adapter', 'fixtureId', 'observations', 'campaignId']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      issues.push(issue(key, 'unknown_field', `Unknown field: ${key}`));
    }
  }

  const adapter = Object.prototype.hasOwnProperty.call(input, 'adapter')
    ? input.adapter
    : 'fixture';
  if (adapter !== 'fixture' && adapter !== 'http_stub') {
    issues.push(
      issue('adapter', 'invalid_value', 'adapter must be one of: fixture, http_stub'),
    );
  }

  let fixtureId = 'civic-wage-bulletin';
  if (adapter === 'fixture') {
    if (Object.prototype.hasOwnProperty.call(input, 'fixtureId')) {
      if (typeof input.fixtureId !== 'string' || input.fixtureId.trim() === '') {
        issues.push(issue('fixtureId', 'invalid_type', 'fixtureId must be a non-empty string'));
      } else if (!listFixtureIds().includes(input.fixtureId)) {
        issues.push(
          issue(
            'fixtureId',
            'invalid_value',
            `fixtureId must be one of: ${listFixtureIds().join(', ')}`,
          ),
        );
      } else {
        fixtureId = input.fixtureId;
      }
    }
    if (Object.prototype.hasOwnProperty.call(input, 'observations')) {
      issues.push(
        issue('observations', 'unknown_field', 'observations is only valid for adapter http_stub'),
      );
    }
  }

  let observations = null;
  if (adapter === 'http_stub') {
    if (!Array.isArray(input.observations)) {
      issues.push(issue('observations', 'invalid_type', 'observations must be an array'));
    } else {
      observations = input.observations;
    }
  }

  const campaignId = parseOptionalCampaignId(input, issues);

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      adapter,
      fixtureId: adapter === 'fixture' ? fixtureId : null,
      observations,
      campaignId,
    },
  };
}

export function runPipelineIngest(request) {
  const validated = validateIngestRequest(request);
  if (!validated.ok) {
    throw new TriggerValidationError('Invalid ingest request', validated.issues);
  }
  const { adapter, fixtureId, observations: stubBodies } = validated.value;
  let observations;
  switch (adapter) {
    case 'fixture':
      observations = collectFixtureObservations(fixtureId);
      break;
    case 'http_stub':
      observations = collectHttpStubObservations(stubBodies);
      break;
    default: {
      const unexpected = adapter;
      throw new Error(`Unknown ingest adapter: ${String(unexpected)}`);
    }
  }
  const { registry, activated } = ingestObservationsIntoRegistry(
    emptyPipelineRegistry(),
    observations,
  );
  return {
    adapter,
    fixtureId,
    registry,
    activated,
    triggers: activeTriggersFromRegistry(registry),
    events: registry.events.map(describePipelineEvent),
  };
}

function mapIngestRunRow(row) {
  return {
    id: row.id,
    startedAt: row.started_at?.toISOString?.() ?? row.started_at,
    finishedAt: row.finished_at?.toISOString?.() ?? row.finished_at,
    adapter: row.adapter,
    fixtureId: row.fixture_id,
    status: row.status,
    changed: row.changed,
    error: row.error,
    triggerClientIds: row.trigger_client_ids ?? [],
    result: row.result_json,
    scheduledMeetingId: row.scheduled_meeting_id ?? null,
  };
}

export async function insertIngestRun(pool, fields) {
  const result = await pool.query(
    `INSERT INTO ingest_runs (
       started_at, finished_at, adapter, fixture_id, status, changed, error,
       trigger_client_ids, result_json, scheduled_meeting_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::jsonb, $10)
     RETURNING id, started_at, finished_at, adapter, fixture_id, status, changed,
               error, trigger_client_ids, result_json, scheduled_meeting_id`,
    [
      fields.startedAt,
      fields.finishedAt,
      fields.adapter,
      fields.fixtureId,
      fields.status,
      fields.changed,
      fields.error,
      fields.triggerClientIds ?? [],
      fields.resultJson == null ? null : JSON.stringify(fields.resultJson),
      fields.scheduledMeetingId ?? null,
    ],
  );
  return mapIngestRunRow(result.rows[0]);
}

export async function listIngestRuns(pool, { limit = 50 } = {}) {
  const capped = Math.max(1, Math.min(200, Number(limit) || 50));
  const result = await pool.query(
    `SELECT id, started_at, finished_at, adapter, fixture_id, status, changed,
            error, trigger_client_ids, result_json, scheduled_meeting_id
     FROM ingest_runs
     ORDER BY started_at DESC
     LIMIT $1`,
    [capped],
  );
  return result.rows.map(mapIngestRunRow);
}

async function recordErrorRun(pool, request, startedAt, error, scheduledMeetingId = null) {
  const hints = requestHints(request);
  try {
    await insertIngestRun(pool, {
      startedAt,
      finishedAt: new Date(),
      adapter: hints.adapter,
      fixtureId: hints.fixtureId,
      status: 'error',
      changed: false,
      error: error?.message || String(error),
      triggerClientIds: [],
      scheduledMeetingId,
      resultJson: Array.isArray(error?.issues) ? { issues: error.issues } : null,
    });
  } catch (recordError) {
    console.error(recordError);
  }
}

/**
 * Persist active pipeline triggers through the existing createTrigger path
 * (same-id replace, company baseline restack — no compounding).
 * Always inserts an ingest_runs row; validation failure is status=error, not success.
 * CIT-69: when campaignId is set and changed=true, nest-filter then commitTurn
 * restack before marking the run successful. Failed restack keeps triggers and
 * records status=error (does not delete real_world_triggers).
 * CIT-81: optional scheduledMeetingId links the audit row (due-row / Phase C).
 */
export async function ingestAndPersist(pool, request, { scheduledMeetingId = null } = {}) {
  const startedAt = new Date();
  try {
    const validated = validateIngestRequest(request);
    if (!validated.ok) {
      throw new TriggerValidationError('Invalid ingest request', validated.issues);
    }
    const campaignId = validated.value.campaignId;
    const result = runPipelineIngest(request);
    // CIT-101: idempotent on source id + document timestamp — identical re-run
    // → changed=false (no createTrigger restack of companies, no campaign restack).
    const existingRows = await listTriggersByClientIds(
      pool,
      result.triggers.map((trigger) => trigger.id),
    );
    const existingById = new Map(existingRows.map((row) => [row.id, row]));
    const stored = [];
    let changed = false;
    for (const trigger of result.triggers) {
      const existing = existingById.get(trigger.id);
      if (isIdenticalTriggerDocument(existing, trigger)) {
        stored.push(existing);
        continue;
      }
      changed = true;
      stored.push(await createTrigger(pool, trigger));
    }
    const triggerClientIds = stored.map((trigger) => trigger.id);
    // CIT-80 / CIT-101: stamp known fixture jurisdictions (wage / library → mv).
    if (changed) {
      await stampTriggerJurisdictions(pool, triggerClientIds);
    }
    let restack = null;
    if (
      shouldRestackAfterIngest({
        campaignId,
        changed,
        triggerCount: stored.length,
      })
    ) {
      try {
        restack = await restackCampaignTriggers(pool, campaignId);
      } catch (restackError) {
        // Triggers stay; do not mark ingest success.
        await insertIngestRun(pool, {
          startedAt,
          finishedAt: new Date(),
          adapter: result.adapter,
          fixtureId: result.fixtureId,
          status: 'error',
          changed: false,
          error: restackError?.message || String(restackError),
          triggerClientIds,
          scheduledMeetingId,
          resultJson: {
            events: result.events,
            triggerIds: triggerClientIds,
            restackFailed: true,
            campaignId,
          },
        });
        restackError.ingestRunRecorded = true;
        throw restackError;
      }
    }
    await insertIngestRun(pool, {
      startedAt,
      finishedAt: new Date(),
      adapter: result.adapter,
      fixtureId: result.fixtureId,
      status: 'success',
      changed,
      error: null,
      triggerClientIds,
      scheduledMeetingId,
      resultJson: {
        events: result.events,
        triggerIds: triggerClientIds,
        ...(restack
          ? {
              restack: {
                campaignId: restack.campaignId,
                homeId: restack.homeId,
                appliedTriggerIds: restack.appliedTriggerIds,
              },
            }
          : {}),
      },
    });
    return {
      adapter: result.adapter,
      fixtureId: result.fixtureId,
      events: result.events,
      triggers: stored,
      changed,
      ...(restack
        ? {
            restack: {
              campaignId: restack.campaignId,
              homeId: restack.homeId,
              appliedTriggerIds: restack.appliedTriggerIds,
            },
          }
        : {}),
    };
  } catch (error) {
    if (!error?.ingestRunRecorded) {
      await recordErrorRun(pool, request, startedAt, error, scheduledMeetingId);
    }
    throw error;
  }
}
