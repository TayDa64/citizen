import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../App';
import IngestRunsPanel from '../components/IngestRunsPanel';
import { buildJurisdictionNestView } from '../jurisdictionNest';
import { PLAYER_ROLE_CAMPAIGN, PLAYER_ROLE_COMPANY_OPS } from '../playerRole';
import {
  CALENDAR_DEFAULT_PLACEMENT,
  CAMPAIGN_CALENDAR_ID,
  CAMPAIGN_CAUSAL_ID,
  CAMPAIGN_INGEST_ID,
  CAMPAIGN_LEDGER_ID,
  CAMPAIGN_NEST_ID,
  CAMPAIGN_POLITICS_ID,
  CAMPAIGN_RUNWAY_ID,
  CAMPAIGN_TRIGGERS_ID,
  CAUSAL_DEFAULT_PLACEMENT,
  COMPANY_METRICS_ID,
  INGEST_DEFAULT_PLACEMENT,
  LEDGER_DEFAULT_PLACEMENT,
  METRICS_DEFAULT_PLACEMENT,
  NEST_DEFAULT_PLACEMENT,
  POLITICS_DEFAULT_PLACEMENT,
  RUNWAY_DEFAULT_PLACEMENT,
  TRIGGERS_DEFAULT_PLACEMENT,
  createDefaultWorkspace,
  sanitizeWorkspace,
} from './windowModel';

const CIVIC_IDS = [
  CAMPAIGN_NEST_ID,
  CAMPAIGN_CALENDAR_ID,
  CAMPAIGN_INGEST_ID,
  CAMPAIGN_TRIGGERS_ID,
];

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('campaign civic window model', () => {
  test('defaults stack nest, calendar, ingest, and triggers clear of the tax slider and Advance Month', () => {
    const workspace = createDefaultWorkspace();
    const placements = {
      [CAMPAIGN_NEST_ID]: NEST_DEFAULT_PLACEMENT,
      [CAMPAIGN_CALENDAR_ID]: CALENDAR_DEFAULT_PLACEMENT,
      [CAMPAIGN_INGEST_ID]: INGEST_DEFAULT_PLACEMENT,
      [CAMPAIGN_TRIGGERS_ID]: TRIGGERS_DEFAULT_PLACEMENT,
    };
    const kept = [
      windowById(workspace, CAMPAIGN_RUNWAY_ID).placement,
      windowById(workspace, COMPANY_METRICS_ID).placement,
      windowById(workspace, CAMPAIGN_POLITICS_ID).placement,
      windowById(workspace, CAMPAIGN_CAUSAL_ID).placement,
      windowById(workspace, CAMPAIGN_LEDGER_ID).placement,
    ];

    expect(workspace.windows[0].id).toBe(CAMPAIGN_RUNWAY_ID);
    expect(windowById(workspace, CAMPAIGN_RUNWAY_ID).placement).toEqual(RUNWAY_DEFAULT_PLACEMENT);
    expect(windowById(workspace, COMPANY_METRICS_ID).placement).toEqual(METRICS_DEFAULT_PLACEMENT);
    expect(windowById(workspace, CAMPAIGN_POLITICS_ID).placement).toEqual(POLITICS_DEFAULT_PLACEMENT);
    expect(windowById(workspace, CAMPAIGN_CAUSAL_ID).placement).toEqual(CAUSAL_DEFAULT_PLACEMENT);
    expect(windowById(workspace, CAMPAIGN_LEDGER_ID).placement).toEqual(LEDGER_DEFAULT_PLACEMENT);

    CIVIC_IDS.forEach((id, index) => {
      const record = windowById(workspace, id);
      expect(record.open).toBe(true);
      expect(record.minimized).toBe(false);
      expect(record.userArranged).toBe(false);
      expect(record.placement).toEqual(placements[id]);
      expect(record.placement.x).toBeGreaterThanOrEqual(760);
      expect(record.placement.x + record.placement.width).toBeLessThanOrEqual(1280);
      expect(windowById(workspace, CAMPAIGN_RUNWAY_ID).z).toBeGreaterThan(record.z);
      kept.forEach((placement) => {
        expect(rectsOverlap(record.placement, placement)).toBe(false);
      });
      CIVIC_IDS.slice(index + 1).forEach((otherId) => {
        expect(rectsOverlap(record.placement, windowById(workspace, otherId).placement)).toBe(false);
      });
    });
  });

  test('a saved file without the civic windows gains them and keeps the runway', () => {
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

    expect(legacy.windows[0].placement.x).toBe(300);
    expect(legacy.windows[0].userArranged).toBe(true);
    expect(windowById(legacy, CAMPAIGN_NEST_ID).placement).toEqual(NEST_DEFAULT_PLACEMENT);
    expect(windowById(legacy, CAMPAIGN_CALENDAR_ID).placement).toEqual(CALENDAR_DEFAULT_PLACEMENT);
    expect(windowById(legacy, CAMPAIGN_INGEST_ID).placement).toEqual(INGEST_DEFAULT_PLACEMENT);
    expect(windowById(legacy, CAMPAIGN_TRIGGERS_ID).placement).toEqual(TRIGGERS_DEFAULT_PLACEMENT);
  });

  test('peers still fail closed and ingest runs stay lean', async () => {
    const nest = buildJurisdictionNestView('mv');
    expect(nest.peers).toEqual([
      expect.objectContaining({ id: 'sunnyvale', bindsHome: false }),
    ]);
    expect(nest.peers.every((row) => row.bindsHome === false)).toBe(true);

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => [],
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchImpl);
    render(<IngestRunsPanel apiBase="/api" />);
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalled();
    });
    const calledUrl = String(fetchImpl.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/ingest/runs');
    expect(calledUrl).not.toMatch(/includeResult/);
    expect(screen.getByTestId('ingest-runs-empty')).toBeInTheDocument();
  });
});

describe('campaign civic window mount', () => {
  test('role gate has none of the civic panels', () => {
    render(<App initialPlayerRole={null} />);
    expect(screen.queryByTestId('campaign-nest')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-calendar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-ingest')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-triggers')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nest-explorer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('council-calendar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingest-runs-panel')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'World events' })).not.toBeInTheDocument();
  });

  test('campaign lens has one of each panel inside its window and the desk', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_CAMPAIGN} />);
    const desk = screen.getByTestId('campaign-desk');
    const metrics = screen.getByTestId('company-metrics');

    const nestFrame = screen.getByTestId('campaign-nest');
    const calendarFrame = screen.getByTestId('campaign-calendar');
    const ingestFrame = screen.getByTestId('campaign-ingest');
    const triggersFrame = screen.getByTestId('campaign-triggers');
    const nest = screen.getByTestId('nest-explorer');
    const calendar = screen.getByTestId('council-calendar');
    const ingest = screen.getByTestId('ingest-runs-panel');
    const triggers = screen.getByRole('region', { name: 'World events' });

    expect(screen.getAllByTestId('nest-explorer')).toHaveLength(1);
    expect(screen.getAllByTestId('council-calendar')).toHaveLength(1);
    expect(screen.getAllByTestId('ingest-runs-panel')).toHaveLength(1);
    expect(screen.getAllByRole('region', { name: 'World events' })).toHaveLength(1);

    expect(desk).toContainElement(nestFrame);
    expect(desk).toContainElement(calendarFrame);
    expect(desk).toContainElement(ingestFrame);
    expect(desk).toContainElement(triggersFrame);
    expect(nestFrame).toContainElement(nest);
    expect(calendarFrame).toContainElement(calendar);
    expect(ingestFrame).toContainElement(ingest);
    expect(triggersFrame).toContainElement(triggers);
    expect(metrics).not.toContainElement(nest);
    expect(metrics).not.toContainElement(calendar);
    expect(metrics).not.toContainElement(ingest);
    expect(metrics).not.toContainElement(triggers);

    expect(screen.getByTestId('nest-explorer-offline')).toHaveTextContent(/api offline — nest unavailable/i);
    expect(screen.getByTestId('council-calendar-offline')).toHaveTextContent(/api offline — calendar unavailable/i);
    expect(screen.getByTestId('ingest-runs-offline')).toHaveTextContent(/api offline — ingest history unavailable/i);
    expect(nest).toHaveTextContent(/do not bind/i);
    expect(within(triggers).getByRole('button', { name: 'Ingest fixture wage bulletin' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Jurisdiction nest' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Council calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ingest runs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'World events' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'World events' })).toBeInTheDocument();
    for (const name of ['Jurisdiction nest', 'Council calendar', 'Ingest runs']) {
      expect(screen.getAllByRole('heading', { name, exact: true })).toHaveLength(1);
      expect(screen.getAllByRole('region', { name, exact: true })).toHaveLength(1);
    }
  });

  test('company ops does not mount the civic windows and keeps the campaign hint', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);
    expect(screen.queryByTestId('campaign-nest')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-calendar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-ingest')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-triggers')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nest-explorer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('council-calendar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ingest-runs-panel')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'World events' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-campaign-hint')).toHaveTextContent(/jurisdiction nest/i);
    expect(screen.getByTestId('island-campaign')).toBeInTheDocument();
    expect(screen.getByTestId('island-company-ops')).toBeInTheDocument();
  });
});
