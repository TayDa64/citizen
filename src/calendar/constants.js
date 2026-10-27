/** Three-phase calendar clock — statuses match wave-2 / future 007 sketch. */

export const MEETING_PHASES = Object.freeze(['A', 'B', 'C']);

export const MEETING_STATUSES = Object.freeze([
  'scheduled',
  'agenda_due',
  'agenda_seen',
  'confirmed',
  'minutes_wait',
  'ingested',
  'unchanged',
  'cancelled',
]);

export const TERMINAL_STATUSES = Object.freeze(
  new Set(['cancelled', 'ingested', 'unchanged']),
);

export const MEETING_KINDS = Object.freeze(['meeting', 'publication']);

/** Business-day offsets after the meeting for Phase C backoff (then weekly). */
export const MINUTES_BACKOFF_BUSINESS_DAYS = Object.freeze([1, 2, 5, 10, 20]);

/** Calendar days after starts_at; past this with no file → unchanged (stay closed). */
export const MINUTES_HORIZON_DAYS = 60;

export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

export const DEFAULT_SOURCE_ID = 'legistar:mountainview';
