import { SAMPLE_TRIGGERS, describeTrigger, formatSignedPercent, formatTriggerDate } from '../triggers';

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

function effectParts(trigger) {
  const parts = [];
  if (typeof trigger.effect.talentCost === 'number' && trigger.effect.talentCost !== 0) {
    parts.push({
      key: 'talentCost',
      direction: trigger.effect.talentCost > 0 ? 'up' : 'down',
      text: `talent cost ${formatSignedPercent(trigger.effect.talentCost)}`,
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

export default function TriggerPanel({ state, announcement, onToggleTrigger, onClearTriggers }) {
  const activeIds = new Set((state.activeTriggers ?? []).map((trigger) => trigger.id));

  return (
    <section className="trigger-panel" aria-labelledby="world-events-heading">
      <div className="trigger-panel__header">
        <h2 id="world-events-heading">World events</h2>
        <p className="trigger-panel__lede">
          Sample events stored on this device. A policy change, news spike, or market shift
          moves hype and talent cost. No live feed is connected.
        </p>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="trigger-live">
        {announcement}
      </div>
      <div className="trigger-list">
        {SAMPLE_TRIGGERS.map((trigger) => {
          const active = activeIds.has(trigger.id);
          const sourceId = `${trigger.id}-source`;
          return (
            <button
              key={trigger.id}
              type="button"
              className={active ? 'trigger-button trigger-button--active' : 'trigger-button'}
              aria-pressed={active}
              aria-label={`${active ? 'Remove' : 'Apply'} ${describeTrigger(trigger)}`}
              aria-describedby={sourceId}
              onClick={() => onToggleTrigger(trigger)}
            >
              <span className="trigger-button__title">
                <TriggerGlyph type={trigger.type} />
                <span>{trigger.label}</span>
              </span>
              <span className="trigger-button__effect">
                {effectParts(trigger).map((part) => (
                  <span key={part.key} className={`delta delta--${part.direction}`}>
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
      {activeIds.size > 0 && (
        <button type="button" className="trigger-clear" onClick={onClearTriggers}>
          Clear world events
        </button>
      )}
    </section>
  );
}
