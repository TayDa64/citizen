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
Real-world trigger (mock or Firecrawl) updates hype or talent cost and appears in the diagram + dashboard.

## Slice 2
**A sample world event updates hype and talent cost, and the effect is visible.**

### What works
- `src/triggers.js` is the RealWorldTrigger contract (id, type, label, source, timestamp, effect.hype, effect.talentCost) plus frozen `mock:local` samples.
- `applyTrigger`, `removeTrigger`, and `clearTriggers` in `src/simulation.js` stack those effects from the Slice 1 baseline. No active trigger leaves burn on the Slice 1 formula.
- The diagram shows the talent-cost delta on the infrastructure node and edge, and adds a hype node when hype moves.
- The dashboard draws a dashed Highcharts plot line and band at the trigger month, with a before/after readout.
- World-event buttons are keyboard operable and announce the effect in an `aria-live="polite"` region.

### Local test
```bash
npm install
npm test
npm run dev
```
Drag the tax slider, click “Advance Month”, watch the chart. Apply “Policy change” and confirm talent cost +12% without moving cash until the next month.

### API dependency

Live company and world-event data comes from Citizen API OpenAPI 0.4.0 on PR #2 (`003_trigger_contract_v1`, head `7efcba4b`).

- `GET /api/triggers` and `POST /api/triggers` use `{ id, type, label, source, timestamp, effect: { hype?, talentCost? } }`. `type` is `news_spike`, `policy_change`, or `market_shift`. At least one effect is non-zero. Unknown top-level fields are rejected, so the client strips `appliedAtIndex` and any other client-only key before POST.
- `effect.hype` is a finite absolute delta from -1 to 1. `effect.talentCost` is a finite relative delta from -100 to 100. Both allow at most 4 decimal places. The service trims `label` and `source` and stores `timestamp` with `Date#toISOString()`.
- `POST /api/triggers/mock` always sends `{ scenario }`. The client does not rely on the route’s omitted-scenario default. Trigger objects have `additionalProperties: false`, so unknown top-level keys such as `appliedAtIndex` are stripped before POST.
- `GET /api/companies` returns an array of `{ id, name, cash, burnRate, hype, talentCost, baselines: { hype, talentCost } }` in no specified order. The client uses `selectCompany` and, for now, the first row. Passing an id selects that company later. An empty array falls back to sample data and the status “No company was returned. Using sample data on this device.” The service is the source of truth for hype, talent cost, and baselines only. Cash and burn stay on the client simulation and are never copied from the company payload. Talent cost is dollars, formatted with the same `Intl.NumberFormat` currency helper as burn (`$4,480`, `$4,121.60`). The default baseline is 4000, so the policy sample shows `$4,480` and a +12% delta.
- Burn on the API is `round(2000 * (1 + taxRate * 0.4))`. The API does not multiply burn by talent cost.
- `DELETE /api/triggers/{id}` removes one event and recomputes from baselines. The id is URL-encoded and must be 1–200 characters. `DELETE /api/triggers` clears every v1 trigger and restores the baselines. Both return 204 with an empty body, so the client does not parse JSON. A second clear is also 204. An unknown id returns 404; the client treats that as already removed, then reloads `GET /api/triggers` and `GET /api/companies` and keeps `baselines` from that response. A 404 or 405 on the collection delete means an old or misrouted server: the client shows an alert and keeps the on-screen numbers. A 400 or 413 is the same kind of alert. Re-sync happens only for a 404 on `/{id}`. `{id}` is the contract id, such as `evt-policy-wage-ordinance`. After Clear, the live region says “World events cleared. Hype and talent cost returned to baseline.”
- A company created while triggers are already active keeps its own hype and talent cost until the next trigger create, replace, delete, or clear. The UI does not work around that.
- Set `VITE_CITIZEN_API` to `/api` so the Vite dev server proxies to `127.0.0.1:8787` with a localhost Host header. The API rejects any other Host with 403. A 403 shows an alert and the app stays on sample data. When the flag is unset or the service cannot be reached, the app stays on local samples and shows “Using sample data on this device.” No backend is required.
- Vitest includes only tests under `src/**`. Backend files in `test/api/*.api.js` belong on `npm run test:api` and are not part of `npm test`.
- Node `civic-tax` and the cash/burn chart are unchanged. With no world event, one tick at the default 25% tax is still burn 2200.

### OPEN DECISION

`talentCostMultipliesBurn` in `src/dataSource.js` is the only switch for burn × talent cost. Local sample mode is on, matching PR #1. API mode is off, matching this service. The product has not decided which behavior ships.
