/**
 * CIT-81 — Phase A calendar sync + due-row sweep.
 *
 * Fixture signals only (no live Legistar / Firecrawl). Host loopback DB.
 * Applies the pure calendar reducer; writes ingest_runs every attempt.
 * Calls ingestAndPersist (+ optional CIT-69 restack) only when Phase C
 * actually persists triggers (publication wage body). Agenda-seen / empty /
 * blocked → changed=false, no commitTurn. 60d unchanged stays closed.
 */

import path from 'node:path';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import {
  reduceMeetingRow,
  mvCouncilAgenda3367,
  mvCouncilCalendar2026h2,
  mvCouncilMinutes3363,
  mvCouncilMorning3367,
  mvLibraryMinutes3458,
  civicWageBulletinPublication,
  TERMINAL_STATUSES,
} from '../src/calendar/index.js';
import { assertLocalDatabase } from './database.js';
import { formatChangedLine } from './ingestOnce.js';
import { ingestAndPersist, insertIngestRun } from './eventIngest.js';
import {
  listDueScheduledMeetings,
  seedPhaseAFromMvCouncilFixture,
  seedWagePublicationRow,
  updateScheduledMeeting,
  upsertScheduledMeeting,
} from './scheduledMeetings.js';

const CAMPAIGN_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pick a fixture signal for a due row. Tests may pass an override map.
 * Wall-clock Actions compare `now` to fixture frozen stamps where needed.
 */
export function resolveFixtureSignal(row, nowIso, overrides = null) {
  if (overrides && typeof overrides === 'object') {
    const byId = overrides[row.id] ?? overrides[row.externalEventId] ?? overrides['*'];
    if (byId) return byId;
  }

  if (row.kind === 'publication' || row.fixtureId === 'civic-wage-bulletin') {
    if (Date.parse(nowIso) < Date.parse(row.startsAt)) {
      return civicWageBulletinPublication.signalEmpty;
    }
    return civicWageBulletinPublication.signalBody;
  }

  const status = row.status;
  const externalEventId = String(row.externalEventId);

  if (status === 'scheduled' || status === 'agenda_due') {
    // Agenda window: empty before first-post stamp; first then revised.
    if (Date.parse(nowIso) < Date.parse(mvCouncilAgenda3367.frozenNowFirstPost)) {
      return mvCouncilAgenda3367.signalEmpty;
    }
    if (Date.parse(nowIso) >= Date.parse(mvCouncilAgenda3367.frozenNowRevised)) {
      return mvCouncilAgenda3367.signalRevised;
    }
    return mvCouncilAgenda3367.signalFirst;
  }

  if (status === 'agenda_seen') {
    return mvCouncilMorning3367.signalStillOn;
  }

  if (status === 'confirmed' || status === 'minutes_wait') {
    if (externalEventId === '3363' || row.fixtureId === 'mv-council-minutes-3363') {
      return mvCouncilMinutes3363.signalFinalNullFile;
    }
    if (externalEventId === '3458' || row.fixtureId === 'mv-library-minutes-3458') {
      if (Date.parse(nowIso) >= Date.parse(mvLibraryMinutes3458.frozenNowFile)) {
        return mvLibraryMinutes3458.signalFile;
      }
      return mvLibraryMinutes3458.signalTPlus1Empty;
    }
    // Default meeting minutes: empty wait (no false ingest).
    return {
      type: 'minutes_check',
      outcome: 'empty',
      fixtureId: row.fixtureId ?? 'mv-council-minutes-default',
    };
  }

  // Phase A refresh path (rare in due sweep): calendar sync ok for identity.
  return {
    ...mvCouncilCalendar2026h2.signalOk,
    events: mvCouncilCalendar2026h2.events,
  };
}

function stripReducerMeta(row) {
  const {
    changed: _changed,
    stdout: _stdout,
    id,
    jurisdictionId,
    ...rest
  } = row;
  return { ...rest, id, jurisdictionId };
}

/**
 * Whether this reducer result should call ingestAndPersist for triggers.
 * Only publication wage body with ingested status emits the burn pack.
 */
export function shouldPersistTriggers(before, after) {
  if (after.status !== 'ingested') return false;
  if (before.kind !== 'publication' && after.kind !== 'publication') return false;
  if (after.fixtureId !== 'civic-wage-bulletin') return false;
  if (after.stdout !== 'publication=ingested') return false;
  return true;
}

/**
 * Agenda-seen / empty / blocked / minutes wait → no commitTurn.
 * Trigger-level changed drives restack (inside ingestAndPersist).
 */
export function shouldCommitTurnFromSweep({ triggerChanged = false, triggerCount = 0 } = {}) {
  return triggerChanged === true && triggerCount > 0;
}

async function recordSweepRun(pool, {
  startedAt,
  meetingId,
  fixtureId,
  status,
  changed,
  error = null,
  triggerClientIds = [],
  resultJson = null,
  adapter = 'fixture',
}) {
  return insertIngestRun(pool, {
    startedAt,
    finishedAt: new Date(),
    adapter,
    fixtureId,
    status,
    changed,
    error,
    triggerClientIds,
    resultJson,
    scheduledMeetingId: meetingId,
  });
}

/**
 * Apply one due row: reduce → persist → optional Phase C ingest/restack.
 */
export async function processDueMeeting(pool, row, nowIso, {
  signal = null,
  campaignId = null,
  signalOverrides = null,
} = {}) {
  const startedAt = new Date();
  const resolved = signal ?? resolveFixtureSignal(row, nowIso, signalOverrides);
  const after = reduceMeetingRow(stripReducerMeta(row), nowIso, resolved);
  const saved = await updateScheduledMeeting(pool, {
    ...after,
    id: row.id,
    jurisdictionId: row.jurisdictionId,
  });

  const stdout = after.stdout;
  const fixtureId = after.fixtureId ?? resolved.fixtureId ?? row.fixtureId;

  // Terminal unchanged (60d) stays closed — reducer already latched.
  if (TERMINAL_STATUSES.has(after.status) && after.status === 'unchanged') {
    await recordSweepRun(pool, {
      startedAt,
      meetingId: row.id,
      fixtureId,
      status: 'success',
      changed: false,
      resultJson: { stdout, phase: after.phase, status: after.status, horizonClosed: true },
    });
    return {
      meeting: saved,
      stdout,
      triggerChanged: false,
      triggers: [],
      restack: null,
      ingestRunChanged: false,
    };
  }

  if (shouldPersistTriggers(row, after)) {
    try {
      const request = {
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      };
      if (campaignId) request.campaignId = campaignId;
      const ingest = await ingestAndPersist(pool, request, {
        scheduledMeetingId: row.id,
      });
      const triggerChanged = ingest.triggers.length > 0;
      return {
        meeting: saved,
        stdout,
        triggerChanged,
        triggers: ingest.triggers,
        restack: ingest.restack ?? null,
        ingestRunChanged: triggerChanged,
      };
    } catch (error) {
      // Meeting row already advanced; audit error without deleting pointers.
      await recordSweepRun(pool, {
        startedAt,
        meetingId: row.id,
        fixtureId,
        status: 'error',
        changed: false,
        error: error?.message || String(error),
        resultJson: { stdout, phase: after.phase, status: after.status },
      });
      throw error;
    }
  }

  // Phase A/B and empty/blocked/minutes Phase C: audit only, changed=false.
  await recordSweepRun(pool, {
    startedAt,
    meetingId: row.id,
    fixtureId,
    status: 'success',
    changed: false,
    resultJson: {
      stdout,
      phase: after.phase,
      status: after.status,
      signalType: resolved.type,
      signalOutcome: resolved.outcome ?? null,
    },
  });

  return {
    meeting: saved,
    stdout,
    triggerChanged: false,
    triggers: [],
    restack: null,
    ingestRunChanged: false,
  };
}

/**
 * Sweep due rows at frozen or wall-clock `now`.
 */
export async function sweepDueRows(pool, {
  now = new Date().toISOString(),
  campaignId = null,
  signalOverrides = null,
} = {}) {
  const nowIso = new Date(now).toISOString();
  const client = await pool.connect();
  const results = [];
  try {
    await client.query('BEGIN');
    const due = await listDueScheduledMeetings(client, nowIso, { forUpdate: true });
    await client.query('COMMIT');
    for (const row of due) {
      // Process outside the lock transaction so ingest/restack can use the pool.
      // Status + next_check_at update acts as the latch for the next sweep.
      const outcome = await processDueMeeting(pool, row, nowIso, {
        campaignId,
        signalOverrides,
      });
      results.push(outcome);
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  } finally {
    client.release();
  }

  const anyTriggerChanged = results.some((r) => r.triggerChanged);
  return {
    now: nowIso,
    processed: results.length,
    changed: anyTriggerChanged,
    results,
  };
}

/**
 * Weekly Phase A: upsert MV council calendar identity rows, then apply calendar_sync.
 */
export async function runPhaseACalendarSync(pool, {
  now = mvCouncilCalendar2026h2.frozenNow,
  signal = null,
} = {}) {
  const nowIso = new Date(now).toISOString();
  const { upserted, fixtureId } = await seedPhaseAFromMvCouncilFixture(pool);
  const syncSignal = signal ?? {
    type: 'calendar_sync',
    outcome: 'ok',
    fixtureId,
    events: mvCouncilCalendar2026h2.events,
  };

  const results = [];
  for (const row of upserted) {
    const startedAt = new Date();
    const after = reduceMeetingRow(stripReducerMeta(row), nowIso, syncSignal);
    const saved = await updateScheduledMeeting(pool, {
      ...after,
      id: row.id,
      jurisdictionId: row.jurisdictionId,
    });
    await recordSweepRun(pool, {
      startedAt,
      meetingId: row.id,
      fixtureId,
      status: 'success',
      changed: false,
      resultJson: {
        stdout: after.stdout,
        phase: after.phase,
        status: after.status,
        clock: 'phase_a',
      },
    });
    results.push({ meeting: saved, stdout: after.stdout });
  }

  return {
    now: nowIso,
    fixtureId,
    upserted: results.length,
    changed: false,
    results,
  };
}

export function resolveSweepOptions(argv, env = process.env) {
  const args = Array.isArray(argv) ? argv : [];
  let mode = null;
  let now = null;
  let campaignId = null;
  let seedWage = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      const error = new Error('help');
      error.code = 'help';
      throw error;
    }
    if (arg === '--phase-a' || arg === '--phaseA') {
      mode = 'phase_a';
      continue;
    }
    if (arg === '--due' || arg === '--sweep') {
      mode = 'due';
      continue;
    }
    if (arg === '--seed-wage') {
      seedWage = true;
      continue;
    }
    if (arg === '--now') {
      const value = args[i + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-')) {
        const error = new Error('--now requires an ISO-8601 timestamp');
        error.code = 'invalid_now';
        throw error;
      }
      now = new Date(value.trim()).toISOString();
      if (Number.isNaN(Date.parse(now))) {
        const error = new Error('--now must be a valid ISO-8601 timestamp');
        error.code = 'invalid_now';
        throw error;
      }
      i += 1;
      continue;
    }
    if (arg.startsWith('--now=')) {
      now = new Date(arg.slice('--now='.length).trim()).toISOString();
      if (Number.isNaN(Date.parse(now))) {
        const error = new Error('--now must be a valid ISO-8601 timestamp');
        error.code = 'invalid_now';
        throw error;
      }
      continue;
    }
    if (arg === '--campaign' || arg === '--campaign-id') {
      const value = args[i + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-')) {
        const error = new Error(`${arg} requires a campaign UUID`);
        error.code = 'invalid_campaign_flag';
        throw error;
      }
      campaignId = value.trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--campaign=') || arg.startsWith('--campaign-id=')) {
      campaignId = arg.slice(arg.indexOf('=') + 1).trim();
      continue;
    }
    if (arg.startsWith('-')) {
      const error = new Error(`Unknown flag: ${arg}`);
      error.code = 'unknown_flag';
      throw error;
    }
  }

  if (!mode) {
    const fromEnv = typeof env.CALENDAR_CLOCK_MODE === 'string'
      ? env.CALENDAR_CLOCK_MODE.trim()
      : '';
    if (fromEnv === 'phase_a' || fromEnv === 'due') mode = fromEnv;
  }
  if (!mode) {
    const error = new Error('Specify --phase-a or --due');
    error.code = 'missing_mode';
    throw error;
  }

  if (campaignId != null && !CAMPAIGN_ID_RE.test(campaignId)) {
    const error = new Error('campaignId must be a UUID');
    error.code = 'invalid_campaign_flag';
    throw error;
  }

  if (!now && typeof env.CALENDAR_CLOCK_NOW === 'string' && env.CALENDAR_CLOCK_NOW.trim()) {
    now = new Date(env.CALENDAR_CLOCK_NOW.trim()).toISOString();
  }

  return { mode, now, campaignId, seedWage };
}

export function helpText() {
  return [
    'Usage: npm run calendar:clock -- --phase-a|--due [--now <iso>] [--campaign <uuid>] [--seed-wage]',
    '',
    'Phase A: weekly MV council calendar upsert + calendar_sync (fixture signals).',
    'Due: twice-daily sweep of next_check_at <= now (fixture signals; no network).',
    'Optional --campaign restacks one campaign only when Phase C publication ingest changed=true.',
    'Requires DATABASE_URL pointing at local Postgres (migrations through 007).',
    'Stdout: changed=true|false',
    'GitHub Actions: weekly Phase A + twice-daily due at minute :12, plus workflow_dispatch.',
  ].join('\n');
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = resolveSweepOptions(argv, env);
  } catch (error) {
    if (error?.code === 'help') {
      console.log(helpText());
      return 0;
    }
    console.error(error.message);
    console.log(formatChangedLine(false));
    return 1;
  }

  const databaseUrl = env.DATABASE_URL;
  try {
    assertLocalDatabase(databaseUrl);
  } catch (error) {
    console.error(error.message);
    console.log(formatChangedLine(false));
    return 1;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  try {
    if (options.seedWage) {
      await seedWagePublicationRow(pool);
    }
    if (options.mode === 'phase_a') {
      const result = await runPhaseACalendarSync(pool, {
        now: options.now ?? mvCouncilCalendar2026h2.frozenNow,
      });
      console.log(formatChangedLine(result.changed));
      return 0;
    }
    const result = await sweepDueRows(pool, {
      now: options.now ?? new Date().toISOString(),
      campaignId: options.campaignId,
    });
    console.log(formatChangedLine(result.changed));
    return 0;
  } catch (error) {
    console.error(error.message);
    console.log(formatChangedLine(false));
    return 1;
  } finally {
    await pool.end();
  }
}

if (isDirectRun()) {
  main().then((code) => {
    process.exit(code);
  });
}

export { main as runCalendarClockCli, upsertScheduledMeeting };
