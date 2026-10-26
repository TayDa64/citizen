export const TRIGGER_TYPES = Object.freeze(['news', 'market', 'talent', 'policy']);
export const MOCK_SCENARIOS = Object.freeze(['hype', 'talent']);

export const HYPE_DELTA_MIN = -1;
export const HYPE_DELTA_MAX = 1;
export const TALENT_COST_DELTA_MIN = -100_000;
export const TALENT_COST_DELTA_MAX = 100_000;
export const HYPE_MIN = 0;
export const HYPE_MAX = 1;
export const TALENT_COST_MIN = 0;
export const TALENT_COST_MAX = 1_000_000;
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
  max: TALENT_COST_MAX,
  decimals: 2,
  fallback: DEFAULT_TALENT_COST
});
export const MAX_LABEL_LENGTH = 160;
export const MAX_SOURCE_LENGTH = 2048;

const PAYLOAD_KEYS = new Set(['type', 'label', 'source', 'effect']);
const RECORD_KEYS = new Set(['id', 'type', 'label', 'source', 'timestamp', 'effect']);
const EFFECT_KEYS = new Set(['hype', 'talentCost']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export const MOCK_TRIGGERS = Object.freeze({
  hype: Object.freeze({
    type: 'news',
    label: 'Mock press cycle lifts founder hype',
    source: 'mock:press-cycle',
    effect: Object.freeze({ hype: 0.1 })
  }),
  talent: Object.freeze({
    type: 'talent',
    label: 'Mock hiring surge raises talent cost',
    source: 'mock:labor-market',
    effect: Object.freeze({ talentCost: 500 })
  })
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
    issues.push(
      issue('effect', 'empty', 'At least one of effect.hype or effect.talentCost is required')
    );
  }
  if (hasHype) {
    validateDelta(issues, 'effect.hype', effect.hype, HYPE_DELTA_MIN, HYPE_DELTA_MAX, 4);
  }
  if (hasTalent) {
    validateDelta(
      issues,
      'effect.talentCost',
      effect.talentCost,
      TALENT_COST_DELTA_MIN,
      TALENT_COST_DELTA_MAX,
      2
    );
  }
  if (issues.some((entry) => entry.path === 'effect' || entry.path.startsWith('effect.'))) {
    return null;
  }
  const sanitized = {};
  if (hasHype) sanitized.hype = effect.hype;
  if (hasTalent) sanitized.talentCost = effect.talentCost;
  return sanitized;
}

function validateCommon(input, allowedKeys) {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: [issue('', 'invalid_type', 'Payload must be a JSON object')]
    };
  }
  const issues = [];
  rejectUnknown(issues, input, allowedKeys);

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

  let effect = null;
  if (!Object.prototype.hasOwnProperty.call(input, 'effect')) {
    issues.push(issue('effect', 'required', 'effect is required'));
  } else {
    effect = validateEffect(issues, input.effect);
  }

  return { issues, type: input.type, label, source, effect };
}

export function validateTriggerPayload(input) {
  const result = validateCommon(input, PAYLOAD_KEYS);
  if (result.issues.length > 0 || result.label == null || result.source == null || result.effect == null) {
    return { ok: false, issues: result.issues };
  }
  return {
    ok: true,
    value: {
      type: result.type,
      label: result.label,
      source: result.source,
      effect: result.effect
    }
  };
}

export function validateTriggerRecord(input) {
  const result = validateCommon(input, RECORD_KEYS);
  const issues = result.issues;
  let id = null;
  if (!isPlainObject(input)) {
    return { ok: false, issues };
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'id')) {
    issues.push(issue('id', 'required', 'id is required'));
  } else if (typeof input.id !== 'string' || !UUID_PATTERN.test(input.id)) {
    issues.push(issue('id', 'invalid_value', 'id must be a UUID'));
  } else {
    id = input.id.toLowerCase();
  }

  let timestamp = null;
  if (!Object.prototype.hasOwnProperty.call(input, 'timestamp')) {
    issues.push(issue('timestamp', 'required', 'timestamp is required'));
  } else if (typeof input.timestamp !== 'string' || !TIMESTAMP_PATTERN.test(input.timestamp)) {
    issues.push(issue('timestamp', 'invalid_value', 'timestamp must be an ISO-8601 UTC string'));
  } else if (!Number.isFinite(Date.parse(input.timestamp))) {
    issues.push(issue('timestamp', 'invalid_value', 'timestamp must be a real date'));
  } else {
    timestamp = input.timestamp;
  }

  if (issues.length > 0 || result.label == null || result.source == null || result.effect == null || !id || !timestamp) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      id,
      type: result.type,
      label: result.label,
      source: result.source,
      timestamp,
      effect: result.effect
    }
  };
}

export function validateMockRequest(input) {
  if (input == null) return { ok: true, scenario: 'hype' };
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
    return issues.length > 0 ? { ok: false, issues } : { ok: true, scenario: 'hype' };
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
    case 'hype':
      return structuredClone(MOCK_TRIGGERS.hype);
    case 'talent':
      return structuredClone(MOCK_TRIGGERS.talent);
    default: {
      const unexpected = scenario;
      throw new Error(`Unknown mock scenario: ${String(unexpected)}`);
    }
  }
}

export function applyDelta(current, delta, bounds) {
  const base =
    current == null || !Number.isFinite(Number(current)) ? bounds.fallback : Number(current);
  const clamped = Math.min(bounds.max, Math.max(bounds.min, base + delta));
  const factor = 10 ** bounds.decimals;
  return Math.round((clamped + Number.EPSILON) * factor) / factor;
}

export function formatEffect(effect) {
  const parts = [];
  if (effect && effect.hype != null) {
    const sign = effect.hype > 0 ? '+' : '';
    parts.push(`${sign}${effect.hype.toFixed(2)} hype`);
  }
  if (effect && effect.talentCost != null) {
    const sign = effect.talentCost > 0 ? '+' : effect.talentCost < 0 ? '-' : '';
    parts.push(`${sign}$${Math.abs(effect.talentCost).toFixed(0)} talent cost`);
  }
  return parts.join(', ');
}
