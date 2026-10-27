/**
 * Client helper: run fixture (or registry) ingest into local simulation state.
 * Mirrors server ingestAndPersist but stays offline / network-free.
 */

import { collectFixtureObservations } from './adapters/fixtureAdapter.js';
import {
  activeTriggersFromRegistry,
  describePipelineEvent,
  emptyPipelineRegistry,
  ingestObservationsIntoRegistry,
} from './eventPipeline.js';
import { applyTrigger, removeTrigger } from './simulation.js';

/**
 * Ingest fixture observations → activate (with supersession) → apply contract
 * triggers onto sim state. Expired/superseded pipeline trigger ids are removed
 * so effects never compound.
 */
export function ingestFixtureIntoState(state, fixtureId = 'civic-wage-bulletin') {
  const observations = collectFixtureObservations(fixtureId);
  const { registry } = ingestObservationsIntoRegistry(emptyPipelineRegistry(), observations);
  const active = activeTriggersFromRegistry(registry);
  const activeIds = new Set(active.map((trigger) => trigger.id));

  let next = state;
  for (const event of registry.events) {
    const id = event.triggerId;
    if (!id || activeIds.has(id)) continue;
    if ((next.activeTriggers ?? []).some((row) => row.id === id)) {
      next = removeTrigger(next, id);
    }
  }
  for (const trigger of active) {
    next = applyTrigger(next, trigger);
  }

  return {
    state: next,
    registry,
    triggers: active,
    events: registry.events.map(describePipelineEvent),
  };
}
