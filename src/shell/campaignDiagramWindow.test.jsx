import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { PLAYER_ROLE_CAMPAIGN, PLAYER_ROLE_COMPANY_OPS } from '../playerRole';
import {
  CAMPAIGN_CALENDAR_ID,
  CAMPAIGN_INGEST_ID,
  CAMPAIGN_RUNWAY_ID,
  CAMPAIGN_TRIGGERS_ID,
  DIAGRAM_DEFAULT_PLACEMENT,
  TRIGGERS_DEFAULT_PLACEMENT,
  WORKFLOW_DIAGRAM_ID,
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

describe('workflow-diagram window model', () => {
  test('defaults open a diagram large enough for the civic band and above the event windows', () => {
    const workspace = createDefaultWorkspace();
    const diagram = windowById(workspace, WORKFLOW_DIAGRAM_ID);
    const runway = windowById(workspace, CAMPAIGN_RUNWAY_ID);
    const triggers = windowById(workspace, CAMPAIGN_TRIGGERS_ID);

    expect(WORKFLOW_DIAGRAM_ID).toBe('workflow-diagram');
    expect(workspace.windows[0].id).toBe(CAMPAIGN_RUNWAY_ID);
    expect(workspace.focusedId).toBe(CAMPAIGN_RUNWAY_ID);
    expect(diagram.open).toBe(true);
    expect(diagram.minimized).toBe(false);
    expect(diagram.userArranged).toBe(false);
    expect(diagram.placement).toEqual(DIAGRAM_DEFAULT_PLACEMENT);
    expect(diagram.placement.x).toBeGreaterThanOrEqual(240);
    expect(diagram.placement.width).toBeGreaterThanOrEqual(960);
    expect(diagram.placement.height).toBeGreaterThanOrEqual(640);
    expect(diagram.placement.x + diagram.placement.width).toBeLessThanOrEqual(1280);
    expect(diagram.placement.y + diagram.placement.height).toBeLessThanOrEqual(900);
    expect(diagram.z).toBeGreaterThan(runway.z);
    expect(rectsOverlap(diagram.placement, triggers.placement)).toBe(false);
    expect(rectsOverlap(diagram.placement, windowById(workspace, CAMPAIGN_CALENDAR_ID).placement)).toBe(false);
    expect(rectsOverlap(diagram.placement, windowById(workspace, CAMPAIGN_INGEST_ID).placement)).toBe(false);
    expect(triggers.placement).toEqual(TRIGGERS_DEFAULT_PLACEMENT);
  });

  test('a saved file without the diagram gains it and keeps the runway', () => {
    const legacy = sanitizeWorkspace({
      version: 1,
      placementMode: 'desktop',
      windows: [
        {
          id: CAMPAIGN_RUNWAY_ID,
          open: true,
          minimized: false,
          pinned: false,
          z: 10,
          userArranged: true,
          placement: { mode: 'desktop', x: 300, y: 40, width: 420, height: 360 },
        },
      ],
    });

    expect(legacy.windows[0].placement.x).toBe(300);
    expect(legacy.windows[0].userArranged).toBe(true);
    expect(windowById(legacy, WORKFLOW_DIAGRAM_ID).open).toBe(true);
    expect(windowById(legacy, WORKFLOW_DIAGRAM_ID).placement).toEqual(DIAGRAM_DEFAULT_PLACEMENT);
  });
});

describe('workflow-diagram window mount', () => {
  test('role gate has no diagram and no tax slider', () => {
    render(<App initialPlayerRole={null} />);
    expect(screen.queryByTestId('workflow-diagram')).not.toBeInTheDocument();
    expect(document.querySelector('.react-flow')).toBeNull();
    expect(screen.queryByRole('slider', { name: /tax rate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /advance month/i })).not.toBeInTheDocument();
  });

  test('campaign lens has one tax slider and one Advance Month inside the diagram window', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_CAMPAIGN} />);
    const frame = screen.getByTestId('workflow-diagram');
    const layer = document.querySelector('.window-layer');
    const flow = frame.querySelector('.react-flow');
    const advance = screen.getByRole('button', { name: /advance month/i });

    expect(frame).toHaveTextContent(/workflow diagram/i);
    expect(layer).not.toHaveClass('react-flow');
    expect(document.querySelectorAll('.react-flow')).toHaveLength(1);
    expect(flow).toBeTruthy();
    expect(frame).toContainElement(flow);
    expect(frame.querySelector('[data-id="civic-tax"]')).toBeTruthy();
    expect(frame).toContainElement(advance);
    expect(advance).toHaveAccessibleName(/advance month/i);
    expect(screen.getAllByRole('button', { name: /advance month/i })).toHaveLength(1);
    expect(screen.getAllByRole('slider', { name: /tax rate/i })).toHaveLength(1);
    expect(screen.getByRole('slider', { name: /tax rate/i })).toHaveValue('0.25');
    expect(screen.getByTestId('island-campaign')).toBeInTheDocument();
    expect(screen.getByTestId('island-company-ops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workflow diagram' })).toBeInTheDocument();
  });

  test('company ops still mounts the diagram and keeps the campaign hint', () => {
    render(<App initialPlayerRole={PLAYER_ROLE_COMPANY_OPS} />);
    const frame = screen.getByTestId('workflow-diagram');
    expect(frame.querySelector('.react-flow')).toBeTruthy();
    expect(frame).toContainElement(screen.getByRole('button', { name: /advance month/i }));
    expect(screen.getByRole('button', { name: /hire tech employee/i })).toBeInTheDocument();
    expect(screen.getByTestId('ops-campaign-hint')).toHaveTextContent(/jurisdiction nest/i);
    expect(screen.getByTestId('company-ops-forms')).toBeInTheDocument();
  });
});
