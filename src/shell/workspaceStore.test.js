import { describe, expect, test, vi } from 'vitest';
import {
  PLAYER_ROLE_CAMPAIGN,
  PLAYER_ROLE_COMPANY_OPS,
  PLAYER_ROLE_STORAGE_KEY,
  readStoredPlayerRole,
  writeStoredPlayerRole,
} from '../playerRole';
import { CAMPAIGN_RUNWAY_ID, createDefaultWorkspace, reduceWorkspace } from './windowModel';
import { WORKSPACE_STORAGE_KEY, readWorkspace, writeWorkspace } from './workspaceStore';

function memoryStorage(seed = new Map()) {
  const setItem = vi.fn((key, value) => {
    seed.set(key, String(value));
  });
  const removeItem = vi.fn((key) => {
    seed.delete(key);
  });
  const getItem = vi.fn((key) => (seed.has(key) ? seed.get(key) : null));
  return {
    seed,
    storage: { getItem, setItem, removeItem },
  };
}

describe('workspaceStore', () => {
  test('uses citizen.workspace.v1 and round-trips layout only', () => {
    expect(WORKSPACE_STORAGE_KEY).toBe('citizen.workspace.v1');
    expect(WORKSPACE_STORAGE_KEY).not.toBe(PLAYER_ROLE_STORAGE_KEY);

    const { storage, seed } = memoryStorage();
    const moved = reduceWorkspace(createDefaultWorkspace(), {
      type: 'move',
      id: CAMPAIGN_RUNWAY_ID,
      x: 360,
      y: 48,
      bounds: { width: 1280, height: 900 },
    });
    const pinned = reduceWorkspace(moved, {
      type: 'pin',
      id: CAMPAIGN_RUNWAY_ID,
      pinned: true,
    });

    writeWorkspace(pinned, storage);
    const raw = seed.get(WORKSPACE_STORAGE_KEY);
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.placementMode).toBe('desktop');
    expect(parsed.focusedId).toBeUndefined();
    expect(parsed.windows[0].userArranged).toBe(true);
    expect(parsed.windows[0].pinned).toBe(true);
    expect(parsed.windows[0].placement.x).toBe(360);
    expect(raw).not.toMatch(/playerRole|taxRate|"cash"|campaignId/);

    const read = readWorkspace(storage);
    expect(read.windows[0].placement.x).toBe(360);
    expect(read.windows[0].userArranged).toBe(true);
    expect(read.windows[0].pinned).toBe(true);
    expect(read.placementMode).toBe('desktop');
  });

  test('corrupt payload, wrong version, and thrown getItem fall back to defaults', () => {
    const corrupt = memoryStorage();
    corrupt.seed.set(WORKSPACE_STORAGE_KEY, '{not json');
    const fromCorrupt = readWorkspace(corrupt.storage);
    expect(fromCorrupt.placementMode).toBe('desktop');
    expect(fromCorrupt.windows[0].id).toBe(CAMPAIGN_RUNWAY_ID);
    expect(fromCorrupt.windows[0].placement.width).toBe(420);

    const wrongVersion = memoryStorage();
    wrongVersion.seed.set(WORKSPACE_STORAGE_KEY, JSON.stringify({
      version: 2,
      placementMode: 'desktop',
      windows: [],
    }));
    expect(readWorkspace(wrongVersion.storage).windows[0].placement.height).toBe(360);

    const throwing = {
      getItem() {
        throw new Error('denied');
      },
    };
    expect(readWorkspace(throwing).placementMode).toBe('desktop');
    expect(readWorkspace(throwing).windows[0].id).toBe(CAMPAIGN_RUNWAY_ID);
  });

  test('writeWorkspace does not write citizen.playerRole', () => {
    const { storage } = memoryStorage();
    writeStoredPlayerRole(PLAYER_ROLE_COMPANY_OPS, storage);
    storage.setItem.mockClear();
    storage.removeItem.mockClear();

    writeWorkspace(createDefaultWorkspace(), storage);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(WORKSPACE_STORAGE_KEY, expect.any(String));
    expect(storage.setItem).not.toHaveBeenCalledWith(PLAYER_ROLE_STORAGE_KEY, expect.anything());
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(readStoredPlayerRole(storage)).toBe(PLAYER_ROLE_COMPANY_OPS);
    expect(storage.getItem(PLAYER_ROLE_STORAGE_KEY)).toBe(PLAYER_ROLE_COMPANY_OPS);
  });

  test('readStoredPlayerRole ignores the workspace key', () => {
    const { storage } = memoryStorage();
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
      version: 1,
      placementMode: 'desktop',
      playerRole: PLAYER_ROLE_CAMPAIGN,
      windows: [],
    }));
    storage.setItem.mockClear();

    expect(readStoredPlayerRole(storage)).toBeNull();
    expect(storage.getItem).toHaveBeenCalledWith(PLAYER_ROLE_STORAGE_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();

    writeStoredPlayerRole(PLAYER_ROLE_CAMPAIGN, storage);
    writeWorkspace(createDefaultWorkspace(), storage);
    expect(readStoredPlayerRole(storage)).toBe(PLAYER_ROLE_CAMPAIGN);
  });
});
