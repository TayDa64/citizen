import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { PLAYER_ROLE_CAMPAIGN, PLAYER_ROLE_COMPANY_OPS } from '../playerRole';
import { appendLedgerFromTurnResults } from '../turnLedger';
import {
  CAMPAIGN_CAUSAL_ID,
  CAMPAIGN_LEDGER_ID,
  CAMPAIGN_POLITICS_ID,
  CAMPAIGN_RUNWAY_ID,
  CAUSAL_DEFAULT_PLACEMENT,
  COMPANY_METRICS_ID,
  LEDGER_DEFAULT_PLACEMENT,
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

describe('campaign-ledger window model', () => {
  test('defaults include one open ledger window clear of the other campaign windows', () => {
    const workspace = createDefaultWorkspace();
    const ledger = windowById(workspace, CAMPAIGN_LEDGER_ID);
    const runway = windowById(workspace, CAMPAIGN_RUNWAY_ID);
    const metrics = windowById(workspace, COMPANY_METRICS_ID);
    const politics = windowById(workspace, CAMPAIGN_POLITICS_ID);
    const causal = windowById(workspace, CAMPAIGN_CAUSAL_ID);

    expect(CAMPAIGN_LEDGER_ID).toBe('campaign-ledger');
    expect(ledger.open).toBe(true);
    expect(ledger.minimized).toBe(false);
    expect(ledger.userArranged).toBe(false);
    expect(ledger.placement).toEqual(LEDGER_DEFAULT_PLACEMENT);
    expect(ledger.placement.x).toBeGreaterThanOrEqual(240);
    expect(ledger.placement.y + ledger.placement.height).toBeLessThanOrEqual(960);
    expect(rectsOverlap(ledger.placement, runway.placement)).toBe(false);
    expect(rectsOverlap(ledger.placement, metrics.placement)).toBe(false);
    expect(rectsOverlap(ledger.placement, politics.placement)).toBe(false);
    expect(rectsOverlap(ledger.placement, causal.placement)).toBe(false);
    expect(runway.placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);
    expect(metrics.placement).toEqual(METRICS_DEFAULT_PLACEMENT);
    expect(politics.placement).toEqual(POLITICS_DEFAULT_PLACEMENT);
    expect(causal.placement).toEqual(CAUSAL_DEFAULT_PLACEMENT);
    expect(runway.z).toBeGreaterThan(ledger.z);
  });

  test('a saved file without campaign-ledger gains that window', () => {
    const legacy = sanitizeWorkspace({
      version: 1,
      placementMode: 'desktop',
      windows: [
        {
          id: CAMPAIGN_RUNWAY_ID,
          open: true,
          minimized: false,
          pinned: false,
          z: 6,
          userArranged: true,
          placement: { mode: 'desktop', x: 300, y: 40, width: 420, height: 360 },
        },
      ],
    });

    expect(windowById(legacy, CAMPAIGN_LEDGER_ID).open).toBe(true);
    expect(windowById(legacy, CAMPAIGN_LEDGER_ID).placement).toEqual(LEDGER_DEFAULT_PLACEMENT);
    expect(legacy.windows[0].placement.x).toBe(300);
    expect(legacy.windows[0].userArranged).toBe(true);
  });

  test('ledger entries still come from turnLedger.js', () => {
    const entries = appendLedgerFromTurnResults([], [{
      seq: 1,
      turnBefore: 0,
      turnAfter: 1,
      command: { type: 'advance_turn' },
      before: { cash: 15000, burnRate: 2200, hype: 0.3, taxRate: 0.25 },
      after: { cash: 14817, burnRate: 2200, hype: 0.3, taxRate: 0.25 },
      explanations: ['Advanced one month.'],
    }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].command.type).toBe('advance_turn');
  });
});

describe('campaign-ledger window mount', () => {
  test('role gate has no turn ledger', () => {
    render(<App initialPlayerRole={null} />);
    expect(screen.queryByTestId('campaign-ledger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('turn-ledger')).not.toBeInTheDocument();
  });

  test('campaign lens has one ledger inside its window and the desk, not in metrics', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_CAMPAIGN} />);
    const desk = screen.getByTestId('campaign-desk');
    const frame = screen.getByTestId('campaign-ledger');
    const ledger = screen.getByTestId('turn-ledger');

    expect(frame).toHaveTextContent(/turn ledger/i);
    expect(desk).toContainElement(frame);
    expect(frame).toContainElement(ledger);
    expect(screen.getAllByTestId('turn-ledger')).toHaveLength(1);
    expect(screen.getByTestId('turn-ledger-empty')).toBeInTheDocument();
    expect(screen.getByTestId('company-metrics')).not.toContainElement(ledger);
    expect(screen.getByTestId('island-campaign')).toBeInTheDocument();
    expect(screen.getByTestId('island-company-ops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn ledger' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Turn ledger', exact: true })).toHaveLength(1);
    expect(screen.getAllByRole('region', { name: 'Turn ledger', exact: true })).toHaveLength(1);
    expect(screen.getByTestId('turn-ledger')).toHaveTextContent(/append-only decisions/i);
  });

  test('company ops lens does not mount the ledger', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);
    expect(screen.queryByTestId('campaign-ledger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('turn-ledger')).not.toBeInTheDocument();
    expect(screen.getByTestId('company-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('ops-campaign-hint')).toBeInTheDocument();
  });
});
