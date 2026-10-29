import CausalRulesPanel from './CausalRulesPanel';
import IngestRunsPanel from './IngestRunsPanel';
import PoliticsMeter from './PoliticsMeter';
import TriggerPanel from './TriggerPanel';
import TurnLedger from './TurnLedger';

/**
 * Coherent campaign causal desk (CIT-114) — second modular island after company ops.
 * Binds real CAUSAL_RULES / politics / triggers / ledger / ingest_runs. No fake forms.
 */
export default function CampaignDesk({
  state,
  ledger = [],
  announcement = '',
  busy = false,
  pipelineEvents = [],
  apiBase = null,
  ingestRefreshKey = 0,
  onToggleTrigger,
  onClearTriggers,
  onIngestFixture,
}) {
  return (
    <section
      className="campaign-desk"
      aria-labelledby="campaign-desk-heading"
      data-testid="campaign-desk"
    >
      <header className="campaign-desk__header">
        <h2 id="campaign-desk-heading">Campaign desk</h2>
        <p>
          Causal runner lens on the same backend — interconnect view, politics survival,
          world events, turn ledger, and ingest audit. No inventory / Gantt / fake demographics.
        </p>
      </header>

      <PoliticsMeter state={state} />
      <CausalRulesPanel state={state} />
      <TriggerPanel
        state={state}
        announcement={announcement}
        busy={busy}
        pipelineEvents={pipelineEvents}
        onToggleTrigger={onToggleTrigger}
        onClearTriggers={onClearTriggers}
        onIngestFixture={onIngestFixture}
      />
      <TurnLedger entries={ledger} />
      <IngestRunsPanel apiBase={apiBase} refreshKey={ingestRefreshKey} />
    </section>
  );
}
