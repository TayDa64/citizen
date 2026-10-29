/**
 * CIT-107 — Git is the source of truth for allowlisted HTTPS URLs.
 * One host: Mountain View Legistar (already in calendar catalog).
 * Postgres expected_url is a seed-time copy, not this allowlist.
 */

export const ALLOWLISTED_SOURCE_ID = 'legistar:mountainview';

export const ALLOWLISTED_HOST = 'mountainview.legistar.com';

/** Canonical Phase A calendar fetch URL (HTTPS, no userinfo). */
export const ALLOWLISTED_CALENDAR_URL =
  'https://mountainview.legistar.com/Calendar.aspx';

/**
 * Catalog events already seeded by mv-council-calendar-2026h2.
 * Live/recorded fetch may confirm presence; startsAt / bodyName stay git-SOT.
 */
export const ALLOWLISTED_CATALOG_EVENTS = Object.freeze([
  Object.freeze({
    externalEventId: '3367',
    bodyName: 'City Council',
    startsAt: '2026-10-28T00:15:00.000Z',
    detailUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3367',
  }),
  Object.freeze({
    externalEventId: '3363',
    bodyName: 'City Council',
    startsAt: '2026-08-26T00:00:00.000Z',
    detailUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3363',
  }),
  Object.freeze({
    externalEventId: '3458',
    bodyName: 'Board of Library Trustees',
    startsAt: '2026-09-22T02:00:00.000Z',
    detailUrl: 'https://mountainview.legistar.com/MeetingDetail.aspx?ID=3458',
  }),
]);

const ALLOWLISTED_URLS = Object.freeze(
  new Set([
    ALLOWLISTED_CALENDAR_URL,
    ...ALLOWLISTED_CATALOG_EVENTS.map((event) => event.detailUrl),
  ]),
);

/**
 * @param {string} hostname
 */
export function isAllowlistedHost(hostname) {
  if (typeof hostname !== 'string' || hostname.trim() === '') return false;
  return hostname.trim().toLowerCase() === ALLOWLISTED_HOST;
}

/**
 * Reject non-HTTPS, userinfo, and hosts outside the single allowlisted host.
 * @param {string} rawUrl
 * @returns {URL}
 */
export function assertAllowlistedHttpsUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    const error = new Error('Allowlisted URL must be a non-empty string');
    error.code = 'allowlist_invalid_url';
    throw error;
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    const error = new Error(`Invalid URL: ${rawUrl}`);
    error.code = 'allowlist_invalid_url';
    throw error;
  }
  if (parsed.protocol !== 'https:') {
    const error = new Error(`Allowlisted URL must be HTTPS: ${rawUrl}`);
    error.code = 'allowlist_https_required';
    throw error;
  }
  if (parsed.username || parsed.password) {
    const error = new Error(`Allowlisted URL must not include userinfo: ${rawUrl}`);
    error.code = 'allowlist_userinfo_forbidden';
    throw error;
  }
  if (!isAllowlistedHost(parsed.hostname)) {
    const error = new Error(
      `Host not allowlisted (only ${ALLOWLISTED_HOST}): ${parsed.hostname}`,
    );
    error.code = 'allowlist_host_rejected';
    throw error;
  }
  const normalized = `${parsed.origin}${parsed.pathname}${parsed.search}`;
  if (!ALLOWLISTED_URLS.has(normalized) && !ALLOWLISTED_URLS.has(parsed.href.replace(/\/$/, ''))) {
    // MeetingDetail.aspx?ID=N with known catalog id is allowlisted even if
    // search param order differs — check pathname + ID.
    const idMatch = parsed.searchParams.get('ID');
    const isDetail = /\/MeetingDetail\.aspx$/i.test(parsed.pathname);
    const knownId = ALLOWLISTED_CATALOG_EVENTS.some(
      (event) => String(event.externalEventId) === String(idMatch),
    );
    const isCalendar = /\/Calendar\.aspx$/i.test(parsed.pathname);
    if (!(isCalendar || (isDetail && knownId))) {
      const error = new Error(`URL path not in git catalog allowlist: ${rawUrl}`);
      error.code = 'allowlist_url_rejected';
      throw error;
    }
  }
  return parsed;
}

export function listAllowlistedUrls() {
  return [...ALLOWLISTED_URLS];
}

export function getAllowlistedSource() {
  return {
    sourceId: ALLOWLISTED_SOURCE_ID,
    host: ALLOWLISTED_HOST,
    calendarUrl: ALLOWLISTED_CALENDAR_URL,
    events: ALLOWLISTED_CATALOG_EVENTS.map((event) => ({ ...event })),
  };
}
