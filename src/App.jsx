import React, { useEffect, useState } from 'react';
import WorkflowDiagram from './WorkflowDiagram';
import Dashboard from './components/Dashboard';
import TriggerPanel from './components/TriggerPanel';
import {
  CONNECTED_NOTE,
  LOADING_NOTE,
  SAMPLE_DATA_NOTE,
  createCitizenApi,
  loadCitizenWorld,
  readCitizenApiBase,
} from './citizenApi';
import {
  applyEffects,
  applyTrigger,
  clearTriggers,
  hydrateFromApi,
  initialState,
  removeTrigger,
} from './simulation';
import { CLEARED_ANNOUNCEMENT, announceTrigger } from './triggers';

function removalBlockedMessage(error, label) {
  const status = error?.status;
  if (status === 404 || status === 405) {
    return `Could not remove ${label}. The service has not enabled that action yet (${status}). Nothing on this screen was changed.`;
  }
  const detail = typeof error?.message === 'string' && error.message.trim() !== ''
    ? ` ${error.message}`
    : '';
  return `Could not remove ${label}.${detail} Nothing on this screen was changed.`;
}

function App() {
  const configuredBase = readCitizenApiBase();
  const [state, setState] = useState(initialState);
  const [announcement, setAnnouncement] = useState('');
  const [sourceNote, setSourceNote] = useState(configuredBase ? LOADING_NOTE : SAMPLE_DATA_NOTE);
  const [sourceBusy, setSourceBusy] = useState(Boolean(configuredBase));
  const [actionError, setActionError] = useState('');
  const [apiBase, setApiBase] = useState(configuredBase);

  useEffect(() => {
    let cancelled = false;
    loadCitizenWorld()
      .then((result) => {
        if (cancelled) return;
        if (result.mode === 'api' && result.snapshot) {
          setState((prev) => hydrateFromApi(prev, result.snapshot));
          setApiBase(result.baseUrl);
          setSourceNote(result.note || CONNECTED_NOTE);
        } else {
          setState(initialState);
          setApiBase(null);
          setSourceNote(result.note || SAMPLE_DATA_NOTE);
        }
        setActionError('');
      })
      .finally(() => {
        if (!cancelled) setSourceBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSetState = (updater) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return applyEffects(next);
    });
  };

  const onTick = () => {
    setState((prev) => applyEffects(prev));
  };

  const refreshApi = async (baseUrl) => {
    const snapshot = await createCitizenApi({ baseUrl }).loadWorld();
    setState((prev) => hydrateFromApi(prev, snapshot));
  };

  const onToggleTrigger = async (trigger) => {
    const active = (state.activeTriggers ?? []).some((item) => item.id === trigger.id);
    if (state.dataSource !== 'api' || !apiBase) {
      if (active) {
        setState((prev) => removeTrigger(prev, trigger.id));
        setAnnouncement(announceTrigger(trigger, 'remove'));
        return;
      }
      setState((prev) => applyTrigger(prev, trigger));
      setAnnouncement(announceTrigger(trigger, 'apply'));
      return;
    }

    setSourceBusy(true);
    setActionError('');
    setAnnouncement(`Saving ${trigger.label}.`);
    let saved = false;
    try {
      const api = createCitizenApi({ baseUrl: apiBase });
      if (active) {
        await api.deleteTrigger(trigger.id);
      } else {
        await api.createMock(trigger.type);
      }
      saved = true;
      try {
        await refreshApi(apiBase);
      } catch {
        setState((prev) => (active ? removeTrigger(prev, trigger.id) : applyTrigger(prev, trigger)));
      }
      setAnnouncement(announceTrigger(trigger, active ? 'remove' : 'apply'));
    } catch (error) {
      if (!saved) {
        if (active) {
          setActionError(removalBlockedMessage(error, trigger.label));
        } else {
          setActionError(`Could not save ${trigger.label}. ${error.message}`);
        }
        setAnnouncement('');
      }
    } finally {
      setSourceBusy(false);
    }
  };

  const onClearTriggers = async () => {
    if (state.dataSource !== 'api' || !apiBase) {
      setState((prev) => clearTriggers(prev));
      setAnnouncement(CLEARED_ANNOUNCEMENT);
      return;
    }

    setSourceBusy(true);
    setActionError('');
    setAnnouncement('Clearing world events.');
    let saved = false;
    try {
      const api = createCitizenApi({ baseUrl: apiBase });
      await api.deleteTriggers();
      saved = true;
      try {
        const snapshot = await api.loadWorld();
        setState((prev) => ({ ...hydrateFromApi(prev, snapshot), lastTriggerChange: null }));
      } catch {
        setState((prev) => clearTriggers(prev));
      }
      setAnnouncement(CLEARED_ANNOUNCEMENT);
    } catch (error) {
      if (!saved) {
        setActionError(removalBlockedMessage(error, 'world events'));
        setAnnouncement('');
      }
    } finally {
      setSourceBusy(false);
    }
  };

  return (
    <div className="App" style={{ background: '#0f0f1a', minHeight: '100vh', color: 'white' }}>
      <header style={{ padding: '1rem', background: '#1a1a2e', textAlign: 'center' }}>
        <h1>Citizen</h1>
        <p>Civic + Startup Simulation — Slice 1: Tax → Burn Rate</p>
      </header>
      <main>
        <WorkflowDiagram state={state} setState={handleSetState} onTick={onTick} />
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
        <TriggerPanel
          state={state}
          announcement={announcement}
          busy={sourceBusy}
          onToggleTrigger={onToggleTrigger}
          onClearTriggers={onClearTriggers}
        />
        <Dashboard state={state} />
      </main>
    </div>
  );
}

export default App;
