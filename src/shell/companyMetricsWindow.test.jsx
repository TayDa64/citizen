import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { PLAYER_ROLE_CAMPAIGN, PLAYER_ROLE_COMPANY_OPS } from '../playerRole';
import {
  CAMPAIGN_CALENDAR_ID,
  CAMPAIGN_CAUSAL_ID,
  CAMPAIGN_INGEST_ID,
  CAMPAIGN_LEDGER_ID,
  CAMPAIGN_NEST_ID,
  CAMPAIGN_POLITICS_ID,
  CAMPAIGN_TRIGGERS_ID,
  CAMPAIGN_RUNWAY_ID,
  COMPANY_METRICS_ID,
  COMPANY_OPS_ID,
  METRICS_DEFAULT_PLACEMENT,
  OPS_DEFAULT_PLACEMENT,
  createDefaultWorkspace,
  sanitizeWorkspace,
} from './windowModel';

function windowById(workspace, id) {
  return workspace.windows.find((item) => item.id === id);
}

function rectsOverlap(a, b) {
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  return a.x < bRight && aRight > b.x && a.y < bBottom && aBottom > b.y;
}

describe('company-metrics window model', () => {
  test('defaults include one open company-metrics window that does not cover ops or the runway', () => {
    const workspace = createDefaultWorkspace();
    const metrics = windowById(workspace, COMPANY_METRICS_ID);
    const runway = windowById(workspace, CAMPAIGN_RUNWAY_ID);
    const ops = windowById(workspace, COMPANY_OPS_ID);

    expect(COMPANY_METRICS_ID).toBe('company-metrics');
    expect(workspace.windows.map((item) => item.id)).toEqual([
      CAMPAIGN_RUNWAY_ID,
      COMPANY_OPS_ID,
      COMPANY_METRICS_ID,
      CAMPAIGN_POLITICS_ID,
      CAMPAIGN_CAUSAL_ID,
      CAMPAIGN_LEDGER_ID,
      CAMPAIGN_NEST_ID,
      CAMPAIGN_CALENDAR_ID,
      CAMPAIGN_INGEST_ID,
      CAMPAIGN_TRIGGERS_ID,
    ]);
    expect(metrics.open).toBe(true);
    expect(metrics.minimized).toBe(false);
    expect(metrics.userArranged).toBe(false);
    expect(metrics.placement).toEqual(METRICS_DEFAULT_PLACEMENT);
    expect(metrics.placement.mode).toBe('desktop');
    expect(metrics.placement.x).toBeGreaterThanOrEqual(runway.placement.x + runway.placement.width);
    expect(metrics.placement.y + metrics.placement.height).toBeLessThanOrEqual(
      runway.placement.y + runway.placement.height,
    );
    expect(metrics.placement.width).toBeGreaterThanOrEqual(520);
    expect(rectsOverlap(metrics.placement, runway.placement)).toBe(false);
    expect(ops.placement).toEqual(OPS_DEFAULT_PLACEMENT);
    expect(runway.z).toBeGreaterThan(metrics.z);
    expect(runway.z).toBeGreaterThan(ops.z);
  });

  test('a saved file without company-metrics gains that window and drops any persisted draft', () => {
    const legacy = sanitizeWorkspace({
      version: 1,
      placementMode: 'desktop',
      drafts: { [COMPANY_METRICS_ID]: { cash: 1 } },
      windows: [
        {
          id: CAMPAIGN_RUNWAY_ID,
          open: true,
          minimized: false,
          pinned: false,
          z: 3,
          userArranged: true,
          placement: { mode: 'desktop', x: 300, y: 40, width: 420, height: 360 },
        },
        {
          id: COMPANY_OPS_ID,
          open: true,
          minimized: false,
          pinned: false,
          z: 1,
          userArranged: false,
          placement: { ...OPS_DEFAULT_PLACEMENT },
        },
      ],
    });

    expect(legacy.windows).toHaveLength(10);
    expect(legacy.windows[0].placement.x).toBe(300);
    expect(legacy.windows[0].userArranged).toBe(true);
    expect(windowById(legacy, COMPANY_METRICS_ID).placement).toEqual(METRICS_DEFAULT_PLACEMENT);
    expect(legacy.drafts).toBeUndefined();
    expect(JSON.stringify(legacy)).not.toMatch(/drafts/);
  });
});

describe('company-metrics window mount', () => {
  test('role gate has no metrics window', () => {
    render(<App initialPlayerRole={null} />);
    expect(screen.queryByTestId('company-metrics')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cash-value')).not.toBeInTheDocument();
    expect(screen.queryByTestId('burn-value')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.metrics-chart')).toHaveLength(0);
  });

  test('campaign lens has one metrics owner inside the company-metrics window', async () => {
    render(<App initialPlayerRole={PLAYER_ROLE_CAMPAIGN} />);
    const frame = screen.getByTestId('company-metrics');
    expect(frame).toHaveTextContent(/company metrics/i);
    expect(frame).toContainElement(screen.getByTestId('cash-value'));
    expect(frame).toContainElement(screen.getByTestId('burn-value'));
    expect(frame).toContainElement(screen.getByTestId('base-burn-value'));
    expect(frame).toContainElement(await screen.findByRole('heading', { name: 'Cash & Burn Rate' }));
    expect(frame).toContainElement(document.querySelector('.metrics-chart'));
    expect(screen.getByRole('main')).toContainElement(frame);
    expect(screen.getAllByTestId('cash-value')).toHaveLength(1);
    expect(screen.getAllByTestId('burn-value')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'Cash & Burn Rate' })).toHaveLength(1);
    expect(document.querySelectorAll('.metrics-chart')).toHaveLength(1);
    expect(screen.queryByTestId('runway-cash')).not.toBeInTheDocument();
    expect(screen.queryByTestId('runway-burn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('runway-base-burn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('runway-tax')).not.toBeInTheDocument();
    expect(screen.getByTestId('runway-hype')).toBeInTheDocument();
    expect(withinMetrics(frame, 'turn-ledger')).toBe(false);
    expect(frame.querySelector('[data-testid="politics-meter"]')).toBeNull();
    expect(screen.getByTestId('island-campaign')).toBeInTheDocument();
    expect(screen.getByTestId('island-company-ops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Company metrics' })).toBeInTheDocument();
  });

  test('company ops lens still has the same single metrics owner', async () => {
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);
    const frame = screen.getByTestId('company-metrics');
    expect(screen.getAllByTestId('cash-value')).toHaveLength(1);
    expect(screen.getAllByTestId('burn-value')).toHaveLength(1);
    expect(document.querySelectorAll('.metrics-chart')).toHaveLength(1);
    expect(frame).toContainElement(screen.getByTestId('cash-value'));
    expect(screen.getByTestId('company-ops-forms')).toBeInTheDocument();
    expect(screen.getAllByTestId('ops-tax-rate')).toHaveLength(1);
  });
});

function withinMetrics(frame, testId) {
  return frame.querySelector(`[data-testid="${testId}"]`) != null;
}
