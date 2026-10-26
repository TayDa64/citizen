/**
 * RealWorldTrigger API contract (v1).
 *
 * Osiris: this module is the payload contract. Do not invent a second shape.
 * Persist the object on `real_world_triggers.extracted`. The client does not
 * call Firecrawl or any other live source. `SAMPLE_TRIGGERS` stand in until
 * the backend sends the same fields.
 *
 * Required fields:
 * - id: non-empty string. Re-applying an id replaces that trigger.
 * - type: one of TRIGGER_CONTRACT.types.
 * - label: short name used in the announcement, for example "Policy change".
 * - source: provenance. Samples use "mock:local". Later a URL or "firecrawl".
 * - timestamp: ISO-8601 string.
 * - effect:
 *     hype?: absolute delta on the 0..1 scale. 0.1 raises hype by 10 points.
 *       Finite, between -1 and 1, at most 4 decimal places.
 *     talentCost?: relative delta. 0.12 multiplies talent cost by 1.12.
 *       Finite, between -100 and 100, at most 4 decimal places.
 *   At least one effect must be non-zero. Unknown effect keys are rejected.
 *   The API rejects unknown top-level fields. Strip client keys such as
 *   appliedAtIndex before POST. The API trims label and source and stores
 *   timestamp with Date#toISOString().
 *
 * Announcement grammar (talent cost first, then hype):
 *   "{label}: talent cost ±N%, hype ±N%"
 *   Example: "Policy change: talent cost +12%"
 *
 * Stacking, applied by the simulation from company baselines:
 * - hype deltas add, then clamp to 0..1
 * - talent-cost deltas multiply as (1 + delta), then floor at 0
 * - the same id does not stack a second copy
 *
 * `appliedAtIndex` is client runtime for the chart marker. It is not part of
 * this payload.
 */

export const TRIGGER_CONTRACT = Object.freeze({
  version: 1,
  fields: Object.freeze(['id', 'type', 'label', 'source', 'timestamp', 'effect']),
  types: Object.freeze(['news_spike', 'policy_change', 'market_shift']),
  effectFields: Object.freeze({
    hype: 'Absolute delta on the 0 to 1 hype scale. 0.1 raises hype by 10 percentage points.',
    talentCost: 'Relative delta applied as a multiplier. 0.12 multiplies talent cost by 1.12.',
  }),
  stacking: Object.freeze({
    hype: 'Add deltas to the baseline, then clamp to the range 0 through 1.',
    talentCost: 'Multiply the baseline by (1 + delta) for each active trigger, then floor at 0.',
    sameId: 'Re-applying an id replaces that trigger instead of stacking a second copy.',
  }),
  announcement: '{label}: talent cost ±N% if present, then hype ±N% if present.',
  storage:
    'Persist this object in real_world_triggers.extracted. Samples use source "mock:local" until the backend supplies the same shape.',
});

export const TRIGGER_TYPES = TRIGGER_CONTRACT.types;

export const CLEARED_ANNOUNCEMENT =
  'World events cleared. Hype and talent cost returned to baseline.';

const ORIGINAL_TRIGGER_LABEL = 'Real-World Triggers\n(Firecrawl + Events)';
const ORIGINAL_INFRA_LABEL = 'Civic Lever:\nInfrastructure / Talent';

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
    effect: { talentCost: 0.12 },
  }),
  freezeTrigger({
    id: 'evt-news-sector-spike',
    type: 'news_spike',
    label: 'News spike',
    source: 'mock:local',
    timestamp: '2026-04-18T13:30:00.000Z',
    effect: { hype: 0.1 },
  }),
  freezeTrigger({
    id: 'evt-market-cooling',
    type: 'market_shift',
    label: 'Market shift',
    source: 'mock:local',
    timestamp: '2026-05-01T09:00:00.000Z',
    effect: { talentCost: -0.08, hype: -0.05 },
  }),
]);

function hasAtMostDecimalPlaces(value, places) {
  const factor = 10 ** places;
  const scaled = value * factor;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-6;
}

function assertDelta(value, key, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Trigger.effect.${key} must be a finite number`);
  }
  if (!hasAtMostDecimalPlaces(value, 4)) {
    throw new TypeError(`Trigger.effect.${key} must have at most 4 decimal places`);
  }
  if (value < min || value > max) {
    throw new TypeError(`Trigger.effect.${key} must be between ${min} and ${max}`);
  }
}

export function roundTo(value, places) {
  const factor = 10 ** places;
  return Math.round((value + Math.sign(value) * 1e-10) * factor) / factor;
}

const USD_CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function assertTriggerId(id) {
  if (typeof id !== 'string' || id.length < 1 || id.length > 200 || id.trim() === '') {
    throw new TypeError('Trigger id must be 1–200 characters');
  }
  return id;
}

export function assertValidTrigger(trigger) {
  if (trigger === null || typeof trigger !== 'object' || Array.isArray(trigger)) {
    throw new TypeError('Trigger must be an object');
  }
  assertTriggerId(trigger.id);
  if (!TRIGGER_TYPES.includes(trigger.type)) {
    throw new TypeError(`Trigger.type must be one of: ${TRIGGER_TYPES.join(', ')}`);
  }
  if (typeof trigger.label !== 'string' || trigger.label.trim() === '') {
    throw new TypeError('Trigger.label must be a non-empty string');
  }
  if (typeof trigger.source !== 'string' || trigger.source.trim() === '') {
    throw new TypeError('Trigger.source must be a non-empty string');
  }
  if (typeof trigger.timestamp !== 'string' || Number.isNaN(Date.parse(trigger.timestamp))) {
    throw new TypeError('Trigger.timestamp must be an ISO-8601 string');
  }
  if (trigger.effect === null || typeof trigger.effect !== 'object' || Array.isArray(trigger.effect)) {
    throw new TypeError('Trigger.effect must be an object');
  }

  const effectKeys = Object.keys(trigger.effect);
  for (const key of effectKeys) {
    if (!Object.prototype.hasOwnProperty.call(TRIGGER_CONTRACT.effectFields, key)) {
      throw new TypeError(`Trigger.effect.${key} is not part of the contract`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(trigger.effect, 'hype')) {
    assertDelta(trigger.effect.hype, 'hype', -1, 1);
  }
  if (Object.prototype.hasOwnProperty.call(trigger.effect, 'talentCost')) {
    assertDelta(trigger.effect.talentCost, 'talentCost', -100, 100);
  }

  const hypeMoves = typeof trigger.effect.hype === 'number' && trigger.effect.hype !== 0;
  const talentMoves = typeof trigger.effect.talentCost === 'number' && trigger.effect.talentCost !== 0;
  if (!hypeMoves && !talentMoves) {
    throw new TypeError('Trigger.effect must change hype or talentCost');
  }

  return trigger;
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

export function announceTrigger(trigger, mode) {
  const description = describeTrigger(trigger);
  switch (mode) {
    case 'apply':
      return description;
    case 'remove': {
      const detail = description.slice(trigger.label.length + 2);
      return `${trigger.label} removed: ${detail}.`;
    }
    default: {
      const neverMode = mode;
      throw new Error(`Unknown announcement mode: ${String(neverMode)}`);
    }
  }
}

export function deltaPhrase(fraction) {
  if (!Number.isFinite(fraction) || Math.abs(fraction) < 0.0005) return 'unchanged';
  const word = fraction > 0 ? 'up' : 'down';
  return `${word} ${formatSignedPercent(fraction)}`;
}

export function formatHypePercent(value) {
  return `${Math.round(value * 100)}%`;
}

export function formatTalentMultiplier(value) {
  return `${Number(value).toFixed(2)}×`;
}

export function projectedTalentDollars(baseline, delta) {
  if (!Number.isFinite(baseline) || !Number.isFinite(delta)) return null;
  return roundTo(Math.max(0, baseline * (1 + delta)), 2);
}

export function formatCurrency(value) {
  const amount = roundTo(Number(value), 2);
  if (!Number.isFinite(amount)) return '$0';
  const body = USD_CURRENCY.format(Math.abs(amount)).replace(/\.00$/, '');
  return amount < 0 ? `-${body}` : body;
}

export function formatTalentDollars(value) {
  return formatCurrency(value);
}

export function formatDollars(value) {
  return formatCurrency(value);
}

export function formatTriggerDate(timestamp) {
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function triggerDiagramOverlay(state) {
  const active = state.activeTriggers ?? [];
  const baseHype = state.baselines?.hype ?? state.company?.hype ?? 0.3;
  const baseTalent = state.baselines?.talentCost ?? state.company?.talentCost ?? 1;
  const hypeDelta = (state.company?.hype ?? baseHype) - baseHype;
  const talentRatio = baseTalent === 0
    ? 0
    : (state.company?.talentCost ?? baseTalent) / baseTalent - 1;

  const nodeLabels = {
    5: ORIGINAL_TRIGGER_LABEL,
    'civic-infra': ORIGINAL_INFRA_LABEL,
  };
  const edgeLabels = {
    'einfra-7': 'talent cost',
  };

  if (active.length === 0) {
    return { nodeLabels, edgeLabels, hypeNode: null };
  }

  nodeLabels[5] = `${ORIGINAL_TRIGGER_LABEL}\n${active.map((trigger) => trigger.label).join(', ')}`;

  if (Math.abs(talentRatio) >= 0.0005) {
    const arrow = talentRatio > 0 ? '▲' : '▼';
    nodeLabels['civic-infra'] = `${ORIGINAL_INFRA_LABEL}\n${arrow} talent cost ${formatSignedPercent(talentRatio)}`;
    edgeLabels['einfra-7'] = `talent cost ${formatSignedPercent(talentRatio)}`;
  }

  if (Math.abs(hypeDelta) < 0.0005) {
    return { nodeLabels, edgeLabels, hypeNode: null };
  }

  const arrow = hypeDelta > 0 ? '▲' : '▼';
  const signed = formatSignedPercent(hypeDelta);
  return {
    nodeLabels,
    edgeLabels,
    hypeNode: {
      id: 'hype',
      label: `Hype\n${arrow} hype ${signed}`,
      edgeLabel: `${arrow} hype ${signed}`,
    },
  };
}
