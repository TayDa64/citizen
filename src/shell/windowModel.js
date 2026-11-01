/**
 * Desktop window layout reducer. Layout only — no GameState and no TurnCommand.
 * Placement mode `desktop` is the only value this series keeps.
 */

export const WORKSPACE_VERSION = 1;
export const PLACEMENT_MODE_DESKTOP = 'desktop';
export const CAMPAIGN_RUNWAY_ID = 'campaign-runway';
export const CAMPAIGN_CAUSAL_ID = 'campaign-causal';
export const CAMPAIGN_LEDGER_ID = 'campaign-ledger';
export const CAMPAIGN_NEST_ID = 'campaign-nest';
export const CAMPAIGN_CALENDAR_ID = 'campaign-calendar';
export const CAMPAIGN_INGEST_ID = 'campaign-ingest';
export const CAMPAIGN_TRIGGERS_ID = 'campaign-triggers';
export const WORKFLOW_DIAGRAM_ID = 'workflow-diagram';
export const CAMPAIGN_POLITICS_ID = 'campaign-politics';
export const COMPANY_OPS_ID = 'company-ops';
export const COMPANY_METRICS_ID = 'company-metrics';
export const TITLE_BAR_HEIGHT = 40;

const MIN_WINDOW_WIDTH = 280;
const MIN_WINDOW_HEIGHT = 160;
const TITLE_VISIBLE_WIDTH = 96;
const RAIL_CLEARANCE = 264;

export const RUNWAY_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: RAIL_CLEARANCE,
  y: 24,
  width: 420,
  height: 360,
});

/** Sits to the right of the runway so the rail and the runway title stay clear. */
export const OPS_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: RAIL_CLEARANCE + RUNWAY_DEFAULT_PLACEMENT.width + 16,
  y: 24,
  width: 420,
  height: 540,
});

/**
 * Same top band as the runway, to its right. That band already clears
 * Advance Month. The campaign lens does not mount the ops window, so this
 * column is free there. Wide enough for the plot-line label to stay one line.
 */
export const METRICS_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: OPS_DEFAULT_PLACEMENT.x,
  y: OPS_DEFAULT_PLACEMENT.y,
  width: 560,
  height: RUNWAY_DEFAULT_PLACEMENT.height,
});

/** Under the runway, still above Advance Month, and clear of the metrics chart. */
export const POLITICS_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: RAIL_CLEARANCE,
  y: RUNWAY_DEFAULT_PLACEMENT.y + RUNWAY_DEFAULT_PLACEMENT.height + 16,
  width: 420,
  height: 320,
});

/** Under the metrics chart, beside politics, still above Advance Month. */
export const CAUSAL_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: OPS_DEFAULT_PLACEMENT.x,
  y: POLITICS_DEFAULT_PLACEMENT.y,
  width: METRICS_DEFAULT_PLACEMENT.width,
  height: POLITICS_DEFAULT_PLACEMENT.height,
});

/** Under politics, still above Advance Month, and clear of the causal hub. */
export const LEDGER_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: RAIL_CLEARANCE,
  y: POLITICS_DEFAULT_PLACEMENT.y + POLITICS_DEFAULT_PLACEMENT.height + 16,
  width: 420,
  height: 200,
});

/**
 * Civic column sits to the right of Advance Month (the button ends at x 748)
 * and the tax node (it ends at x 454) at 1280×900. Rail growth moves those
 * controls down; x stays clear of both.
 */
const CIVIC_COLUMN_X = 760;
const CIVIC_COLUMN_WIDTH = 500;
const CIVIC_STACK_GAP = 16;

export const NEST_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: CIVIC_COLUMN_X,
  y: LEDGER_DEFAULT_PLACEMENT.y,
  width: CIVIC_COLUMN_WIDTH,
  height: 220,
});

export const CALENDAR_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: CIVIC_COLUMN_X,
  y: NEST_DEFAULT_PLACEMENT.y + NEST_DEFAULT_PLACEMENT.height + CIVIC_STACK_GAP,
  width: CIVIC_COLUMN_WIDTH,
  height: 220,
});

export const INGEST_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: CIVIC_COLUMN_X,
  y: CALENDAR_DEFAULT_PLACEMENT.y + CALENDAR_DEFAULT_PLACEMENT.height + CIVIC_STACK_GAP,
  width: CIVIC_COLUMN_WIDTH,
  height: 240,
});

export const TRIGGERS_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: CIVIC_COLUMN_X,
  y: INGEST_DEFAULT_PLACEMENT.y + INGEST_DEFAULT_PLACEMENT.height + CIVIC_STACK_GAP,
  width: CIVIC_COLUMN_WIDTH,
  height: 420,
});

/**
 * Wide enough for the civic-band smoke at 1280×900, beside the rail.
 * Bottom stays above the ledger and the event windows. Painted above the
 * top-band windows so the tax slider and Advance Month stay clickable.
 */
export const DIAGRAM_DEFAULT_PLACEMENT = Object.freeze({
  mode: PLACEMENT_MODE_DESKTOP,
  x: RAIL_CLEARANCE,
  y: 24,
  width: 1000,
  height: 700,
});

function copyPlacement(placement) {
  return {
    mode: PLACEMENT_MODE_DESKTOP,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  };
}

function defaultPlacement() {
  return copyPlacement(RUNWAY_DEFAULT_PLACEMENT);
}

function defaultWindow(id, z = 1, placement = defaultPlacement()) {
  return {
    id,
    open: true,
    minimized: false,
    pinned: false,
    z,
    userArranged: false,
    placement: copyPlacement(placement),
  };
}

function defaultPersistable() {
  return {
    version: WORKSPACE_VERSION,
    placementMode: PLACEMENT_MODE_DESKTOP,
    windows: [
      defaultWindow(CAMPAIGN_RUNWAY_ID, 10),
      defaultWindow(COMPANY_OPS_ID, 9, OPS_DEFAULT_PLACEMENT),
      defaultWindow(COMPANY_METRICS_ID, 8, METRICS_DEFAULT_PLACEMENT),
      defaultWindow(CAMPAIGN_POLITICS_ID, 7, POLITICS_DEFAULT_PLACEMENT),
      defaultWindow(CAMPAIGN_CAUSAL_ID, 6, CAUSAL_DEFAULT_PLACEMENT),
      defaultWindow(CAMPAIGN_LEDGER_ID, 5, LEDGER_DEFAULT_PLACEMENT),
      defaultWindow(CAMPAIGN_NEST_ID, 4, NEST_DEFAULT_PLACEMENT),
      defaultWindow(CAMPAIGN_CALENDAR_ID, 3, CALENDAR_DEFAULT_PLACEMENT),
      defaultWindow(CAMPAIGN_INGEST_ID, 2, INGEST_DEFAULT_PLACEMENT),
      defaultWindow(CAMPAIGN_TRIGGERS_ID, 1, TRIGGERS_DEFAULT_PLACEMENT),
      defaultWindow(WORKFLOW_DIAGRAM_ID, 11, DIAGRAM_DEFAULT_PLACEMENT),
    ],
  };
}

function cloneWindow(windowRecord) {
  return {
    id: windowRecord.id,
    open: windowRecord.open,
    minimized: windowRecord.minimized,
    pinned: windowRecord.pinned,
    z: windowRecord.z,
    userArranged: windowRecord.userArranged,
    placement: {
      mode: PLACEMENT_MODE_DESKTOP,
      x: windowRecord.placement.x,
      y: windowRecord.placement.y,
      width: windowRecord.placement.width,
      height: windowRecord.placement.height,
    },
  };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidWindow(windowRecord) {
  if (!windowRecord || typeof windowRecord.id !== 'string' || windowRecord.id.trim() === '') {
    return false;
  }
  if (typeof windowRecord.open !== 'boolean') return false;
  if (typeof windowRecord.minimized !== 'boolean') return false;
  if (typeof windowRecord.pinned !== 'boolean') return false;
  if (typeof windowRecord.userArranged !== 'boolean') return false;
  if (!isFiniteNumber(windowRecord.z)) return false;
  const placement = windowRecord.placement;
  if (!placement || placement.mode !== PLACEMENT_MODE_DESKTOP) return false;
  return isFiniteNumber(placement.x)
    && isFiniteNumber(placement.y)
    && isFiniteNumber(placement.width)
    && isFiniteNumber(placement.height);
}

function ensureKnownWindows(windows) {
  let next = windows;
  if (!next.some((item) => item.id === CAMPAIGN_RUNWAY_ID)) {
    next = [defaultWindow(CAMPAIGN_RUNWAY_ID, 1), ...next];
  }
  if (!next.some((item) => item.id === COMPANY_OPS_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(COMPANY_OPS_ID, z, OPS_DEFAULT_PLACEMENT)];
  }
  if (!next.some((item) => item.id === COMPANY_METRICS_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(COMPANY_METRICS_ID, z, METRICS_DEFAULT_PLACEMENT)];
  }
  if (!next.some((item) => item.id === CAMPAIGN_POLITICS_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(CAMPAIGN_POLITICS_ID, z, POLITICS_DEFAULT_PLACEMENT)];
  }
  if (!next.some((item) => item.id === CAMPAIGN_CAUSAL_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(CAMPAIGN_CAUSAL_ID, z, CAUSAL_DEFAULT_PLACEMENT)];
  }
  if (!next.some((item) => item.id === CAMPAIGN_LEDGER_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(CAMPAIGN_LEDGER_ID, z, LEDGER_DEFAULT_PLACEMENT)];
  }
  if (!next.some((item) => item.id === CAMPAIGN_NEST_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(CAMPAIGN_NEST_ID, z, NEST_DEFAULT_PLACEMENT)];
  }
  if (!next.some((item) => item.id === CAMPAIGN_CALENDAR_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(CAMPAIGN_CALENDAR_ID, z, CALENDAR_DEFAULT_PLACEMENT)];
  }
  if (!next.some((item) => item.id === CAMPAIGN_INGEST_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(CAMPAIGN_INGEST_ID, z, INGEST_DEFAULT_PLACEMENT)];
  }
  if (!next.some((item) => item.id === CAMPAIGN_TRIGGERS_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(CAMPAIGN_TRIGGERS_ID, z, TRIGGERS_DEFAULT_PLACEMENT)];
  }
  if (!next.some((item) => item.id === WORKFLOW_DIAGRAM_ID)) {
    const z = next.reduce((max, item) => Math.max(max, item.z), 0) + 1;
    next = [...next, defaultWindow(WORKFLOW_DIAGRAM_ID, z, DIAGRAM_DEFAULT_PLACEMENT)];
  }
  return next;
}

function copyDrafts(drafts) {
  if (!drafts || typeof drafts !== 'object') return {};
  const next = {};
  for (const [id, draft] of Object.entries(drafts)) {
    if (draft && typeof draft === 'object') next[id] = { ...draft };
  }
  return next;
}

export function sanitizeWorkspace(file) {
  const valid = Boolean(file)
    && file.version === WORKSPACE_VERSION
    && file.placementMode === PLACEMENT_MODE_DESKTOP
    && Array.isArray(file.windows)
    && file.windows.every(isValidWindow);
  if (!valid) return defaultPersistable();
  return {
    version: WORKSPACE_VERSION,
    placementMode: PLACEMENT_MODE_DESKTOP,
    windows: ensureKnownWindows(file.windows.map(cloneWindow)),
  };
}

export function createDefaultWorkspace() {
  const file = defaultPersistable();
  return {
    version: file.version,
    placementMode: file.placementMode,
    windows: file.windows.map(cloneWindow),
    focusedId: CAMPAIGN_RUNWAY_ID,
    drafts: {},
  };
}

function withWorkspace(workspace, windows, focusedId = workspace.focusedId, drafts = workspace.drafts) {
  return {
    version: WORKSPACE_VERSION,
    placementMode: PLACEMENT_MODE_DESKTOP,
    windows,
    focusedId,
    drafts: copyDrafts(drafts),
  };
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  if (max < min) return min;
  return Math.min(max, Math.max(min, numeric));
}

function clampPlacement(placement, bounds) {
  const width = Math.max(MIN_WINDOW_WIDTH, Number(placement.width) || MIN_WINDOW_WIDTH);
  const height = Math.max(MIN_WINDOW_HEIGHT, Number(placement.height) || MIN_WINDOW_HEIGHT);
  const boundWidth = Number(bounds?.width);
  const boundHeight = Number(bounds?.height);
  const maxX = Math.max(0, (Number.isFinite(boundWidth) ? boundWidth : width) - TITLE_VISIBLE_WIDTH);
  const maxY = Math.max(0, (Number.isFinite(boundHeight) ? boundHeight : height) - TITLE_BAR_HEIGHT);
  return {
    mode: PLACEMENT_MODE_DESKTOP,
    x: clampNumber(placement.x, 0, maxX),
    y: clampNumber(placement.y, 0, maxY),
    width,
    height,
  };
}

function autoplace(index) {
  const step = 28;
  return {
    mode: PLACEMENT_MODE_DESKTOP,
    x: RUNWAY_DEFAULT_PLACEMENT.x + index * step,
    y: RUNWAY_DEFAULT_PLACEMENT.y + index * step,
    width: RUNWAY_DEFAULT_PLACEMENT.width,
    height: RUNWAY_DEFAULT_PLACEMENT.height,
  };
}

function nextZ(windows) {
  return windows.reduce((max, item) => Math.max(max, item.z), 0) + 1;
}

function raise(windows, id) {
  const z = nextZ(windows);
  return windows.map((item) => (item.id === id ? { ...item, z } : item));
}

function updateWindow(workspace, id, recipe) {
  if (!workspace.windows.some((item) => item.id === id)) return workspace;
  return withWorkspace(
    workspace,
    workspace.windows.map((item) => (item.id === id ? recipe(item) : item)),
  );
}

function focusWindow(workspace, id) {
  if (!workspace.windows.some((item) => item.id === id)) return workspace;
  return withWorkspace(workspace, raise(workspace.windows, id), id);
}

function createWindow(workspace, id) {
  const existing = workspace.windows.find((item) => item.id === id);
  if (existing) {
    const opened = workspace.windows.map((item) => (
      item.id === id ? { ...item, open: true, minimized: false } : item
    ));
    return withWorkspace(workspace, raise(opened, id), id);
  }
  const created = {
    id,
    open: true,
    minimized: false,
    pinned: false,
    z: nextZ(workspace.windows),
    userArranged: false,
    placement: autoplace(workspace.windows.length),
  };
  return withWorkspace(
    workspace,
    [...workspace.windows.map(cloneWindow), created],
    id,
  );
}

function unhandledAction(actionType) {
  throw new Error(`Unhandled workspace action: ${String(actionType)}`);
}

/**
 * @param {object} workspace
 * @param {object} action
 * @param {object} [gameState] ignored. Close must not mutate sim state.
 */
export function reduceWorkspace(workspace, action, gameState) {
  void gameState;
  const current = workspace ?? createDefaultWorkspace();
  switch (action.type) {
    case 'create':
      return createWindow(current, action.id);
    case 'move':
      return updateWindow(current, action.id, (item) => ({
        ...item,
        userArranged: true,
        placement: clampPlacement({ ...item.placement, x: action.x, y: action.y }, action.bounds),
      }));
    case 'resize':
      return updateWindow(current, action.id, (item) => ({
        ...item,
        userArranged: true,
        placement: clampPlacement({
          ...item.placement,
          width: action.width,
          height: action.height,
        }, action.bounds),
      }));
    case 'close':
      return updateWindow(current, action.id, (item) => ({ ...item, open: false }));
    case 'minimize':
      return updateWindow(current, action.id, (item) => ({ ...item, minimized: true }));
    case 'restore':
      return focusWindow(
        updateWindow(current, action.id, (item) => ({ ...item, minimized: false })),
        action.id,
      );
    case 'pin':
      return updateWindow(current, action.id, (item) => ({
        ...item,
        pinned: action.pinned === true,
      }));
    case 'focus':
      return focusWindow(current, action.id);
    case 'setDraft': {
      if (!current.windows.some((item) => item.id === action.id)) return current;
      const drafts = copyDrafts(current.drafts);
      if (action.draft == null) {
        delete drafts[action.id];
      } else {
        drafts[action.id] = { ...action.draft };
      }
      return withWorkspace(current, current.windows.map(cloneWindow), current.focusedId, drafts);
    }
    case 'reset':
      return createDefaultWorkspace();
    default: {
      const neverType = action.type;
      return unhandledAction(neverType);
    }
  }
}
