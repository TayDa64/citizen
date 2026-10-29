import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import NestExplorer from './NestExplorer';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NestExplorer', () => {
  test('shows offline stub when apiBase is missing (no fake nest)', () => {
    render(<NestExplorer apiBase={null} />);
    expect(screen.getByTestId('nest-explorer-offline')).toBeInTheDocument();
    expect(screen.queryByTestId('nest-explorer-chain')).not.toBeInTheDocument();
  });

  test('binds nest chain and marks sunnyvale peer as non-binding', async () => {
    const nest = {
      homeId: 'mv',
      homeKnown: true,
      chain: [
        { id: 'mv', name: 'Mountain View', tier: 'city', parentId: 'sc_county', bindsHome: true },
        { id: 'sc_county', name: 'Santa Clara County', tier: 'county', parentId: 'ca', bindsHome: true },
        { id: 'ca', name: 'California', tier: 'state', parentId: 'us', bindsHome: true },
        { id: 'us', name: 'United States', tier: 'federal', parentId: null, bindsHome: true },
      ],
      peers: [
        {
          id: 'sunnyvale',
          name: 'Sunnyvale',
          tier: 'city',
          parentId: 'sc_county',
          bindsHome: false,
        },
      ],
      jurisdictions: [],
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => nest,
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchImpl);

    render(<NestExplorer apiBase="/api" homeId="mv" />);

    await waitFor(() => {
      expect(screen.getByTestId('nest-explorer-chain')).toBeInTheDocument();
    });
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/jurisdictions');
    expect(String(fetchImpl.mock.calls[0][0])).toContain('home=mv');

    const chainRows = screen.getAllByTestId('nest-chain-row');
    expect(chainRows[0]).toHaveAttribute('data-jurisdiction-id', 'mv');
    expect(chainRows[0]).toHaveAttribute('data-binds-home', 'true');

    const peer = screen.getByTestId('nest-peer-row');
    expect(peer).toHaveAttribute('data-jurisdiction-id', 'sunnyvale');
    expect(peer).toHaveAttribute('data-binds-home', 'false');
    expect(peer).toHaveTextContent(/does not bind/i);
  });
});
