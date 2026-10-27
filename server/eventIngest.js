/**
 * Server-side real-world ingest: fixture (or http stub) → pipeline → createTrigger.
 * Network-free by default so CI stays deterministic. Firecrawl can later plug in
 * behind the same Observation → interpretation → TRIGGER_CONTRACT path.
 */

import { collectFixtureObservations, listFixtureIds } from '../src/adapters/fixtureAdapter.js';
import { collectHttpStubObservations } from '../src/adapters/httpStubAdapter.js';
import {
  activeTriggersFromRegistry,
  describePipelineEvent,
  emptyPipelineRegistry,
  ingestObservationsIntoRegistry,
} from '../src/eventPipeline.js';
import { TriggerValidationError } from '../src/triggerContract.js';
import { createTrigger } from './triggers.js';

function issue(path, code, message) {
  return { path, code, message };
}

export function validateIngestRequest(input) {
  if (input == null) {
    return { ok: true, value: { adapter: 'fixture', fixtureId: 'civic-wage-bulletin' } };
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      issues: [issue('', 'invalid_type', 'Ingest request must be a JSON object')],
    };
  }
  const issues = [];
  const allowed = new Set(['adapter', 'fixtureId', 'observations']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      issues.push(issue(key, 'unknown_field', `Unknown field: ${key}`));
    }
  }

  const adapter = Object.prototype.hasOwnProperty.call(input, 'adapter')
    ? input.adapter
    : 'fixture';
  if (adapter !== 'fixture' && adapter !== 'http_stub') {
    issues.push(
      issue('adapter', 'invalid_value', 'adapter must be one of: fixture, http_stub'),
    );
  }

  let fixtureId = 'civic-wage-bulletin';
  if (adapter === 'fixture') {
    if (Object.prototype.hasOwnProperty.call(input, 'fixtureId')) {
      if (typeof input.fixtureId !== 'string' || input.fixtureId.trim() === '') {
        issues.push(issue('fixtureId', 'invalid_type', 'fixtureId must be a non-empty string'));
      } else if (!listFixtureIds().includes(input.fixtureId)) {
        issues.push(
          issue(
            'fixtureId',
            'invalid_value',
            `fixtureId must be one of: ${listFixtureIds().join(', ')}`,
          ),
        );
      } else {
        fixtureId = input.fixtureId;
      }
    }
    if (Object.prototype.hasOwnProperty.call(input, 'observations')) {
      issues.push(
        issue('observations', 'unknown_field', 'observations is only valid for adapter http_stub'),
      );
    }
  }

  let observations = null;
  if (adapter === 'http_stub') {
    if (!Array.isArray(input.observations)) {
      issues.push(issue('observations', 'invalid_type', 'observations must be an array'));
    } else {
      observations = input.observations;
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      adapter,
      fixtureId: adapter === 'fixture' ? fixtureId : null,
      observations,
    },
  };
}

export function runPipelineIngest(request) {
  const validated = validateIngestRequest(request);
  if (!validated.ok) {
    throw new TriggerValidationError('Invalid ingest request', validated.issues);
  }
  const { adapter, fixtureId, observations: stubBodies } = validated.value;
  let observations;
  switch (adapter) {
    case 'fixture':
      observations = collectFixtureObservations(fixtureId);
      break;
    case 'http_stub':
      observations = collectHttpStubObservations(stubBodies);
      break;
    default: {
      const unexpected = adapter;
      throw new Error(`Unknown ingest adapter: ${String(unexpected)}`);
    }
  }
  const { registry, activated } = ingestObservationsIntoRegistry(
    emptyPipelineRegistry(),
    observations,
  );
  return {
    adapter,
    fixtureId,
    registry,
    activated,
    triggers: activeTriggersFromRegistry(registry),
    events: registry.events.map(describePipelineEvent),
  };
}

/**
 * Persist active pipeline triggers through the existing createTrigger path
 * (same-id replace, restack from baselines — no compounding).
 */
export async function ingestAndPersist(pool, request) {
  const result = runPipelineIngest(request);
  const stored = [];
  for (const trigger of result.triggers) {
    stored.push(await createTrigger(pool, trigger));
  }
  return {
    adapter: result.adapter,
    fixtureId: result.fixtureId,
    events: result.events,
    triggers: stored,
  };
}
