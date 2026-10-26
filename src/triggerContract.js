// TRIGGER_CONTRACT v1, the payload in the frontend src/triggers.js.
// Wire fields are exactly id, type, label, source, timestamp, and effect.
//
// Intentional differences from that module's assertValidTrigger:
// - Unknown top-level fields are rejected. appliedAtIndex is client runtime
//   and is not part of the payload.
// - effect.hype must be finite, within [-1, 1], at most 4 decimal places.
// - effect.talentCost must be finite, within [-100, 100], at most 4 decimal
//   places. The contract does not bound the multiplier. An unbounded product
//   can overflow companies.talent_cost NUMERIC(12,2). -5 is inside this
//   window and floors the company value at 0.
// - A stacked talent result that would exceed NUMERIC(12,2) after flooring
//   at 0 and rounding to 2 decimal places is rejected. The contract only
//   requires the floor.
// - Timestamps are stored and returned as Date#toISOString().
// - Label and source are trimmed.
// The talent baseline is companies.talent_cost (default 4000). This API does
// not adopt the client simulation's dimensionless baseline of 1, and it does
// not multiply burn rate by talent cost.

export const TRIGGER_CONTRACT_VERSION = 1;
export const TRIGGER_FIELDS = Object.freeze([
  'id',
  'type',
  'label',
  'source',
  'timestamp',
  'effect'
]);
export const TRIGGER_TYPES = Object.freeze(['news_spike', 'policy_change', 'market_shift']);
export const LEGACY_TRIGGER_TYPES = Object.freeze(['news', 'market', 'talent', 'policy']);
export const MOCK_SCENARIOS = TRIGGER_TYPES;

export const HYPE_DELTA_MIN = -1;
export const HYPE_DELTA_MAX = 1;
export const TALENT_RELATIVE_MIN = -100;
export const TALENT_RELATIVE_MAX = 100;
export const HYPE_MIN = 0;
export const HYPE_MAX = 1;
export const TALENT_COST_MIN = 0;
export const TALENT_COST_COLUMN_MAX = 9_999_999_999.99;
export const DEFAULT_HYPE = 0.3;
export const DEFAULT_TALENT_COST = 4000;
export const HYPE_BOUNDS = Object.freeze({
  min: HYPE_MIN,
  max: HYPE_MAX,
  decimals: 4,
  fallback: DEFAULT_HYPE
});
export const TALENT_COST_BOUNDS = Object.freeze({
  min: TALENT_COST_MIN,
  max: TALENT_COST_COLUMN_MAX,
  decimals: 2,
  fallback: DEFAULT_TALENT_COST
});
export const MAX_LABEL_LENGTH = 160;
export const MAX_SOURCE_LENGTH = 2048;
export const MAX_ID_LENGTH = 200;
export const MAX_TIMESTAMP_LENGTH = 64;

const TRIGGER_KEYS = new Set(TRIGGER_FIELDS);
const EFFECT_KEYS = new Set(['hype', 'talentCost']);
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function freezeTrigger(trigger) {
  Object.freeze(trigger.effect);
  return Object.freeze(trigger);
}

export const SAMPLE_TRIGGERS = Object.freeze([
  freezeTrigger({
    id: 'evt-policy-wage-ordinance',
    type: 'policy_change',
    label: 'Policy change',
    source: 'mock:local',
    timestamp: '2026-04-02T15:00:00.000Z',
    effect: { talentCost: 0.12 }
  }),
  freezeTrigger({
    id: 'evt-news-sector-spike',
    type: 'news_spike',
    label: 'News spike',
    source: 'mock:local',
    timestamp: '2026-04-18T13:30:00.000Z',
    effect: { hype: 0.1 }
  }),
  freezeTrigger({
    id: 'evt-market-cooling',
    type: 'market_shift',
    label: 'Market shift',
    source: 'mock:local',
    timestamp: '2026-05-01T09:00:00.000Z',
    effect: { talentCost: -0.08, hype: -0.05 }
  })
]);

export const MOCK_TRIGGERS = Object.freeze({
  policy_change: SAMPLE_TRIGGERS[0],
  news_spike: SAMPLE_TRIGGERS[1],
  market_shift: SAMPLE_TRIGGERS[2]
});

export class TriggerValidationError extends Error {
  constructor(message, issues) {
    super(message);
    this.name = 'TriggerValidationError';
    this.status = 400;
    this.issues = issues;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function issue(path, code, message) {
  return { path, code, message };
}

function hasDecimalPrecision(value, places) {
  const factor = 10 ** places;
  const scaled = value * factor;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}

export function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round((value + Math.sign(value) * 1e-10) * factor) / factor;
}

function validateText(issues, path, value, maxLength) {
  if (typeof value !== 'string') {
    issues.push(issue(path, 'invalid_type', `${path} must be a string`));
    return null;
  }
  if (CONTROL_CHARS.test(value)) {
    issues.push(issue(path, 'invalid_characters', `${path} must not contain control characters`));
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    issues.push(issue(path, 'empty', `${path} is required`));
    return null;
  }
  if (trimmed.length > maxLength) {
    issues.push(issue(path, 'too_long', `${path} must be at most ${maxLength} characters`));
    return null;
  }
  return trimmed;
}

function validateId(issues, value) {
  if (typeof value !== 'string') {
    issues.push(issue('id', 'invalid_type', 'id must be a string'));
    return null;
  }
  if (CONTROL_CHARS.test(value)) {
    issues.push(issue('id', 'invalid_characters', 'id must not contain control characters'));
    return null;
  }
  if (value.trim() === '') {
    issues.push(issue('id', 'empty', 'id is required'));
    return null;
  }
  if (value !== value.trim()) {
    issues.push(issue('id', 'invalid_value', 'id must not have surrounding whitespace'));
    return null;
  }
  if (value.length > MAX_ID_LENGTH) {
    issues.push(issue('id', 'too_long', `id must be at most ${MAX_ID_LENGTH} characters`));
    return null;
  }
  return value;
}

function validateTimestamp(issues, value) {
  if (typeof value !== 'string') {
    issues.push(issue('timestamp', 'invalid_type', 'timestamp must be a string'));
    return null;
  }
  if (CONTROL_CHARS.test(value) || value.trim() !== value) {
    issues.push(issue('timestamp', 'invalid_value', 'timestamp must be an ISO-8601 string'));
    return null;
  }
  if (value.length > MAX_TIMESTAMP_LENGTH) {
    issues.push(issue('timestamp', 'too_long', `timestamp must be at most ${MAX_TIMESTAMP_LENGTH} characters`));
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    issues.push(issue('timestamp', 'invalid_value', 'timestamp must be an ISO-8601 string'));
    return null;
  }
  return new Date(parsed).toISOString();
}

function validateDelta(issues, path, value, min, max, places) {
  if (typeof value !== 'number') {
    issues.push(issue(path, 'invalid_type', `${path} must be a number`));
    return;
  }
  if (!Number.isFinite(value)) {
    issues.push(issue(path, 'invalid_number', `${path} must be a finite number`));
    return;
  }
  if (!hasDecimalPrecision(value, places)) {
    issues.push(issue(path, 'invalid_precision', `${path} must have at most ${places} decimal places`));
    return;
  }
  if (value < min || value > max) {
    issues.push(issue(path, 'out_of_range', `${path} must be between ${min} and ${max}`));
  }
}

function rejectUnknown(issues, value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(issue(key, 'unknown_field', `Unknown field: ${key}`));
    }
  }
}

function validateEffect(issues, effect) {
  if (!isPlainObject(effect)) {
    issues.push(issue('effect', 'invalid_type', 'effect must be an object'));
    return null;
  }
  for (const key of Object.keys(effect)) {
    if (!EFFECT_KEYS.has(key)) {
      issues.push(issue(`effect.${key}`, 'unknown_field', `Unknown field: effect.${key}`));
    }
  }
  const hasHype = Object.prototype.hasOwnProperty.call(effect, 'hype');
  const hasTalent = Object.prototype.hasOwnProperty.call(effect, 'talentCost');
  if (!hasHype && !hasTalent) {
    issues.push(issue('effect', 'empty', 'Trigger.effect must change hype or talentCost'));
  }
  if (hasHype) {
    validateDelta(issues, 'effect.hype', effect.hype, HYPE_DELTA_MIN, HYPE_DELTA_MAX, 4);
  }
  if (hasTalent) {
    validateDelta(
      issues,
      'effect.talentCost',
      effect.talentCost,
      TALENT_RELATIVE_MIN,
      TALENT_RELATIVE_MAX,
      4
    );
  }
  const hypeMoves = hasHype && typeof effect.hype === 'number' && effect.hype !== 0;
  const talentMoves = hasTalent && typeof effect.talentCost === 'number' && effect.talentCost !== 0;
  const effectIssues = issues.some(
    (entry) => entry.path === 'effect' || entry.path.startsWith('effect.')
  );
  if (!effectIssues && !hypeMoves && !talentMoves) {
    issues.push(issue('effect', 'empty', 'Trigger.effect must change hype or talentCost'));
  }
  if (issues.some((entry) => entry.path === 'effect' || entry.path.startsWith('effect.'))) {
    return null;
  }
  const sanitized = {};
  if (hasHype) sanitized.hype = effect.hype;
  if (hasTalent) sanitized.talentCost = effect.talentCost;
  return sanitized;
}

function validateTrigger(input) {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: [issue('', 'invalid_type', 'Trigger must be an object')]
    };
  }
  const issues = [];
  rejectUnknown(issues, input, TRIGGER_KEYS);

  let id = null;
  if (!Object.prototype.hasOwnProperty.call(input, 'id')) {
    issues.push(issue('id', 'required', 'id is required'));
  } else {
    id = validateId(issues, input.id);
  }

  if (!Object.prototype.hasOwnProperty.call(input, 'type')) {
    issues.push(issue('type', 'required', 'type is required'));
  } else if (typeof input.type !== 'string') {
    issues.push(issue('type', 'invalid_type', 'type must be a string'));
  } else if (!TRIGGER_TYPES.includes(input.type)) {
    issues.push(
      issue('type', 'invalid_value', `type must be one of: ${TRIGGER_TYPES.join(', ')}`)
    );
  }

  let label = null;
  if (!Object.prototype.hasOwnProperty.call(input, 'label')) {
    issues.push(issue('label', 'required', 'label is required'));
  } else {
    label = validateText(issues, 'label', input.label, MAX_LABEL_LENGTH);
  }

  let source = null;
  if (!Object.prototype.hasOwnProperty.call(input, 'source')) {
    issues.push(issue('source', 'required', 'source is required'));
  } else {
    source = validateText(issues, 'source', input.source, MAX_SOURCE_LENGTH);
  }

  let timestamp = null;
  if (!Object.prototype.hasOwnProperty.call(input, 'timestamp')) {
    issues.push(issue('timestamp', 'required', 'timestamp is required'));
  } else {
    timestamp = validateTimestamp(issues, input.timestamp);
  }

  let effect = null;
  if (!Object.prototype.hasOwnProperty.call(input, 'effect')) {
    issues.push(issue('effect', 'required', 'effect is required'));
  } else {
    effect = validateEffect(issues, input.effect);
  }

  if (
    issues.length > 0 ||
    id == null ||
    label == null ||
    source == null ||
    timestamp == null ||
    effect == null
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      id,
      type: input.type,
      label,
      source,
      timestamp,
      effect
    }
  };
}

export function validateTriggerPayload(input) {
  return validateTrigger(input);
}

export function validateTriggerRecord(input) {
  return validateTrigger(input);
}

export function validateMockRequest(input) {
  if (input == null) return { ok: true, scenario: 'news_spike' };
  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: [issue('', 'invalid_type', 'Mock request must be a JSON object')]
    };
  }
  const issues = [];
  for (const key of Object.keys(input)) {
    if (key !== 'scenario') {
      issues.push(issue(key, 'unknown_field', `Unknown field: ${key}`));
    }
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'scenario')) {
    return issues.length > 0 ? { ok: false, issues } : { ok: true, scenario: 'news_spike' };
  }
  if (!MOCK_SCENARIOS.includes(input.scenario)) {
    issues.push(
      issue('scenario', 'invalid_value', `scenario must be one of: ${MOCK_SCENARIOS.join(', ')}`)
    );
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, scenario: input.scenario };
}

export function mockTriggerPayload(scenario) {
  switch (scenario) {
    case 'news_spike':
      return structuredClone(MOCK_TRIGGERS.news_spike);
    case 'policy_change':
      return structuredClone(MOCK_TRIGGERS.policy_change);
    case 'market_shift':
      return structuredClone(MOCK_TRIGGERS.market_shift);
    default: {
      const unexpected = scenario;
      throw new Error(`Unknown mock scenario: ${String(unexpected)}`);
    }
  }
}

export function stackTriggerEffects(baselines, triggers) {
  const hypeBaseline =
    baselines == null || baselines.hype == null || !Number.isFinite(Number(baselines.hype))
      ? DEFAULT_HYPE
      : Number(baselines.hype);
  const talentBaseline =
    baselines == null ||
    baselines.talentCost == null ||
    !Number.isFinite(Number(baselines.talentCost))
      ? DEFAULT_TALENT_COST
      : Number(baselines.talentCost);
  const ordered = [...triggers].sort((left, right) => {
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });
  let hype = hypeBaseline;
  let factor = 1;
  for (const trigger of ordered) {
    if (trigger.effect?.hype != null) hype += trigger.effect.hype;
    if (trigger.effect?.talentCost != null) factor *= 1 + trigger.effect.talentCost;
  }
  const talent = talentBaseline * factor;
  if (!Number.isFinite(hype) || !Number.isFinite(talent)) {
    throw new TriggerValidationError('Trigger effect is outside storable bounds', [
      issue('effect', 'out_of_range', 'Stacked trigger effects must be finite')
    ]);
  }
  const talentCost = roundTo(Math.max(0, talent), 2);
  if (talentCost > TALENT_COST_COLUMN_MAX) {
    throw new TriggerValidationError('Trigger effect is outside storable bounds', [
      issue(
        'effect.talentCost',
        'out_of_range',
        `Stacked talent cost must fit NUMERIC(12,2) (<= ${TALENT_COST_COLUMN_MAX})`
      )
    ]);
  }
  return {
    hype: roundTo(Math.min(HYPE_MAX, Math.max(HYPE_MIN, hype)), 4),
    talentCost
  };
}

export function formatSignedPercent(fraction) {
  const pct = Math.round(fraction * 1000) / 10;
  const body = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  if (pct > 0) return `+${body}%`;
  return `${body}%`;
}

export function describeTrigger(trigger) {
  const parts = [];
  if (typeof trigger.effect?.talentCost === 'number' && trigger.effect.talentCost !== 0) {
    parts.push(`talent cost ${formatSignedPercent(trigger.effect.talentCost)}`);
  }
  if (typeof trigger.effect?.hype === 'number' && trigger.effect.hype !== 0) {
    parts.push(`hype ${formatSignedPercent(trigger.effect.hype)}`);
  }
  return `${trigger.label}: ${parts.join(', ')}`;
}

export function formatTalentDollars(value) {
  const rounded = roundTo(Number(value), 2);
  if (Number.isInteger(rounded)) return `$${rounded}`;
  return `$${rounded.toFixed(2)}`;
}
