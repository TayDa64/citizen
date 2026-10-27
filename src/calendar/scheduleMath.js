/**
 * Pure schedule helpers for the calendar reducer.
 * All instants are ISO-8601 UTC strings; local civil dates use the row timezone.
 */

import { MINUTES_BACKOFF_BUSINESS_DAYS, MINUTES_HORIZON_DAYS } from './constants.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function assertValidIso(iso, label = 'instant') {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) {
    throw new TypeError(`${label} must be an ISO-8601 string`);
  }
  return new Date(iso).toISOString();
}

/** Local Y-M-D parts in an IANA zone. */
export function localDateParts(iso, timeZone) {
  const d = new Date(assertValidIso(iso));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday, // Sun Mon …
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

const WEEKDAY_INDEX = Object.freeze({
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
});

function isWeekendName(weekday) {
  return weekday === 'Sat' || weekday === 'Sun';
}

/**
 * Approximate a zoned local civil datetime as a UTC Instant.
 * Uses noon-probe + offset so DST edges stay stable enough for fixture clocks.
 */
export function zonedLocalToUtcIso(year, month, day, hour, minute, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const probe = new Date(utcGuess);
  const local = localDateParts(probe.toISOString(), timeZone);
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
  const offsetMs = localAsUtc - utcGuess;
  return new Date(utcGuess - offsetMs).toISOString();
}

function addCalendarDaysParts(year, month, day, deltaDays) {
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + deltaDays);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function weekdayNameForParts(year, month, day) {
  // Use UTC noon so weekday of the civil date is stable.
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
}

/** Add N business days to a local civil date (skip Sat/Sun). N may be 0. */
export function addBusinessDaysLocal(year, month, day, businessDays) {
  let y = year;
  let m = month;
  let d = day;
  let remaining = businessDays;
  const step = remaining >= 0 ? 1 : -1;
  remaining = Math.abs(remaining);
  while (remaining > 0) {
    ({ year: y, month: m, day: d } = addCalendarDaysParts(y, m, d, step));
    const wd = weekdayNameForParts(y, m, d);
    if (!isWeekendName(wd)) remaining -= 1;
  }
  return { year: y, month: m, day: d };
}

/**
 * Last business day that is at least 72 hours before starts_at, at 13:00 local
 * (clerk afternoon habit). Second same-day check at 16:00 local.
 */
export function agendaWindowInstants(startsAtIso, timeZone) {
  const start = assertValidIso(startsAtIso, 'startsAt');
  const parts = localDateParts(start, timeZone);
  // Walk back until the candidate afternoon is ≥ 72h before the meeting start.
  let cursor = { year: parts.year, month: parts.month, day: parts.day };
  for (let i = 0; i < 14; i += 1) {
    cursor = addCalendarDaysParts(cursor.year, cursor.month, cursor.day, -1);
    const wd = weekdayNameForParts(cursor.year, cursor.month, cursor.day);
    if (isWeekendName(wd)) continue;
    const afternoon = zonedLocalToUtcIso(
      cursor.year,
      cursor.month,
      cursor.day,
      13,
      0,
      timeZone,
    );
    const leadMs = Date.parse(start) - Date.parse(afternoon);
    if (leadMs >= 72 * 60 * 60 * 1000) {
      const later = zonedLocalToUtcIso(
        cursor.year,
        cursor.month,
        cursor.day,
        16,
        0,
        timeZone,
      );
      return { first: afternoon, later };
    }
  }
  // Fallback: three calendar days before at 13:00.
  const fallback = addCalendarDaysParts(parts.year, parts.month, parts.day, -3);
  return {
    first: zonedLocalToUtcIso(fallback.year, fallback.month, fallback.day, 13, 0, timeZone),
    later: zonedLocalToUtcIso(fallback.year, fallback.month, fallback.day, 16, 0, timeZone),
  };
}

/** Local 08:00 on the calendar day of starts_at (morning-of check). */
export function morningOfMeeting(startsAtIso, timeZone) {
  const parts = localDateParts(assertValidIso(startsAtIso, 'startsAt'), timeZone);
  return zonedLocalToUtcIso(parts.year, parts.month, parts.day, 8, 0, timeZone);
}

/** Local 08:00 on the next calendar day after the meeting (Phase C open). */
export function morningAfterMeeting(startsAtIso, timeZone) {
  const parts = localDateParts(assertValidIso(startsAtIso, 'startsAt'), timeZone);
  const next = addCalendarDaysParts(parts.year, parts.month, parts.day, 1);
  // If that lands on a weekend, still use calendar morning-after (wave2: morning after).
  return zonedLocalToUtcIso(next.year, next.month, next.day, 8, 0, timeZone);
}

/**
 * next_check_at for Phase C backoff index (0 = morning after, then +2/+5/+10/+20 BD, then weekly).
 */
export function minutesBackoffCheckAt(startsAtIso, timeZone, backoffIndex) {
  const start = assertValidIso(startsAtIso, 'startsAt');
  const parts = localDateParts(start, timeZone);
  const idx = Math.max(0, Number(backoffIndex) || 0);

  if (idx < MINUTES_BACKOFF_BUSINESS_DAYS.length) {
    const offset = MINUTES_BACKOFF_BUSINESS_DAYS[idx];
    if (offset === 1) {
      return morningAfterMeeting(start, timeZone);
    }
    const bd = addBusinessDaysLocal(parts.year, parts.month, parts.day, offset);
    return zonedLocalToUtcIso(bd.year, bd.month, bd.day, 8, 0, timeZone);
  }

  // Weekly after the +20 business-day slot: from the +20 check, add 7 calendar days per step.
  const baseBd = addBusinessDaysLocal(
    parts.year,
    parts.month,
    parts.day,
    MINUTES_BACKOFF_BUSINESS_DAYS[MINUTES_BACKOFF_BUSINESS_DAYS.length - 1],
  );
  const weeksPast = idx - (MINUTES_BACKOFF_BUSINESS_DAYS.length - 1);
  const weekly = addCalendarDaysParts(baseBd.year, baseBd.month, baseBd.day, 7 * weeksPast);
  return zonedLocalToUtcIso(weekly.year, weekly.month, weekly.day, 8, 0, timeZone);
}

export function horizonInstant(startsAtIso, horizonDays = MINUTES_HORIZON_DAYS) {
  const startMs = Date.parse(assertValidIso(startsAtIso, 'startsAt'));
  return new Date(startMs + horizonDays * MS_PER_DAY).toISOString();
}

export function isPastHorizon(startsAtIso, nowIso, horizonDays = MINUTES_HORIZON_DAYS) {
  return Date.parse(assertValidIso(nowIso, 'now')) >= Date.parse(horizonInstant(startsAtIso, horizonDays));
}

export function isDue(nextCheckAtIso, nowIso) {
  return Date.parse(assertValidIso(nowIso, 'now')) >= Date.parse(assertValidIso(nextCheckAtIso, 'nextCheckAt'));
}
