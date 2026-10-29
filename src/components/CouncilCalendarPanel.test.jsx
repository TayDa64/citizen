import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import CouncilCalendarPanel from './CouncilCalendarPanel';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CouncilCalendarPanel', () => {
  test('shows offline stub when apiBase is missing (no fake meetings)', () => {
    render(<CouncilCalendarPanel apiBase={null} />);
    expect(screen.getByTestId('council-calendar-offline')).toBeInTheDocument();
    expect(screen.queryByTestId('council-calendar-list')).not.toBeInTheDocument();
  });

  test('binds GET /api/scheduled-meetings list including due annotation', async () => {
    const rows = [
      {
        id: '33333333-3333-3333-3333-333333333333',
        jurisdictionId: 'mv',
        sourceId: 'legistar:mountainview',
        externalEventId: '3367',
        kind: 'meeting',
        startsAt: '2026-07-08T01:00:00.000Z',
        timezone: 'America/Los_Angeles',
        nextCheckAt: '2026-07-01T00:00:00.000Z',
        phase: 'B',
        status: 'scheduled',
        fixtureId: 'mv-council-calendar-2026h2',
        bodyName: 'City Council',
        due: true,
        changed: false,
        stdout: null,
      },
    ];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => rows,
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchImpl);

    render(<CouncilCalendarPanel apiBase="/api" jurisdictionId="mv" />);

    await waitFor(() => {
      expect(screen.getByTestId('council-calendar-list')).toBeInTheDocument();
    });
    const calledUrl = String(fetchImpl.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/scheduled-meetings');
    expect(calledUrl).toContain('jurisdictionId=mv');
    expect(calledUrl).toContain('asOf=');

    const row = screen.getByTestId('council-meeting-row');
    expect(row).toHaveAttribute('data-phase', 'B');
    expect(row).toHaveAttribute('data-due', 'true');
    expect(screen.getByTestId('council-meeting-due')).toHaveTextContent('due');
    expect(row).toHaveTextContent('City Council');
  });

  test('empty list is honest (no invented meetings)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => [],
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchImpl);

    render(<CouncilCalendarPanel apiBase="/api" />);
    await waitFor(() => {
      expect(screen.getByTestId('council-calendar-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('council-calendar-list')).not.toBeInTheDocument();
  });
});
