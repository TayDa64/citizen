/**
 * Registered trigger effect keys (P1-3 causal graph).
 *
 * Zero-dependency module so triggers / contract / causal graph share one
 * allow-list without import cycles. Unknown keys are rejected at
 * assert / preview / apply — the registry is truth.
 */

export const EFFECT_KEY_RULES = Object.freeze([
  Object.freeze({
    id: 'effect.hype',
    kind: 'trigger_effect',
    effectKey: 'hype',
    target: Object.freeze({ path: 'company.hype', kind: 'company' }),
    description:
      'Absolute delta on the 0 to 1 hype scale. 0.1 raises hype by 10 percentage points.',
    diagram: Object.freeze({
      edgeId: 'e5-hype',
      source: '5',
      target: 'hype',
      label: 'hype',
      /** Drawn only when a live trigger moves hype (overlay). */
      ephemeral: true,
    }),
  }),
  Object.freeze({
    id: 'effect.talentCost',
    kind: 'trigger_effect',
    effectKey: 'talentCost',
    target: Object.freeze({ path: 'company.talentCost', kind: 'company' }),
    description:
      'Relative delta applied as a multiplier. 0.12 multiplies talent cost by 1.12.',
    diagram: Object.freeze({
      edgeId: 'einfra-7',
      source: 'civic-infra',
      target: '7',
      label: 'talent cost',
    }),
  }),
]);

export const KNOWN_EFFECT_KEYS = Object.freeze(
  EFFECT_KEY_RULES.map((rule) => rule.effectKey),
);

export function isKnownEffectKey(key) {
  return KNOWN_EFFECT_KEYS.includes(key);
}

export function getEffectKeyRule(effectKey) {
  return EFFECT_KEY_RULES.find((rule) => rule.effectKey === effectKey) ?? null;
}

/** Contract-shaped map for TRIGGER_CONTRACT.effectFields (descriptions from registry). */
export function effectFieldsFromRegistry() {
  const fields = {};
  for (const rule of EFFECT_KEY_RULES) {
    fields[rule.effectKey] = rule.description;
  }
  return Object.freeze(fields);
}

/**
 * Reject any effect object key that is not registered.
 * Used by assertValidTrigger, turn apply/preview, and pipeline validation.
 */
export function assertKnownEffectKeys(effect) {
  if (effect == null || typeof effect !== 'object' || Array.isArray(effect)) {
    throw new TypeError('effect must be an object');
  }
  for (const key of Object.keys(effect)) {
    if (!isKnownEffectKey(key)) {
      throw new TypeError(`Trigger.effect.${key} is not part of the contract`);
    }
  }
  return effect;
}

/**
 * Preview path: same rejection as apply; returns the registered rules touched.
 */
export function previewEffectKeys(effect) {
  assertKnownEffectKeys(effect);
  return EFFECT_KEY_RULES.filter((rule) =>
    Object.prototype.hasOwnProperty.call(effect, rule.effectKey),
  );
}
