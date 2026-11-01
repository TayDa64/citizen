import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { PLAYER_ROLE_CAMPAIGN, PLAYER_ROLE_COMPANY_OPS } from '../playerRole';
import { CAUSAL_HUB_FOCUS } from '../causalInfluence';
import {
  CAMPAIGN_CAUSAL_ID,
  CAMPAIGN_POLITICS_ID,
  CAMPAIGN_RUNWAY_ID,
  CAUSAL_DEFAULT_PLACEMENT,
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

describe('campaign-causal window model', () => {
  test('defaults include one open causal window clear of the runway, metrics, and politics', () => {
    const workspace = createDefaultWorkspace();
    const causal = windowById(workspace, CAMPAIGN_CAUSAL_ID);
    const runway = windowById(workspace, CAMPAIGN_RUNWAY_ID);
    const metrics = windowById(workspace, COMPANY_METRICS_ID);
    const politics = windowById(workspace, CAMPAIGN_POLITICS_ID);

    expect(CAMPAIGN_CAUSAL_ID).toBe('campaign-causal');
    expect(CAUSAL_HUB_FOCUS).toBe('company.burnRate');
    expect(causal.open).toBe(true);
    expect(causal.minimized).toBe(false);
    expect(causal.userArranged).toBe(false);
    expect(causal.placement).toEqual(CAUSAL_DEFAULT_PLACEMENT);
    expect(causal.placement.x).toBeGreaterThanOrEqual(240);
    expect(causal.placement.y + causal.placement.height).toBeLessThanOrEqual(720);
    expect(rectsOverlap(causal.placement, runway.placement)).toBe(false);
    expect(rectsOverlap(causal.placement, metrics.placement)).toBe(false);
    expect(rectsOverlap(causal.placement, politics.placement)).toBe(false);
    expect(runway.placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);
    expect(metrics.placement).toEqual(METRICS_DEFAULT_PLACEMENT);
    expect(politics.placement).toEqual(POLITICS_DEFAULT_PLACEMENT);
    expect(runway.z).toBeGreaterThan(causal.z);
  });

  test('a saved file without campaign-causal gains that window', () => {
    const legacy = sanitizeWorkspace({
      version: 1,
      placementMode: 'desktop',
      windows: [
        {
          id: CAMPAIGN_RUNWAY_ID,
          open: true,
          minimized: false,
          pinned: false,
          z: 5,
          userArranged: true,
          placement: { mode: 'desktop', x: 300, y: 40, width: 420, height: 360 },
        },
      ],
    });

    expect(windowById(legacy, CAMPAIGN_CAUSAL_ID).open).toBe(true);
    expect(windowById(legacy, CAMPAIGN_CAUSAL_ID).placement).toEqual(CAUSAL_DEFAULT_PLACEMENT);
    expect(legacy.windows[0].placement.x).toBe(300);
    expect(legacy.windows[0].userArranged).toBe(true);
  });
});

describe('campaign-causal window mount', () => {
  test('role gate has no causal hub', () => {
    render(<App initialPlayerRole={null} />);
    expect(screen.queryByTestId('campaign-causal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('causal-hub')).not.toBeInTheDocument();
  });

  test('campaign lens has one hub inside the causal window, focused on company.burnRate', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_CAMPAIGN} />);
    const frame = screen.getByTestId('campaign-causal');
    const hub = screen.getByTestId('causal-hub');

    expect(frame).toHaveTextContent(/causal hub/i);
    expect(frame).toContainElement(hub);
    expect(screen.getAllByTestId('causal-hub')).toHaveLength(1);
    expect(screen.getByTestId('causal-hub-focus')).toHaveTextContent('company.burnRate');
    expect(screen.getByTestId('causal-node-company.burnRate')).toHaveAttribute('data-hub', 'true');
    expect(screen.getByTestId('campaign-desk')).not.toContainElement(hub);
    expect(screen.getByTestId('company-metrics')).not.toContainElement(hub);
    expect(document.querySelector('.react-flow')).toBeTruthy();
    expect(screen.getByRole('button', { name: /advance month/i })).toBeInTheDocument();
    expect(screen.getByTestId('island-campaign')).toBeInTheDocument();
    expect(screen.getByTestId('island-company-ops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Causal hub' })).toBeInTheDocument();
  });

  test('company ops lens does not mount the causal hub', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);
    expect(screen.queryByTestId('campaign-causal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('causal-hub')).not.toBeInTheDocument();
    expect(screen.getByTestId('company-ops-forms')).toBeInTheDocument();
    expect(screen.getByTestId('ops-campaign-hint')).toBeInTheDocument();
  });
});
