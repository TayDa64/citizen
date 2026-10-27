/**
 * Pure three-phase calendar reducer: (row, now, signal) → row.
 *
 * No sockets, no DB, no ingestAndPersist. Tests freeze `now` and pass fixture signals.
 * Wave-2 clock: A calendar sync → B agenda/morning → C minutes/publication.
 */

import {
  DEFAULT_SOURCE_ID,
  DEFAULT_TIMEZONE,
  MEETING_KINDS,
  MEETING_STATUSES,
  MINUTES_HORIZON_DAYS,
  TERMINAL_STATUSES,
} from './constants.js';
import {
  agendaWindowInstants,
  horizonInstant,
  isPastHorizon,
  minutesBackoffCheckAt,
  morningAfterMeeting,
  morningOfMeeting,
} from './scheduleMath.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertIso(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO-8601 string`);
  }
  return new Date(value).toISOString();
}

function cloneRow(row) {
  return structuredClone(row);
}

function withMeta(row, patch) {
  return {
    ...row,
    ...patch,
    changed: patch.changed === true,
  };
}

/**
 * Build an in-memory meeting/publication row (future scheduled_meetings shape, no uuid/db).
 */
export function createMeetingRow(input = {}) {
  if (!isPlainObject(input)) {
    throw new TypeError('createMeetingRow requires an object');
  }
  const kind = input.kind ?? 'meeting';
  if (!MEETING_KINDS.includes(kind)) {
    throw new TypeError(`kind must be one of ${MEETING_KINDS.join(', ')}`);
  }
  const status = input.status ?? 'scheduled';
  if (!MEETING_STATUSES.includes(status)) {
    throw new TypeError(`status must be one of ${MEETING_STATUSES.join(', ')}`);
  }
  const startsAt = assertIso(input.startsAt, 'startsAt');
  const timeZone = typeof input.timezone === 'string' && input.timezone
    ? input.timezone
    : DEFAULT_TIMEZONE;
  const phase = input.phase ?? (kind === 'publication' ? 'A' : 'A');
  const nextCheckAt = input.nextCheckAt
    ? assertIso(input.nextCheckAt, 'nextCheckAt')
    : kind === 'publication'
      ? startsAt
      : agendaWindowInstants(startsAt, timeZone).first;

  return {
    sourceId: input.sourceId ?? DEFAULT_SOURCE_ID,
    externalEventId: String(input.externalEventId ?? ''),
    kind,
    startsAt,
    timezone: timeZone,
    nextCheckAt,
    phase,
    status,
    fixtureId: input.fixtureId ?? null,
    expectedUrl: input.expectedUrl ?? null,
    agendaUrl: input.agendaUrl ?? null,
    agendaPublishedAt: input.agendaPublishedAt ?? null,
    minutesUrl: input.minutesUrl ?? null,
    minutesPublishedAt: input.minutesPublishedAt ?? null,
    observedSourceUrl: input.observedSourceUrl ?? null,
    lastError: input.lastError ?? null,
    backoffIndex: Number.isFinite(input.backoffIndex) ? input.backoffIndex : 0,
    horizonDays: Number.isFinite(input.horizonDays) ? input.horizonDays : MINUTES_HORIZON_DAYS,
    bodyName: input.bodyName ?? null,
    changed: false,
    stdout: null,
  };
}

export function createPublicationRow(input = {}) {
  return createMeetingRow({
    ...input,
    kind: 'publication',
    phase: input.phase ?? 'A',
    status: input.status ?? 'scheduled',
    sourceId: input.sourceId ?? 'fixture:civic-wage-bulletin',
  });
}

function stayBlocked(row, error, stdout) {
  return withMeta(cloneRow(row), {
    lastError: error ?? row.lastError ?? 'blocked',
    changed: false,
    stdout: stdout ?? 'blocked',
  });
}

function stayUnchangedRow(row, stdout = null) {
  return withMeta(cloneRow(row), {
    changed: false,
    stdout,
    lastError: null,
  });
}

/** Terminal latch: cancelled | ingested | unchanged never reopen (user sign-off on 60d). */
function reduceTerminal(row, signal) {
  if (row.status === 'ingested') {
    return withMeta(cloneRow(row), {
      changed: false,
      stdout: 'ingested_replay',
      lastError: signal?.error ?? null,
    });
  }
  if (row.status === 'unchanged') {
    // Stay closed even if a later minutes file appears.
    return withMeta(cloneRow(row), {
      changed: false,
      stdout: 'unchanged_closed',
      lastError: null,
    });
  }
  // cancelled
  return withMeta(cloneRow(row), {
    changed: false,
    stdout: 'cancelled',
    lastError: null,
  });
}

function reduceCalendarSync(row, now, signal) {
  if (signal.outcome === 'blocked') {
    return stayBlocked(row, signal.error ?? 'calendar_blocked', 'calendar=blocked');
  }
  if (signal.outcome !== 'ok') {
    throw new TypeError(`calendar_sync outcome must be ok|blocked, got ${signal.outcome}`);
  }

  const next = cloneRow(row);
  const eventId = row.externalEventId;
  const events = Array.isArray(signal.events) ? signal.events : [];
  const match = events.find((e) => String(e.externalEventId) === String(eventId));

  if (!match) {
    // Successful sync that omits a stored future meeting is cancellation only on morning_check.
    // Phase A refresh that cannot find the event leaves identity; mark error for visibility.
    return withMeta(next, {
      lastError: 'event_missing_on_calendar_sync',
      changed: false,
      stdout: 'calendar=missing',
      phase: 'A',
    });
  }

  const startsAt = assertIso(match.startsAt ?? row.startsAt, 'event.startsAt');
  const windows = agendaWindowInstants(startsAt, row.timezone);
  return withMeta(next, {
    startsAt,
    bodyName: match.bodyName ?? row.bodyName,
    expectedUrl: match.detailUrl ?? row.expectedUrl,
    nextCheckAt: windows.first,
    phase: 'A',
    status: 'scheduled',
    lastError: null,
    changed:
      startsAt !== row.startsAt
      || (match.detailUrl && match.detailUrl !== row.expectedUrl)
      || row.status !== 'scheduled',
    stdout: 'calendar=upserted',
    fixtureId: signal.fixtureId ?? row.fixtureId,
  });
}

function agendaPointerChanged(row, agendaUrl, agendaPublishedAt) {
  if (agendaUrl && agendaUrl !== row.agendaUrl) return true;
  if (agendaPublishedAt && agendaPublishedAt !== row.agendaPublishedAt) return true;
  return false;
}

function reduceAgendaCheck(row, now, signal) {
  if (row.kind === 'publication') {
    return stayUnchangedRow(row, 'agenda=skipped_publication');
  }
  if (signal.outcome === 'blocked') {
    return stayBlocked(row, signal.error ?? 'agenda_blocked', 'agenda=blocked');
  }

  const next = cloneRow(row);
  next.phase = 'B';
  if (next.status === 'scheduled') {
    next.status = 'agenda_due';
  }

  if (signal.outcome === 'empty' || (!signal.agendaUrl && !signal.agendaPublishedAt)) {
    const windows = agendaWindowInstants(row.startsAt, row.timezone);
    const laterDue = Date.parse(now) < Date.parse(windows.later);
    return withMeta(next, {
      status: 'agenda_due',
      nextCheckAt: laterDue ? windows.later : morningOfMeeting(row.startsAt, row.timezone),
      lastError: null,
      changed: row.status !== 'agenda_due',
      stdout: 'agenda=pending',
    });
  }

  if (signal.outcome !== 'ok') {
    throw new TypeError(`agenda_check outcome must be ok|blocked|empty, got ${signal.outcome}`);
  }

  const agendaUrl = signal.agendaUrl ?? null;
  const agendaPublishedAt = signal.agendaPublishedAt
    ? assertIso(signal.agendaPublishedAt, 'agendaPublishedAt')
    : null;
  const moved = agendaPointerChanged(row, agendaUrl, agendaPublishedAt);
  const revised = typeof signal.agendaStatus === 'string'
    && /revised/i.test(signal.agendaStatus);

  return withMeta(next, {
    status: 'agenda_seen',
    agendaUrl,
    agendaPublishedAt,
    nextCheckAt: morningOfMeeting(row.startsAt, row.timezone),
    lastError: null,
    changed: moved || row.status !== 'agenda_seen',
    stdout: revised || (moved && row.agendaUrl) ? 'agenda=revised' : 'agenda=seen',
  });
}

function reduceMorningCheck(row, now, signal) {
  if (row.kind === 'publication') {
    return stayUnchangedRow(row, 'meeting=skipped_publication');
  }
  if (signal.outcome === 'blocked') {
    // Never cancel on blocked fetch.
    return stayBlocked(row, signal.error ?? 'morning_blocked', 'meeting=blocked');
  }

  const next = cloneRow(row);
  next.phase = 'B';

  if (signal.outcome === 'absent') {
    return withMeta(next, {
      status: 'cancelled',
      phase: 'B',
      nextCheckAt: now,
      lastError: null,
      changed: true,
      stdout: 'meeting=cancelled',
    });
  }

  if (signal.outcome === 'moved') {
    const startsAt = assertIso(signal.startsAt ?? row.startsAt, 'moved.startsAt');
    const windows = agendaWindowInstants(startsAt, row.timezone);
    return withMeta(next, {
      startsAt,
      status: 'scheduled',
      phase: 'A',
      nextCheckAt: windows.first,
      agendaUrl: null,
      agendaPublishedAt: null,
      backoffIndex: 0,
      lastError: null,
      changed: true,
      stdout: 'meeting=moved',
    });
  }

  if (signal.outcome !== 'still_on') {
    throw new TypeError(
      `morning_check outcome must be still_on|moved|absent|blocked, got ${signal.outcome}`,
    );
  }

  return withMeta(next, {
    status: 'confirmed',
    phase: 'B',
    nextCheckAt: morningAfterMeeting(row.startsAt, row.timezone),
    lastError: null,
    changed: row.status !== 'confirmed',
    stdout: 'meeting=still_on',
  });
}

function minutesArtifactPresent(signal) {
  if (signal.mediaOnly === true) return false;
  const hasUrl = typeof signal.minutesUrl === 'string' && signal.minutesUrl.trim() !== '';
  const hasTs = typeof signal.minutesPublishedAt === 'string'
    && !Number.isNaN(Date.parse(signal.minutesPublishedAt));
  return hasUrl || hasTs;
}

function closeUnchanged(row, now) {
  return withMeta(cloneRow(row), {
    status: 'unchanged',
    phase: 'C',
    nextCheckAt: now,
    lastError: null,
    changed: true,
    stdout: 'minutes=unchanged',
  });
}

function advanceMinutesBackoff(row, now) {
  const nextIndex = (Number(row.backoffIndex) || 0) + 1;
  const nextAt = minutesBackoffCheckAt(row.startsAt, row.timezone, nextIndex);
  if (isPastHorizon(row.startsAt, nextAt, row.horizonDays) || isPastHorizon(row.startsAt, now, row.horizonDays)) {
    return closeUnchanged(row, now);
  }
  return withMeta(cloneRow(row), {
    status: 'minutes_wait',
    phase: 'C',
    backoffIndex: nextIndex,
    nextCheckAt: nextAt,
    lastError: null,
    changed: row.status !== 'minutes_wait',
    stdout: 'minutes=wait',
  });
}

function reduceMinutesCheck(row, now, signal) {
  if (row.kind === 'publication') {
    return stayUnchangedRow(row, 'minutes=skipped_publication');
  }

  const priorStatus = row.status;
  const current = cloneRow(row);
  if (current.status === 'confirmed') {
    current.status = 'minutes_wait';
    current.phase = 'C';
    current.backoffIndex = 0;
  }
  if (current.status !== 'minutes_wait') {
    throw new TypeError(`minutes_check requires confirmed|minutes_wait, got ${priorStatus}`);
  }
  current.phase = 'C';

  if (isPastHorizon(current.startsAt, now, current.horizonDays)) {
    return closeUnchanged(current, now);
  }

  if (signal.outcome === 'blocked') {
    // Never change status / never delete pointers; stay due for retry.
    return withMeta(current, {
      status: 'minutes_wait',
      lastError: signal.error ?? 'minutes_blocked',
      changed: false,
      stdout: 'minutes=blocked',
    });
  }

  if (signal.outcome === 'empty' || signal.mediaOnly === true || !minutesArtifactPresent(signal)) {
    // Final + null file, media-only, or T+1 miss → stay minutes_wait (or horizon).
    // changed=false when already waiting (wave2: T+1 miss is changed=false).
    const advanced = advanceMinutesBackoff(current, now);
    if (advanced.status === 'unchanged') return advanced;
    return withMeta(advanced, {
      changed: priorStatus !== 'minutes_wait',
      stdout: signal.mediaOnly ? 'minutes=media_only' : 'minutes=wait',
      minutesUrl: current.minutesUrl,
      minutesPublishedAt: current.minutesPublishedAt,
      agendaUrl: current.agendaUrl,
      agendaPublishedAt: current.agendaPublishedAt,
    });
  }

  if (signal.outcome !== 'ok') {
    throw new TypeError(`minutes_check outcome must be ok|blocked|empty, got ${signal.outcome}`);
  }

  const minutesUrl = signal.minutesUrl ?? null;
  const minutesPublishedAt = signal.minutesPublishedAt
    ? assertIso(signal.minutesPublishedAt, 'minutesPublishedAt')
    : null;

  return withMeta(current, {
    status: 'ingested',
    phase: 'C',
    minutesUrl,
    minutesPublishedAt,
    observedSourceUrl: minutesUrl ?? current.observedSourceUrl,
    nextCheckAt: now,
    lastError: null,
    changed: true,
    stdout: 'minutes=ingested',
  });
}

function reducePublicationCheck(row, now, signal) {
  if (row.kind !== 'publication') {
    return stayUnchangedRow(row, 'publication=skipped_meeting');
  }

  if (signal.outcome === 'blocked') {
    return stayBlocked(row, signal.error ?? 'publication_blocked', 'publication=blocked');
  }

  const releaseAt = row.startsAt;
  if (Date.parse(now) < Date.parse(releaseAt)) {
    return withMeta(cloneRow(row), {
      status: 'scheduled',
      phase: 'A',
      nextCheckAt: releaseAt,
      changed: false,
      stdout: 'publication=too_early',
      lastError: null,
    });
  }

  // Phase C at or after observedAt / release clock.
  if (signal.outcome === 'empty' || signal.bodyPresent === false) {
    return withMeta(cloneRow(row), {
      status: 'minutes_wait',
      phase: 'C',
      nextCheckAt: now,
      changed: row.status !== 'minutes_wait',
      stdout: 'publication=wait',
      lastError: null,
    });
  }

  if (signal.outcome !== 'ok' || signal.bodyPresent !== true) {
    throw new TypeError('publication_check ok requires bodyPresent=true');
  }

  const observedAt = signal.observedAt
    ? assertIso(signal.observedAt, 'observedAt')
    : now;
  const sourceUrl = typeof signal.sourceUrl === 'string' ? signal.sourceUrl : row.expectedUrl;

  return withMeta(cloneRow(row), {
    status: 'ingested',
    phase: 'C',
    observedSourceUrl: sourceUrl,
    minutesPublishedAt: observedAt,
    nextCheckAt: now,
    lastError: null,
    changed: true,
    stdout: 'publication=ingested',
    fixtureId: signal.fixtureId ?? row.fixtureId,
  });
}

/**
 * @param {object} row meeting/publication row
 * @param {string} nowIso frozen now
 * @param {object} signal fixture signal
 * @returns {object} next row
 */
export function reduceMeetingRow(row, nowIso, signal) {
  if (!isPlainObject(row)) {
    throw new TypeError('row must be an object');
  }
  if (!MEETING_STATUSES.includes(row.status)) {
    throw new TypeError(`unknown row.status: ${row.status}`);
  }
  const now = assertIso(nowIso, 'now');
  if (!isPlainObject(signal) || typeof signal.type !== 'string') {
    throw new TypeError('signal.type is required');
  }

  if (TERMINAL_STATUSES.has(row.status)) {
    return reduceTerminal(row, signal);
  }

  switch (signal.type) {
    case 'calendar_sync':
      return reduceCalendarSync(row, now, signal);
    case 'agenda_check':
      return reduceAgendaCheck(row, now, signal);
    case 'morning_check':
      return reduceMorningCheck(row, now, signal);
    case 'minutes_check':
      return reduceMinutesCheck(row, now, signal);
    case 'publication_check':
      return reducePublicationCheck(row, now, signal);
    default: {
      const exhaustive = signal.type;
      throw new TypeError(`unknown signal.type: ${exhaustive}`);
    }
  }
}

export function rowHorizonIso(row) {
  return horizonInstant(row.startsAt, row.horizonDays ?? MINUTES_HORIZON_DAYS);
}
