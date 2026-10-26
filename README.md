# Citizen

**Citizen** is a real-world-triggered civic and startup simulation game.

Players manage both city-level civic systems (budgets, policies, social incidents, political events) and personal startups (Hipster CEO-style: idea, staff, product development, funding, exit), all modulated by live scraped data and the interconnected simulation effects.

Forked conceptually from civic-brief ideas and expanded into a full game backend + frontend.

## Tech Stack (planned)
- Frontend: React + React Flow (workflows), three.js (3D city), Highcharts, fabric.js, etc.
- Backend: PostgreSQL (simulation objects, effects, companies, real-world triggers) + pgvector for AI
- Data: Firecrawl for real-world ingestion

## Getting Started (Cursor)
1. Clone this repo: `git clone https://github.com/TayDa64/citizen.git`
2. Open the folder in Cursor.
3. `npm install`
4. `npm run dev`
5. Extend the WorkflowDiagram.jsx and add backend schema from previous design.

`npm run dev` proxies `/api` to `http://127.0.0.1:8787`. The API listens on port 8787 unless `PORT` is set. A non-default `PORT` needs the same change in the Vite proxy `target` in `vite.config.js`. `changeOrigin` rewrites `Host` to that target, and the API accepts only `localhost`, `127.0.0.1`, and `[::1]` on the bound port.

See the React Flow component in `src/WorkflowDiagram.jsx` for the core gameplay loop visualization.

## Local Postgres

Install the pgvector package that matches the cluster major version, `postgresql-<major>-pgvector`. `pg_lsclusters` prints the version and cluster name. Start that cluster with `sudo pg_ctlcluster <version> <name> start`.

The API binds to loopback and refuses a `DATABASE_URL` whose host, after `pg-connection-string` parsing, is not `localhost`, `127.0.0.1`, `::1`, or a unix-socket path. An omitted host uses `PGHOST`, then `localhost`. Repeated `host` parameters and comma-separated host lists are refused. Tests create throwaway databases on the local socket and do not read `DATABASE_URL`.

A company inserted while v1 triggers are already active keeps its own hype and talent cost until the next trigger create, replace, delete, or clear. That write recomputes every company. A row that does not yet have a baseline is captured as it stands, so it does not inherit effects applied before it existed.

`talentMultiplier` is the employee mean and is exactly 1 when the mix is empty. Contributions sum to that multiplier only when the mix is non-empty. A null, blank, NaN, or Infinity skill counts as 0.5. `talentCostFactor` is the stacked ratio `talentCost / baselines.talentCost`, clamped once to [0.1, 3] and rounded to 4 decimal places. It is 1, and `talentCostFactorClamped` is false, when there is no trigger or the baseline is missing, 0, negative, or non-finite. `talentCostFactorClamped` is true only when that raw ratio fell outside the range. The stored talent cost and hype stay raw. `effectiveMultiplier` is `round(talentMultiplier * talentCostFactor, 4)`. API `burnRate` is `round(baseBurnRate * talentMultiplier * talentCostFactor)`, rounded once, with no tax. GET `/api/companies` does not write `companies.burn_rate` or `companies.cash`. Validation failures are `400` `{ "error", "issues" }`. A method the route does not implement is `405` `{ "error": "Method not allowed", "issues": [] }`.

## Browser tests against the API

`npm run test:browser` skips the live API check unless `CITIZEN_API_E2E=1`. Playwright runs `npm run build` and then `vite preview`, so the API base is fixed at build time. Set `VITE_CITIZEN_API=/api` in that build. The preview server proxies `/api` to `http://127.0.0.1:8787`, which keeps the Host header on an address the API allows. When `CITIZEN_API_E2E` is set, every browser test calls `DELETE /api/triggers` before it starts and after it finishes.

## Tests

`npm test` runs the database-free backend suite in `test/unit`, then the UI suite (`vitest run`). Neither needs Postgres. CI's `npm run test --if-present` uses this script.

`npm run test:api` runs the Postgres suite in `test/api`. That suite creates and drops `citizen_slice2_test_*` databases on the local socket and does not read `DATABASE_URL`.

Both backend suites use `*.api.js` names, which sit outside Vitest's include (`src/**/*.{test,spec}.{js,jsx}`).
