/**
 * Layout persistence. Never reads or writes `citizen.playerRole`.
 */

import {
  CAMPAIGN_RUNWAY_ID,
  createDefaultWorkspace,
  sanitizeWorkspace,
} from './windowModel';

export const WORKSPACE_STORAGE_KEY = 'citizen.workspace.v1';

function focusedIdOf(windows) {
  const open = windows.filter((item) => item.open);
  const pool = open.length > 0 ? open : windows;
  const top = [...pool].sort((a, b) => b.z - a.z)[0];
  return top?.id ?? CAMPAIGN_RUNWAY_ID;
}

function hydrate(file) {
  return {
    version: file.version,
    placementMode: file.placementMode,
    windows: file.windows.map((item) => ({
      ...item,
      placement: { ...item.placement },
    })),
    focusedId: focusedIdOf(file.windows),
    drafts: {},
  };
}

export function readWorkspace(storage = globalThis.localStorage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return createDefaultWorkspace();
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw == null || raw === '') return createDefaultWorkspace();
    return hydrate(sanitizeWorkspace(JSON.parse(raw)));
  } catch {
    return createDefaultWorkspace();
  }
}

export function writeWorkspace(workspace, storage = globalThis.localStorage) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return;
    const file = sanitizeWorkspace(workspace);
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(file));
  } catch {
    // Private mode or quota: keep the layout in memory for this session.
  }
}
