/**
 * Real-world event pipeline (P1-2): observation → interpretation → validated
 * effect → lifecycle, with provenance.
 *
 * Layers stay separate:
 * - Observation: source URL / time / evidence (adapter output)
 * - Interpretation: typed trigger type/label + rationale (not yet a game effect)
 * - Effect: contract hype / talentCost deltas → TRIGGER_CONTRACT payload
 * - Lifecycle: discovered → normalized → pending → active → expired|cleared
 *
 * Supersession / clear never compound: same observation id replaces; clear /
 * expire remove the trigger from the active stack and restack from baselines.
 */

import { assertValidTrigger } from './triggers.js';

export const PIPELINE_VERSION = 1;

export const LIFECYCLE = Object.freeze({
  DISCOVERED: 'discovered',
  NORMALIZED: 'normalized',
  PENDING: 'pending',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  CLEARED: 'cleared',
});

export const LIFECYCLE_STATES = Object.freeze(Object.values(LIFECYCLE));

const ACTIVE_LIKE = new Set([LIFECYCLE.PENDING, LIFECYCLE.ACTIVE]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObservation(raw) {
  if (!isPlainObject(raw)) {
    throw new TypeError('Observation must be an object');
  }
  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    throw new TypeError('Observation.id must be a non-empty string');
  }
  if (typeof raw.sourceUrl !== 'string' || raw.sourceUrl.trim() === '') {
    throw new TypeError('Observation.sourceUrl must be a non-empty string');
  }
  if (typeof raw.observedAt !== 'string' || Number.isNaN(Date.parse(raw.observedAt))) {
    throw new TypeError('Observation.observedAt must be an ISO-8601 string');
  }
  if (typeof raw.evidence !== 'string' || raw.evidence.trim() === '') {
    throw new TypeError('Observation.evidence must be a non-empty string');
  }
  return {
    id: raw.id.trim(),
    sourceUrl: raw.sourceUrl.trim(),
    observedAt: new Date(raw.observedAt).toISOString(),
    evidence: raw.evidence.trim(),
    adapterId: typeof raw.adapterId === 'string' && raw.adapterId.trim() !== ''
      ? raw.adapterId.trim()
      : 'unknown',
    fixtureId: typeof raw.fixtureId === 'string' ? raw.fixtureId : null,
    supersedes: typeof raw.supersedes === 'string' && raw.supersedes.trim() !== ''
      ? raw.supersedes.trim()
      : null,
    hints: isPlainObject(raw.hints) ? structuredClone(raw.hints) : null,
  };
}

/** discovered → normalized (canonical observation fields + provenance shell). */
export function discoverObservation(raw) {
  const observation = assertObservation(raw);
  return {
    version: PIPELINE_VERSION,
    lifecycle: LIFECYCLE.DISCOVERED,
    observation,
    interpretation: null,
    effect: null,
    provenance: {
      adapterId: observation.adapterId,
      fixtureId: observation.fixtureId,
      observationId: observation.id,
      sourceUrl: observation.sourceUrl,
      observedAt: observation.observedAt,
      evidence: observation.evidence,
    },
    supersedes: observation.supersedes,
    triggerId: null,
  };
}

export function normalizeEvent(event) {
  if (!event || event.lifecycle !== LIFECYCLE.DISCOVERED) {
    throw new TypeError('normalizeEvent requires a discovered pipeline event');
  }
  return {
    ...event,
    lifecycle: LIFECYCLE.NORMALIZED,
    observation: assertObservation(event.observation),
  };
}

/**
 * Map a normalized observation to an interpretation + typed effect.
 * Hints from the adapter are accepted when present; callers may override.
 */
export function interpretEvent(event, interpretationInput = null) {
  if (!event || event.lifecycle !== LIFECYCLE.NORMALIZED) {
    throw new TypeError('interpretEvent requires a normalized pipeline event');
  }
  const hints = interpretationInput ?? event.observation.hints;
  if (!isPlainObject(hints)) {
    throw new TypeError('Interpretation requires type, label, and effect');
  }
  if (typeof hints.type !== 'string' || hints.type.trim() === '') {
    throw new TypeError('Interpretation.type is required');
  }
  if (typeof hints.label !== 'string' || hints.label.trim() === '') {
    throw new TypeError('Interpretation.label is required');
  }
  if (!isPlainObject(hints.effect)) {
    throw new TypeError('Interpretation.effect is required');
  }
  const interpretation = {
    type: hints.type.trim(),
    label: hints.label.trim(),
    rationale: typeof hints.rationale === 'string' ? hints.rationale.trim() : '',
  };
  const effect = {};
  if (Object.prototype.hasOwnProperty.call(hints.effect, 'hype')) {
    effect.hype = hints.effect.hype;
  }
  if (Object.prototype.hasOwnProperty.call(hints.effect, 'talentCost')) {
    effect.talentCost = hints.effect.talentCost;
  }
  const triggerId = `evt-pipeline-${event.observation.id}`;
  return {
    ...event,
    lifecycle: LIFECYCLE.PENDING,
    interpretation,
    effect,
    triggerId,
  };
}

/** Build a TRIGGER_CONTRACT v1 payload from a pending/active pipeline event. */
export function toContractTrigger(event) {
  if (!event || !ACTIVE_LIKE.has(event.lifecycle)) {
    throw new TypeError('toContractTrigger requires a pending or active pipeline event');
  }
  if (!event.interpretation || !event.effect || !event.triggerId) {
    throw new TypeError('Pipeline event is missing interpretation/effect');
  }
  const trigger = {
    id: event.triggerId,
    type: event.interpretation.type,
    label: event.interpretation.label,
    source: event.provenance?.sourceUrl ?? event.observation.sourceUrl,
    timestamp: event.observation.observedAt,
    effect: { ...event.effect },
  };
  return assertValidTrigger(trigger);
}

export function activateEvent(event) {
  if (!event || event.lifecycle !== LIFECYCLE.PENDING) {
    throw new TypeError('activateEvent requires a pending pipeline event');
  }
  // Validate before flipping lifecycle so bad effects never become active.
  toContractTrigger(event);
  return { ...event, lifecycle: LIFECYCLE.ACTIVE };
}

export function expireEvent(event) {
  if (!event || event.lifecycle !== LIFECYCLE.ACTIVE) {
    throw new TypeError('expireEvent requires an active pipeline event');
  }
  return { ...event, lifecycle: LIFECYCLE.EXPIRED };
}

export function clearEvent(event) {
  if (!event) throw new TypeError('clearEvent requires a pipeline event');
  if (event.lifecycle === LIFECYCLE.CLEARED) return event;
  if (event.lifecycle === LIFECYCLE.EXPIRED) {
    return { ...event, lifecycle: LIFECYCLE.CLEARED };
  }
  if (event.lifecycle !== LIFECYCLE.ACTIVE && event.lifecycle !== LIFECYCLE.PENDING) {
    throw new TypeError('clearEvent requires pending, active, or expired');
  }
  return { ...event, lifecycle: LIFECYCLE.CLEARED };
}

/**
 * Run observation → normalized → pending (interpreted) for one raw observation.
 */
export function ingestObservation(raw, interpretationInput = null) {
  const discovered = discoverObservation(raw);
  const normalized = normalizeEvent(discovered);
  return interpretEvent(normalized, interpretationInput);
}

/**
 * Registry helpers: supersession and clear without compounding.
 * Active triggers are uniquely keyed by observation id (and thus trigger id).
 */
export function emptyPipelineRegistry() {
  return { version: PIPELINE_VERSION, events: [] };
}

function cloneRegistry(registry) {
  const events = Array.isArray(registry?.events)
    ? registry.events.map((event) => ({
        ...event,
        observation: { ...event.observation },
        interpretation: event.interpretation ? { ...event.interpretation } : null,
        effect: event.effect ? { ...event.effect } : null,
        provenance: event.provenance ? { ...event.provenance } : null,
      }))
    : [];
  return { version: PIPELINE_VERSION, events };
}

function upsertEvent(registry, event) {
  const next = cloneRegistry(registry);
  const index = next.events.findIndex((row) => row.observation.id === event.observation.id);
  if (index >= 0) next.events[index] = event;
  else next.events.push(event);
  return next;
}

/**
 * Activate a pending event. If it supersedes another observation, that event
 * is expired (removed from the active stack). Re-activating the same
 * observation id replaces the prior entry instead of stacking a second copy.
 */
export function activateInRegistry(registry, pendingEvent) {
  let event = pendingEvent;
  if (event.lifecycle === LIFECYCLE.PENDING) {
    event = activateEvent(event);
  } else if (event.lifecycle !== LIFECYCLE.ACTIVE) {
    throw new TypeError('activateInRegistry requires pending or active');
  }

  let next = cloneRegistry(registry);

  if (event.supersedes) {
    next.events = next.events.map((row) => {
      if (row.observation.id !== event.supersedes) return row;
      if (row.lifecycle === LIFECYCLE.ACTIVE) return expireEvent(row);
      if (row.lifecycle === LIFECYCLE.PENDING) return clearEvent(row);
      return row;
    });
  }

  // Same observation id replaces; never two active copies.
  next.events = next.events.filter((row) => row.observation.id !== event.observation.id);
  next.events.push(event);
  return { registry: next, event };
}

export function clearRegistry(registry) {
  const next = cloneRegistry(registry);
  next.events = next.events.map((event) => {
    if (event.lifecycle === LIFECYCLE.CLEARED || event.lifecycle === LIFECYCLE.EXPIRED) {
      return event.lifecycle === LIFECYCLE.EXPIRED ? clearEvent(event) : event;
    }
    if (ACTIVE_LIKE.has(event.lifecycle)) return clearEvent(event);
    return event;
  });
  return next;
}

export function expireInRegistry(registry, observationId) {
  const next = cloneRegistry(registry);
  next.events = next.events.map((event) => {
    if (event.observation.id !== observationId) return event;
    if (event.lifecycle === LIFECYCLE.ACTIVE) return expireEvent(event);
    return event;
  });
  return next;
}

/** Active contract triggers currently affecting the game (unique by id). */
export function activeTriggersFromRegistry(registry) {
  const active = (registry?.events ?? []).filter((event) => event.lifecycle === LIFECYCLE.ACTIVE);
  const byId = new Map();
  for (const event of active) {
    const trigger = toContractTrigger(event);
    byId.set(trigger.id, trigger);
  }
  return [...byId.values()].sort((left, right) => {
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });
}

/**
 * Ingest a list of observations into a registry: interpret → activate, applying
 * supersession. Re-ingesting the same observation replaces rather than stacks.
 */
export function ingestObservationsIntoRegistry(registry, observations, interpretationFor = null) {
  let next = cloneRegistry(registry);
  const activated = [];
  for (const raw of observations) {
    const hints = typeof interpretationFor === 'function'
      ? interpretationFor(raw)
      : null;
    const pending = ingestObservation(raw, hints);
    const result = activateInRegistry(next, pending);
    next = result.registry;
    activated.push(result.event);
  }
  return { registry: next, activated };
}

export function summarizeProvenance(event) {
  if (!event?.provenance) return '';
  const { adapterId, sourceUrl, observedAt } = event.provenance;
  return `${adapterId} · ${sourceUrl} · ${observedAt}`;
}

/** Light UI readout for a pipeline event. */
export function describePipelineEvent(event) {
  const label = event.interpretation?.label ?? event.observation?.id ?? 'event';
  const lifecycle = event.lifecycle ?? 'unknown';
  const evidence = event.provenance?.evidence ?? event.observation?.evidence ?? '';
  const shortEvidence = evidence.length > 96 ? `${evidence.slice(0, 93)}…` : evidence;
  return {
    label,
    lifecycle,
    evidence: shortEvidence,
    provenance: summarizeProvenance(event),
    triggerId: event.triggerId,
    observationId: event.observation?.id ?? null,
  };
}

export { upsertEvent };
