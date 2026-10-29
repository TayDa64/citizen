import React, { useEffect, useRef, useState } from 'react';
import WorkflowDiagram from './WorkflowDiagram';
import CampaignDesk from './components/CampaignDesk';
import CompanyOpsForms from './components/CompanyOpsForms';
import Dashboard from './components/Dashboard';
import IslandSwitcher from './components/IslandSwitcher';
import RoleSelect from './components/RoleSelect';
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
  PLAYER_ROLE_CAMPAIGN,
  PLAYER_ROLE_COMPANY_OPS,
  parsePlayerRole,
  readStoredPlayerRole,
  roleLabel,
  writeStoredPlayerRole,
} from './playerRole';
import {
  applyTrigger,
  clearTriggers,
  initialState,
  readApiSnapshot,
  removeTrigger,
} from './simulation';
import { CLEARED_ANNOUNCEMENT, announceTrigger, composeLiveAnnouncement } from './triggers';
import { effectiveBurnRate, talentCostFactorClampOf } from './talentMultiplier';
import {
  applyCommandsLocally,
  buildTriggerRestackCommands,
  commandsWithTriggerRestack,
  dispatchTurnCommands,
  toCampaignTrigger,
} from './turnCommands';
import {
  appendLedgerFromTurnResults,
  ledgerEntriesFromApiCommits,
  shapeLedgerEntry,
} from './turnLedger';
import { ingestFixtureIntoState } from './pipelineIngest';

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

function App({ initialPlayerRole } = {}) {
  const configuredBase = readCitizenApiBase();
  const [playerRole, setPlayerRole] = useState(() => {
    // Explicit null forces the role gate (tests); undefined falls back to storage.
    if (initialPlayerRole === null) return null;
    const fromProp = parsePlayerRole(initialPlayerRole);
    if (fromProp) return fromProp;
    return readStoredPlayerRole();
  });
  const [state, setState] = useState(() => {
    const seededRole = initialPlayerRole === null
      ? null
      : (parsePlayerRole(initialPlayerRole) ?? readStoredPlayerRole());
    return {
      ...initialState,
      playerRole: seededRole ?? undefined,
    };
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [announcement, setAnnouncement] = useState('');
  const [sourceNote, setSourceNote] = useState(configuredBase ? LOADING_NOTE : SAMPLE_DATA_NOTE);
  const [sourceBusy, setSourceBusy] = useState(Boolean(configuredBase));
  const [actionError, setActionError] = useState('');
  const [apiBase, setApiBase] = useState(configuredBase);
  const [ledger, setLedger] = useState([]);
  const [pipelineEvents, setPipelineEvents] = useState([]);
  const [ingestRefreshKey, setIngestRefreshKey] = useState(0);
  const campaignIdRef = useRef(null);

  const applyPlayerRole = (role) => {
    const nextRole = writeStoredPlayerRole(role);
    setPlayerRole(nextRole);
    setState((prev) => {
      const next = { ...prev, playerRole: nextRole ?? undefined };
      stateRef.current = next;
      return next;
    });
  };

  const showSampleData = (note) => {
    const sample = {
      ...initialState,
      playerRole: playerRole ?? undefined,
    };
    setState(sample);
    stateRef.current = sample;
    setApiBase(null);
    campaignIdRef.current = null;
    setLedger([]);
    setPipelineEvents([]);
    setSourceNote(note);
    setActionError('');
  };

  const appendLocalResults = (results) => {
    const list = Array.isArray(results) ? results.filter(Boolean) : [results].filter(Boolean);
    if (list.length === 0) return;
    setLedger((prev) => appendLedgerFromTurnResults(prev, list));
  };

  const appendApiCommits = (payloads) => {
    const list = Array.isArray(payloads) ? payloads : [payloads];
    const entries = [];
    for (const payload of list) {
      const commit = payload?.commit;
      if (commit == null) continue;
      entries.push(shapeLedgerEntry({
        seq: commit.seq,
        turnBefore: commit.turnBefore,
        turnAfter: commit.turnAfter,
        command: commit.command,
        result: {
          before: commit.before,
          after: commit.after,
          deltas: commit.deltas,
          appliedEffects: commit.appliedEffects,
          explanations: commit.explanations,
        },
        createdAt: null,
      }));
    }
    if (entries.length === 0) return;
    setLedger((prev) => {
      const seen = new Set(prev.map((entry) => entry.seq));
      const merged = [...prev];
      for (const entry of entries) {
        if (seen.has(entry.seq)) continue;
        merged.push(entry);
        seen.add(entry.seq);
      }
      return merged.sort((a, b) => a.seq - b.seq);
    });
  };

  const refreshLedgerFromApi = async (baseUrl, campaignId) => {
    if (!baseUrl || !campaignId) return;
    try {
      const rows = await createCitizenApi({ baseUrl }).listTurns(campaignId, { limit: 50 });
      setLedger(ledgerEntriesFromApiCommits(rows));
    } catch {
      // Keep any local appends if the ledger route is unavailable.
    }
  };

  const ensureCampaign = async (baseUrl, simState) => {
    try {
      const api = createCitizenApi({ baseUrl });
      const created = await api.createCampaign({
        seed: simState.seed ?? 'ui-default',
        state: {
          taxRate: simState.taxRate,
          turn: simState.turn ?? 0,
          // Lens only — no migration; normalizeGameState spreads unknown fields.
          playerRole: parsePlayerRole(simState.playerRole) ?? playerRole ?? undefined,
          company: {
            cash: simState.company.cash,
            burnRate: simState.company.burnRate,
            hype: simState.company.hype,
            productQuality: simState.company.productQuality,
            talentCost: simState.company.talentCost,
          },
          history: simState.history,
          baselines: simState.baselines,
          // Seed the same stack the UI shows so Advance Month burn matches
          // preview (not empty state_json vs /api/triggers).
          activeTriggers: (simState.activeTriggers ?? []).map((trigger) =>
            toCampaignTrigger(trigger)
          ),
          // Campaign owns roster after hire; seed any already-hired employees.
          employees: Array.isArray(simState.employees)
            ? simState.employees.map((row) => ({ ...row }))
            : [],
          talentMultiplier: simState.talentMultiplier ?? 1,
          talentMix: Array.isArray(simState.talentMix)
            ? simState.talentMix.map((row) => ({ ...row }))
            : [],
        },
      });
      if (created?.id) {
        campaignIdRef.current = created.id;
        await refreshLedgerFromApi(baseUrl, created.id);
        return created.id;
      }
    } catch {
      campaignIdRef.current = null;
    }
    return null;
  };

  const commitCommands = (commands, { restackTriggers = false } = {}) => {
    const prev = stateRef.current;
    const list = Array.isArray(commands) ? commands : [commands];
    // Local engine stays synchronous so tax slider / Advance Month update
    // immediately (Slice 1/2 UX + existing UI tests). Campaign API is async.
    // Only restack when a campaign is live — local state already owns the stack.
    if (!apiBase || !campaignIdRef.current) {
      const results = [];
      let next = prev;
      for (const command of list) {
        const step = applyCommandsLocally(next, [command]);
        next = step.state;
        if (step.result) results.push(step.result);
      }
      setState(next);
      stateRef.current = next;
      appendLocalResults(results);
      return Promise.resolve({
        state: next,
        mode: 'local',
        result: results[results.length - 1] ?? null,
        results,
      });
    }
    const queued = restackTriggers ? commandsWithTriggerRestack(prev, list) : list;
    return dispatchTurnCommands(prev, queued, {
      api: createCitizenApi({ baseUrl: apiBase }),
      campaignId: campaignIdRef.current,
    }).then((dispatched) => {
      setState(dispatched.state);
      stateRef.current = dispatched.state;
      if (dispatched.mode === 'api' && Array.isArray(dispatched.results)) {
        appendApiCommits(dispatched.results);
      } else if (dispatched.result) {
        appendLocalResults([dispatched.result]);
      }
      return dispatched;
    });
  };

  const syncCampaignTriggerCommand = (command) => {
    if (!apiBase || !campaignIdRef.current || command == null) {
      return Promise.resolve(null);
    }
    return commitCommands([command]);
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
      .then(async (result) => {
        if (cancelled) return;
        if (result.mode === 'api' && result.snapshot) {
          try {
            const reading = commitSnapshot(result.snapshot);
            setApiBase(result.baseUrl);
            setActionError(reading.skipped > 0 ? skippedTriggerAlert(reading.skipped) : (result.alert || ''));
            // Best-effort campaign for authoritative turns. Missing route/migration
            // keeps Slice 1/2 playable on the local engine.
            await ensureCampaign(result.baseUrl, stateRef.current);
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

  // Tax slider: set_tax then advance_turn through the turn engine (and campaign
  // API when a campaign is active). Never copy GET /api/companies cash/burn.
  const handleSetState = (updater) => {
    const prev = stateRef.current;
    const patched = typeof updater === 'function' ? updater(prev) : updater;
    const taxRate = patched?.taxRate;
    void commitCommands(
      [
        { type: 'set_tax', taxRate },
        { type: 'advance_turn' },
      ],
      { restackTriggers: true },
    );
  };

  // Advance Month via TurnCommand. Uses campaign commit when connected;
  // otherwise the local deterministic engine. Never POSTs to /api/companies.
  // Restack campaign triggers first so burn/cash match the UI preview.
  const onTick = () => {
    void commitCommands([{ type: 'advance_turn' }], { restackTriggers: true });
  };

  // Hire via TurnCommand on diagram node 3. Refreshes talent/burn preview;
  // cash drains only on advance_turn. Persists through campaign turns when live.
  const onHire = ({ department = 'tech', skill = 1 } = {}) => {
    void commitCommands([{ type: 'hire_employee', department, skill }]);
  };

  // Ops desk tax form: same TurnCommand path as the diagram civic-tax slider.
  const onOpsSetTax = (taxRate) => {
    void commitCommands(
      [
        { type: 'set_tax', taxRate },
        { type: 'advance_turn' },
      ],
      { restackTriggers: true },
    );
  };

  const refreshApi = async (baseUrl) => {
    const snapshot = await createCitizenApi({ baseUrl }).loadWorld();
    return commitSnapshot(snapshot);
  };

  const announceLive = (delta, nextState) => {
    setAnnouncement(composeLiveAnnouncement(delta, nextState?.activeTriggers));
  };

  const onToggleTrigger = async (trigger) => {
    const active = (state.activeTriggers ?? []).some((item) => item.id === trigger.id);
    if (state.dataSource !== 'api' || !apiBase) {
      if (active) {
        const next = removeTrigger(stateRef.current, trigger.id);
        setState(next);
        stateRef.current = next;
        announceLive(
          announceTrigger(trigger, 'remove', effectiveBurnRate(next), talentCostFactorClampOf(next)),
          next
        );
        return;
      }
      const next = applyTrigger(stateRef.current, trigger);
      setState(next);
      stateRef.current = next;
      announceLive(
        announceTrigger(trigger, 'apply', effectiveBurnRate(next), talentCostFactorClampOf(next)),
        next
      );
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
        announceLive(
          announceTrigger(trigger, active ? 'remove' : 'apply', effectiveBurnRate(next), talentCostFactorClampOf(next)),
          next
        );
        return;
      }
      const listed = reading.state.activeTriggers.find((item) => item.id === trigger.id);
      const alerts = [];
      if (reading.skipped > 0) alerts.push(skippedTriggerAlert(reading.skipped));
      if (listed) {
        announceLive(
          announceTrigger(listed, 'apply', effectiveBurnRate(reading.state), talentCostFactorClampOf(reading.state)),
          reading.state
        );
        if (active) alerts.push(`${listed.label} is still listed by the service.`);
        else {
          await syncCampaignTriggerCommand({
            type: 'apply_trigger',
            trigger: toCampaignTrigger(listed),
          });
        }
      } else if (active) {
        announceLive(
          announceTrigger(trigger, 'remove', effectiveBurnRate(reading.state), talentCostFactorClampOf(reading.state)),
          reading.state
        );
        await syncCampaignTriggerCommand({
          type: 'remove_trigger',
          triggerId: trigger.id,
        });
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

  const onIngestFixture = async () => {
    if (state.dataSource !== 'api' || !apiBase) {
      const result = ingestFixtureIntoState(stateRef.current);
      setState(result.state);
      stateRef.current = result.state;
      setPipelineEvents(result.events);
      const active = result.triggers[0];
      if (active) {
        announceLive(
          announceTrigger(active, 'apply', effectiveBurnRate(result.state), talentCostFactorClampOf(result.state)),
          result.state,
        );
      } else {
        setAnnouncement('Fixture ingest produced no active world events.');
      }
      return;
    }

    setSourceBusy(true);
    setActionError('');
    setAnnouncement('Ingesting fixture wage bulletin.');
    let saved = false;
    try {
      const api = createCitizenApi({ baseUrl: apiBase });
      const ingested = await api.ingestWorldEvents({
        adapter: 'fixture',
        fixtureId: 'civic-wage-bulletin',
      });
      saved = true;
      setPipelineEvents(Array.isArray(ingested?.events) ? ingested.events : []);
      setIngestRefreshKey((key) => key + 1);
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
        const local = ingestFixtureIntoState(stateRef.current);
        setState(local.state);
        stateRef.current = local.state;
        setPipelineEvents(local.events);
        const active = local.triggers[0];
        if (active) {
          announceLive(
            announceTrigger(active, 'apply', effectiveBurnRate(local.state), talentCostFactorClampOf(local.state)),
            local.state,
          );
        }
        return;
      }
      // Restack campaign GameState from the refreshed API trigger list (supersession
      // already applied server-side — no compounding).
      const listed = reading.state.activeTriggers ?? [];
      await commitCommands(buildTriggerRestackCommands(listed));
      const pipelineTriggers = (ingested?.triggers ?? []).filter(Boolean);
      const headline = pipelineTriggers[0]
        ?? listed.find((row) => String(row.id).startsWith('evt-pipeline-'));
      if (headline) {
        announceLive(
          announceTrigger(headline, 'apply', effectiveBurnRate(reading.state), talentCostFactorClampOf(reading.state)),
          reading.state,
        );
      } else {
        setAnnouncement('Fixture ingest completed.');
      }
    } catch (error) {
      if (!saved) {
        setActionError(saveBlockedMessage(error, 'fixture ingest'));
        setAnnouncement('');
      }
    } finally {
      setSourceBusy(false);
    }
  };

  const onClearTriggers = async () => {
    if (state.dataSource !== 'api' || !apiBase) {
      setState((prev) => clearTriggers(prev));
      setPipelineEvents((prev) => prev.map((event) => (
        event.lifecycle === 'cleared' || event.lifecycle === 'expired'
          ? event
          : { ...event, lifecycle: 'cleared' }
      )));
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
          setPipelineEvents((prev) => prev.map((event) => (
            event.lifecycle === 'cleared' ? event : { ...event, lifecycle: 'cleared' }
          )));
          await syncCampaignTriggerCommand({ type: 'clear_triggers' });
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
        setPipelineEvents((prev) => prev.map((event) => (
          event.lifecycle === 'cleared' ? event : { ...event, lifecycle: 'cleared' }
        )));
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

  if (!playerRole) {
    return (
      <div className="App" style={{ background: '#0f0f1a', minHeight: '100vh', color: 'white' }}>
        <header style={{ padding: '1rem', background: '#1a1a2e', textAlign: 'center' }}>
          <h1>Citizen</h1>
          <p>Civic + Startup Simulation — one backend, two lenses</p>
        </header>
        <main>
          <RoleSelect onSelect={applyPlayerRole} />
        </main>
      </div>
    );
  }

  const isCompanyOps = playerRole === PLAYER_ROLE_COMPANY_OPS;
  const isCampaign = playerRole === PLAYER_ROLE_CAMPAIGN;

  return (
    <div className="App" style={{ background: '#0f0f1a', minHeight: '100vh', color: 'white' }}>
      <header style={{ padding: '1rem', background: '#1a1a2e', textAlign: 'center' }}>
        <h1>Citizen</h1>
        <p>
          {isCompanyOps
            ? 'Company ops desk — tax, hire, talent & burn (campaign authority). Same sim as campaign.'
            : 'Campaign causal runner — world events, ledger, pathways. Same sim as company ops.'}
        </p>
        <IslandSwitcher role={playerRole} onChange={applyPlayerRole} />
        <p className="role-active" data-testid="active-role-label">
          Active lens: {roleLabel(playerRole)}
        </p>
      </header>
      <main>
        <WorkflowDiagram state={state} setState={handleSetState} onTick={onTick} onHire={onHire} />
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
        {isCompanyOps ? (
          <CompanyOpsForms
            taxRate={state.taxRate}
            onSetTax={onOpsSetTax}
            onHire={onHire}
          />
        ) : null}
        {isCampaign ? (
          <CampaignDesk
            state={state}
            ledger={ledger}
            announcement={announcement}
            busy={sourceBusy}
            pipelineEvents={pipelineEvents}
            apiBase={apiBase}
            ingestRefreshKey={ingestRefreshKey}
            onToggleTrigger={onToggleTrigger}
            onClearTriggers={onClearTriggers}
            onIngestFixture={onIngestFixture}
          />
        ) : (
          <p className="island-hint" data-testid="ops-campaign-hint">
            World events, causal hub, ingest runs, and the turn ledger live on the{' '}
            <button
              type="button"
              className="island-hint__link"
              onClick={() => applyPlayerRole(PLAYER_ROLE_CAMPAIGN)}
            >
              Campaign
            </button>{' '}
            island — enter campaign when you want the causal runner.
          </p>
        )}
        <Dashboard
          state={state}
          ledger={ledger}
          showLedger={false}
          showPolitics={false}
        />
      </main>
    </div>
  );
}

export default App;
