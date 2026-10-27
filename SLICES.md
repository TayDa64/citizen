# Citizen Slices

## Slice 1 (completed in this iteration)
**Tax policy modulates company burn rate, visible and adjustable.**

### What works
- Interactive civic-tax node in the existing WorkflowDiagram.
- Simple effects resolver (`src/simulation.js`) that applies a formula: burnRate = base * (1 + taxRate * 0.4).
- Cash decreases on each tick.
- Highcharts dashboard shows cash and burn rate history.
- Existing diagram nodes and edges are preserved.

### Invariants for later slices
- Do not remove or rename node id `civic-tax`.
- Effects stay data-driven (formulas in the style of the Postgres `effects` table).
- Real-world triggers (Firecrawl) will later feed the same state objects.
- Keep the React Flow diagram as the system map.

### Next suggested slice
Slice 2 landed on `main` (PRs #1–#6). See **Next suggested slice** under Slice 2.

## Slice 2 (completed on main)
**A sample world event updates hype and talent cost, and the effect is visible.**

### What works
- `src/triggers.js` is the RealWorldTrigger contract (id, type, label, source, timestamp, effect.hype, effect.talentCost) plus frozen `mock:local` samples shaped for `real_world_triggers.extracted` (Firecrawl can replace the source later).
- `applyTrigger`, `removeTrigger`, and `clearTriggers` in `src/simulation.js` stack those effects from the Slice 1 baseline. No active trigger leaves burn on the Slice 1 formula.
- The diagram updates Real-World Triggers node `id: '5'`, shows the talent-cost delta on the infrastructure node and edge, and adds a hype node when hype moves. Node id `civic-tax` is unchanged.
- The dashboard draws a dashed Highcharts plot line and band at the trigger month, with a before/after hype and talent-cost readout.
- World-event buttons are keyboard operable and announce the effect in an `aria-live="polite"` region.

### Acceptance (Brainiac) — verified; PR #7 merged
- [x] Mock trigger (`SAMPLE_TRIGGERS` / `source: mock:local`) updates `company.hype` and/or talent cost via data-driven effects.
- [x] Change appears on React Flow node `5` (and related overlay) and in the Dashboard readout/chart markers.
- [x] Node id `civic-tax` still present; with no world event, tax → burn matches Slice 1 (2200 at 25% tax).
- [x] Local test steps below still pass.

### Local test
```bash
npm install
npm test
npm run dev
```
Drag the tax slider, click “Advance Month”, watch the chart. Apply “Policy change” and confirm talent cost +12% without moving cash until the next month. Apply “News spike” and confirm hype rises and node `5` / the hype overlay update. Clear world events and confirm burn returns to the Slice 1 baseline.

### Next suggested slice
Slice 3 (authoritative turns) — see below and [STATE.md](STATE.md) Phase 1.

## Slice 3 (in progress — authoritative turns)
**Versioned GameState + TurnCommand → deterministic engine → atomic commit.**

### What works
- Shared turn engine in `src/turnEngine.js` / `src/simulationCore.js` (effect order documented in the engine header).
- TurnCommands: `set_tax`, `advance_turn`, `apply_trigger`, `remove_trigger`, `clear_triggers`.
- Client Advance Month / tax slider dispatch through the engine (`src/turnCommands.js`, `src/App.jsx`).
- Migration `004_campaign_turns.sql` + `POST /api/campaigns`, `GET /api/campaigns/{id}`, `POST|GET /api/campaigns/{id}/turns` for atomic commit + reload.
- Offline determinism tests under `src/turnEngine.test.js`; Postgres atomicity under `test/api/campaign-turns.api.js`.

### Invariants preserved
- Node id `civic-tax`; Slice 1 burn baselines 2000 / 2200 / 2800; Slice 2 trigger → hype / talent → burn factor.
- `GET /api/companies` cash / burnRate are still never copied onto the client sim.
- Campaign `TurnResult` is the write path for cash / burn history / tax / turn when a campaign is active.
- No hire / funding / exit interactivity; no Firecrawl.

### API dependency

Live company and world-event data comes from Citizen API OpenAPI **0.8.0** (campaign turns + prior 0.7.1 talent fields). Trigger contract paths below still apply.

**Authority boundary:** The companies service is the source of truth for hype, talent cost, baselines, and talent multiplier / mix / factors. `hydrateFromApi` / `readApiSnapshot` never copy `company.cash` or `company.burnRate` from the companies payload. Cash / burn history / tax / turn commit through the turn engine and, when connected, `POST /api/campaigns/{id}/turns`. Advance Month never POSTs to `/api/companies`.

- `GET /api/triggers` and `POST /api/triggers` use `{ id, type, label, source, timestamp, effect: { hype?, talentCost? } }`. `type` is `news_spike`, `policy_change`, or `market_shift`. At least one effect is non-zero. Unknown top-level fields are rejected, so the client strips `appliedAtIndex` and any other client-only key before POST.
- `effect.hype` is a finite absolute delta from -1 to 1. `effect.talentCost` is a finite relative delta from -100 to 100. Both allow at most 4 decimal places. The service trims `label` and `source` and stores `timestamp` with `Date#toISOString()`.
- `POST /api/triggers/mock` always sends `{ scenario }`. The client does not rely on the route’s omitted-scenario default. Trigger objects have `additionalProperties: false`, so unknown top-level keys such as `appliedAtIndex` are stripped before POST.
- `GET /api/companies` returns an array of `{ id, name, cash, burnRate, hype, talentCost, baselines: { hype, talentCost } }` in no specified order. The client uses `selectCompany` and, for now, the first row. Passing an id selects that company later. An empty array falls back to sample data and the status “No company was returned. Using sample data on this device.” The service is the source of truth for hype, talent cost, and baselines only. Cash and burn stay on the client simulation and are never copied from the company payload. Talent cost is dollars, formatted with the same `Intl.NumberFormat` currency helper as burn (`$4,480`, `$4,121.60`). The default baseline is 4000, so the policy sample shows `$4,480` and a +12% delta.
- Burn in the simulation is `round(baseBurnRate * talentMultiplier * talentCostFactor)`, rounded once, where `baseBurnRate` is `round(2000 * (1 + taxRate * 0.4))`. Local mode stacks talent cost in dollars from the 4000 baseline and rounds that total to cents once, then `talentCostFactor` is `round4(clamp(talentCost / baselines.talentCost, 0.1, 3))`: clamp first, then round. The clamp flag uses that cent-rounded ratio, so exactly 0.1 and exactly 3 are not clamped. It is 1 when there is no trigger or the baseline is missing, 0, negative, or non-finite. A talent cost of 0 floors the factor at 0.1, so burn stays above 0 (`$220` at 25% tax with no employees). A ratio above 3 caps at 3. The employee `talentMultiplier` is not clamped. `effectiveMultiplier` is `round4(talentMultiplier × talentCostFactor)`. The API's `burnRate` is computed on read from the stored base and is not copied onto the simulation. Trigger writes do not change stored cash or burn, so the client reloads `GET /api/companies` after every trigger write and delete. A policy of +12% is factor 1.12: the API burn is 2240 at base 2000 when the employee multiplier is 1, and the simulation burn at 25% tax is `$2,464`. Four tech employees at skill 1 stay ×1.75; with that policy the effective multiplier is 1.96 and tax 1 burns `$5,488`. Policy then market is factor 1.0304. A +250% policy caps the factor at 3 and the simulation burn at 25% tax is `$6,600`. A 0.5.0 payload omits the factors and the client computes them. When the server sends `talentCostFactor`, the client uses it and still clamps it. `talentCostFactorClamped` is true only when the raw ratio fell outside 0.1–3. A missing flag counts as false unless the client itself clamped the factor. The badge reads `capped at 3×` or `floored at 0.1×`. Displayed talent-cost dollars stay unclamped. Cash and the stored burn are still not copied onto the simulation. The dashboard labels burn, base burn, the talent multiplier, the talent-cost factor, and the effective multiplier.
- `DELETE /api/triggers/{id}` removes one event and recomputes from baselines. The id is URL-encoded and must be 1–200 characters. `DELETE /api/triggers` clears every v1 trigger and restores the baselines. Both return 204 with an empty body, so the client does not parse JSON. A second clear is also 204. An unknown id returns 404. The client reloads `GET /api/triggers` and `GET /api/companies`, keeps `baselines`, and builds the announcement from that refreshed list. It says the event was removed only when the list no longer includes it. If the service still lists the event, the live region keeps the applied description and an alert says it is still listed. A 404 or 405 on the collection delete means an old or misrouted server: the client shows an alert and keeps the on-screen numbers. A 400 or 413 is the same kind of alert. Re-sync happens only for a 404 on `/{id}`. `{id}` is the contract id, such as `evt-policy-wage-ordinance`. After a clear that leaves no events, the live region says “World events cleared. Hype and talent cost returned to baseline.”
- A trigger with an unknown type, or an effect key outside the contract, is skipped. An alert says how many were skipped, and the rest of the payload is kept. Payloads are checked before any state update. A company whose baselines are missing or not finite numbers falls back to sample data with the status “The company payload could not be read. Using sample data on this device.” Null or non-finite `hype` or `talentCost` is missing: the baseline is shown and the status says so. Zero is a real value. A render error is caught by an accessible fallback instead of a blank page.
- A company created while triggers are already active keeps its own hype and talent cost until the next trigger create, replace, delete, or clear. The UI does not work around that.
- Set `VITE_CITIZEN_API` to `/api` so the Vite dev server proxies to `127.0.0.1:8787` with a localhost Host header. The API rejects any other Host with 403. A 403 shows an alert and the app stays on sample data. When the flag is unset or the service cannot be reached, the app stays on local samples and shows “Using sample data on this device.” No backend is required. Browser tests that talk to the API need `CITIZEN_API_E2E=1` and `VITE_CITIZEN_API=/api` at build time, because Playwright builds the app before `vite preview`. Those tests delete `/api/triggers` before and after each test.
- Vitest includes only tests under `src/**`. Backend files in `test/api/*.api.js` belong on `npm run test:api` and are not part of `npm test`.
- Node `civic-tax` and the cash/burn chart are unchanged. With no world event, one tick at the default 25% tax is still burn 2200.

### OPEN DECISION

`APPLY_TALENT_COST_TO_BURN` in `src/talentMultiplier.js` is on. Trigger talent cost scales burn in local mode and API mode. `talentMultiplier` stays employee-only.

OpenAPI **0.8.0** (campaign turns; builds on 0.7.1 talent fields from PR #6 / Slice 2 via PR #7) includes `talentCostFactor` and `effectiveMultiplier` on `GET /api/companies`, plus campaign GameState / TurnCommand routes. `talentMultiplier` remains employee-only. A 0.5.0 payload omits the new talent fields and the client computes them. Parsing stays in `src/talentMultiplier.js`. A missing Host is 400 `Host required`, two Host headers are 400 `Duplicate host`, and any other host is 403 `Forbidden host`. Those alerts keep the current numbers. Hype outside 0–1 and talent cost outside $0–$9,999,999,999.99 are clamped, and the status says so.

## Merge train

Which slices land in which order, and what is already verified, is tracked in [STATE.md](STATE.md).
