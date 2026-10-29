import { describe, expect, test } from 'vitest';
import {
  PLAYER_ROLE_CAMPAIGN,
  PLAYER_ROLE_COMPANY_OPS,
  PLAYER_ROLE_STORAGE_KEY,
  isPlayerRole,
  parsePlayerRole,
  readStoredPlayerRole,
  roleLabel,
  writeStoredPlayerRole,
} from './playerRole';

describe('playerRole', () => {
  test('parses known roles only', () => {
    expect(isPlayerRole(PLAYER_ROLE_COMPANY_OPS)).toBe(true);
    expect(isPlayerRole(PLAYER_ROLE_CAMPAIGN)).toBe(true);
    expect(parsePlayerRole('company_ops')).toBe(PLAYER_ROLE_COMPANY_OPS);
    expect(parsePlayerRole('campaign')).toBe(PLAYER_ROLE_CAMPAIGN);
    expect(parsePlayerRole('admin')).toBeNull();
    expect(parsePlayerRole(null)).toBeNull();
  });

  test('persists and clears via storage', () => {
    const memory = new Map();
    const storage = {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => {
        memory.set(key, String(value));
      },
      removeItem: (key) => {
        memory.delete(key);
      },
    };

    expect(writeStoredPlayerRole(PLAYER_ROLE_COMPANY_OPS, storage)).toBe(PLAYER_ROLE_COMPANY_OPS);
    expect(memory.get(PLAYER_ROLE_STORAGE_KEY)).toBe('company_ops');
    expect(readStoredPlayerRole(storage)).toBe(PLAYER_ROLE_COMPANY_OPS);

    expect(writeStoredPlayerRole(PLAYER_ROLE_CAMPAIGN, storage)).toBe(PLAYER_ROLE_CAMPAIGN);
    expect(readStoredPlayerRole(storage)).toBe(PLAYER_ROLE_CAMPAIGN);

    expect(writeStoredPlayerRole(null, storage)).toBeNull();
    expect(memory.has(PLAYER_ROLE_STORAGE_KEY)).toBe(false);
  });

  test('labels cover both roles exhaustively', () => {
    expect(roleLabel(PLAYER_ROLE_COMPANY_OPS)).toMatch(/company ops/i);
    expect(roleLabel(PLAYER_ROLE_CAMPAIGN)).toMatch(/campaign/i);
  });
});
