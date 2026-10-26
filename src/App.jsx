import React, { useState } from 'react';
import WorkflowDiagram from './WorkflowDiagram';
import Dashboard from './components/Dashboard';
import TriggerPanel from './components/TriggerPanel';
import { initialState, applyEffects, applyTrigger, clearTriggers, removeTrigger } from './simulation';
import { CLEARED_ANNOUNCEMENT, announceTrigger } from './triggers';

function App() {
  const [state, setState] = useState(initialState);
  const [announcement, setAnnouncement] = useState('');

  const handleSetState = (updater) => {
    setState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // Re-apply effects whenever tax changes so burn rate stays consistent
      return applyEffects(next);
    });
  };

  const onTick = () => {
    setState((prev) => applyEffects(prev));
  };

  const onToggleTrigger = (trigger) => {
    const active = (state.activeTriggers ?? []).some((item) => item.id === trigger.id);
    if (active) {
      setState((prev) => removeTrigger(prev, trigger.id));
      setAnnouncement(announceTrigger(trigger, 'remove'));
      return;
    }
    setState((prev) => applyTrigger(prev, trigger));
    setAnnouncement(announceTrigger(trigger, 'apply'));
  };

  const onClearTriggers = () => {
    setState((prev) => clearTriggers(prev));
    setAnnouncement(CLEARED_ANNOUNCEMENT);
  };

  return (
    <div className="App" style={{ background: '#0f0f1a', minHeight: '100vh', color: 'white' }}>
      <header style={{ padding: '1rem', background: '#1a1a2e', textAlign: 'center' }}>
        <h1>Citizen</h1>
        <p>Civic + Startup Simulation — Slice 1: Tax → Burn Rate</p>
      </header>
      <WorkflowDiagram state={state} setState={handleSetState} onTick={onTick} />
      <TriggerPanel
        state={state}
        announcement={announcement}
        onToggleTrigger={onToggleTrigger}
        onClearTriggers={onClearTriggers}
      />
      <Dashboard state={state} />
    </div>
  );
}

export default App;