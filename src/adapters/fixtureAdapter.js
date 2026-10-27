/**
 * Fixture source adapter for the real-world event pipeline.
 *
 * Produces Observations only (URL / time / evidence). Interpretation and
 * TRIGGER_CONTRACT validation live in `eventPipeline.js`. Firecrawl (or any
 * live scraper) can later implement the same Observation shape; this adapter
 * stays network-free so tests remain deterministic.
 */

import { civicWageBulletin } from './fixtures/civicWageBulletin.js';

export const FIXTURE_ADAPTER_ID = 'fixture';

const FIXTURES = Object.freeze({
  'civic-wage-bulletin': civicWageBulletin,
});

export function listFixtureIds() {
  return Object.keys(FIXTURES);
}

export function loadFixture(fixtureId = 'civic-wage-bulletin') {
  const fixture = FIXTURES[fixtureId];
  if (!fixture) {
    const error = new Error(`Unknown fixture: ${fixtureId}`);
    error.code = 'unknown_fixture';
    throw error;
  }
  return structuredClone(fixture);
}

/**
 * Collect Observations from a named fixture (default civic-wage-bulletin).
 * Does not interpret or validate game effects.
 */
export function collectFixtureObservations(fixtureId = 'civic-wage-bulletin') {
  const fixture = loadFixture(fixtureId);
  const rows = Array.isArray(fixture.observations) ? fixture.observations : [];
  return rows.map((row) => ({
    id: row.id,
    sourceUrl: row.sourceUrl,
    observedAt: row.observedAt,
    evidence: row.evidence,
    adapterId: FIXTURE_ADAPTER_ID,
    fixtureId: fixture.fixtureId ?? fixtureId,
    supersedes: typeof row.supersedes === 'string' ? row.supersedes : null,
    hints: row.hints && typeof row.hints === 'object' ? structuredClone(row.hints) : null,
  }));
}
