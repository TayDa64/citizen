import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SAMPLE_TRIGGERS,
  TRIGGER_FIELDS,
  TRIGGER_TYPES,
  describeTrigger,
  mockTriggerPayload,
  stackTriggerEffects,
  validateMockRequest,
  validateTriggerPayload,
  validateTriggerRecord
} from '../../src/triggerContract.js';

const [POLICY, NEWS, MARKET] = SAMPLE_TRIGGERS;

function issueCodes(result, path) {
  return result.issues.filter((issue) => issue.path === path).map((issue) => issue.code);
}

describe('TRIGGER_CONTRACT v1', () => {
  test('samples, types, and announcements match the frontend contract', () => {
    assert.deepEqual(TRIGGER_TYPES, ['news_spike', 'policy_change', 'market_shift']);
    assert.deepEqual(TRIGGER_FIELDS, ['id', 'type', 'label', 'source', 'timestamp', 'effect']);
    assert.deepEqual(POLICY, {
      id: 'evt-policy-wage-ordinance',
      type: 'policy_change',
      label: 'Policy change',
      source: 'mock:local',
      timestamp: '2026-04-02T15:00:00.000Z',
      effect: { talentCost: 0.12 }
    });
    assert.deepEqual(NEWS.effect, { hype: 0.1 });
    assert.deepEqual(MARKET.effect, { talentCost: -0.08, hype: -0.05 });
    assert.equal(describeTrigger(POLICY), 'Policy change: talent cost +12%');
    assert.equal(describeTrigger(NEWS), 'News spike: hype +10%');
    assert.equal(describeTrigger(MARKET), 'Market shift: talent cost -8%, hype -5%');
    for (const sample of SAMPLE_TRIGGERS) {
      assert.equal(validateTriggerPayload(sample).ok, true);
      assert.equal(validateTriggerRecord(sample).ok, true);
    }
  });

  test('accepts a zero companion field, trims label and source, and keeps the id', () => {
    const result = validateTriggerPayload({
      ...MARKET,
      label: '  Market shift  ',
      source: '  mock:local  ',
      effect: { hype: 0.1, talentCost: 0 }
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.id, MARKET.id);
    assert.equal(result.value.label, 'Market shift');
    assert.equal(result.value.source, 'mock:local');
    assert.deepEqual(result.value.effect, { hype: 0.1, talentCost: 0 });
    assert.equal(result.value.timestamp, MARKET.timestamp);
  });

  test('does not mutate the caller payload', () => {
    const payload = {
      ...POLICY,
      label: '  Policy change  ',
      effect: { talentCost: 0.12 }
    };
    const snapshot = structuredClone(payload);
    validateTriggerPayload(payload);
    assert.deepEqual(payload, snapshot);
  });

  test('rejects unknown fields, legacy types, and effects that do not move', () => {
    const extra = validateTriggerPayload({ ...NEWS, appliedAtIndex: 2 });
    assert.equal(extra.ok, false);
    assert.deepEqual(issueCodes(extra, 'appliedAtIndex'), ['unknown_field']);

    const legacy = validateTriggerPayload({ ...NEWS, type: 'news' });
    assert.deepEqual(issueCodes(legacy, 'type'), ['invalid_value']);
    for (const type of ['market', 'talent', 'policy']) {
      assert.equal(validateTriggerPayload({ ...NEWS, type }).ok, false, type);
    }

    const missing = validateTriggerPayload({
      type: 'news_spike',
      label: 'A',
      source: 'mock:a',
      timestamp: NEWS.timestamp
    });
    assert.deepEqual(issueCodes(missing, 'id'), ['required']);
    assert.deepEqual(issueCodes(missing, 'effect'), ['required']);

    const empty = validateTriggerPayload({ ...NEWS, effect: {} });
    assert.deepEqual(issueCodes(empty, 'effect'), ['empty']);
    const zero = validateTriggerPayload({ ...NEWS, effect: { hype: 0, talentCost: 0 } });
    assert.deepEqual(issueCodes(zero, 'effect'), ['empty']);
  });

  test('rejects target fields outside hype and talentCost', () => {
    for (const field of ['burnRate', 'cash', 'taxRate', 'productQuality']) {
      const result = validateTriggerPayload({ ...NEWS, effect: { [field]: 1 } });
      assert.equal(result.ok, false, field);
      assert.deepEqual(issueCodes(result, `effect.${field}`), ['unknown_field']);
    }
  });

  test('rejects bad ids, timestamps, non-finite numbers, precision, and bounds', () => {
    assert.equal(validateTriggerPayload(null).ok, false);
    assert.equal(validateTriggerPayload(['news_spike']).ok, false);
    assert.deepEqual(issueCodes(validateTriggerPayload({ ...NEWS, id: '   ' }), 'id'), ['empty']);
    assert.deepEqual(
      issueCodes(validateTriggerPayload({ ...NEWS, id: ' evt ' }), 'id'),
      ['invalid_value']
    );

    const badTime = validateTriggerPayload({ ...NEWS, timestamp: 'yesterday' });
    assert.deepEqual(issueCodes(badTime, 'timestamp'), ['invalid_value']);

    const numericString = validateTriggerPayload({ ...NEWS, effect: { hype: '0.1' } });
    assert.deepEqual(issueCodes(numericString, 'effect.hype'), ['invalid_type']);

    const infinite = validateTriggerPayload({
      ...POLICY,
      effect: { talentCost: Number.POSITIVE_INFINITY }
    });
    assert.deepEqual(issueCodes(infinite, 'effect.talentCost'), ['invalid_number']);

    const precise = validateTriggerPayload({ ...NEWS, effect: { hype: 0.00001 } });
    assert.deepEqual(issueCodes(precise, 'effect.hype'), ['invalid_precision']);

    const high = validateTriggerPayload({ ...NEWS, effect: { hype: 1.5 } });
    assert.deepEqual(issueCodes(high, 'effect.hype'), ['out_of_range']);

    const low = validateTriggerPayload({ ...POLICY, effect: { talentCost: 1.00001 } });
    assert.deepEqual(issueCodes(low, 'effect.talentCost'), ['invalid_precision']);
    const tooHigh = validateTriggerPayload({ ...POLICY, effect: { talentCost: 101 } });
    const below = validateTriggerPayload({ ...POLICY, effect: { talentCost: -100.01 } });
    assert.deepEqual(issueCodes(below, 'effect.talentCost'), ['out_of_range']);
    assert.deepEqual(issueCodes(tooHigh, 'effect.talentCost'), ['out_of_range']);

    const edges = validateTriggerPayload({
      ...MARKET,
      effect: { hype: -1, talentCost: -5 }
    });
    assert.equal(edges.ok, true);
    assert.equal(
      validateTriggerPayload({ ...POLICY, effect: { talentCost: 100 } }).ok,
      true
    );
  });

  test('rejects empty, overlong, and control-character strings', () => {
    const emptyLabel = validateTriggerPayload({ ...NEWS, label: '   ' });
    assert.deepEqual(issueCodes(emptyLabel, 'label'), ['empty']);

    const longLabel = validateTriggerPayload({ ...NEWS, label: 'a'.repeat(161) });
    assert.deepEqual(issueCodes(longLabel, 'label'), ['too_long']);

    const newline = validateTriggerPayload({ ...NEWS, source: 'mock:bad\nline' });
    assert.deepEqual(issueCodes(newline, 'source'), ['invalid_characters']);
  });

  test('talent cost multiplies the baseline and hype adds, including a floor at 0', () => {
    assert.deepEqual(stackTriggerEffects({ hype: 0.3, talentCost: 4000 }, [POLICY]), {
      hype: 0.3,
      talentCost: 4480
    });
    assert.deepEqual(
      stackTriggerEffects({ hype: 0.3, talentCost: 4000 }, [
        { ...POLICY, effect: { talentCost: 0.2 } }
      ]),
      { hype: 0.3, talentCost: 4800 }
    );
    assert.deepEqual(stackTriggerEffects({ hype: 0.3, talentCost: 4000 }, [POLICY, MARKET]), {
      hype: 0.25,
      talentCost: 4121.6
    });
    assert.deepEqual(
      stackTriggerEffects({ hype: 0.3, talentCost: 4000 }, [
        POLICY,
        { id: 'evt-shock', effect: { talentCost: -5 } }
      ]),
      { hype: 0.3, talentCost: 0 }
    );
    assert.equal(
      stackTriggerEffects({ hype: 0.95, talentCost: 4000 }, [NEWS]).hype,
      1
    );
    assert.throws(() =>
      stackTriggerEffects(
        { hype: 0.3, talentCost: 4000 },
        [0, 1, 2, 3].map((index) => ({
          id: `evt-big-${index}`,
          effect: { talentCost: 100 }
        }))
      )
    );
  });
});

describe('mock request', () => {
  test('defaults to the news spike sample and clones every sample', () => {
    assert.deepEqual(validateMockRequest(undefined), { ok: true, scenario: 'news_spike' });
    assert.deepEqual(validateMockRequest({}), { ok: true, scenario: 'news_spike' });
    assert.deepEqual(validateMockRequest({ scenario: 'policy_change' }), {
      ok: true,
      scenario: 'policy_change'
    });
    assert.deepEqual(mockTriggerPayload('policy_change'), POLICY);
    assert.deepEqual(mockTriggerPayload('news_spike'), NEWS);
    assert.deepEqual(mockTriggerPayload('market_shift'), MARKET);
    const cloned = mockTriggerPayload('news_spike');
    cloned.effect.hype = 0;
    assert.equal(NEWS.effect.hype, 0.1);
  });

  test('rejects legacy scenario names and unknown fields', () => {
    const scenario = validateMockRequest({ scenario: 'talent' });
    assert.equal(scenario.ok, false);
    assert.deepEqual(issueCodes(scenario, 'scenario'), ['invalid_value']);

    const extra = validateMockRequest({ scenario: 'news_spike', effect: { hype: 1 } });
    assert.equal(extra.ok, false);
    assert.deepEqual(issueCodes(extra, 'effect'), ['unknown_field']);
  });
});
