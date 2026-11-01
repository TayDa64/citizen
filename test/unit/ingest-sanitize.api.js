/**
 * CIT-120 Rank-1 — sanitize gate + content gate (unit, network-off).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mapFetchToHttpStubObservations,
  liveFetchAllowlisted,
} from '../../src/adapters/allowlistedHttps.js';
import {
  MAX_OBSERVATION_EVIDENCE_CHARS,
  passesLibraryMinutesContentGate,
  validateHttpStubObservations,
} from '../../src/adapters/ingestSanitize.js';
import { validateIngestRequest } from '../../server/eventIngest.js';
import { TriggerValidationError } from '../../src/triggerContract.js';
import { toContractTrigger, ingestObservation } from '../../src/eventPipeline.js';
import { MV_LIBRARY_MINUTES_SOURCE_URL } from '../../src/adapters/fixtures/mvLibraryMinutes3458.js';

test('library minutes content gate rejects unmarked HTML', () => {
  assert.equal(passesLibraryMinutesContentGate('random html'), false);
  assert.equal(
    passesLibraryMinutesContentGate(
      'Board of Library Trustees minutes record a community talent stipend',
    ),
    true,
  );
});

test('partial minutes envelope (missing url/ts) yields zero observations', () => {
  assert.deepEqual(
    mapFetchToHttpStubObservations({
      ok: true,
      status: 200,
      externalEventId: '3458',
      bodyText:
        'Board of Library Trustees minutes record a community talent stipend and attention',
    }),
    [],
  );
});

test('evil minutesUrl fails closed (known PDF only)', () => {
  assert.deepEqual(
    mapFetchToHttpStubObservations({
      ok: true,
      status: 200,
      externalEventId: '3458',
      bodyText:
        'Board of Library Trustees minutes record a community talent stipend and attention',
      minutesUrl: 'https://evil.example/steal.pdf',
      minutesPublishedAt: '2026-10-20T16:35:16.597Z',
    }),
    [],
  );
  assert.equal(MV_LIBRARY_MINUTES_SOURCE_URL.includes('granicus.com'), true);
});

test('oversized evidence rejected at request validation', () => {
  const evidence = `${'Board of Library Trustees talent stipend '.padEnd(MAX_OBSERVATION_EVIDENCE_CHARS + 10, 'x')}`;
  const result = validateHttpStubObservations([
    {
      id: 'obs-mv-library-minutes-3458',
      sourceUrl: MV_LIBRARY_MINUTES_SOURCE_URL,
      observedAt: '2026-10-20T16:35:16.597Z',
      evidence,
      hints: {
        type: 'policy_change',
        label: 'Library board minutes',
        effect: { talentCost: 0.05, hype: 0.04 },
      },
    },
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((row) => row.code === 'too_long'));
});

test('malformed http_stub fails closed at request validation (not 500 path)', () => {
  const validated = validateIngestRequest({
    adapter: 'http_stub',
    observations: [{ id: 1 }],
  });
  assert.equal(validated.ok, false);
  assert.equal(
    validateIngestRequest({ adapter: 'http_stub', observations: 'nope' }).ok,
    false,
  );
});

test('pipeline toContractTrigger uses strict contract (oversize label fails closed)', () => {
  const pending = ingestObservation({
    id: 'obs-civic-wage-bulletin-2026-04',
    sourceUrl: 'https://example.local/civic/wage-bulletin-2026-04',
    observedAt: '2026-04-02T14:55:00.000Z',
    evidence: 'City council posted a living-wage bulletin.',
    hints: {
      type: 'policy_change',
      label: 'x'.repeat(161),
      effect: { talentCost: 0.08 },
    },
  });
  assert.throws(
    () => toContractTrigger(pending),
    (error) => error instanceof TriggerValidationError,
  );
});

test('liveFetchAllowlisted rejects cross-host redirect without following', async () => {
  const fetchImpl = async () => ({
    status: 302,
    ok: false,
    headers: { get: () => 'https://evil.example/capture' },
    text: async () => 'nope',
  });
  const envelope = await liveFetchAllowlisted(
    'https://mountainview.legistar.com/Calendar.aspx',
    { fetchImpl },
  );
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error, 'allowlist_redirect_rejected');
  assert.equal(envelope.bodyText, '');
});
