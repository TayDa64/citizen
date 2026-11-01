import { describe, expect, test } from 'vitest';
import { initialState } from '../simulationCore';
import {
  CAMPAIGN_RUNWAY_ID,
  PLACEMENT_MODE_DESKTOP,
  RUNWAY_DEFAULT_PLACEMENT,
  TITLE_BAR_HEIGHT,
  createDefaultWorkspace,
  reduceWorkspace,
  sanitizeWorkspace,
} from './windowModel';

const BOUNDS = Object.freeze({ width: 1280, height: 900 });

function windowById(workspace, id = CAMPAIGN_RUNWAY_ID) {
  return workspace.windows.find((item) => item.id === id);
}

describe('windowModel', () => {
  test('defaults to desktop placement for the campaign-runway singleton', () => {
    const workspace = createDefaultWorkspace();
    const runway = windowById(workspace);

    expect(workspace.placementMode).toBe(PLACEMENT_MODE_DESKTOP);
    expect(workspace.placementMode).toBe('desktop');
    expect(workspace.windows).toHaveLength(2);
    expect(runway.id).toBe(CAMPAIGN_RUNWAY_ID);
    expect(runway.open).toBe(true);
    expect(runway.minimized).toBe(false);
    expect(runway.pinned).toBe(false);
    expect(runway.userArranged).toBe(false);
    expect(runway.placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);
    expect(runway.placement.mode).toBe('desktop');
    expect(runway.placement.width).toBe(420);
    expect(runway.placement.height).toBe(360);
    expect(runway.placement.x).toBeGreaterThanOrEqual(240);
    expect(workspace.focusedId).toBe(CAMPAIGN_RUNWAY_ID);
  });

  test('creating an existing singleton focuses it and does not reset userArranged or placement', () => {
    const moved = reduceWorkspace(createDefaultWorkspace(), {
      type: 'move',
      id: CAMPAIGN_RUNWAY_ID,
      x: 480,
      y: 64,
      bounds: BOUNDS,
    });
    const placed = windowById(moved).placement;
    expect(windowById(moved).userArranged).toBe(true);

    const closed = reduceWorkspace(moved, { type: 'close', id: CAMPAIGN_RUNWAY_ID });
    const again = reduceWorkspace(closed, { type: 'create', id: CAMPAIGN_RUNWAY_ID });
    const runway = windowById(again);

    expect(again.windows).toHaveLength(2);
    expect(runway.open).toBe(true);
    expect(runway.minimized).toBe(false);
    expect(runway.userArranged).toBe(true);
    expect(runway.placement).toEqual(placed);
    expect(again.focusedId).toBe(CAMPAIGN_RUNWAY_ID);
  });

  test('create inserts a missing id once and autoplaces only that new window', () => {
    const created = reduceWorkspace(createDefaultWorkspace(), { type: 'create', id: 'scratch-pad' });
    expect(created.windows).toHaveLength(3);
    const scratch = windowById(created, 'scratch-pad');
    expect(scratch.userArranged).toBe(false);
    expect(scratch.placement.mode).toBe('desktop');
    expect(scratch.open).toBe(true);
    expect(windowById(created).placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);
    expect(windowById(created).userArranged).toBe(false);

    const focused = reduceWorkspace(created, { type: 'create', id: 'scratch-pad' });
    expect(focused.windows).toHaveLength(3);
    expect(windowById(focused, 'scratch-pad').placement).toEqual(scratch.placement);
    expect(focused.focusedId).toBe('scratch-pad');
  });

  test('move sets userArranged and keeps a pinned window movable', () => {
    const pinned = reduceWorkspace(createDefaultWorkspace(), {
      type: 'pin',
      id: CAMPAIGN_RUNWAY_ID,
      pinned: true,
    });
    expect(windowById(pinned).pinned).toBe(true);
    expect(windowById(pinned).userArranged).toBe(false);

    const moved = reduceWorkspace(pinned, {
      type: 'move',
      id: CAMPAIGN_RUNWAY_ID,
      x: 300,
      y: 48,
      bounds: BOUNDS,
    });
    const runway = windowById(moved);
    expect(runway.pinned).toBe(true);
    expect(runway.userArranged).toBe(true);
    expect(runway.placement.x).toBe(300);
    expect(runway.placement.y).toBe(48);
    expect(runway.placement.mode).toBe('desktop');
  });

  test('move clamps so the title bar stays on screen', () => {
    const moved = reduceWorkspace(createDefaultWorkspace(), {
      type: 'move',
      id: CAMPAIGN_RUNWAY_ID,
      x: -40,
      y: 5000,
      bounds: BOUNDS,
    });
    const placement = windowById(moved).placement;
    expect(placement.x).toBe(0);
    expect(placement.y).toBe(BOUNDS.height - TITLE_BAR_HEIGHT);
    expect(placement.y).toBeLessThanOrEqual(BOUNDS.height - TITLE_BAR_HEIGHT);
  });

  test('resize sets userArranged and keeps a minimum size', () => {
    const resized = reduceWorkspace(createDefaultWorkspace(), {
      type: 'resize',
      id: CAMPAIGN_RUNWAY_ID,
      width: 40,
      height: 20,
      bounds: BOUNDS,
    });
    const runway = windowById(resized);
    expect(runway.userArranged).toBe(true);
    expect(runway.placement.width).toBeGreaterThanOrEqual(280);
    expect(runway.placement.height).toBeGreaterThanOrEqual(160);
    expect(runway.placement.mode).toBe('desktop');
  });

  test('focus raises z-order without moving a user-arranged window', () => {
    const withSecond = reduceWorkspace(createDefaultWorkspace(), { type: 'create', id: 'scratch-pad' });
    const moved = reduceWorkspace(withSecond, {
      type: 'move',
      id: CAMPAIGN_RUNWAY_ID,
      x: 360,
      y: 80,
      bounds: BOUNDS,
    });
    const before = windowById(moved).placement;
    const focused = reduceWorkspace(moved, { type: 'focus', id: CAMPAIGN_RUNWAY_ID });
    const runway = windowById(focused);
    const scratch = windowById(focused, 'scratch-pad');

    expect(focused.focusedId).toBe(CAMPAIGN_RUNWAY_ID);
    expect(runway.z).toBeGreaterThan(scratch.z);
    expect(runway.placement).toEqual(before);
    expect(runway.userArranged).toBe(true);
  });

  test('pin does not freeze an explicit move and unpin keeps placement', () => {
    let workspace = reduceWorkspace(createDefaultWorkspace(), {
      type: 'pin',
      id: CAMPAIGN_RUNWAY_ID,
      pinned: true,
    });
    workspace = reduceWorkspace(workspace, {
      type: 'move',
      id: CAMPAIGN_RUNWAY_ID,
      x: 400,
      y: 32,
      bounds: BOUNDS,
    });
    workspace = reduceWorkspace(workspace, {
      type: 'pin',
      id: CAMPAIGN_RUNWAY_ID,
      pinned: false,
    });
    const runway = windowById(workspace);
    expect(runway.pinned).toBe(false);
    expect(runway.userArranged).toBe(true);
    expect(runway.placement.x).toBe(400);
  });

  test('minimize and restore toggle minimized and restore focuses', () => {
    const minimized = reduceWorkspace(createDefaultWorkspace(), {
      type: 'minimize',
      id: CAMPAIGN_RUNWAY_ID,
    });
    expect(windowById(minimized).minimized).toBe(true);
    expect(windowById(minimized).open).toBe(true);
    expect(windowById(minimized).placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);

    const restored = reduceWorkspace(minimized, { type: 'restore', id: CAMPAIGN_RUNWAY_ID });
    expect(windowById(restored).minimized).toBe(false);
    expect(restored.focusedId).toBe(CAMPAIGN_RUNWAY_ID);
    expect(windowById(restored).z).toBeGreaterThan(windowById(minimized).z);
  });

  test('close leaves the record and does not touch a GameState object or emit a command', () => {
    const game = structuredClone(initialState);
    const company = game.company;
    const workspace = reduceWorkspace(createDefaultWorkspace(), {
      type: 'move',
      id: CAMPAIGN_RUNWAY_ID,
      x: 320,
      y: 40,
      bounds: BOUNDS,
    });
    const placed = windowById(workspace).placement;
    const next = reduceWorkspace(workspace, { type: 'close', id: CAMPAIGN_RUNWAY_ID }, game);
    const runway = windowById(next);

    expect(runway.open).toBe(false);
    expect(runway.placement).toEqual(placed);
    expect(runway.userArranged).toBe(true);
    expect(next.windows).toHaveLength(2);
    expect(next.commands).toBeUndefined();
    expect(game.company).toBe(company);
    expect(game.company.cash).toBe(15000);
    expect(game.taxRate).toBe(0.25);
    expect(game.turn).toBe(0);
    expect(JSON.stringify(next)).not.toMatch(/advance_turn|set_tax|hire_employee|applyTurnCommand/);
  });

  test('reset layout restores defaults and clears userArranged', () => {
    let workspace = reduceWorkspace(createDefaultWorkspace(), {
      type: 'move',
      id: CAMPAIGN_RUNWAY_ID,
      x: 500,
      y: 80,
      bounds: BOUNDS,
    });
    workspace = reduceWorkspace(workspace, {
      type: 'pin',
      id: CAMPAIGN_RUNWAY_ID,
      pinned: true,
    });
    workspace = reduceWorkspace(workspace, { type: 'close', id: CAMPAIGN_RUNWAY_ID });
    workspace = reduceWorkspace(workspace, { type: 'create', id: 'scratch-pad' });

    const reset = reduceWorkspace(workspace, { type: 'reset' });
    expect(reset.placementMode).toBe('desktop');
    expect(reset.windows).toHaveLength(2);
    expect(windowById(reset).userArranged).toBe(false);
    expect(windowById(reset).pinned).toBe(false);
    expect(windowById(reset).open).toBe(true);
    expect(windowById(reset).minimized).toBe(false);
    expect(windowById(reset).placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);
    expect(reset.commands).toBeUndefined();
  });

  test('unknown placement mode is rejected back to desktop defaults', () => {
    const spatial = sanitizeWorkspace({
      version: 1,
      placementMode: 'spatial',
      windows: [
        {
          id: CAMPAIGN_RUNWAY_ID,
          open: true,
          minimized: false,
          pinned: true,
          z: 4,
          userArranged: true,
          placement: { mode: 'spatial', x: 3, y: 4, width: 100, height: 100, anchor: 'desk' },
        },
      ],
    });
    expect(spatial.placementMode).toBe('desktop');
    expect(spatial.windows).toHaveLength(2);
    expect(windowById(spatial).placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);
    expect(windowById(spatial).userArranged).toBe(false);
    expect(JSON.stringify(spatial)).not.toMatch(/anchor|quaternion|spatial/);

    const badWindow = sanitizeWorkspace({
      version: 1,
      placementMode: 'desktop',
      windows: [
        {
          id: CAMPAIGN_RUNWAY_ID,
          open: true,
          minimized: false,
          pinned: false,
          z: 1,
          userArranged: true,
          placement: { mode: 'spatial', x: 9, y: 9, width: 200, height: 200 },
        },
      ],
    });
    expect(windowById(badWindow).placement.mode).toBe('desktop');
    expect(windowById(badWindow).placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);
  });
});
