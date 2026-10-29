/**
 * CIT-107 — Allowlisted HTTPS fetch outside the API process.
 *
 * Default mode is recorded (network-off) for CI. Live HTTPS is opt-in
 * (--live / CITIZEN_ALLOWLISTED_FETCH=live) for Actions workflow_dispatch.
 * Maps into the same three-phase calendar reducer + http_stub ingest path.
 * adapter: firecrawl stays rejected.
 */

import path from 'node:path';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import {
  loadRecordedBody,
  liveFetchAllowlisted,
  mapFetchToCalendarSignal,
  mapFetchToHttpStubObservations,
  mapFetchToMinutesSignal,
  ALLOWLISTED_HTTPS_ID,
} from '../src/adapters/allowlistedHttps.js';
import {
  ALLOWLISTED_CALENDAR_URL,
  assertAllowlistedHttpsUrl,
} from '../src/sourceAllowlist.js';
import { reduceMeetingRow } from '../src/calendar/calendarReducer.js';
import {
  mvCouncilCalendar2026h2,
  seedRow3458MinutesWait,
} from '../src/calendar/fixtures.js';
import { assertLocalDatabase } from './database.js';
import { ingestAndPersist, insertIngestRun } from './eventIngest.js';
import { formatChangedLine } from './ingestOnce.js';
import { runPhaseACalendarSync } from './dueRowSweep.js';
import {
  updateScheduledMeeting,
  upsertScheduledMeeting,
} from './scheduledMeetings.js';

export const DEFAULT_FETCH_MODE = 'recorded';
export const DEFAULT_RECORDED_KIND = 'calendar';

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveAllowlistedFetchOptions(argv, env = process.env) {
  const args = Array.isArray(argv) ? argv : [];
  let mode = null;
  let kind = null;
  let apply = false;
  let ingestStub = false;
  let url = null;
  let recordedName = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--live') {
      mode = 'live';
      continue;
    }
    if (arg === '--recorded') {
      mode = 'recorded';
      continue;
    }
    if (arg === '--apply' || arg === '--apply-phase-a') {
      apply = true;
      continue;
    }
    if (arg === '--ingest-http-stub') {
      ingestStub = true;
      continue;
    }
    if (arg === '--kind') {
      const value = args[i + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-')) {
        const error = new Error('--kind requires calendar|minutes|blocked|empty');
        error.code = 'invalid_kind_flag';
        throw error;
      }
      kind = value.trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--kind=')) {
      kind = arg.slice('--kind='.length).trim();
      continue;
    }
    if (arg === '--url') {
      const value = args[i + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-')) {
        const error = new Error('--url requires an allowlisted HTTPS URL');
        error.code = 'invalid_url_flag';
        throw error;
      }
      url = value.trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--url=')) {
      url = arg.slice('--url='.length).trim();
      continue;
    }
    if (arg === '--recorded-file') {
      const value = args[i + 1];
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('-')) {
        const error = new Error('--recorded-file requires a recorded body name');
        error.code = 'invalid_recorded_flag';
        throw error;
      }
      recordedName = value.trim();
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      const error = new Error('help');
      error.code = 'help';
      throw error;
    }
    if (arg.startsWith('-')) {
      const error = new Error(`Unknown flag: ${arg}`);
      error.code = 'unknown_flag';
      throw error;
    }
  }

  const envMode =
    typeof env.CITIZEN_ALLOWLISTED_FETCH === 'string'
    && env.CITIZEN_ALLOWLISTED_FETCH.trim() !== ''
      ? env.CITIZEN_ALLOWLISTED_FETCH.trim().toLowerCase()
      : null;

  const resolvedMode = mode ?? envMode ?? DEFAULT_FETCH_MODE;
  if (resolvedMode !== 'recorded' && resolvedMode !== 'live') {
    const error = new Error('Fetch mode must be recorded|live');
    error.code = 'invalid_fetch_mode';
    throw error;
  }

  const resolvedKind = kind ?? DEFAULT_RECORDED_KIND;
  const kindToRecorded = {
    calendar: 'calendar',
    blocked: 'calendarBlocked',
    empty: 'calendarEmpty',
    minutes: 'minutes3458',
  };
  if (!kindToRecorded[resolvedKind] && !recordedName) {
    const error = new Error('--kind must be calendar|minutes|blocked|empty');
    error.code = 'invalid_kind';
    throw error;
  }

  const resolvedUrl = url ?? ALLOWLISTED_CALENDAR_URL;
  assertAllowlistedHttpsUrl(resolvedUrl);

  return {
    mode: resolvedMode,
    kind: resolvedKind,
    recordedName: recordedName ?? kindToRecorded[resolvedKind],
    url: resolvedUrl,
    apply,
    ingestStub,
  };
}

/**
 * Load envelope from recorded body or live HTTPS (outside API).
 */
export async function loadFetchEnvelope(options, { fetchImpl } = {}) {
  if (options.mode === 'recorded') {
    return loadRecordedBody(options.recordedName);
  }
  return liveFetchAllowlisted(options.url, { fetchImpl });
}

/**
 * Map envelope → calendar signal + optional http_stub observations / minutes signal.
 */
export function mapEnvelope(options, envelope) {
  if (options.kind === 'minutes' || envelope.kind === 'minutes_fetch') {
    return {
      calendarSignal: null,
      minutesSignal: mapFetchToMinutesSignal(envelope),
      observations: mapFetchToHttpStubObservations(envelope),
      envelope,
    };
  }
  return {
    calendarSignal: mapFetchToCalendarSignal(envelope),
    minutesSignal: null,
    observations: [],
    envelope,
  };
}

function printHelp(stdout = console.log) {
  stdout(`Usage: npm run fetch:allowlisted -- [options]

CIT-107 allowlisted HTTPS fetch (outside API). Default: recorded / network-off.

Options:
  --recorded          Use checked-in recorded body (default; CI-safe)
  --live              HTTPS GET allowlisted host (Actions opt-in only)
  --kind <name>       calendar | minutes | blocked | empty
  --url <https>       Allowlisted URL (default Calendar.aspx)
  --apply             Apply Phase A calendar_sync via reducer (needs DATABASE_URL)
  --ingest-http-stub  Persist mapped minutes via http_stub ingestAndPersist
  --help              Show this help

Env:
  CITIZEN_ALLOWLISTED_FETCH=recorded|live
  DATABASE_URL        Loopback Postgres when --apply / --ingest-http-stub
`);
}

/**
 * Pure offline proof: recorded/live envelope → reducer row (no DB).
 */
export function reduceWithMappedSignal(row, nowIso, mapped) {
  const signal = mapped.minutesSignal ?? mapped.calendarSignal;
  if (!signal) {
    throw new Error('No mapped signal to reduce');
  }
  return reduceMeetingRow(row, nowIso, signal);
}

/**
 * Apply mapped calendar signal through Phase A (DB).
 */
export async function applyCalendarSignal(pool, calendarSignal, nowIso) {
  return runPhaseACalendarSync(pool, {
    now: nowIso ?? mvCouncilCalendar2026h2.frozenNow,
    signal: calendarSignal,
  });
}

/**
 * Seed library minutes wait row, apply minutes signal via same reducer,
 * then persist via http_stub (not fixture / not firecrawl) when body present.
 * Blocked/empty → changed=false, pointers kept, audit row only.
 */
export async function applyMinutesPath(pool, mapped, {
  nowIso = '2026-10-20T17:00:00.000Z',
  ingestStub = true,
} = {}) {
  const startedAt = new Date();
  const seed = seedRow3458MinutesWait(0);
  const meeting = await upsertScheduledMeeting(pool, {
    ...seed,
    jurisdictionId: 'mv',
  });
  const before = { ...seed, id: meeting.id, jurisdictionId: 'mv' };
  const after = reduceMeetingRow(before, nowIso, mapped.minutesSignal);
  const saved = await updateScheduledMeeting(pool, {
    ...after,
    id: meeting.id,
    jurisdictionId: 'mv',
  });

  let ingest = null;
  if (ingestStub && mapped.observations.length > 0 && after.status === 'ingested') {
    ingest = await ingestAndPersist(
      pool,
      { adapter: 'http_stub', observations: mapped.observations },
      { scheduledMeetingId: meeting.id },
    );
  } else {
    // Blocked / empty / no observations → changed=false; do not delete pointers.
    await insertIngestRun(pool, {
      startedAt,
      finishedAt: new Date(),
      adapter: 'http_stub',
      fixtureId: after.fixtureId ?? 'mv-library-minutes-3458',
      status: 'success',
      changed: false,
      error: after.lastError,
      triggerClientIds: [],
      scheduledMeetingId: meeting.id,
      resultJson: {
        stdout: after.stdout,
        phase: after.phase,
        status: after.status,
        via: ALLOWLISTED_HTTPS_ID,
        signalOutcome: mapped.minutesSignal?.outcome ?? null,
      },
    });
    ingest = {
      adapter: 'http_stub',
      fixtureId: null,
      triggers: [],
      changed: false,
      skipped: true,
      reason: 'blocked_or_empty',
    };
  }

  return { meeting: saved, after, ingest };
}

export async function main(argv = process.argv.slice(2), {
  env = process.env,
  stdout = console.log,
  stderr = console.error,
  fetchImpl,
} = {}) {
  let options;
  try {
    options = resolveAllowlistedFetchOptions(argv, env);
  } catch (error) {
    if (error?.code === 'help') {
      printHelp(stdout);
      return { ok: true, help: true, changed: false };
    }
    stderr(error.message || String(error));
    stdout(formatChangedLine(false));
    return { ok: false, changed: false, error };
  }

  const envelope = await loadFetchEnvelope(options, { fetchImpl });
  const mapped = mapEnvelope(options, envelope);
  const signal = mapped.minutesSignal ?? mapped.calendarSignal;

  stdout(JSON.stringify({
    via: ALLOWLISTED_HTTPS_ID,
    mode: options.mode,
    kind: options.kind,
    fetchedUrl: envelope.fetchedUrl,
    signalType: signal?.type ?? null,
    signalOutcome: signal?.outcome ?? null,
    eventCount: Array.isArray(mapped.calendarSignal?.events)
      ? mapped.calendarSignal.events.length
      : null,
    observationCount: mapped.observations.length,
    empty: mapped.calendarSignal?.empty === true,
  }));

  const needsDb = options.apply || options.ingestStub;
  if (!needsDb) {
    // Offline proof: reducer only (no network beyond optional live fetch).
    if (options.kind === 'minutes' || envelope.kind === 'minutes_fetch') {
      const row = seedRow3458MinutesWait(0);
      const after = reduceWithMappedSignal(row, '2026-10-20T17:00:00.000Z', mapped);
      const changed = after.changed === true && after.status === 'ingested';
      stdout(formatChangedLine(changed));
      return {
        ok: true,
        changed,
        mapped,
        after,
        mode: options.mode,
      };
    }
    const row = {
      sourceId: 'legistar:mountainview',
      externalEventId: '3367',
      kind: 'meeting',
      startsAt: '2026-10-28T00:15:00.000Z',
      timezone: 'America/Los_Angeles',
      nextCheckAt: '2026-10-23T16:00:00.000Z',
      phase: 'A',
      status: 'scheduled',
      fixtureId: 'mv-council-calendar-2026h2',
      expectedUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3367',
      agendaUrl: null,
      agendaPublishedAt: null,
      minutesUrl: null,
      minutesPublishedAt: null,
      observedSourceUrl: null,
      lastError: null,
      backoffIndex: 0,
      horizonDays: 60,
      bodyName: 'City Council',
      changed: false,
      stdout: null,
    };
    const after = reduceWithMappedSignal(
      row,
      mvCouncilCalendar2026h2.frozenNow,
      mapped,
    );
    // Blocked/empty calendar → changed=false (no delete of pointers).
    const changed = after.changed === true;
    stdout(formatChangedLine(changed));
    return {
      ok: true,
      changed,
      mapped,
      after,
      mode: options.mode,
    };
  }

  assertLocalDatabase(env.DATABASE_URL);
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  try {
    if (options.apply && mapped.calendarSignal) {
      const phaseA = await applyCalendarSignal(pool, mapped.calendarSignal);
      // Phase A identity sync never emits triggers; changed stays false.
      stdout(formatChangedLine(false));
      return {
        ok: true,
        changed: false,
        mapped,
        phaseA,
        mode: options.mode,
      };
    }

    if (options.ingestStub) {
      const result = await applyMinutesPath(pool, mapped, {
        ingestStub: true,
      });
      const changed = result.ingest?.changed === true;
      stdout(formatChangedLine(changed));
      return {
        ok: true,
        changed,
        mapped,
        result,
        mode: options.mode,
      };
    }

    stdout(formatChangedLine(false));
    return { ok: true, changed: false, mapped, mode: options.mode };
  } finally {
    await pool.end();
  }
}

const isDirect = import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href
  || process.argv[1]?.endsWith('allowlistedFetch.js');

if (isDirect) {
  main().then((result) => {
    process.exitCode = result?.ok === false ? 1 : 0;
  }).catch((error) => {
    console.error(error);
    console.log(formatChangedLine(false));
    process.exitCode = 1;
  });
}
