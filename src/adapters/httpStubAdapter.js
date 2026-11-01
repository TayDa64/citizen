/**
 * HTTP stub adapter — same Observation contract as the fixture adapter.
 *
 * Accepts preloaded response bodies (no network). A future Firecrawl adapter
 * should map scrape results into this same shape, then hand them to
 * `eventPipeline` for interpretation → validated TRIGGER_CONTRACT effects.
 * CIT-120: prefer validateIngestRequest / validateHttpStubObservations first
 * so bad payloads fail closed as TriggerValidationError (400), not TypeError.
 */

import { validateHttpStubObservations } from './ingestSanitize.js';
import { TriggerValidationError } from '../triggerContract.js';

export const HTTP_STUB_ADAPTER_ID = 'http_stub';

/**
 * @param {Array<{ id: string, sourceUrl: string, observedAt: string, evidence: string, supersedes?: string, hints?: object }>} bodies
 */
export function collectHttpStubObservations(bodies) {
  const validated = validateHttpStubObservations(bodies);
  if (!validated.ok) {
    throw new TriggerValidationError('Invalid http_stub observations', validated.issues);
  }
  return validated.value.map((row) => ({
    id: row.id,
    sourceUrl: row.sourceUrl,
    observedAt: row.observedAt,
    evidence: row.evidence,
    adapterId: HTTP_STUB_ADAPTER_ID,
    fixtureId: null,
    supersedes: row.supersedes,
    hints: row.hints,
  }));
}
