import { useEffect, useState } from 'react';
import { createCitizenApi } from '../citizenApi';

/**
 * Campaign desk: bind GET /api/ingest/runs when API-backed.
 * No fake rows — empty / unavailable states only. Minutes appear via
 * scheduledMeetingId on real run rows (calendar board is a sibling panel).
 */
export default function IngestRunsPanel({ apiBase, refreshKey = 0 }) {
  const [runs, setRuns] = useState([]);
  const [status, setStatus] = useState(apiBase ? 'loading' : 'offline');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!apiBase) {
      setRuns([]);
      setStatus('offline');
      setError('');
      return undefined;
    }
    setStatus('loading');
    setError('');
    createCitizenApi({ baseUrl: apiBase })
      .listIngestRuns({ limit: 20 })
      .then((rows) => {
        if (cancelled) return;
        setRuns(Array.isArray(rows) ? rows : []);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setRuns([]);
        setStatus('error');
        setError(typeof err?.message === 'string' ? err.message : 'Could not load ingest runs.');
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, refreshKey]);

  return (
    <section
      className="ingest-runs-panel"
      aria-labelledby="ingest-runs-heading"
      data-testid="ingest-runs-panel"
    >
      <h3 id="ingest-runs-heading">Ingest runs</h3>
      <p className="ingest-runs-panel__blurb">
        Audit of <code>GET /api/ingest/runs</code> (fixture / http_stub → TRIGGER_CONTRACT). Minutes
        gameplay shows up here when a run carries <code>scheduledMeetingId</code>; the council
        calendar panel lists meetings separately.
      </p>

      {status === 'offline' ? (
        <p data-testid="ingest-runs-offline">
          API offline — ingest history unavailable. Connect <code>VITE_CITIZEN_API</code> to load real runs.
        </p>
      ) : null}

      {status === 'loading' ? (
        <p data-testid="ingest-runs-loading">Loading ingest runs…</p>
      ) : null}

      {status === 'error' ? (
        <p className="ingest-runs-panel__error" role="status" data-testid="ingest-runs-error">
          {error || 'Could not load ingest runs.'} (panel only — sim unchanged)
        </p>
      ) : null}

      {status === 'ready' && runs.length === 0 ? (
        <p data-testid="ingest-runs-empty">No ingest runs recorded yet.</p>
      ) : null}

      {status === 'ready' && runs.length > 0 ? (
        <ol className="ingest-runs-panel__list" data-testid="ingest-runs-list">
          {runs.map((run) => (
            <li
              key={run.id}
              className="ingest-runs-panel__item"
              data-testid="ingest-run-row"
              data-status={run.status}
              data-changed={run.changed ? 'true' : 'false'}
            >
              <div className="ingest-runs-panel__meta">
                <span className="ingest-runs-panel__status">{run.status}</span>
                <span>changed={String(Boolean(run.changed))}</span>
                {run.adapter ? <span>adapter={run.adapter}</span> : null}
                {run.fixtureId ? <span>fixture={run.fixtureId}</span> : null}
              </div>
              <p className="ingest-runs-panel__when">
                {run.startedAt ?? '—'}
                {run.finishedAt ? ` → ${run.finishedAt}` : ''}
              </p>
              {run.scheduledMeetingId ? (
                <p className="ingest-runs-panel__meeting" data-testid="ingest-run-meeting">
                  Meeting: <code>{run.scheduledMeetingId}</code>
                </p>
              ) : null}
              {run.error ? (
                <p className="ingest-runs-panel__run-error">{run.error}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
