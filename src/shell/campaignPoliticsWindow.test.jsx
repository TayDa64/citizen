import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { PLAYER_ROLE_CAMPAIGN, PLAYER_ROLE_COMPANY_OPS } from '../playerRole';
import {
  CAMPAIGN_POLITICS_ID,
  CAMPAIGN_RUNWAY_ID,
  COMPANY_METRICS_ID,
  METRICS_DEFAULT_PLACEMENT,
  POLITICS_DEFAULT_PLACEMENT,
  RUNWAY_DEFAULT_PLACEMENT,
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

describe('campaign-politics window model', () => {
  test('defaults include one open politics window clear of the runway and the metrics chart', () => {
    const workspace = createDefaultWorkspace();
    const politics = windowById(workspace, CAMPAIGN_POLITICS_ID);
    const runway = windowById(workspace, CAMPAIGN_RUNWAY_ID);
    const metrics = windowById(workspace, COMPANY_METRICS_ID);

    expect(CAMPAIGN_POLITICS_ID).toBe('campaign-politics');
    expect(politics.open).toBe(true);
    expect(politics.minimized).toBe(false);
    expect(politics.userArranged).toBe(false);
    expect(politics.placement).toEqual(POLITICS_DEFAULT_PLACEMENT);
    expect(politics.placement.x).toBeGreaterThanOrEqual(240);
    expect(politics.placement.y + politics.placement.height).toBeLessThanOrEqual(720);
    expect(rectsOverlap(politics.placement, runway.placement)).toBe(false);
    expect(rectsOverlap(politics.placement, metrics.placement)).toBe(false);
    expect(runway.placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);
    expect(metrics.placement).toEqual(METRICS_DEFAULT_PLACEMENT);
    expect(runway.z).toBeGreaterThan(politics.z);
  });

  test('a saved file without campaign-politics gains that window', () => {
    const legacy = sanitizeWorkspace({
      version: 1,
      placementMode: 'desktop',
      windows: [
        {
          id: CAMPAIGN_RUNWAY_ID,
          open: true,
          minimized: false,
          pinned: false,
          z: 4,
          userArranged: true,
          placement: { mode: 'desktop', x: 300, y: 40, width: 420, height: 360 },
        },
      ],
    });

    expect(windowById(legacy, CAMPAIGN_POLITICS_ID).open).toBe(true);
    expect(windowById(legacy, CAMPAIGN_POLITICS_ID).placement).toEqual(POLITICS_DEFAULT_PLACEMENT);
    expect(legacy.windows[0].placement.x).toBe(300);
    expect(legacy.windows[0].userArranged).toBe(true);
  });
});

describe('campaign-politics window mount', () => {
  test('role gate has no politics meter', () => {
    render(<App initialPlayerRole={null} />);
    expect(screen.queryByTestId('campaign-politics')).not.toBeInTheDocument();
    expect(screen.queryByTestId('politics-meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter', { name: 'Voter support' })).not.toBeInTheDocument();
  });

  test('campaign lens has one voter-support meter inside the politics window and the desk', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_CAMPAIGN} />);
    const desk = screen.getByTestId('campaign-desk');
    const frame = screen.getByTestId('campaign-politics');
    const meter = screen.getByRole('meter', { name: 'Voter support' });

    expect(frame).toHaveTextContent(/politics/i);
    expect(desk).toContainElement(frame);
    expect(frame).toContainElement(screen.getByTestId('politics-meter'));
    expect(frame).toContainElement(meter);
    expect(screen.getAllByTestId('politics-meter')).toHaveLength(1);
    expect(screen.getAllByRole('meter', { name: 'Voter support' })).toHaveLength(1);
    expect(screen.getByTestId('company-metrics')).not.toContainElement(screen.getByTestId('politics-meter'));
    expect(screen.getByTestId('island-campaign')).toBeInTheDocument();
    expect(screen.getByTestId('island-company-ops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Politics' })).toBeInTheDocument();
    expect(within(desk).getByTestId('causal-hub')).toBeInTheDocument();
  });

  test('company ops lens does not mount the politics meter', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);
    expect(screen.queryByTestId('campaign-politics')).not.toBeInTheDocument();
    expect(screen.queryByTestId('politics-meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter', { name: 'Voter support' })).not.toBeInTheDocument();
    expect(screen.getByTestId('company-ops-forms')).toBeInTheDocument();
    expect(screen.getByTestId('company-metrics')).toBeInTheDocument();
  });
});
