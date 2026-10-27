import { summarizeLedgerCommand } from '../turnLedger';
import { formatCurrency, formatHypePercent } from '../triggers';

function formatMetricLine(metrics) {
  if (metrics == null) return '—';
  const cash = formatCurrency(metrics.cash);
  const burn = formatCurrency(metrics.burnRate);
  const hype = formatHypePercent(metrics.hype);
  return `cash ${cash} · burn ${burn}/mo · hype ${hype} · tax ${Math.round((metrics.taxRate || 0) * 100)}%`;
}

/**
 * Minimal campaign turn ledger / history (not the Highcharts ring buffer).
 */
export default function TurnLedger({ entries = [] }) {
  const list = Array.isArray(entries) ? entries : [];
  const recent = list.slice(-24).reverse();

  return (
    <section className="turn-ledger" aria-labelledby="turn-ledger-heading" data-testid="turn-ledger">
      <h3 id="turn-ledger-heading">Turn ledger</h3>
      <p className="turn-ledger__blurb">
        Append-only decisions and outcomes for this campaign (beyond the 24-month chart window).
      </p>
      {recent.length === 0 ? (
        <p data-testid="turn-ledger-empty">No committed turns yet. Advance a month or change tax to append.</p>
      ) : (
        <ol className="turn-ledger__list" reversed data-testid="turn-ledger-list">
          {recent.map((entry) => {
            const headline = entry.explanations?.[0] ?? summarizeLedgerCommand(entry);
            const effects = (entry.appliedEffects ?? [])
              .map((effect) => effect.summary)
              .filter(Boolean)
              .slice(0, 3);
            return (
              <li
                key={`ledger-${entry.seq}-${entry.command?.type ?? 'cmd'}`}
                className="turn-ledger__item"
                data-testid="turn-ledger-entry"
                data-seq={entry.seq}
              >
                <div className="turn-ledger__meta">
                  <span className="turn-ledger__seq">#{entry.seq}</span>
                  <span className="turn-ledger__turn">Turn {entry.turnAfter}</span>
                  <span className="turn-ledger__type">{entry.command?.type ?? 'unknown'}</span>
                </div>
                <p className="turn-ledger__summary">{headline}</p>
                <p className="turn-ledger__metrics" data-testid="turn-ledger-metrics">
                  <span className="turn-ledger__label">Before:</span> {formatMetricLine(entry.before)}
                  <br />
                  <span className="turn-ledger__label">After:</span> {formatMetricLine(entry.after)}
                </p>
                {effects.length > 0 ? (
                  <ul className="turn-ledger__effects">
                    {effects.map((summary) => (
                      <li key={`${entry.seq}-${summary}`}>{summary}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
