import { useRef } from 'react';
import {
  SAMPLE_TRIGGERS,
  formatSignedPercent,
  formatTalentDollars,
  formatTriggerDate,
  projectedTalentDollars,
} from '../triggers';

function TriggerGlyph({ type }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    focusable: 'false',
  };
  switch (type) {
    case 'policy_change':
      return (
        <svg {...common}>
          <path fill="currentColor" d="M6 2.5h8.2L19 7.3V21.5H6v-19zm7.2 1.8V8H18l-4.8-3.7zM8.2 11h7.6V12.6H8.2V11zm0 3.4h7.6v1.6H8.2v-1.6z" />
        </svg>
      );
    case 'news_spike':
      return (
        <svg {...common}>
          <path fill="currentColor" d="M3.5 5.5h13v9h-13v-9zm14.5 1.6h2.5v6.2H18V7.1zM5.5 16.2h11v2.2h-11v-2.2z" />
        </svg>
      );
    case 'market_shift':
      return (
        <svg {...common}>
          <path fill="currentColor" d="M3.5 16.2 8.8 11l3.1 3 6.3-7.2V9h2.2V3.8h-5.4V6h2.2L11.8 12 8.7 9 3.5 14.1v2.1z" />
        </svg>
      );
    default: {
      const neverType = type;
      throw new Error(`Unknown trigger type: ${String(neverType)}`);
    }
  }
}

function effectParts(trigger, state) {
  const parts = [];
  if (typeof trigger.effect.talentCost === 'number' && trigger.effect.talentCost !== 0) {
    let text = `talent cost ${formatSignedPercent(trigger.effect.talentCost)}`;
    if (state.dataSource === 'api' && Number.isFinite(state.baselines?.talentCost)) {
      const dollars = projectedTalentDollars(state.baselines.talentCost, trigger.effect.talentCost);
      if (dollars != null) text = `${text} (${formatTalentDollars(dollars)})`;
    }
    parts.push({
      key: 'talentCost',
      direction: trigger.effect.talentCost > 0 ? 'up' : 'down',
      text,
    });
  }
  if (typeof trigger.effect.hype === 'number' && trigger.effect.hype !== 0) {
    parts.push({
      key: 'hype',
      direction: trigger.effect.hype > 0 ? 'up' : 'down',
      text: `hype ${formatSignedPercent(trigger.effect.hype)}`,
    });
  }
  return parts;
}

export default function TriggerPanel({
  state,
  announcement,
  busy = false,
  pipelineEvents = [],
  onToggleTrigger,
  onClearTriggers,
  onIngestFixture,
}) {
  const activeIds = new Set((state.activeTriggers ?? []).map((trigger) => trigger.id));
  const headingRef = useRef(null);
  const events = Array.isArray(pipelineEvents) ? pipelineEvents : [];

  const handleClear = async () => {
    await onClearTriggers();
    const heading = headingRef.current;
    if (!heading) return;
    try {
      heading.focus({ focusVisible: true });
    } catch {
      heading.focus();
    }
  };

  return (
    <section className="trigger-panel" aria-labelledby="world-events-heading">
      <div className="trigger-panel__header">
        <h2 id="world-events-heading" ref={headingRef} tabIndex={-1}>
          World events
        </h2>
        <p className="trigger-panel__lede">
          {state.dataSource === 'api'
            ? 'Events stored by the Citizen service. Talent cost is shown in dollars from the company baseline. Ingest a fixture signal through the observation → interpretation → effect pipeline (no live scrape).'
            : 'Sample events stored on this device. Ingest a fixture wage bulletin through the same pipeline — observation, interpretation, and validated effect stay separate. No live feed is connected.'}
        </p>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="trigger-live">
        {announcement}
      </div>
      <div className="trigger-list">
        {SAMPLE_TRIGGERS.map((trigger) => {
          const active = activeIds.has(trigger.id);
          const labelId = `${trigger.id}-label`;
          const sourceId = `${trigger.id}-source`;
          const parts = effectParts(trigger, state);
          const labelledBy = [labelId, ...parts.map((part) => `${trigger.id}-${part.key}`), sourceId].join(' ');
          return (
            <button
              key={trigger.id}
              type="button"
              className={active ? 'trigger-button trigger-button--active' : 'trigger-button'}
              aria-pressed={active}
              aria-labelledby={labelledBy}
              disabled={busy}
              onClick={() => onToggleTrigger(trigger)}
            >
              <span className="trigger-button__title">
                <TriggerGlyph type={trigger.type} />
                <span id={labelId}>{trigger.label}</span>
              </span>
              <span className="trigger-button__effect">
                {parts.map((part) => (
                  <span key={part.key} id={`${trigger.id}-${part.key}`} className={`delta delta--${part.direction}`}>
                    <span aria-hidden="true">{part.direction === 'up' ? '▲' : '▼'}</span>
                    {' '}
                    {part.direction === 'up' ? 'Up' : 'Down'}
                    {' '}
                    {part.text}
                  </span>
                ))}
              </span>
              <span id={sourceId} className="trigger-button__source">
                Source: {trigger.source}
                {' · '}
                <time dateTime={trigger.timestamp}>{formatTriggerDate(trigger.timestamp)}</time>
              </span>
            </button>
          );
        })}
      </div>
      <div className="trigger-pipeline">
        <button
          type="button"
          className="trigger-ingest"
          disabled={busy || typeof onIngestFixture !== 'function'}
          onClick={() => onIngestFixture?.()}
        >
          Ingest fixture wage bulletin
        </button>
        {events.length > 0 ? (
          <ul className="trigger-pipeline__list" aria-label="Pipeline provenance">
            {events.map((event) => (
              <li key={event.observationId ?? event.triggerId ?? event.label} className="trigger-pipeline__item">
                <span className="trigger-pipeline__lifecycle">{event.lifecycle}</span>
                {' '}
                <span className="trigger-pipeline__label">{event.label}</span>
                {event.evidence ? (
                  <span className="trigger-pipeline__evidence"> — {event.evidence}</span>
                ) : null}
                {event.provenance ? (
                  <span className="trigger-pipeline__provenance"> ({event.provenance})</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {activeIds.size > 0 && (
        <button type="button" className="trigger-clear" onClick={handleClear} disabled={busy}>
          Clear world events
        </button>
      )}
    </section>
  );
}
