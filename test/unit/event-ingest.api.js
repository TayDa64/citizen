import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runPipelineIngest,
  validateIngestRequest,
} from '../../server/eventIngest.js';
import { TriggerValidationError } from '../../src/triggerContract.js';

test('validateIngestRequest defaults to fixture civic-wage-bulletin', () => {
  const result = validateIngestRequest(undefined);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    adapter: 'fixture',
    fixtureId: 'civic-wage-bulletin',
    campaignId: null,
  });
});

test('validateIngestRequest rejects unknown adapter and unknown fixture', () => {
  assert.equal(validateIngestRequest({ adapter: 'firecrawl' }).ok, false);
  assert.equal(validateIngestRequest({ adapter: 'fixture', fixtureId: 'nope' }).ok, false);
});

test('validateIngestRequest accepts optional campaignId UUID (CIT-69 default off)', () => {
  const without = validateIngestRequest({ adapter: 'fixture' });
  assert.equal(without.ok, true);
  assert.equal(without.value.campaignId, null);
  const withId = validateIngestRequest({
    adapter: 'fixture',
    campaignId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(withId.ok, true);
  assert.equal(withId.value.campaignId, '11111111-1111-4111-8111-111111111111');
  assert.equal(validateIngestRequest({ campaignId: 'not-a-uuid' }).ok, false);
});

test('adapter firecrawl stays rejected at pipeline entry', () => {
  assert.throws(
    () => runPipelineIngest({ adapter: 'firecrawl' }),
    (error) => error instanceof TriggerValidationError,
  );
});

test('runPipelineIngest fixture produces one active contract trigger after supersession', () => {
  const result = runPipelineIngest({ adapter: 'fixture', fixtureId: 'civic-wage-bulletin' });
  assert.equal(result.adapter, 'fixture');
  assert.equal(result.triggers.length, 1);
  assert.equal(result.triggers[0].id, 'evt-pipeline-obs-civic-wage-bulletin-2026-04-revision');
  assert.equal(result.triggers[0].effect.talentCost, 0.08);
  assert.equal(result.triggers[0].source.startsWith('https://example.local/'), true);
  const lifecycles = result.events.map((event) => event.lifecycle).sort();
  assert.deepEqual(lifecycles, ['active', 'expired']);
});

test('runPipelineIngest http_stub accepts preloaded observations without network', () => {
  const result = runPipelineIngest({
    adapter: 'http_stub',
    observations: [
      {
        id: 'obs-stub-1',
        sourceUrl: 'https://example.local/stub',
        observedAt: '2026-06-01T00:00:00.000Z',
        evidence: 'Stub evidence for pipeline plug-in point.',
        hints: {
          type: 'news_spike',
          label: 'Stub spike',
          effect: { hype: 0.05 },
        },
      },
    ],
  });
  assert.equal(result.triggers.length, 1);
  assert.equal(result.triggers[0].effect.hype, 0.05);
  assert.equal(result.events[0].lifecycle, 'active');
});
