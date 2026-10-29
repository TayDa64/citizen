/**
 * CIT-81 — persist/load for scheduled_meetings (migration 007).
 * Maps calendar reducer rows ↔ Postgres. No network.
 */

import {
  DEFAULT_SOURCE_ID,
  DEFAULT_TIMEZONE,
  MINUTES_HORIZON_DAYS,
  createMeetingRow,
  createPublicationRow,
  mvCouncilCalendar2026h2,
} from '../src/calendar/index.js';
import { agendaWindowInstants } from '../src/calendar/scheduleMath.js';

const MV_JURISDICTION_ID = 'mv';

function isoOrNull(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return null;
}

/**
 * Map a DB row to the in-memory calendar reducer shape (+ id / jurisdictionId).
 */
export function mapScheduledMeetingRow(row) {
  if (!row) return null;
  const kind = row.kind;
  const base = {
    id: row.id,
    jurisdictionId: row.jurisdiction_id,
    sourceId: row.source_id,
    externalEventId: row.external_event_id,
    kind,
    startsAt: isoOrNull(row.starts_at),
    timezone: row.timezone,
    nextCheckAt: isoOrNull(row.next_check_at),
    phase: row.phase,
    status: row.status,
    fixtureId: row.fixture_id ?? null,
    expectedUrl: row.expected_url ?? null,
    agendaUrl: row.agenda_url ?? null,
    agendaPublishedAt: isoOrNull(row.agenda_published_at),
    minutesUrl: row.minutes_url ?? null,
    minutesPublishedAt: isoOrNull(row.minutes_published_at),
    observedSourceUrl: row.observed_source_url ?? null,
    lastError: row.last_error ?? null,
    backoffIndex: Number.isFinite(row.backoff_index) ? row.backoff_index : 0,
    horizonDays: Number.isFinite(row.horizon_days) ? row.horizon_days : MINUTES_HORIZON_DAYS,
    bodyName: row.body_name ?? null,
    changed: false,
    stdout: null,
  };
  return base;
}

const SELECT_COLUMNS = `
  id, jurisdiction_id, source_id, external_event_id, kind, starts_at, timezone,
  next_check_at, phase, status, fixture_id, expected_url, agenda_url,
  agenda_published_at, minutes_url, minutes_published_at, observed_source_url,
  last_error, backoff_index, horizon_days, body_name
`;

export async function getScheduledMeeting(pool, id) {
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM scheduled_meetings WHERE id = $1`,
    [id],
  );
  return mapScheduledMeetingRow(result.rows[0] ?? null);
}

export async function getScheduledMeetingByNaturalKey(pool, sourceId, externalEventId) {
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM scheduled_meetings
     WHERE source_id = $1 AND external_event_id = $2`,
    [sourceId, externalEventId],
  );
  return mapScheduledMeetingRow(result.rows[0] ?? null);
}

/**
 * Upsert by (source_id, external_event_id). Returns the persisted reducer row.
 */
export async function upsertScheduledMeeting(pool, meeting, {
  jurisdictionId = MV_JURISDICTION_ID,
} = {}) {
  const sourceId = meeting.sourceId ?? DEFAULT_SOURCE_ID;
  const externalEventId = String(meeting.externalEventId ?? '');
  const kind = meeting.kind ?? 'meeting';
  const startsAt = meeting.startsAt;
  const timeZone = meeting.timezone ?? DEFAULT_TIMEZONE;
  const nextCheckAt = meeting.nextCheckAt
    ?? (kind === 'publication'
      ? startsAt
      : agendaWindowInstants(startsAt, timeZone).first);
  const phase = meeting.phase ?? 'A';
  const status = meeting.status ?? 'scheduled';

  const result = await pool.query(
    `INSERT INTO scheduled_meetings (
       jurisdiction_id, source_id, external_event_id, kind, starts_at, timezone,
       next_check_at, phase, status, fixture_id, expected_url, agenda_url,
       agenda_published_at, minutes_url, minutes_published_at, observed_source_url,
       last_error, backoff_index, horizon_days, body_name
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16,
       $17, $18, $19, $20
     )
     ON CONFLICT (source_id, external_event_id) DO UPDATE SET
       jurisdiction_id = EXCLUDED.jurisdiction_id,
       kind = EXCLUDED.kind,
       starts_at = EXCLUDED.starts_at,
       timezone = EXCLUDED.timezone,
       next_check_at = EXCLUDED.next_check_at,
       phase = EXCLUDED.phase,
       status = EXCLUDED.status,
       fixture_id = EXCLUDED.fixture_id,
       expected_url = EXCLUDED.expected_url,
       agenda_url = EXCLUDED.agenda_url,
       agenda_published_at = EXCLUDED.agenda_published_at,
       minutes_url = EXCLUDED.minutes_url,
       minutes_published_at = EXCLUDED.minutes_published_at,
       observed_source_url = EXCLUDED.observed_source_url,
       last_error = EXCLUDED.last_error,
       backoff_index = EXCLUDED.backoff_index,
       horizon_days = EXCLUDED.horizon_days,
       body_name = EXCLUDED.body_name
     RETURNING ${SELECT_COLUMNS}`,
    [
      meeting.jurisdictionId ?? jurisdictionId,
      sourceId,
      externalEventId,
      kind,
      startsAt,
      timeZone,
      nextCheckAt,
      phase,
      status,
      meeting.fixtureId ?? null,
      meeting.expectedUrl ?? null,
      meeting.agendaUrl ?? null,
      meeting.agendaPublishedAt ?? null,
      meeting.minutesUrl ?? null,
      meeting.minutesPublishedAt ?? null,
      meeting.observedSourceUrl ?? null,
      meeting.lastError ?? null,
      Number.isFinite(meeting.backoffIndex) ? meeting.backoffIndex : 0,
      Number.isFinite(meeting.horizonDays) ? meeting.horizonDays : MINUTES_HORIZON_DAYS,
      meeting.bodyName ?? null,
    ],
  );
  return mapScheduledMeetingRow(result.rows[0]);
}

/**
 * Persist reducer output onto an existing id (natural key unchanged).
 */
export async function updateScheduledMeeting(pool, meeting) {
  if (!meeting?.id) {
    throw new TypeError('updateScheduledMeeting requires meeting.id');
  }
  const result = await pool.query(
    `UPDATE scheduled_meetings SET
       starts_at = $2,
       timezone = $3,
       next_check_at = $4,
       phase = $5,
       status = $6,
       fixture_id = $7,
       expected_url = $8,
       agenda_url = $9,
       agenda_published_at = $10,
       minutes_url = $11,
       minutes_published_at = $12,
       observed_source_url = $13,
       last_error = $14,
       backoff_index = $15,
       horizon_days = $16,
       body_name = $17
     WHERE id = $1
     RETURNING ${SELECT_COLUMNS}`,
    [
      meeting.id,
      meeting.startsAt,
      meeting.timezone,
      meeting.nextCheckAt,
      meeting.phase,
      meeting.status,
      meeting.fixtureId ?? null,
      meeting.expectedUrl ?? null,
      meeting.agendaUrl ?? null,
      meeting.agendaPublishedAt ?? null,
      meeting.minutesUrl ?? null,
      meeting.minutesPublishedAt ?? null,
      meeting.observedSourceUrl ?? null,
      meeting.lastError ?? null,
      Number.isFinite(meeting.backoffIndex) ? meeting.backoffIndex : 0,
      Number.isFinite(meeting.horizonDays) ? meeting.horizonDays : MINUTES_HORIZON_DAYS,
      meeting.bodyName ?? null,
    ],
  );
  return mapScheduledMeetingRow(result.rows[0]);
}

const TERMINAL = new Set(['cancelled', 'ingested', 'unchanged']);

/**
 * Due rows: next_check_at <= now, non-terminal. FOR UPDATE SKIP LOCKED when client supports it.
 */
export async function listDueScheduledMeetings(client, nowIso, { forUpdate = true } = {}) {
  const lock = forUpdate ? 'FOR UPDATE SKIP LOCKED' : '';
  const result = await client.query(
    `SELECT ${SELECT_COLUMNS}
     FROM scheduled_meetings
     WHERE next_check_at <= $1::timestamptz
       AND status <> ALL($2::text[])
     ORDER BY next_check_at ASC, source_id ASC, external_event_id ASC
     ${lock}`,
    [nowIso, [...TERMINAL]],
  );
  return result.rows.map(mapScheduledMeetingRow);
}

/**
 * CIT-116 — read-only calendar board list (no invent / no writes).
 * Optional jurisdictionId filter; optional asOf marks due rows (next_check ≤ asOf, non-terminal).
 */
export async function listScheduledMeetings(pool, {
  limit = 50,
  jurisdictionId = null,
  asOf = null,
} = {}) {
  const capped = Math.max(1, Math.min(200, Number(limit) || 50));
  const params = [];
  const where = [];
  if (jurisdictionId != null && jurisdictionId !== '') {
    params.push(String(jurisdictionId));
    where.push(`jurisdiction_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(capped);
  const result = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM scheduled_meetings
     ${whereSql}
     ORDER BY starts_at ASC, source_id ASC, external_event_id ASC
     LIMIT $${params.length}`,
    params,
  );
  const asOfMs = asOf == null || asOf === ''
    ? null
    : Date.parse(typeof asOf === 'string' ? asOf : new Date(asOf).toISOString());
  return result.rows.map((row) => {
    const mapped = mapScheduledMeetingRow(row);
    if (asOfMs == null || Number.isNaN(asOfMs)) {
      return mapped;
    }
    const nextMs = mapped.nextCheckAt == null ? NaN : Date.parse(mapped.nextCheckAt);
    const due =
      Number.isFinite(nextMs)
      && nextMs <= asOfMs
      && !TERMINAL.has(mapped.status);
    return { ...mapped, due };
  });
}

/**
 * Phase A seed/upsert from MV council calendar fixture (no PDF, no network).
 * @returns {Promise<{ upserted: object[], fixtureId: string }>}
 */
export async function seedPhaseAFromMvCouncilFixture(pool, {
  jurisdictionId = MV_JURISDICTION_ID,
  fixture = mvCouncilCalendar2026h2,
} = {}) {
  const upserted = [];
  for (const event of fixture.events) {
    const windows = agendaWindowInstants(event.startsAt, DEFAULT_TIMEZONE);
    const draft = createMeetingRow({
      sourceId: DEFAULT_SOURCE_ID,
      externalEventId: event.externalEventId,
      bodyName: event.bodyName,
      startsAt: event.startsAt,
      timezone: DEFAULT_TIMEZONE,
      nextCheckAt: windows.first,
      phase: 'A',
      status: 'scheduled',
      fixtureId: fixture.fixtureId,
      expectedUrl: event.detailUrl,
    });
    const saved = await upsertScheduledMeeting(pool, {
      ...draft,
      jurisdictionId,
    });
    upserted.push(saved);
  }
  return { upserted, fixtureId: fixture.fixtureId };
}

/**
 * Seed the wage bulletin as a publication row (Phase A identity → Phase C at observedAt).
 */
export async function seedWagePublicationRow(pool, {
  jurisdictionId = MV_JURISDICTION_ID,
} = {}) {
  const draft = createPublicationRow({
    externalEventId: 'obs-civic-wage-bulletin-2026-04',
    startsAt: '2026-04-02T14:55:00.000Z',
    timezone: 'UTC',
    nextCheckAt: '2026-04-02T14:55:00.000Z',
    phase: 'A',
    status: 'scheduled',
    fixtureId: 'civic-wage-bulletin',
    expectedUrl: 'https://example.local/civic/wage-bulletin-2026-04',
    bodyName: 'Wage bulletin',
  });
  return upsertScheduledMeeting(pool, { ...draft, jurisdictionId });
}

export { MV_JURISDICTION_ID, TERMINAL as TERMINAL_MEETING_STATUSES };
