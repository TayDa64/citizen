import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MOCK_TRIGGERS,
  validateMockRequest,
  validateTriggerPayload,
  validateTriggerRecord
} from '../src/triggerContract.js';

const HYPE_MOCK = {
  type: 'news',
  label: 'Mock press cycle lifts founder hype',
  source: 'mock:press-cycle',
  effect: { hype: 0.1 }
};

const TALENT_MOCK = {
  type: 'talent',
  label: 'Mock hiring surge raises talent cost',
  source: 'mock:labor-market',
  effect: { talentCost: 500 }
};

function issueCodes(result, path) {
  return result.issues.filter((issue) => issue.path === path).map((issue) => issue.code);
}

describe('trigger payload contract', () => {
  test('mock payloads match the frontend shape and validate', () => {
    assert.deepEqual(MOCK_TRIGGERS.hype, HYPE_MOCK);
    assert.deepEqual(MOCK_TRIGGERS.talent, TALENT_MOCK);

    const hype = validateTriggerPayload(HYPE_MOCK);
    const talent = validateTriggerPayload(TALENT_MOCK);
    assert.equal(hype.ok, true);
    assert.equal(talent.ok, true);
    assert.deepEqual(Object.keys(hype.value.effect), ['hype']);
    assert.deepEqual(Object.keys(talent.value.effect), ['talentCost']);
  });

  test('accepts both effect fields and trims label and source', () => {
    const result = validateTriggerPayload({
      type: 'market',
      label: '  Market brief  ',
      source: '  mock:market  ',
      effect: { hype: -0.25, talentCost: -250.5 }
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.label, 'Market brief');
    assert.equal(result.value.source, 'mock:market');
    assert.deepEqual(result.value.effect, { hype: -0.25, talentCost: -250.5 });
  });

  test('does not mutate the caller payload', () => {
    const payload = {
      type: 'policy',
      label: '  Policy note  ',
      source: 'mock:policy',
      effect: { hype: 0.2 }
    };
    const snapshot = structuredClone(payload);
    validateTriggerPayload(payload);
    assert.deepEqual(payload, snapshot);
  });

  test('rejects unknown fields, missing effect, and empty effect', () => {
    const unknown = validateTriggerPayload({ ...HYPE_MOCK, id: 'nope' });
    assert.equal(unknown.ok, false);
    assert.deepEqual(issueCodes(unknown, 'id'), ['unknown_field']);

    const missing = validateTriggerPayload({ type: 'news', label: 'A', source: 'mock:a' });
    assert.equal(missing.ok, false);
    assert.deepEqual(issueCodes(missing, 'effect'), ['required']);

    const empty = validateTriggerPayload({ ...HYPE_MOCK, effect: {} });
    assert.equal(empty.ok, false);
    assert.deepEqual(issueCodes(empty, 'effect'), ['empty']);
  });

  test('rejects target fields outside hype and talentCost', () => {
    for (const field of ['burnRate', 'cash', 'taxRate', 'productQuality']) {
      const result = validateTriggerPayload({ ...HYPE_MOCK, effect: { [field]: 1 } });
      assert.equal(result.ok, false, field);
      assert.deepEqual(issueCodes(result, `effect.${field}`), ['unknown_field']);
    }
  });

  test('rejects bad types, non-finite numbers, precision, and bounds', () => {
    assert.equal(validateTriggerPayload(null).ok, false);
    assert.equal(validateTriggerPayload(['news']).ok, false);
    assert.equal(validateTriggerPayload({ ...HYPE_MOCK, type: 'weather' }).ok, false);
    assert.deepEqual(
      issueCodes(validateTriggerPayload({ ...HYPE_MOCK, type: 'weather' }), 'type'),
      ['invalid_value']
    );

    const numericString = validateTriggerPayload({ ...HYPE_MOCK, effect: { hype: '0.1' } });
    assert.deepEqual(issueCodes(numericString, 'effect.hype'), ['invalid_type']);

    const nan = validateTriggerPayload({ ...HYPE_MOCK, effect: { hype: Number.NaN } });
    assert.deepEqual(issueCodes(nan, 'effect.hype'), ['invalid_number']);

    const infinite = validateTriggerPayload({
      ...TALENT_MOCK,
      effect: { talentCost: Number.POSITIVE_INFINITY }
    });
    assert.deepEqual(issueCodes(infinite, 'effect.talentCost'), ['invalid_number']);

    const precise = validateTriggerPayload({ ...HYPE_MOCK, effect: { hype: 0.00001 } });
    assert.deepEqual(issueCodes(precise, 'effect.hype'), ['invalid_precision']);

    const money = validateTriggerPayload({ ...TALENT_MOCK, effect: { talentCost: 10.123 } });
    assert.deepEqual(issueCodes(money, 'effect.talentCost'), ['invalid_precision']);

    const high = validateTriggerPayload({ ...HYPE_MOCK, effect: { hype: 1.5 } });
    assert.deepEqual(issueCodes(high, 'effect.hype'), ['out_of_range']);

    const low = validateTriggerPayload({ ...TALENT_MOCK, effect: { talentCost: -100001 } });
    assert.deepEqual(issueCodes(low, 'effect.talentCost'), ['out_of_range']);

    const edges = validateTriggerPayload({
      ...HYPE_MOCK,
      effect: { hype: -1, talentCost: 100000 }
    });
    assert.equal(edges.ok, true);
  });

  test('rejects empty, overlong, and control-character strings', () => {
    const emptyLabel = validateTriggerPayload({ ...HYPE_MOCK, label: '   ' });
    assert.deepEqual(issueCodes(emptyLabel, 'label'), ['empty']);

    const longLabel = validateTriggerPayload({ ...HYPE_MOCK, label: 'a'.repeat(161) });
    assert.deepEqual(issueCodes(longLabel, 'label'), ['too_long']);

    const newline = validateTriggerPayload({ ...HYPE_MOCK, source: 'mock:bad\nline' });
    assert.deepEqual(issueCodes(newline, 'source'), ['invalid_characters']);
  });
});

describe('trigger record contract', () => {
  const record = {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'news',
    label: 'Mock press cycle lifts founder hype',
    source: 'mock:press-cycle',
    timestamp: '2026-10-26T15:00:00.000Z',
    effect: { hype: 0.1 }
  };

  test('accepts the camelCase record the frontend renders', () => {
    const result = validateTriggerRecord(record);
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.value).sort(), [
      'effect',
      'id',
      'label',
      'source',
      'timestamp',
      'type'
    ]);
    assert.equal(result.value.id, record.id);
    assert.equal(result.value.timestamp, record.timestamp);
  });

  test('rejects unknown record fields and bad id or timestamp', () => {
    const extra = validateTriggerRecord({ ...record, processed: true });
    assert.deepEqual(issueCodes(extra, 'processed'), ['unknown_field']);

    const badId = validateTriggerRecord({ ...record, id: 'not-a-uuid' });
    assert.deepEqual(issueCodes(badId, 'id'), ['invalid_value']);

    const badTime = validateTriggerRecord({ ...record, timestamp: 'yesterday' });
    assert.deepEqual(issueCodes(badTime, 'timestamp'), ['invalid_value']);
  });
});

describe('mock request', () => {
  test('defaults to the hype scenario and allows talent', () => {
    assert.deepEqual(validateMockRequest(undefined), { ok: true, scenario: 'hype' });
    assert.deepEqual(validateMockRequest({}), { ok: true, scenario: 'hype' });
    assert.deepEqual(validateMockRequest({ scenario: 'talent' }), { ok: true, scenario: 'talent' });
  });

  test('rejects unknown scenarios and unknown fields', () => {
    const scenario = validateMockRequest({ scenario: 'burn' });
    assert.equal(scenario.ok, false);
    assert.deepEqual(issueCodes(scenario, 'scenario'), ['invalid_value']);

    const extra = validateMockRequest({ scenario: 'hype', effect: { hype: 1 } });
    assert.equal(extra.ok, false);
    assert.deepEqual(issueCodes(extra, 'effect'), ['unknown_field']);
  });
});
