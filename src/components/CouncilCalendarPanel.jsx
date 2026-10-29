import { useEffect, useState } from 'react';
import { createCitizenApi } from '../citizenApi';

/**
 * Campaign desk: bind GET /api/scheduled-meetings (council calendar).
 * Real rows only — empty when none seeded. No fake events / Gantt.
 */
export default function CouncilCalendarPanel({
  apiBase,
  jurisdictionId = 'mv',
  refreshKey = 0,
}) {
  const [meetings, setMeetings] = useState([]);
  const [status, setStatus] = useState(apiBase ? 'loading' : 'offline');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!apiBase) {
      setMeetings([]);
      setStatus('offline');
      setError('');
      return undefined;
    }
    setStatus('loading');
    setError('');
    const asOf = new Date().toISOString();
    createCitizenApi({ baseUrl: apiBase })
      .listScheduledMeetings({ limit: 50, jurisdictionId, asOf })
      .then((rows) => {
        if (cancelled) return;
        setMeetings(Array.isArray(rows) ? rows : []);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setMeetings([]);
        setStatus('error');
        setError(
          typeof err?.message === 'string' ? err.message : 'Could not load scheduled meetings.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, jurisdictionId, refreshKey]);

  return (
    <section
      className="council-calendar"
      aria-labelledby="council-calendar-heading"
      data-testid="council-calendar"
    >
      <h3 id="council-calendar-heading">Council calendar</h3>
      <p className="council-calendar__blurb">
        Mountain View scheduled meetings from <code>GET /api/scheduled-meetings</code> — phases A/B/C
        and due rows only when the clock has persisted them. No invented events.
      </p>

      {status === 'offline' ? (
        <p data-testid="council-calendar-offline">
          API offline — calendar unavailable. Connect <code>VITE_CITIZEN_API</code> to load real rows.
        </p>
      ) : null}

      {status === 'loading' ? (
        <p data-testid="council-calendar-loading">Loading scheduled meetings…</p>
      ) : null}

      {status === 'error' ? (
        <p className="council-calendar__error" role="status" data-testid="council-calendar-error">
          {error || 'Could not load scheduled meetings.'} (panel only — sim unchanged)
        </p>
      ) : null}

      {status === 'ready' && meetings.length === 0 ? (
        <p data-testid="council-calendar-empty">
          No scheduled meetings persisted yet (Phase A seed / due-row clock write first).
        </p>
      ) : null}

      {status === 'ready' && meetings.length > 0 ? (
        <ol className="council-calendar__list" data-testid="council-calendar-list">
          {meetings.map((meeting) => (
            <li
              key={meeting.id}
              className="council-calendar__item"
              data-testid="council-meeting-row"
              data-meeting-id={meeting.id}
              data-phase={meeting.phase}
              data-status={meeting.status}
              data-due={meeting.due ? 'true' : 'false'}
              data-jurisdiction-id={meeting.jurisdictionId}
            >
              <div className="council-calendar__meta">
                <span className="council-calendar__body">
                  {meeting.bodyName || meeting.externalEventId}
                </span>
                <span>phase={meeting.phase}</span>
                <span>status={meeting.status}</span>
                {meeting.due ? (
                  <span className="council-calendar__due" data-testid="council-meeting-due">
                    due
                  </span>
                ) : null}
              </div>
              <p className="council-calendar__when">
                starts {meeting.startsAt ?? '—'}
                {meeting.nextCheckAt ? ` · next check ${meeting.nextCheckAt}` : ''}
              </p>
              {meeting.fixtureId ? (
                <p className="council-calendar__fixture">fixture={meeting.fixtureId}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
