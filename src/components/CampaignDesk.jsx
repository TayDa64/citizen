import WindowFrame from '../shell/WindowFrame';
import CouncilCalendarPanel from './CouncilCalendarPanel';
import IngestRunsPanel from './IngestRunsPanel';
import NestExplorer from './NestExplorer';
import PoliticsMeter from './PoliticsMeter';
import TriggerPanel from './TriggerPanel';
import TurnLedger from './TurnLedger';

/**
 * Campaign desk for the campaign lens — nest, council calendar, world events,
 * turn ledger, and ingest audit. Politics and the causal hub mount as windows.
 * No fake forms / invent calendar.
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
  politicsWindow = null,
  onWorkspaceAction,
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
          nest + council calendar, world events, turn ledger, and ingest audit. No inventory /
          Gantt / fake demographics.
        </p>
      </header>

      {politicsWindow?.open ? (
        <WindowFrame windowRecord={politicsWindow} onAction={onWorkspaceAction}>
          <PoliticsMeter state={state} />
        </WindowFrame>
      ) : null}
      <NestExplorer apiBase={apiBase} homeId="mv" refreshKey={ingestRefreshKey} />
      <CouncilCalendarPanel
        apiBase={apiBase}
        jurisdictionId="mv"
        refreshKey={ingestRefreshKey}
      />
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
