import IslandSwitcher from '../components/IslandSwitcher';
import TurnSaveAlert from '../components/TurnSaveAlert';
import { roleLabel } from '../playerRole';
import {
  CAMPAIGN_CALENDAR_ID,
  CAMPAIGN_CAUSAL_ID,
  CAMPAIGN_INGEST_ID,
  CAMPAIGN_LEDGER_ID,
  CAMPAIGN_NEST_ID,
  CAMPAIGN_POLITICS_ID,
  CAMPAIGN_TRIGGERS_ID,
  CAMPAIGN_RUNWAY_ID,
  WORKFLOW_DIAGRAM_ID,
  COMPANY_METRICS_ID,
  COMPANY_OPS_ID,
} from './windowModel';

export default function NavigationShell({ role, onChangeRole, turn, onWorkspaceAction }) {
  return (
    <aside className="nav-rail" aria-label="Office rail">
      <p className="nav-rail__mark">Office</p>
      <IslandSwitcher role={role} onChange={onChangeRole} />
      <p className="role-active" data-testid="active-role-label">
        Active lens: {roleLabel(role)}
      </p>
      <p className="nav-rail__turn" data-testid="rail-turn">
        Turn {turn}
      </p>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: CAMPAIGN_RUNWAY_ID })}
      >
        Campaign runway
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: COMPANY_OPS_ID })}
      >
        Ops desk
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: COMPANY_METRICS_ID })}
      >
        Company metrics
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: CAMPAIGN_POLITICS_ID })}
      >
        Politics
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: CAMPAIGN_CAUSAL_ID })}
      >
        Causal hub
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: CAMPAIGN_LEDGER_ID })}
      >
        Turn ledger
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: CAMPAIGN_NEST_ID })}
      >
        Jurisdiction nest
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: CAMPAIGN_CALENDAR_ID })}
      >
        Council calendar
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: CAMPAIGN_INGEST_ID })}
      >
        Ingest runs
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: CAMPAIGN_TRIGGERS_ID })}
      >
        World events
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'create', id: WORKFLOW_DIAGRAM_ID })}
      >
        Workflow diagram
      </button>
      <button
        type="button"
        className="nav-rail__button"
        onClick={() => onWorkspaceAction({ type: 'reset' })}
      >
        Reset layout
      </button>
    </aside>
  );
}

export function OfficeStatus({
  sourceNote,
  sourceBusy,
  actionError,
  turnFailure,
  turnRetrying,
  onRetryTurn,
}) {
  return (
    <>
      <p
        className="data-source"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={sourceBusy ? 'true' : 'false'}
        aria-label={sourceNote}
      >
        {sourceNote}
      </p>
      {actionError ? (
        <p className="data-source data-source--alert" role="alert">
          {actionError}
        </p>
      ) : null}
      <TurnSaveAlert
        message={turnFailure?.message ?? ''}
        announceKey={turnFailure?.attempt ?? 0}
        retrying={turnRetrying}
        onRetry={onRetryTurn}
      />
    </>
  );
}
