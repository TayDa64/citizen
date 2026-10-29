import { useEffect, useState } from 'react';
import { createCitizenApi } from '../citizenApi';

/**
 * Campaign desk: bind GET /api/jurisdictions nest (home chain + non-binding peers).
 * Peers fail closed — bindsHome=false. No fake jurisdictions.
 */
export default function NestExplorer({ apiBase, homeId = 'mv', refreshKey = 0 }) {
  const [nest, setNest] = useState(null);
  const [status, setStatus] = useState(apiBase ? 'loading' : 'offline');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!apiBase) {
      setNest(null);
      setStatus('offline');
      setError('');
      return undefined;
    }
    setStatus('loading');
    setError('');
    createCitizenApi({ baseUrl: apiBase })
      .getJurisdictionNest({ home: homeId })
      .then((payload) => {
        if (cancelled) return;
        setNest(payload && typeof payload === 'object' ? payload : null);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setNest(null);
        setStatus('error');
        setError(
          typeof err?.message === 'string' ? err.message : 'Could not load jurisdiction nest.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, homeId, refreshKey]);

  return (
    <section
      className="nest-explorer"
      aria-labelledby="nest-explorer-heading"
      data-testid="nest-explorer"
    >
      <h3 id="nest-explorer-heading">Jurisdiction nest</h3>
      <p className="nest-explorer__blurb">
        Home + ancestors bind this campaign. Same-tier peers (e.g. Sunnyvale) do{' '}
        <strong>not</strong> bind — fail closed. Bound to <code>GET /api/jurisdictions</code>.
      </p>

      {status === 'offline' ? (
        <p data-testid="nest-explorer-offline">
          API offline — nest unavailable. Connect <code>VITE_CITIZEN_API</code> to load the real chain.
        </p>
      ) : null}

      {status === 'loading' ? (
        <p data-testid="nest-explorer-loading">Loading jurisdiction nest…</p>
      ) : null}

      {status === 'error' ? (
        <p className="nest-explorer__error" role="status" data-testid="nest-explorer-error">
          {error || 'Could not load jurisdiction nest.'} (panel only — sim unchanged)
        </p>
      ) : null}

      {status === 'ready' && nest ? (
        <div data-testid="nest-explorer-ready" data-home={nest.homeId}>
          {!nest.homeKnown ? (
            <p data-testid="nest-explorer-unknown-home">
              Home <code>{nest.homeId}</code> is unknown — chain empty (fail closed).
            </p>
          ) : null}

          <h4 className="nest-explorer__subhead">Binding chain</h4>
          {nest.chain?.length ? (
            <ol className="nest-explorer__chain" data-testid="nest-explorer-chain">
              {nest.chain.map((row) => (
                <li
                  key={row.id}
                  className="nest-explorer__node nest-explorer__node--binds"
                  data-testid="nest-chain-row"
                  data-jurisdiction-id={row.id}
                  data-binds-home={row.bindsHome ? 'true' : 'false'}
                  data-tier={row.tier ?? ''}
                >
                  <span className="nest-explorer__name">{row.name}</span>
                  <span className="nest-explorer__meta">
                    {row.id} · {row.tier} · binds
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p data-testid="nest-explorer-chain-empty">No binding jurisdictions on this home.</p>
          )}

          <h4 className="nest-explorer__subhead">Peers (non-binding)</h4>
          {nest.peers?.length ? (
            <ul className="nest-explorer__peers" data-testid="nest-explorer-peers">
              {nest.peers.map((row) => (
                <li
                  key={row.id}
                  className="nest-explorer__node nest-explorer__node--peer"
                  data-testid="nest-peer-row"
                  data-jurisdiction-id={row.id}
                  data-binds-home={row.bindsHome ? 'true' : 'false'}
                  data-tier={row.tier ?? ''}
                >
                  <span className="nest-explorer__name">{row.name}</span>
                  <span className="nest-explorer__meta">
                    {row.id} · {row.tier} · does not bind
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p data-testid="nest-explorer-peers-empty">No peer jurisdictions seeded beside this home.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
