import React, { useEffect, useState } from 'react';
import WorkflowDiagram from './WorkflowDiagram';
import Dashboard from './components/Dashboard';
import { initialState, applyEffects, applyTriggerEffect } from './simulation';
import { fetchTriggerState, postMockTrigger } from './triggerClient';

function App() {
  const [state, setState] = useState(initialState);
  const [triggerError, setTriggerError] = useState('');
  const [triggerPending, setTriggerPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTriggerState()
      .then(({ triggers, company }) => {
        if (cancelled || !company) return;
        setState((prev) => ({
          ...prev,
          company: {
            ...prev.company,
            hype: company.hype,
            talentCost: company.talentCost,
            burnRate: company.burnRate ?? prev.company.burnRate,
            baseBurnRate: company.baseBurnRate ?? prev.company.baseBurnRate,
            talentMultiplier: company.talentMultiplier ?? prev.company.talentMultiplier,
            talentCostFactor: company.talentCostFactor ?? prev.company.talentCostFactor,
            effectiveMultiplier: company.effectiveMultiplier ?? prev.company.effectiveMultiplier,
            talentMix: company.talentMix ?? prev.company.talentMix
          },
          baselines: company.baselines ?? prev.baselines,
          history: {
            ...prev.history,
            hype: [company.hype],
            talentCost: [company.talentCost]
          },
          triggers
        }));
      })
      .catch((error) => {
        if (!cancelled) setTriggerError(error.message || 'Trigger service unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const onMockTrigger = async (scenario) => {
    setTriggerPending(true);
    setTriggerError('');
    try {
      const trigger = await postMockTrigger(scenario);
      setState((prev) => applyTriggerEffect(prev, trigger));
    } catch (error) {
      setTriggerError(error.message || 'Trigger request failed');
    } finally {
      setTriggerPending(false);
    }
  };

  return (
    <div className="App" style={{ background: '#0f0f1a', minHeight: '100vh', color: 'white' }}>
      <header style={{ padding: '1rem', background: '#1a1a2e', textAlign: 'center' }}>
        <h1>Citizen</h1>
        <p>Civic + Startup Simulation — Tax, employees, and talent cost → burn. Triggers → hype and talent cost.</p>
      </header>
      <WorkflowDiagram
        state={state}
        setState={handleSetState}
        onTick={onTick}
        onMockTrigger={onMockTrigger}
        triggerError={triggerError}
        triggerPending={triggerPending}
      />
      <Dashboard state={state} />
    </div>
  );
}

export default App;