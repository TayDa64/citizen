/**
 * Player role = UI lens on the same total backend (Approach A dual islands).
 * Persist client-side; optionally echo onto campaign state_json.playerRole
 * (normalizeGameState spreads unknown fields — no migration).
 */

export const PLAYER_ROLE_STORAGE_KEY = 'citizen.playerRole';

export const PLAYER_ROLE_COMPANY_OPS = 'company_ops';
export const PLAYER_ROLE_CAMPAIGN = 'campaign';

export const PLAYER_ROLES = Object.freeze([
  PLAYER_ROLE_COMPANY_OPS,
  PLAYER_ROLE_CAMPAIGN,
]);

export function isPlayerRole(value) {
  return value === PLAYER_ROLE_COMPANY_OPS || value === PLAYER_ROLE_CAMPAIGN;
}

export function parsePlayerRole(value) {
  if (isPlayerRole(value)) return value;
  return null;
}

export function readStoredPlayerRole(storage = globalThis.localStorage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return null;
    return parsePlayerRole(storage.getItem(PLAYER_ROLE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredPlayerRole(role, storage = globalThis.localStorage) {
  const parsed = parsePlayerRole(role);
  try {
    if (!storage || typeof storage.setItem !== 'function') return parsed;
    if (parsed == null) {
      if (typeof storage.removeItem === 'function') {
        storage.removeItem(PLAYER_ROLE_STORAGE_KEY);
      }
      return null;
    }
    storage.setItem(PLAYER_ROLE_STORAGE_KEY, parsed);
    return parsed;
  } catch {
    return parsed;
  }
}

export function roleLabel(role) {
  switch (role) {
    case PLAYER_ROLE_COMPANY_OPS:
      return 'Company ops';
    case PLAYER_ROLE_CAMPAIGN:
      return 'Campaign';
    default: {
      const _exhaustive = role;
      void _exhaustive;
      return 'Choose role';
    }
  }
}

export function roleBlurb(role) {
  switch (role) {
    case PLAYER_ROLE_COMPANY_OPS:
      return 'Run the startup desk: tax budget, hire requisition, talent & burn. Same sim — ops lens.';
    case PLAYER_ROLE_CAMPAIGN:
      return 'Causal runner: world events, ledger, pathways. Same sim — campaign lens.';
    default: {
      const _exhaustive = role;
      void _exhaustive;
      return '';
    }
  }
}
