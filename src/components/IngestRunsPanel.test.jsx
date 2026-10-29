import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import IngestRunsPanel from './IngestRunsPanel';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IngestRunsPanel', () => {
  test('shows offline stub when apiBase is missing (no fake rows)', () => {
    render(<IngestRunsPanel apiBase={null} />);
    expect(screen.getByTestId('ingest-runs-offline')).toBeInTheDocument();
    expect(screen.queryByTestId('ingest-runs-list')).not.toBeInTheDocument();
  });

  test('binds GET /api/ingest/runs rows including scheduledMeetingId', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ([
        {
          id: '11111111-1111-1111-1111-111111111111',
          startedAt: '2026-10-29T12:00:00.000Z',
          finishedAt: '2026-10-29T12:00:01.000Z',
          adapter: 'fixture',
          fixtureId: 'civic-wage-bulletin',
          status: 'success',
          changed: true,
          error: null,
          triggerClientIds: ['evt-pipeline-wage'],
          scheduledMeetingId: '22222222-2222-2222-2222-222222222222',
        },
      ]),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchImpl);

    render(<IngestRunsPanel apiBase="/api" />);

    await waitFor(() => {
      expect(screen.getByTestId('ingest-runs-list')).toBeInTheDocument();
    });
    expect(fetchImpl).toHaveBeenCalled();
    const calledUrl = String(fetchImpl.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/ingest/runs');
    expect(screen.getByTestId('ingest-run-row')).toHaveAttribute('data-status', 'success');
    expect(screen.getByTestId('ingest-run-meeting')).toHaveTextContent(
      '22222222-2222-2222-2222-222222222222',
    );
  });
});
