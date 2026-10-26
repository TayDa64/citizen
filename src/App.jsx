import React, { useEffect, useRef, useState } from 'react';
import WorkflowDiagram from './WorkflowDiagram';
import Dashboard from './components/Dashboard';
import TriggerPanel from './components/TriggerPanel';
import {
  CONNECTED_NOTE,
  LOADING_NOTE,
  CLAMPED_HYPE_NOTE,
  CLAMPED_TALENT_COST_NOTE,
  MISSING_HYPE_NOTE,
  MISSING_TALENT_COST_NOTE,
  SAMPLE_DATA_NOTE,
  UNREADABLE_COMPANY_NOTE,
  createCitizenApi,
  loadCitizenWorld,
  hostHeaderAlert,
  readCitizenApiBase,
  skippedTriggerAlert,
} from './citizenApi';
import {
  applyEffects,
  applyTrigger,
  clearTriggers,
  initialState,
  readApiSnapshot,
  removeTrigger,
} from './simulation';
import { CLEARED_ANNOUNCEMENT, announceTrigger } from './triggers';
import { effectiveBurnRate } from './talentMultiplier';

function removalBlockedMessage(error, label) {
  const hostAlert = hostHeaderAlert(error);
  if (hostAlert) return `Could not remove ${label}. ${hostAlert}`;
  const status = error?.status;
  if (status === 404 || status === 405) {
    return `Could not remove ${label}. The service has not enabled that action yet (${status}). Nothing on this screen was changed.`;
  }
  if (status === 400 || status === 413) {
    return `Could not remove ${label}. The service rejected that request (${status}). Nothing on this screen was changed.`;
  }
  if (status === 403) {
    return `Could not remove ${label}. The Citizen service refused this page (403). Use the local /api address on this machine. Nothing on this screen was changed.`;
  }
  const detail = typeof error?.message === 'string' && error.message.trim() !== ''
    ? ` ${error.message}`
    : '';
  return `Could not remove ${label}.${detail} Nothing on this screen was changed.`;
}

function saveBlockedMessage(error, label) {
  const hostAlert = hostHeaderAlert(error);
  if (hostAlert) return `Could not save ${label}. ${hostAlert}`;
  return `Could not save ${label}. ${error.message}`;
}

function sourceNotes(reading) {
  const notes = [CONNECTED_NOTE];
  if (reading.missingHype) notes.push(MISSING_HYPE_NOTE);
  if (reading.missingTalent) notes.push(MISSING_TALENT_COST_NOTE);
  if (reading.clampedHype) notes.push(CLAMPED_HYPE_NOTE);
  if (reading.clampedTalent) notes.push(CLAMPED_TALENT_COST_NOTE);
  return notes.join(' ');
}

function App() {
  const configuredBase = readCitizenApiBase();
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [announcement, setAnnouncement] = useState('');
  const [sourceNote, setSourceNote] = useState(configuredBase ? LOADING_NOTE : SAMPLE_DATA_NOTE);
  const [sourceBusy, setSourceBusy] = useState(Boolean(configuredBase));
  const [actionError, setActionError] = useState('');
  const [apiBase, setApiBase] = useState(configuredBase);

  const showSampleData = (note) => {
    setState(initialState);
    stateRef.current = initialState;
    setApiBase(null);
    setSourceNote(note);
    setActionError('');
  };

  // Read the payload before setState. A throw inside an updater runs during
  // render, where the caller's try/catch cannot see it.
  const commitSnapshot = (snapshot, { clearChange = false } = {}) => {
    const reading = readApiSnapshot(stateRef.current, snapshot);
    const next = clearChange ? { ...reading.state, lastTriggerChange: null } : reading.state;
    setState(next);
    stateRef.current = next;
    setSourceNote(sourceNotes(reading));
    return reading;
  };

  useEffect(() => {
    let cancelled = false;
    loadCitizenWorld()
      .then((result) => {
        if (cancelled) return;
        if (result.mode === 'api' && result.snapshot) {
          try {
            const reading = commitSnapshot(result.snapshot);
            setApiBase(result.baseUrl);
            setActionError(reading.skipped > 0 ? skippedTriggerAlert(reading.skipped) : (result.alert || ''));
          } catch (error) {
            if (error?.code === 'unreadable-company') {
              showSampleData(UNREADABLE_COMPANY_NOTE);
            } else {
              showSampleData(SAMPLE_DATA_NOTE);
              setActionError(result.alert || '');
            }
          }
        } else {
          showSampleData(result.note || SAMPLE_DATA_NOTE);
          setActionError(result.alert || '');
        }
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
    return commitSnapshot(snapshot);
  };

  const onToggleTrigger = async (trigger) => {
    const active = (state.activeTriggers ?? []).some((item) => item.id === trigger.id);
    if (state.dataSource !== 'api' || !apiBase) {
      if (active) {
        const next = removeTrigger(stateRef.current, trigger.id);
        setState(next);
        stateRef.current = next;
        setAnnouncement(announceTrigger(trigger, 'remove', effectiveBurnRate(next)));
        return;
      }
      const next = applyTrigger(stateRef.current, trigger);
      setState(next);
      stateRef.current = next;
      setAnnouncement(announceTrigger(trigger, 'apply', effectiveBurnRate(next)));
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
      let reading = null;
      try {
        reading = await refreshApi(apiBase);
      } catch (error) {
        const hostAlert = hostHeaderAlert(error);
        if (hostAlert) {
          setActionError(hostAlert);
          setAnnouncement('');
          return;
        }
        if (error?.code === 'unreadable-company') {
          showSampleData(UNREADABLE_COMPANY_NOTE);
          setAnnouncement('');
          return;
        }
        const next = active
          ? removeTrigger(stateRef.current, trigger.id)
          : applyTrigger(stateRef.current, trigger);
        setState(next);
        stateRef.current = next;
        setAnnouncement(announceTrigger(trigger, active ? 'remove' : 'apply', effectiveBurnRate(next)));
        return;
      }
      const listed = reading.state.activeTriggers.find((item) => item.id === trigger.id);
      const alerts = [];
      if (reading.skipped > 0) alerts.push(skippedTriggerAlert(reading.skipped));
      if (listed) {
        setAnnouncement(announceTrigger(listed, 'apply', effectiveBurnRate(reading.state)));
        if (active) alerts.push(`${listed.label} is still listed by the service.`);
      } else if (active) {
        setAnnouncement(announceTrigger(trigger, 'remove', effectiveBurnRate(reading.state)));
      } else {
        alerts.push(`${trigger.label} is not listed by the service.`);
        setAnnouncement('');
      }
      setActionError(alerts.join(' '));
    } catch (error) {
      if (!saved) {
        if (active) {
          setActionError(removalBlockedMessage(error, trigger.label));
        } else {
          setActionError(saveBlockedMessage(error, trigger.label));
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
        const reading = commitSnapshot(snapshot, { clearChange: true });
        const alerts = [];
        if (reading.skipped > 0) alerts.push(skippedTriggerAlert(reading.skipped));
        if (reading.state.activeTriggers.length === 0) {
          setAnnouncement(CLEARED_ANNOUNCEMENT);
        } else {
          alerts.push('World events are still listed by the service.');
          setAnnouncement('');
        }
        setActionError(alerts.join(' '));
      } catch (error) {
        const hostAlert = hostHeaderAlert(error);
        if (hostAlert) {
          setActionError(hostAlert);
          setAnnouncement('');
          return;
        }
        if (error?.code === 'unreadable-company') {
          showSampleData(UNREADABLE_COMPANY_NOTE);
          setAnnouncement('');
          return;
        }
        setState((prev) => clearTriggers(prev));
        setAnnouncement(CLEARED_ANNOUNCEMENT);
      }
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
