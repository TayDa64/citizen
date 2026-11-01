/**
 * CIT-107 — Narrowly named allowlisted HTTPS fetch mapper (not Firecrawl).
 *
 * Live/recorded fetch results map into:
 *   1) three-phase calendar_sync signals (Phase A), and/or
 *   2) http_stub Observation bodies for ingestAndPersist (Phase C minutes).
 *
 * CI stays network-off via recorded JSON under src/adapters/recorded/.
 * adapter: 'firecrawl' remains rejected at validateIngestRequest.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWLISTED_CALENDAR_URL,
  ALLOWLISTED_CATALOG_EVENTS,
  ALLOWLISTED_SOURCE_ID,
  assertAllowlistedHttpsUrl,
} from '../sourceAllowlist.js';
import {
  MV_LIBRARY_MINUTES_OBSERVATION_ID,
  MV_LIBRARY_MINUTES_SOURCE_URL,
  mvLibraryMinutes3458Fixture,
} from './fixtures/mvLibraryMinutes3458.js';
import {
  MAX_OBSERVATION_EVIDENCE_CHARS,
  isKnownLibraryMinutesSourceUrl,
  passesLibraryMinutesContentGate,
} from './ingestSanitize.js';

export const ALLOWLISTED_HTTPS_ID = 'allowlisted_https';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RECORDED_DIR = path.join(HERE, 'recorded');

export const RECORDED_BODIES = Object.freeze({
  calendar: 'mv-legistar-calendar.json',
  calendarBlocked: 'mv-legistar-calendar-blocked.json',
  calendarEmpty: 'mv-legistar-calendar-empty.json',
  minutes3458: 'mv-legistar-minutes-3458.json',
});

/**
 * @param {keyof typeof RECORDED_BODIES | string} name
 */
export function loadRecordedBody(name) {
  const file = RECORDED_BODIES[name] ?? name;
  const full = path.join(RECORDED_DIR, file);
  const raw = readFileSync(full, 'utf8');
  return JSON.parse(raw);
}

/**
 * Extract MeetingDetail.aspx?ID=N ids from HTML / text body.
 * @param {string} bodyText
 * @returns {string[]}
 */
export function extractMeetingDetailIds(bodyText) {
  if (typeof bodyText !== 'string' || bodyText.trim() === '') return [];
  const ids = new Set();
  const re = /MeetingDetail\.aspx\?[^"'>\s]*ID=(\d+)/gi;
  let match;
  while ((match = re.exec(bodyText)) !== null) {
    ids.add(String(match[1]));
  }
  return [...ids];
}

/**
 * Map a fetch envelope (live or recorded) to a calendar_sync signal.
 * blocked / empty → outcome that keeps pointers (changed=false path).
 * @param {object} envelope
 */
export function mapFetchToCalendarSignal(envelope) {
  if (envelope == null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('mapFetchToCalendarSignal requires an envelope object');
  }

  const fetchedUrl = typeof envelope.fetchedUrl === 'string'
    ? envelope.fetchedUrl
    : ALLOWLISTED_CALENDAR_URL;
  assertAllowlistedHttpsUrl(fetchedUrl);

  if (envelope.ok === false || envelope.status === 0 || envelope.error) {
    return {
      type: 'calendar_sync',
      outcome: 'blocked',
      error: typeof envelope.error === 'string' && envelope.error
        ? envelope.error
        : 'legistar_unreachable',
      fixtureId: 'mv-council-calendar-2026h2',
      sourceId: ALLOWLISTED_SOURCE_ID,
      fetchedUrl,
      via: ALLOWLISTED_HTTPS_ID,
    };
  }

  const bodyText = typeof envelope.bodyText === 'string' ? envelope.bodyText : '';
  if (bodyText.trim() === '') {
    return {
      type: 'calendar_sync',
      outcome: 'blocked',
      error: 'legistar_empty_body',
      fixtureId: 'mv-council-calendar-2026h2',
      sourceId: ALLOWLISTED_SOURCE_ID,
      fetchedUrl,
      via: ALLOWLISTED_HTTPS_ID,
    };
  }

  const foundIds = new Set(extractMeetingDetailIds(bodyText));
  const events = ALLOWLISTED_CATALOG_EVENTS
    .filter((event) => foundIds.has(String(event.externalEventId)))
    .map((event) => ({ ...event }));

  if (events.length === 0) {
    // Successful HTTP but no catalog IDs — empty calendar signal (no delete).
    return {
      type: 'calendar_sync',
      outcome: 'ok',
      fixtureId: 'mv-council-calendar-2026h2',
      sourceId: ALLOWLISTED_SOURCE_ID,
      fetchedUrl,
      via: ALLOWLISTED_HTTPS_ID,
      events: [],
      empty: true,
    };
  }

  return {
    type: 'calendar_sync',
    outcome: 'ok',
    fixtureId: 'mv-council-calendar-2026h2',
    sourceId: ALLOWLISTED_SOURCE_ID,
    fetchedUrl,
    via: ALLOWLISTED_HTTPS_ID,
    events,
  };
}

/**
 * Map a minutes fetch envelope to http_stub Observation bodies.
 * Uses the same contract hints as the library minutes fixture pack.
 * Empty/blocked/garbage/partial → empty array (fail closed; changed=false).
 * Requires body + minutesUrl + minutesPublishedAt (aligned with minutes signal).
 * @param {object} envelope
 */
export function mapFetchToHttpStubObservations(envelope) {
  if (envelope == null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('mapFetchToHttpStubObservations requires an envelope object');
  }

  if (envelope.ok === false || envelope.status === 0 || envelope.error) {
    return [];
  }

  const bodyText = typeof envelope.bodyText === 'string' ? envelope.bodyText.trim() : '';
  if (!bodyText) return [];
  if (bodyText.length > MAX_OBSERVATION_EVIDENCE_CHARS) return [];

  const externalEventId = String(envelope.externalEventId ?? '3458');
  if (externalEventId !== '3458') {
    // Only the library minutes pack is wired for gameplay ingest in this program.
    return [];
  }

  // Align with mapFetchToMinutesSignal: no fixture URL/ts fallbacks.
  const minutesUrl = typeof envelope.minutesUrl === 'string' ? envelope.minutesUrl.trim() : '';
  const minutesPublishedAt = typeof envelope.minutesPublishedAt === 'string'
    ? envelope.minutesPublishedAt
    : null;
  if (!minutesUrl || !minutesPublishedAt || Number.isNaN(Date.parse(minutesPublishedAt))) {
    return [];
  }
  if (!isKnownLibraryMinutesSourceUrl(minutesUrl)) {
    return [];
  }
  // Content gate: refuse arbitrary HTML that would stamp hardcoded effects.
  if (!passesLibraryMinutesContentGate(bodyText)) {
    return [];
  }

  const fixtureHints = mvLibraryMinutes3458Fixture.observations[0].hints;
  return [
    {
      id: MV_LIBRARY_MINUTES_OBSERVATION_ID,
      sourceUrl: MV_LIBRARY_MINUTES_SOURCE_URL,
      observedAt: new Date(minutesPublishedAt).toISOString(),
      evidence: bodyText,
      hints: {
        type: fixtureHints.type,
        label: fixtureHints.label,
        effect: { ...fixtureHints.effect },
        rationale:
          'Allowlisted HTTPS minutes body passed content gate; maps stipend → talentCost and '
          + 'board attention → hype via http_stub (not firecrawl).',
      },
    },
  ];
}

/**
 * Build a minutes_check signal for the three-phase reducer from a fetch envelope.
 * @param {object} envelope
 */
export function mapFetchToMinutesSignal(envelope) {
  if (envelope == null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('mapFetchToMinutesSignal requires an envelope object');
  }

  if (envelope.ok === false || envelope.status === 0 || envelope.error) {
    return {
      type: 'minutes_check',
      outcome: 'blocked',
      error: typeof envelope.error === 'string' && envelope.error
        ? envelope.error
        : 'legistar_unreachable',
      fixtureId: 'mv-library-minutes-3458',
      via: ALLOWLISTED_HTTPS_ID,
    };
  }

  const bodyText = typeof envelope.bodyText === 'string' ? envelope.bodyText.trim() : '';
  const minutesUrl = typeof envelope.minutesUrl === 'string' ? envelope.minutesUrl.trim() : '';
  const minutesPublishedAt = typeof envelope.minutesPublishedAt === 'string'
    ? envelope.minutesPublishedAt
    : null;

  if (!bodyText || !minutesUrl || !minutesPublishedAt) {
    return {
      type: 'minutes_check',
      outcome: 'empty',
      fixtureId: 'mv-library-minutes-3458',
      via: ALLOWLISTED_HTTPS_ID,
    };
  }

  return {
    type: 'minutes_check',
    outcome: 'ok',
    fixtureId: 'mv-library-minutes-3458',
    minutesStatus: 'Final',
    minutesUrl,
    minutesPublishedAt,
    via: ALLOWLISTED_HTTPS_ID,
  };
}

/**
 * Perform HTTPS GET against an allowlisted URL (live path only).
 * Never called from CI unit path — tests use recorded bodies.
 * @param {string} rawUrl
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function liveFetchAllowlisted(rawUrl, options = {}) {
  const parsed = assertAllowlistedHttpsUrl(rawUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    const error = new Error('fetch is not available');
    error.code = 'allowlist_fetch_unavailable';
    throw error;
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Fail closed on cross-host redirects: never follow without re-allowlisting.
    const response = await fetchImpl(parsed.href, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'CitizenAllowlistedFetch/1.0 (+https://github.com/TayDa64/citizen)',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      let redirectOk = false;
      if (typeof location === 'string' && location.trim() !== '') {
        try {
          const next = new URL(location, parsed.href);
          assertAllowlistedHttpsUrl(next.href);
          redirectOk = true;
        } catch {
          redirectOk = false;
        }
      }
      if (!redirectOk) {
        return {
          kind: 'calendar_fetch',
          sourceId: ALLOWLISTED_SOURCE_ID,
          fetchedUrl: parsed.href,
          fetchedAt: new Date().toISOString(),
          status: response.status,
          ok: false,
          bodyText: '',
          error: 'allowlist_redirect_rejected',
        };
      }
      // Same-allowlist redirect: one follow, still manual (no chains).
      const followed = await fetchImpl(new URL(location, parsed.href).href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'CitizenAllowlistedFetch/1.0 (+https://github.com/TayDa64/citizen)',
        },
      });
      if (followed.status >= 300 && followed.status < 400) {
        return {
          kind: 'calendar_fetch',
          sourceId: ALLOWLISTED_SOURCE_ID,
          fetchedUrl: parsed.href,
          fetchedAt: new Date().toISOString(),
          status: followed.status,
          ok: false,
          bodyText: '',
          error: 'allowlist_redirect_rejected',
        };
      }
      const followedBody = await followed.text();
      return {
        kind: 'calendar_fetch',
        sourceId: ALLOWLISTED_SOURCE_ID,
        fetchedUrl: parsed.href,
        fetchedAt: new Date().toISOString(),
        status: followed.status,
        ok: followed.ok,
        bodyText: followedBody,
        error: followed.ok ? null : `http_${followed.status}`,
      };
    }
    const bodyText = await response.text();
    return {
      kind: 'calendar_fetch',
      sourceId: ALLOWLISTED_SOURCE_ID,
      fetchedUrl: parsed.href,
      fetchedAt: new Date().toISOString(),
      status: response.status,
      ok: response.ok,
      bodyText,
      error: response.ok ? null : `http_${response.status}`,
    };
  } catch (cause) {
    return {
      kind: 'calendar_fetch',
      sourceId: ALLOWLISTED_SOURCE_ID,
      fetchedUrl: parsed.href,
      fetchedAt: new Date().toISOString(),
      status: 0,
      ok: false,
      bodyText: '',
      error: cause?.name === 'AbortError' ? 'legistar_timeout' : 'legistar_unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}
