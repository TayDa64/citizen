# Citizen — State & Order of Operations

## Current Merge Sequence (do not skip)
1. PR #3 — CI / Node 22 — MERGED (d47559c)
2. PR #1 — Frontend triggers — MERGED (7ea00f0, head 107d8fd, trace diag-20261026-04496e36)
3. PR #4 — API wiring — MERGED (eb02b8b, head 793b7e0, trace diag-20261026-ebca9b87)
4. PR #5 — Type-weighted talent multiplier + clamp — MERGED (d0fbbad, head a93f3ac, trace diag-20261026-c6e15877)
5. PR #2 — Backend-only (drop duplicate UI files) — MERGED (69898fc, head 2715fe6, trace diag-20261026-19a92410)
6. PR #6 — Talent multiplier backend + 0.1×–3× clamp — MERGED (5f4f021, head e4bceaa, OpenAPI 0.7.1, trace diag-20261026-512e6d27)

Sequence complete. Post-merge regression on main 5f4f021: PASS (trace diag-20261026-8e1cd230), CI green.

Later merges: PR #7 Slice 2 checklist; PR #8 authority boundary; PR #9–#11 UI/Playwright; PR #12 authoritative turns; PR #13 campaign↔trigger coherence; PR #14 business lifecycle hire; PR #15 civic feedback; PR #16 connect pathways; PR #17 turn ledger; PR #18 real-world pipeline; PR #19 causal graph; PR #20 campaign acceptance; PR #21 political objectives; PR #22 test:api harness; **Wave 2** PR #23–#28 (ingest_runs → meetings + `:12`); peer #30; minutes #31; allowlisted live fetch #32; CIT-113 role select + company ops #33 @ `31b06a2`; CIT-114 campaign causal UI (this PR).

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

Migrations on `main`: **`001`–`007`**. OpenAPI **0.8.8**.

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

### Phase 20 — campaign causal UI vertical (CIT-114) — this PR
- Coherent **Campaign desk**: politics meter (`voterSupport` + survivalFloor **0.25**), causal hub from real `CAUSAL_RULES` (green/red influence; hub = `company.burnRate`), TriggerPanel, turn ledger, ingest runs
- Bind `GET /api/ingest/runs` via `listIngestRuns`; minutes via `scheduledMeetingId` on real rows only (no nest/calendar GET)
- Role switch company↔campaign preserves `citizen.playerRole`
- Out of scope: nest/calendar GET UI, company ops rewrite, HNSW, Convex, AI Judge, Firecrawl, fake demographics/inventory/Gantt

**Done-when (stop when green):** Campaign desk coherent; causal edges from registry with polarity; politics floor visible; ingest bound or honest offline stub; lens persistence; burns **2376** / clear **2200** + Slice tax locks untouched; firecrawl rejected; `npm test` green; no OpenAPI/TRIGGER_CONTRACT/Slice burn changes unless read-only already in schema.

### Backlog (eligible — not started; await direction)
- Nest / calendar GET UI (Wave 1b — needs thin read APIs)
- Formula dampening Adapt (**only if** SOT reopen bar fails — currently **NO-GO**)
- HNSW / embeddings
- Firecrawl product path / AI Judge (stay rejected)

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

Last updated: 2026-10-29, CIT-114 campaign causal UI (this PR); main tip `31b06a2` (#33 role + company ops).
