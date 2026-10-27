/**
 * HTTP stub adapter — same Observation contract as the fixture adapter.
 *
 * Accepts preloaded response bodies (no network). A future Firecrawl adapter
 * should map scrape results into this same shape, then hand them to
 * `eventPipeline` for interpretation → validated TRIGGER_CONTRACT effects.
 */

export const HTTP_STUB_ADAPTER_ID = 'http_stub';

/**
 * @param {Array<{ id: string, sourceUrl: string, observedAt: string, evidence: string, supersedes?: string, hints?: object }>} bodies
 */
export function collectHttpStubObservations(bodies) {
  if (!Array.isArray(bodies)) {
    throw new TypeError('http stub bodies must be an array');
  }
  return bodies.map((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError(`http stub body at ${index} must be an object`);
    }
    if (typeof row.id !== 'string' || row.id.trim() === '') {
      throw new TypeError(`http stub body at ${index} requires id`);
    }
    if (typeof row.sourceUrl !== 'string' || row.sourceUrl.trim() === '') {
      throw new TypeError(`http stub body at ${index} requires sourceUrl`);
    }
    if (typeof row.observedAt !== 'string' || Number.isNaN(Date.parse(row.observedAt))) {
      throw new TypeError(`http stub body at ${index} requires observedAt ISO-8601`);
    }
    if (typeof row.evidence !== 'string' || row.evidence.trim() === '') {
      throw new TypeError(`http stub body at ${index} requires evidence`);
    }
    return {
      id: row.id,
      sourceUrl: row.sourceUrl.trim(),
      observedAt: new Date(row.observedAt).toISOString(),
      evidence: row.evidence.trim(),
      adapterId: HTTP_STUB_ADAPTER_ID,
      fixtureId: null,
      supersedes: typeof row.supersedes === 'string' ? row.supersedes : null,
      hints: row.hints && typeof row.hints === 'object' ? structuredClone(row.hints) : null,
    };
  });
}
