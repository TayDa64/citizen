import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { PLAYER_ROLE_CAMPAIGN, PLAYER_ROLE_COMPANY_OPS } from '../playerRole';
import { initialState } from '../simulationCore';
import {
  CAMPAIGN_RUNWAY_ID,
  COMPANY_OPS_ID,
  OPS_DEFAULT_PLACEMENT,
  createDefaultWorkspace,
  reduceWorkspace,
  sanitizeWorkspace,
} from './windowModel';
import { WORKSPACE_STORAGE_KEY, readWorkspace, writeWorkspace } from './workspaceStore';

function windowById(workspace, id) {
  return workspace.windows.find((item) => item.id === id);
}

describe('company-ops window model', () => {
  test('defaults include an open company-ops window beside the runway', () => {
    const workspace = createDefaultWorkspace();
    const ops = windowById(workspace, COMPANY_OPS_ID);
    const runway = windowById(workspace, CAMPAIGN_RUNWAY_ID);

    expect(COMPANY_OPS_ID).toBe('company-ops');
    expect(workspace.windows).toHaveLength(5);
    expect(workspace.windows[0].id).toBe(CAMPAIGN_RUNWAY_ID);
    expect(ops.open).toBe(true);
    expect(ops.minimized).toBe(false);
    expect(ops.pinned).toBe(false);
    expect(ops.userArranged).toBe(false);
    expect(ops.placement).toEqual(OPS_DEFAULT_PLACEMENT);
    expect(ops.placement.mode).toBe('desktop');
    expect(ops.placement.x).toBeGreaterThanOrEqual(runway.placement.x + runway.placement.width);
    expect(workspace.focusedId).toBe(CAMPAIGN_RUNWAY_ID);
    expect(workspace.drafts).toEqual({});
    expect(runway.z).toBeGreaterThan(ops.z);
  });

  test('a saved runway-only file gains company-ops without moving the runway', () => {
    const legacy = sanitizeWorkspace({
      version: 1,
      placementMode: 'desktop',
      drafts: { [COMPANY_OPS_ID]: { taxRate: 0.5 } },
      windows: [
        {
          id: CAMPAIGN_RUNWAY_ID,
          open: true,
          minimized: false,
          pinned: true,
          z: 4,
          userArranged: true,
          placement: { mode: 'desktop', x: 300, y: 40, width: 420, height: 360 },
        },
      ],
    });

    expect(legacy.windows).toHaveLength(5);
    expect(legacy.windows[0].id).toBe(CAMPAIGN_RUNWAY_ID);
    expect(legacy.windows[0].placement.x).toBe(300);
    expect(legacy.windows[0].userArranged).toBe(true);
    expect(legacy.windows[0].pinned).toBe(true);
    expect(windowById(legacy, COMPANY_OPS_ID).open).toBe(true);
    expect(windowById(legacy, COMPANY_OPS_ID).placement).toEqual(OPS_DEFAULT_PLACEMENT);
    expect(legacy.drafts).toBeUndefined();
    expect(JSON.stringify(legacy)).not.toMatch(/taxRate|drafts/);
  });

  test('close keeps the in-memory draft and reset drops it without a TurnCommand', () => {
    const game = structuredClone(initialState);
    const drafted = reduceWorkspace(createDefaultWorkspace(), {
      type: 'setDraft',
      id: COMPANY_OPS_ID,
      draft: { taxRate: 0.5, department: 'marketing', skill: '0.4' },
    }, game);
    expect(drafted.drafts[COMPANY_OPS_ID]).toEqual({
      taxRate: 0.5,
      department: 'marketing',
      skill: '0.4',
    });
    expect(game.taxRate).toBe(0.25);
    expect(drafted.commands).toBeUndefined();

    const closed = reduceWorkspace(drafted, { type: 'close', id: COMPANY_OPS_ID }, game);
    expect(windowById(closed, COMPANY_OPS_ID).open).toBe(false);
    expect(closed.drafts[COMPANY_OPS_ID].taxRate).toBe(0.5);
    expect(game.taxRate).toBe(0.25);
    expect(game.company.cash).toBe(15000);
    expect(JSON.stringify(closed)).not.toMatch(/advance_turn|set_tax|hire_employee|applyTurnCommand/);

    const reopened = reduceWorkspace(closed, { type: 'create', id: COMPANY_OPS_ID });
    expect(windowById(reopened, COMPANY_OPS_ID).open).toBe(true);
    expect(reopened.drafts[COMPANY_OPS_ID].taxRate).toBe(0.5);
    expect(windowById(reopened, COMPANY_OPS_ID).userArranged).toBe(false);

    const reset = reduceWorkspace(reopened, { type: 'reset' }, game);
    expect(reset.drafts).toEqual({});
    expect(windowById(reset, COMPANY_OPS_ID).open).toBe(true);
    expect(reset.commands).toBeUndefined();
    expect(game.taxRate).toBe(0.25);
  });

  test('writeWorkspace omits drafts so a reload cannot restore an unsubmitted tax', () => {
    const seed = new Map();
    const storage = {
      getItem: (key) => (seed.has(key) ? seed.get(key) : null),
      setItem: (key, value) => {
        seed.set(key, String(value));
      },
      removeItem: (key) => {
        seed.delete(key);
      },
    };
    const drafted = reduceWorkspace(createDefaultWorkspace(), {
      type: 'setDraft',
      id: COMPANY_OPS_ID,
      draft: { taxRate: 0.5, department: 'sales', skill: '0.2' },
    });
    writeWorkspace(drafted, storage);
    const raw = seed.get(WORKSPACE_STORAGE_KEY);
    expect(raw).not.toMatch(/taxRate|drafts|sales|playerRole/);
    const read = readWorkspace(storage);
    expect(read.drafts ?? {}).toEqual({});
    expect(read.drafts?.[COMPANY_OPS_ID]).toBeUndefined();
    expect(windowById(read, COMPANY_OPS_ID).id).toBe(COMPANY_OPS_ID);
  });
});

describe('company-ops window mount', () => {
  test('role gate has no ops window', () => {
    render(<App initialPlayerRole={null} />);
    expect(screen.queryByTestId('company-ops')).not.toBeInTheDocument();
    expect(screen.queryByTestId('company-ops-forms')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-tax-rate')).not.toBeInTheDocument();
  });

  test('company ops lens shows one ops form inside the company-ops window', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);
    const frame = screen.getByTestId('company-ops');
    expect(frame).toHaveTextContent(/ops desk/i);
    expect(frame).toContainElement(screen.getByTestId('company-ops-forms'));
    expect(screen.getAllByTestId('company-ops-forms')).toHaveLength(1);
    expect(screen.getAllByTestId('ops-tax-form')).toHaveLength(1);
    expect(screen.getAllByTestId('ops-tax-rate')).toHaveLength(1);
    expect(screen.getAllByTestId('ops-tax-readout')).toHaveLength(1);
    expect(screen.getAllByTestId('ops-tax-apply')).toHaveLength(1);
    expect(screen.getAllByTestId('ops-hire-form')).toHaveLength(1);
    expect(screen.getAllByTestId('ops-hire-department')).toHaveLength(1);
    expect(screen.getAllByTestId('ops-hire-skill')).toHaveLength(1);
    expect(screen.getAllByTestId('ops-hire-submit')).toHaveLength(1);
    expect(screen.getByTestId('island-company-ops')).toBeInTheDocument();
    expect(screen.getByTestId('island-campaign')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ops desk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Campaign runway' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset layout' })).toBeInTheDocument();
    expect(screen.getByTestId('ops-campaign-hint')).toBeInTheDocument();
  });

  test('campaign lens keeps a single tax slider and does not mount ops ids', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_CAMPAIGN} />);
    expect(screen.queryByTestId('company-ops')).not.toBeInTheDocument();
    expect(screen.queryByTestId('company-ops-forms')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-tax-rate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-tax-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-hire-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ops-hire-submit')).not.toBeInTheDocument();
    expect(screen.getAllByRole('slider', { name: /tax rate/i })).toHaveLength(1);
    expect(screen.getByTestId('island-company-ops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ops desk' })).toBeInTheDocument();
    expect(screen.getByTestId('campaign-desk')).toBeInTheDocument();
  });

  test('close and lens switch keep an unsubmitted tax draft and do not change burn', async () => {
    const user = userEvent.setup();
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);

    fireEvent.change(screen.getByTestId('ops-tax-rate'), { target: { value: '0.5' } });
    expect(screen.getByTestId('ops-tax-readout')).toHaveTextContent('Tax: 50%');
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $2,200');
    expect(globalThis.localStorage.getItem(WORKSPACE_STORAGE_KEY)).not.toMatch(/taxRate|drafts/);

    await user.click(within(screen.getByTestId('company-ops')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('company-ops-forms')).not.toBeInTheDocument();
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $2,200');

    await user.click(screen.getByRole('button', { name: 'Ops desk' }));
    expect(screen.getByTestId('ops-tax-readout')).toHaveTextContent('Tax: 50%');
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $2,200');

    await user.click(screen.getByTestId('island-campaign'));
    expect(screen.queryByTestId('ops-tax-rate')).not.toBeInTheDocument();
    expect(screen.getAllByRole('slider', { name: /tax rate/i })).toHaveLength(1);
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $2,200');

    await user.click(screen.getByTestId('island-company-ops'));
    expect(screen.getAllByTestId('ops-tax-rate')).toHaveLength(1);
    expect(screen.getByTestId('ops-tax-readout')).toHaveTextContent('Tax: 50%');
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $2,200');
  });

  test('reset layout drops the session draft and leaves committed tax alone', async () => {
    const user = userEvent.setup();
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);

    fireEvent.change(screen.getByTestId('ops-tax-rate'), { target: { value: '0.5' } });
    expect(screen.getByTestId('ops-tax-readout')).toHaveTextContent('Tax: 50%');

    await user.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(screen.getByTestId('company-ops')).toBeInTheDocument();
    expect(screen.getByTestId('ops-tax-readout')).toHaveTextContent('Tax: 25%');
    expect(screen.getByTestId('burn-value')).toHaveTextContent('Burn/mo: $2,200');
    expect(screen.getAllByTestId('ops-hire-submit')).toHaveLength(1);
  });
});
