/**
 * CIT-120 — shared sanitize helpers for fixture / http_stub / allowlisted minutes.
 * Fail closed on bad payloads before TRIGGER_CONTRACT activate / persist.
 */

import {
  TRIGGER_TYPES,
  validateTriggerPayload,
} from '../triggerContract.js';
import {
  MV_LIBRARY_MINUTES_OBSERVATION_ID,
  MV_LIBRARY_MINUTES_PUBLISHED_AT,
  MV_LIBRARY_MINUTES_SOURCE_URL,
} from './fixtures/mvLibraryMinutes3458.js';

/** Evidence / body cap for stub + allowlisted CLI path (API body is already 16 KiB). */
export const MAX_OBSERVATION_EVIDENCE_CHARS = 32_768;

/** http_stub may only activate known fixture-pack observation ids. */
export const ALLOWED_HTTP_STUB_OBSERVATION_IDS = Object.freeze(
  new Set([
    'obs-civic-wage-bulletin-2026-04',
    'obs-civic-wage-bulletin-2026-04-revision',
    MV_LIBRARY_MINUTES_OBSERVATION_ID,
  ]),
);

/** Library minutes body must carry these markers (fixture + recorded body). */
export const LIBRARY_MINUTES_CONTENT_MARKERS = Object.freeze([
  /Board of Library Trustees/i,
  /talent stipend/i,
]);

function issue(path, code, message) {
  return { path, code, message };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * True when body text matches the library minutes content gate.
 */
export function passesLibraryMinutesContentGate(bodyText) {
  if (typeof bodyText !== 'string' || bodyText.trim() === '') return false;
  return LIBRARY_MINUTES_CONTENT_MARKERS.every((re) => re.test(bodyText));
}

/**
 * Provenance URL for library minutes: fixture PDF URL only (not arbitrary hosts).
 */
export function isKnownLibraryMinutesSourceUrl(url) {
  return typeof url === 'string' && url.trim() === MV_LIBRARY_MINUTES_SOURCE_URL;
}

/**
 * Validate one http_stub observation row into issues[] (request-time fail closed).
 * @returns {{ ok: true, value: object } | { ok: false, issues: object[] }}
 */
export function validateHttpStubObservation(row, index) {
  const prefix = `observations[${index}]`;
  const issues = [];
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return {
      ok: false,
      issues: [issue(prefix, 'invalid_type', `${prefix} must be an object`)],
    };
  }

  if (typeof row.id !== 'string' || row.id.trim() === '') {
    issues.push(issue(`${prefix}.id`, 'invalid_type', `${prefix}.id must be a non-empty string`));
  } else if (!ALLOWED_HTTP_STUB_OBSERVATION_IDS.has(row.id.trim())) {
    issues.push(
      issue(
        `${prefix}.id`,
        'invalid_value',
        `${prefix}.id must be a known fixture observation id`,
      ),
    );
  }

  if (typeof row.sourceUrl !== 'string' || row.sourceUrl.trim() === '') {
    issues.push(
      issue(`${prefix}.sourceUrl`, 'invalid_type', `${prefix}.sourceUrl must be a non-empty string`),
    );
  } else if (row.id?.trim() === MV_LIBRARY_MINUTES_OBSERVATION_ID
    && !isKnownLibraryMinutesSourceUrl(row.sourceUrl)) {
    issues.push(
      issue(
        `${prefix}.sourceUrl`,
        'invalid_value',
        `${prefix}.sourceUrl must be the known library minutes PDF URL`,
      ),
    );
  }

  if (typeof row.observedAt !== 'string' || Number.isNaN(Date.parse(row.observedAt))) {
    issues.push(
      issue(
        `${prefix}.observedAt`,
        'invalid_value',
        `${prefix}.observedAt must be an ISO-8601 string`,
      ),
    );
  }

  if (typeof row.evidence !== 'string' || row.evidence.trim() === '') {
    issues.push(
      issue(`${prefix}.evidence`, 'invalid_type', `${prefix}.evidence must be a non-empty string`),
    );
  } else if (row.evidence.length > MAX_OBSERVATION_EVIDENCE_CHARS) {
    issues.push(
      issue(
        `${prefix}.evidence`,
        'too_long',
        `${prefix}.evidence must be at most ${MAX_OBSERVATION_EVIDENCE_CHARS} characters`,
      ),
    );
  } else if (row.id?.trim() === MV_LIBRARY_MINUTES_OBSERVATION_ID
    && !passesLibraryMinutesContentGate(row.evidence)) {
    issues.push(
      issue(
        `${prefix}.evidence`,
        'content_gate',
        `${prefix}.evidence failed library minutes content gate`,
      ),
    );
  }

  if (!isPlainObject(row.hints)) {
    issues.push(
      issue(`${prefix}.hints`, 'required', `${prefix}.hints must be an object with type/label/effect`),
    );
  } else {
    const hints = row.hints;
    if (typeof hints.type !== 'string' || !TRIGGER_TYPES.includes(hints.type)) {
      issues.push(
        issue(
          `${prefix}.hints.type`,
          'invalid_value',
          `${prefix}.hints.type must be one of: ${TRIGGER_TYPES.join(', ')}`,
        ),
      );
    }
    if (typeof hints.label !== 'string' || hints.label.trim() === '') {
      issues.push(
        issue(`${prefix}.hints.label`, 'invalid_type', `${prefix}.hints.label must be a non-empty string`),
      );
    }
    if (!isPlainObject(hints.effect)) {
      issues.push(
        issue(`${prefix}.hints.effect`, 'required', `${prefix}.hints.effect is required`),
      );
    } else {
      // Dry-run the same contract gate used at persist (id/source/timestamp shells).
      const probe = validateTriggerPayload({
        id: `evt-pipeline-${typeof row.id === 'string' ? row.id.trim() : 'x'}`,
        type: typeof hints.type === 'string' ? hints.type : 'policy_change',
        label: typeof hints.label === 'string' ? hints.label : 'x',
        source: typeof row.sourceUrl === 'string' ? row.sourceUrl : 'https://example.local/x',
        timestamp:
          typeof row.observedAt === 'string' && !Number.isNaN(Date.parse(row.observedAt))
            ? new Date(row.observedAt).toISOString()
            : MV_LIBRARY_MINUTES_PUBLISHED_AT,
        effect: hints.effect,
      });
      for (const entry of probe.issues ?? []) {
        if (
          entry.path === 'effect'
          || entry.path.startsWith('effect.')
          || entry.path === 'label'
          || entry.path === 'type'
        ) {
          issues.push(
            issue(`${prefix}.hints.${entry.path}`, entry.code, entry.message),
          );
        }
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      id: row.id.trim(),
      sourceUrl: row.sourceUrl.trim(),
      observedAt: new Date(row.observedAt).toISOString(),
      evidence: row.evidence.trim(),
      supersedes: typeof row.supersedes === 'string' ? row.supersedes : null,
      hints: structuredClone(row.hints),
    },
  };
}

/**
 * Validate an http_stub observations array. Empty array is allowed (blocked/empty path).
 */
export function validateHttpStubObservations(observations) {
  if (!Array.isArray(observations)) {
    return {
      ok: false,
      issues: [issue('observations', 'invalid_type', 'observations must be an array')],
    };
  }
  const issues = [];
  const values = [];
  for (let index = 0; index < observations.length; index += 1) {
    const result = validateHttpStubObservation(observations[index], index);
    if (!result.ok) {
      issues.push(...result.issues);
    } else {
      values.push(result.value);
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: values };
}
