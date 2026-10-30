# Citizen — State & Order of Operations

## Current Merge Sequence (do not skip)
1. PR #3 — CI / Node 22 — MERGED (d47559c)
2. PR #1 — Frontend triggers — MERGED (7ea00f0, head 107d8fd, trace diag-20261026-04496e36)
3. PR #4 — API wiring — MERGED (eb02b8b, head 793b7e0, trace diag-20261026-ebca9b87)
4. PR #5 — Type-weighted talent multiplier + clamp — MERGED (d0fbbad, head a93f3ac, trace diag-20261026-c6e15877)
5. PR #2 — Backend-only (drop duplicate UI files) — MERGED (69898fc, head 2715fe6, trace diag-20261026-19a92410)
6. PR #6 — Talent multiplier backend + 0.1×–3× clamp — MERGED (5f4f021, head e4bceaa, OpenAPI 0.7.1, trace diag-20261026-512e6d27)

Sequence complete. Post-merge regression on main 5f4f021: PASS (trace diag-20261026-8e1cd230), CI green.

Later merges: PR #7 Slice 2 checklist; PR #8 authority boundary; PR #9–#11 UI/Playwright; PR #12 authoritative turns; PR #13 campaign↔trigger coherence; PR #14 business lifecycle hire; PR #15 civic feedback; PR #16 connect pathways; PR #17 turn ledger; PR #18 real-world pipeline; PR #19 causal graph; PR #20 campaign acceptance; PR #21 political objectives; PR #22 test:api harness; **Wave 2** PR #23–#28 (ingest_runs → meetings + `:12`); peer #30; minutes #31; allowlisted live fetch #32; CIT-113 role select + company ops #33; CIT-114 campaign causal UI #34 @ `80169ab`; CIT-116 nest + council calendar (this PR).

**Rule:** Each PR must be green, rebased clean on main, and meet its acceptance criteria before the next is merged. Update this file after every merge.

## Invariants (must hold after every merge)
- No employees + no trigger talent change → burn exactly 2000 / 2200 / 2800 at tax 0 / 0.25 / 1
- Type-weighted employee multiplier (tech 1.25, marketing 1.05, sales 0.95) active
- Trigger talent-cost factor clamped 0.1×–3× and feeds burn
- Slice 1 tax-to-burn base formula unchanged
- Additive only; no breaking changes to existing schema or UI nodes
- GET /api/companies cash/burnRate never copied onto the client sim
- Same seed + TurnCommand sequence → same metrics (turn engine)
- Fixture wage bulletin burn **2376** / clear **2200**; peers do not bind; `adapter: firecrawl` rejected

## Active phase
### Phase 1 — Authoritative Game State (P0) — landed (PR #12 / #13)
- Versioned GameState, TurnCommand, TurnResult (`src/turnEngine.js`)
- Atomic turn commit on the server (`migrations/004_campaign_turns.sql`, `server/campaigns.js`)
- Campaign↔trigger restack before advance (PR #13)
- Acceptance: reload reproduces last committed state; failed commit leaves no partial state; offline engine determinism under `npm test`

### Phase 2 — Minimum business lifecycle (P0) — landed (PR #14)
- TurnCommand `hire_employee` + Hire UI on diagram node `3`
- Talent multiplier / burn preview update; cash drains on `advance_turn`; cash floors at 0
- Still visual-only: funding, exit, product launch revenue, civic-reg, morale, Firecrawl

### Phase 3 — First civic feedback loop (P0) — landed (PR #15)
- `budgetHeadroom = clamp(1 - taxRate)`; `hypeBias = (budgetHeadroom - 0.75) * 0.2` → company hype
- Diagram + Dashboard show civic metric and hype consequence; Slice 1 burn baselines preserved
- `civic-infra` readout of headroom only (not a full second lever)

### Phase 4 — Connect civic ↔ business pathways (P0-5) — landed (PR #16)
- Typed rule registry in `src/pathways.js` (`pathway.budgetHeadroom→company.hype`)
- Engine executes the rule on `set_tax`; `previewPathway` + TurnResult explanation
- Diagram edge `ecivic-hype` derived from the registry (graph = view of the rule)

### Phase 5 — Campaign turn ledger / replay (P1-1) — landed (PR #17)
- Append-only ledger: command, applied effects, before/after metrics, explanations, turn/seq
- Dual path: offline engine shaping + `GET /api/campaigns/{id}/turns` (turn_commits)
- Dashboard Turn ledger panel; chart 24-month buffer remains display-only
- OpenAPI **0.8.3**

### Phase 6 — Real-world event pipeline (P1-2) — landed (PR #18)
- Observation → interpretation → validated TRIGGER_CONTRACT effect with provenance
- Lifecycle: discovered/normalized → pending/active → expired|cleared; supersession without compounding
- Fixture adapter (`civic-wage-bulletin`) + http_stub plug-in point; `POST /api/triggers/ingest`
- OpenAPI **0.8.4**

### Phase 7 — Executable causal graph (P1-3) — landed (PR #19)
- `CAUSAL_RULES` in `src/causalGraph.js` extends pathway registry; React Flow edges from registry
- Effect keys (`src/effectKeys.js`) are the allow-list; unknown keys rejected at apply/preview
- Tax→burn + pathway + talentCost edges are views of registered rules

### Phase 8 — Campaign-loop acceptance suite (P1-4) — landed (PR #20)
- Deterministic action → applied event → turn → metrics → explanation → reload
- Suite: `src/campaignLoop.acceptance.test.js` (offline + ledger dual-path; live Postgres covered by `npm run test:api` / CI `test-api`)

### Phase 9 — Political survival / objectives (P1-5) — landed (PR #21)
- `voterSupport = 0.5*budgetHeadroom + 0.5*company.hype`; floor **0.25** on `advance_turn` → `ousted` / `incumbent`
- `GameState.politics` + Dashboard readout; OpenAPI **0.8.5**; Slice 1/2 burns unchanged

### Wave 2 — calendar-driven ingest path — **complete** (`main` @ `3420879`)

Locked path shipped: CIT-68 (#23) → CIT-67 (#24) → calendar reducer CIT-79 (#25) → 006 nest CIT-80 (#26) → CIT-69 restack (#27) → 007 meetings + `:12` due-row CIT-81 (#28).

Sign-offs held: MV council alone; minutes outside 60d stay closed; statutory tax fixtures stay on talentCost/hype.

Migrations on `main`: **`001`–`007`**. OpenAPI tip **0.8.9** (this PR; Wave 2 base **0.8.8**).

#### Phase 10 — ingest_runs audit (CIT-68) — landed (PR #23)
- Migration `005_ingest_runs.sql`; every `ingestAndPersist` writes a run row
- Validation failure → `status=error` (not success); `GET /api/ingest/runs?limit=`
- OpenAPI **0.8.6**; fixture burn **2376** / clear **2200**; `adapter: firecrawl` rejected

#### Phase 11 — fixture ingest:once (CIT-67) — landed (PR #24)
- `npm run ingest:once` → `ingestAndPersist` fixture path; default `civic-wage-bulletin`
- Env `INGEST_FIXTURE_ID`; stdout `changed=true|false`; reuses 005 `ingest_runs`

#### Phase 12 — three-phase calendar reducer (CIT-79) — landed (PR #25)
- Pure `(row, now, signal) → row` in `src/calendar/`; MV council fixtures + frozen `now`
- State machine A/B/C; 60d horizon stays closed; wage publication Phase C at `observedAt`

#### Phase 13 — jurisdiction nest (CIT-80) — landed (PR #26)
- Migration `006_jurisdiction_nest.sql`: jurisdictions seed + home/trigger FKs + wage→`mv` backfill
- Chain filter helper before restack (JS + SQL CTE); peers fail closed

#### Phase 14 — campaign restack after ingest (CIT-69) — landed (PR #27)
- Optional `campaignId` on ingest CLI/HTTP (default off); nest filter + tier sort before `commitTurn`
- `changed=false` / zero triggers → no restack; failed restack → ingest_runs error, triggers kept
- OpenAPI **0.8.7**

#### Phase 15 — scheduled meetings + due-row sweep (CIT-81) — landed (PR #28 @ `3420879`)
- Migration `007_scheduled_meetings.sql` + `ingest_runs.scheduled_meeting_id`
- Phase A MV council fixture seed; due-row sweep + pure calendar reducer + fixture signals
- Actions weekly Phase A + twice-daily `:12` due sweep + `workflow_dispatch`; OpenAPI **0.8.8**
- Restack only when Phase C publication trigger `changed=true`; 60d unchanged stays closed

## Next Highest-Priority Phases
### Phase 16 — companies peer read-model filter (CIT-95) — landed PR #30 @ `3d8182d`
- Nest filter on `recomputeCompanies` (home `mv` + ancestors; NULL fail-closed; Sunnyvale ≠ mv)
- `createTrigger` stamps jurisdiction (wage→`mv`, else home) when 006 present; reuse nest helpers; no new migration
- Locks: peer excluded from companies talent/hype; ancestors stack; burns **2376** / clear **2200**; firecrawl rejected; restack path still correct
- OpenAPI unchanged

### Phase 17 — minutes→gameplay vertical (CIT-101) — landed PR #31 @ `41cb40e`
- Library minutes pack + due-sweep Phase C → `ingestAndPersist` (not pointer-only)
- `ingest_runs` + optional one-campaign restack when `changed=true`; idempotent id+timestamp
- Nest/peer locks; Final+null / agenda / wage 2376 / clear 2200 / firecrawl / 60d regressions
- Dampening go/no-go **NO-GO** (no production formula change); no new migration

### Phase 18 — allowlisted live fetch (CIT-107) — landed PR #32 @ `3ca2b13`
- Git allowlist: one host `mountainview.legistar.com` (catalog URLs SOT)
- Actions `allowlisted` job fetches **outside API** (recorded default; `--live` opt-in) → same three-phase reducer
- Minutes recorded body → `http_stub` ingestAndPersist (201 sync write); blocked/empty → `changed=false` (no delete)
- CI network-off recorded bodies; `adapter: firecrawl` stays rejected; burns **2376** / clear **2200**; peers unbound; 60d closed
- OpenAPI unchanged (no new adapter enum); dampening formula untouched

### Phase 19 — role select + company ops UI (CIT-113) — landed (PR #33 @ `31b06a2`)
- Approach A dual islands: role select entry (**company ops** | **campaign**); role is a lens on the same backend
- Persist role in `localStorage` (`citizen.playerRole`) + echo `playerRole` on campaign `state_json` (no migration)
- Company ops desk: tax budget + hire requisition forms → TurnCommands; talent/hype/clamp; campaign-authority cash/burn chart; employee roster from real hire; Hire-only node 3
- Campaign island enter-path stub: diagram + TriggerPanel + ledger/politics + `CAUSAL_RULES` registry list

### Phase 20 — campaign causal UI vertical (CIT-114) — landed (PR #34 @ `80169ab`)
- Coherent **Campaign desk**: politics meter (`voterSupport` + survivalFloor **0.25**), causal hub from real `CAUSAL_RULES` (green/red influence; hub = `company.burnRate`), TriggerPanel, turn ledger, ingest runs
- Bind `GET /api/ingest/runs` via `listIngestRuns`; minutes via `scheduledMeetingId` on real rows only
- Role switch company↔campaign preserves `citizen.playerRole`

### Phase 21 — nest explorer + council calendar (CIT-116 / Wave 1b) — this PR
- OpenAPI **0.8.9** read GETs: `/api/jurisdictions?home=` (default `mv`) nest projection — ancestor chain `bindsHome=true`, same-parent peers `bindsHome=false` (sunnyvale fail closed); `/api/scheduled-meetings` lists persisted rows only (optional `limit` / `jurisdictionId` / `asOf` due annotation). No meeting invent/writes.
- Campaign desk modular panels: `NestExplorer` + `CouncilCalendarPanel`; company ops hint only. Offline = honest stubs.
- Locks: role lens; burns **2000/2200/2800** + **2376**/clear **2200**; TRIGGER_CONTRACT hype+talentCost; firecrawl rejected.

**Done-when (stop when green):** Nest peers-don’t-bind + meetings list bound on campaign island; OpenAPI **0.8.9**; API + UI tests; `npm test` green; no fake calendar / inventory / Gantt / HNSW / Convex / AI Judge / Firecrawl.

### Backlog (eligible — not started; await direction)
- Formula dampening Adapt (**only if** SOT reopen bar fails — currently **NO-GO**)
- HNSW / embeddings
- Firecrawl product path / AI Judge (stay rejected)
- Company registration write / inventory / Gantt / demographic popularity

### Phase 2 continued — Complete business lifecycle (P0)
- Product development, launch, funding, runway, exit as real mechanics
- Separate employee productivity from cost
- Acceptance: player can form company → hire → build → launch → see revenue or insolvency

## Definition of Done (Wave 2 — met on `main` @ `3420879`)
007 schema + due-row sweep + Phase A seed; ingest_runs linked; Actions `:12` + dispatch; agenda-seen/empty/blocked → changed=false no commitTurn; publication Phase C may restack; 60d closed; burns 2376/clear 2200; firecrawl rejected; peers unbound; `npm test` green.

## Open items
- A1: resolved. Axe is 0 on 5f4f021.
- P2-M1 (info): the down migration only reverts 003/002, so a full re-run after rollback fails at 001. (004–007 add down sections.)
- P1-4: live Postgres campaign reload still gated on `npm run test:api` when DB available.
- CIT-81 pointer-only minutes gap closed by CIT-101 (this PR).

Last updated: 2026-10-29, CIT-116 nest + council calendar (this PR); main tip `80169ab` (#34 campaign causal).

---

## Merge record — 2026-10-30 (appended)

main tip: **`ca926681bfc3915ef6b1953e5dd9c913260f21c5`** (`ca92668`), "*fix(ui): no silent local fallback when a campaign commit fails (#41)*", authored 2026-10-30 09:30 PDT, single parent `5d9eeb4`, GitHub-verified. **Open PRs: none.**

| PR | State | Landing commit on `main` | Head | Files |
| --- | --- | --- | --- | --- |
| #36 — torn campaign restack check (product code unchanged) | MERGED | `51ce1db` | `8d53ff0` | 8 |
| #37 — restack as one locked transaction + `compensate_torn_month` (squash) | MERGED | `e8390cd` | `4e5718f` | 19 |
| #38 — model checks + fixes (stacked on `fix/atomic-restack`) | **CLOSED, not merged — superseded by #40** | — | `e6d8d31` | 15 |
| #40 — trigger nest/effect-math model checks, rebased on `main` | MERGED | `5d9eeb4` | `4846fba` | 15 |
| #41 — no silent local fallback when a campaign commit fails | MERGED | `ca92668` | `e9680b4` | 20 |

Merge order held: #36 → #37 (squash of the atomic restack) → #40 (retargeted to `main` as `check/trigger-math-v2` after the squash) → #41 (rebased to `*-v2`). #38's API object carries a non-null `merge_commit_sha` (`65f0dc7`) even though `merged=false`; that commit does not exist on `main`. Read `merged`/`merged_at`, not `merge_commit_sha`.

CI on `ca92668`: **success** — run `41090467945` (workflow `CI`, run #90), jobs `build` and `test-api` both `success`.

### Post-merge regression on `ca92668` — PASS

Trace **`diag-20261030-23d25c95`**, `diag-kb v1.1.0`. Clean local checkout of `ca92668`, Node 22.23.4, local Postgres 17 over the unix socket, scratch DBs only (no remote DB). Logs: `/workspace/grace/probes/citizen-main-ca92668/`. Baseline: `/workspace/grace/baselines/citizen-main-ca92668.json`.

| Command | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run build` | exit 0 (`assets/index-9zjuXizP.js`) |
| `npm test` | node unit **87/87**, vitest **287 passed \| 1 skipped** (28 files) — exit 0 |
| `npm run test:api` | **63/63** — exit 0 |
| `npm run check:restack` | **10/10** — exit 0 |
| `npm run check:model` | **21/21** — exit 0 |
| Playwright `e2e/ux-smokes.spec.js` + `e2e/world-events.spec.js` | **6 passed** (8.3 s), `--workers=1` — exit 0 |

Every number matches Brainiac's corroborating invariants run on the same SHA; no discrepancy. Both runs are listed here because one alone is not proof — the two agree suite by suite.

Invariants re-checked independently (sim in-process, live API on a scratch DB, and the browser build):

- Slice 1 unchanged: init 15000 / burn 2000 / tax 0.25; tick 1 → 14817 / 2200; fresh at 30 % → 14813 / 2240; tick then 100 % → 14583 / 2800. Browser: 15000 → 14817 with burn 2200; tax slider 0 / 0.25 / 1 → burn (and base) 2000 / 2200 / 2800 in both lenses.
- No employees: burn **2000 / 2200 / 2800** at tax 0 / 0.25 / 1.
- Skill-1 person: **tech 1.75**, **marketing 1.47**, **sales 1.33**.
- Clamp 0.1×–3×: raw ratio 0 → factor 0.1, talent cost 0, burn 220 (flagged); ratio 3 → factor 3, talent cost 12000, burn 6600 (not flagged); **exactly 0.1 and exactly 3 are not flagged**; 0.09999 and 3.0003 are.
- Fixture wage bulletin: burn **2376**, factor 1.08, clear → **2200**; the campaign path bills 2376 (cash 15000 → 14802) and 2200 after clear.
- Authority boundary: a `companies` row poisoned to cash 777777 / burn_rate 9999 is never copied onto the client sim — the UI still shows 15000 / 2200 and advances to 14817.
- #41's fix holds in the built app: with `POST /turns` forced to 500 the screen stays at 15000 / 2200 with a `role="alert"` "turn was not saved" message, no local re-run and no extra commit; a second Advance is blocked with "Retry it before playing another turn"; Retry after the server recovers lands on 14817 / 2200.

## Open items (appended 2026-10-30)

- **PoliticsMeter accessible name — `aria-meter-name` (serious).** `src/components/PoliticsMeter.jsx` renders `role="meter"` with `aria-valuemin/max/now/valuetext` and **no accessible name** (`aria-label` / `aria-labelledby` / `title` are all absent; the parent `<section>`'s `aria-labelledby` does not name the meter). axe-core 4.14.0 with WCAG 2.2 AA tags reports one violation on `.politics-meter__bar` (`data-testid="politics-voter-support-meter"`) on the campaign desk, in both the local and API builds; the company-ops lens is clean. **Pre-existing, introduced by PR #34 (`80169ab`), not a regression from #36/#37/#40/#41.** CI does not catch it: `e2e/world-events.spec.js` runs axe only with `withRules(['label-content-name-mismatch'])` over `.trigger-panel` / `.data-source`. **Owner: Brainiac** (follow-up PR offered). Consequence: the earlier note "A1: resolved. Axe is 0 on 5f4f021" is true only for the pages/rules measured at that time and must not be read as a repo-wide axe-zero claim.
- Model checks now need Postgres: `check:model` runs every `test/model/*.api.js`, including the restack atomicity file. Both `check:restack` and `check:model` are outside `npm test` and `npm run test:api`, so a green CI run does not prove them — run both against a local DB.
- Carried: `migrations/001` still has no down section, so a full re-up after a full down fails at 001.

Last updated: 2026-10-30, post-merge regression on `ca92668` (#36/#37/#40/#41; #38 closed as superseded) — PASS, trace `diag-20261030-23d25c95` (`diag-kb v1.1.0`); main tip `ca92668`.


---

## Merge record — #42 (appended 2026-10-30)

`main` tip: **`a9c6c53e5edab71b913625d0c2cb9a1641870a76`** (`a9c6c53`), "*fix(a11y): name the voter support meter for WCAG 2.2 AA (#42)*", authored by **TayDa64**, single parent `3f9f473` (the STATE.md commit). GitHub-verified as the real branch head of `main`. **Open PRs: none.**

| PR | State | Landing commit on `main` | Head | Files |
| --- | --- | --- | --- | --- |
| #42 — PoliticsMeter accessible name (`aria-meter-name`) | **MERGED (squash)** | `a9c6c53` | `425cf22` | 5 |

Squash diff `3f9f473..a9c6c53`: `src/components/PoliticsMeter.jsx` (+2/−1 — adds `aria-labelledby="politics-voter-support-label"` to the `role="meter"` bar and `id="politics-voter-support-label"` to the existing visible `<dt>Voter support</dt>`), new `src/components/PoliticsMeter.test.jsx` (3 tests), new `e2e/a11y.spec.js` (2 tests, incl. a full-page WCAG 2.2 AA scan), `package.json` +1 (`axe-core` devDependency) and `package-lock.json` +1. No simulation, turn, restack, migration or API file touched.

CI on `a9c6c53`: **success** — run `41094841046` (workflow `CI`, `push` event), jobs `build` and `test-api` both `success`. Note the two jobs CI actually runs are `npm ci` + `npm run build` + `npm test` (build job) and `npm run test:api` (test-api job); CI does **not** run Playwright, `check:restack` or `check:model`.

### Post-merge regression on `a9c6c53` — PASS

Trace **`diag-20261030-3d44e700`**, `diag-kb v1.1.0`. Clean local checkout of `a9c6c53`, Node 22.23.4, local Postgres 17.11 over the unix socket, scratch DBs only (no remote DB). Every suite was run **strictly sequentially** — no concurrent `test:api`, because the known throwaway-db race (trace `diag-20261030-60e4dc88`) makes parallel runs unreliable. Probes: `/workspace/grace/probes/citizen-main-a9c6c53/`. Baseline: `/workspace/grace/baselines/citizen-main-a9c6c53.json`.

| Command | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run build` | exit 0 (`assets/index-zUttogV3.js`; chunk-size warning only, pre-existing) |
| `npm test` → `test:unit` | **87/87** (69 subtests, 3 suites) — exit 0 |
| `npm test` → `test:ui` | **290 passed \| 1 skipped** (29 files, 291) — exit 0 |
| `npm run test:api` | **63/63** (17 suites) — exit 0 |
| `npm run check:restack` | **10/10** (3 suites) — exit 0 |
| `npm run check:model` | **21/21** (4 suites) — exit 0 |
| `npx playwright test` (full suite) | **8 passed \| 1 skipped** (9 total, the `CITIZEN_API_E2E`-gated `e2e/api-contract.spec.js`) — exit 0 |

Every count matches the expected figures exactly; **no discrepancy**. A teammate's post-merge invariants pass was reported on this SHA; it is recorded here only as **corroboration** — the numbers below were re-derived independently rather than taken from that report.

**`e2e/a11y.spec.js` ran on `main` itself and passed: 2/2** — `voter support meter exposes an accessible name` and `default page has no WCAG 2.2 AA violations`. This is the first `main` tip on which the full-page WCAG 2.2 AA scan actually executes; it is **not** run by CI (see open item (a)), so it only gates when someone runs Playwright locally.

Axe re-verified independently (full page, campaign lens, tags `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`/`wcag22aa`), the before/after the fix was meant to produce:

- `ca92668` (without the fix): **1 violation** — `aria-meter-name`, impact **serious**, target `.politics-meter__bar`.
- `a9c6c53` (with the fix): **0 violations**, and the meter's computed accessible name resolves to **"Voter support"** (`getByRole('meter', { name: 'Voter support' })` matches exactly 1). Company-ops lens: 0 violations, 0 meters. Exactly one `politics-voter-support-label` id can exist per lens and no duplicate ids exist on either rendered page. Rendering is **pixel-identical** to the pre-merge PR build (same full-page screenshot MD5 `7c29d2162c2035b18cf2aa7b79f8ed78`, same bundle hash).

Invariants re-checked independently on `a9c6c53` (sim in-process; **0 of 82** scalar values differ from the `ca92668` baseline):

- No employees: burn exactly **2000 / 2200 / 2800** at tax **0 / 0.25 / 1**.
- Skill-1 person (one employee): **tech 1.75**, **marketing 1.47**, **sales 1.33**. (Consistent with the `DEPARTMENT_WEIGHTS` of 1.25 / 1.05 / 0.95 in the invariants list above: those weights are multiplied by `skillFactor(1) = 1.4`, giving 1.75 / 1.47 / 1.33.)
- Clamp 0.1×–3×: raw ratio 0.09999 → factor 0.1, **flagged**; raw ratio 3.0003 → factor 3, **flagged**; **exactly 0.1 and exactly 3 are not flagged**.
- Fixture wage bulletin: burn **2376**, clear → **2200**.
- Authority boundary: a `companies` payload carrying cash 999999 / burnRate 123456 is **never copied** onto the client sim — the client keeps its own 15000 / 2000 (stored base burn) and only takes hype/talentCost from the API; `dataSource` becomes `api`. Backed by four passing `authority boundary` tests in `src/simulation.test.js` and `src/apiMode.test.jsx`.
- Slice 1 tax-to-burn base formula unchanged.

### Open item status (appended 2026-10-30, post-#42)

- **RESOLVED on `main` at `a9c6c53` — PoliticsMeter accessible name (`aria-meter-name`, serious).** The original item recorded earlier in this file under "Open items (appended 2026-10-30)" is **kept as written and not deleted**; this line records its disposition. PR #42 (squash `a9c6c53`, head `425cf22`, merged by TayDa64, CI run `41094841046` green) added `aria-labelledby="politics-voter-support-label"` to the meter and `id="politics-voter-support-label"` to the existing visible `<dt>Voter support</dt>`, so the meter now takes its name from visible on-screen text. Verified independently on `a9c6c53`: full-page WCAG 2.2 AA scan is **0 violations** (was 1), the accessible name resolves to **"Voter support"**, and `e2e/a11y.spec.js` passes on `main` (2/2). The original owner (Brainiac) no longer needs a follow-up PR.

Live follow-ups still open after #42:

- **(a) The full-page WCAG scan is still local-only.** `e2e/a11y.spec.js` now gates `main` only when someone runs `npx playwright test` by hand, because **CI does not run Playwright at all** — the `CI` workflow has just two jobs, `build` (`npm ci` + `npm run build` + `npm test`) and `test-api` (`npm run test:api`). So a PR can introduce a WCAG violation and still show green CI. Closing this needs a CI job that runs Playwright (ideally `npm run test:browser`, keeping Playwright's own `webServer` build+preview so API-mode config still mirrors CI). Unowned.
- **(b) Throwaway-db race in `test/api/throwaway-db.js`.** Trace **`diag-20261030-60e4dc88`**, `diag-kb v1.1.0`. `close()` does `await pool.end()` and then `DROP DATABASE ... WITH (FORCE)`, but pg-pool 3.14.0's `Pool.end()` resolves before the client sockets have actually closed (`_remove()` filters `_clients` synchronously, so `_endCallback` fires early) — measured: the socket is still open when `end()` resolves in 100/100 trials, median 1.7 ms, max 3.2 ms. The FORCE drop then intermittently SIGTERMs a backend still being closed (2 hits in 930 drops), and because the helper registers no pool `'error'` listener, `makeIdleListener`'s `pool.emit('error', err)` has no handler, so the recoverable `terminating connection due to administrator command` becomes an **uncaughtException** that aborts a whole test file. Pre-existing on pristine `ca92668`; sequential runs are safe (3/3 clean, and 63/63 on every sequential invocation here); it only bites at ~3× concurrency (~27 % of runs measured, 4 failing runs / 15). Not caused by concurrent runs colliding — the DB name embeds the creating pid, so no two runs ever share a database. **Unowned.**

Last updated: 2026-10-30, post-merge regression on `a9c6c53` (#42 squash-merged on top of `3f9f473`; #36/#37/#40/#41 recorded earlier) — PASS, trace `diag-20261030-3d44e700` (`diag-kb v1.1.0`); main tip `a9c6c53`.
