import React, { useState } from 'react';
import WorkflowDiagram from './WorkflowDiagram';
import Dashboard from './components/Dashboard';
import { initialState, applyEffects, setTaxRate } from './simulation';

function App() {
  const [state, setState] = useState(initialState);

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

  return (
    <div className="App" style={{ background: '#0f0f1a', minHeight: '100vh', color: 'white' }}>
      <header style={{ padding: '1rem', background: '#1a1a2e', textAlign: 'center' }}>
        <h1>Citizen</h1>
        <p>Civic + Startup Simulation — Slice 1: Tax → Burn Rate</p>
      </header>
      <WorkflowDiagram state={state} setState={handleSetState} onTick={onTick} />
      <Dashboard state={state} />
    </div>
  );
}

export default App;