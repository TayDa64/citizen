# Citizen — State & Order of Operations

## Current Merge Sequence (do not skip)
1. PR #3 — CI / Node 22 — MERGED (d47559c)
2. PR #1 — Frontend triggers — MERGED (7ea00f0, head 107d8fd, trace diag-20261026-04496e36)
3. PR #4 — API wiring — MERGED (eb02b8b, head 793b7e0, trace diag-20261026-ebca9b87)
4. PR #5 — Type-weighted talent multiplier + clamp — MERGED (d0fbbad, head a93f3ac, trace diag-20261026-c6e15877)
5. PR #2 — Backend-only (drop duplicate UI files) — MERGED (69898fc, head 2715fe6, trace diag-20261026-19a92410)
6. PR #6 — Talent multiplier backend + 0.1×–3× clamp — MERGED (5f4f021, head e4bceaa, OpenAPI 0.7.1, trace diag-20261026-512e6d27)

Sequence complete. Post-merge regression on main 5f4f021: PASS (trace diag-20261026-8e1cd230), CI green.

Later merges: PR #7 Slice 2 checklist; PR #8 authority boundary; PR #9–#11 UI/Playwright; PR #12 authoritative turns; PR #13 campaign↔trigger coherence; PR #14 business lifecycle hire; PR #15 civic feedback; PR #16 connect pathways. Tip: `main` @ `855211f` (PR #16).

**Rule:** Each PR must be green, rebased clean on main, and meet its acceptance criteria before the next is merged. Update this file after every merge.

## Invariants (must hold after every merge)
- No employees + no trigger talent change → burn exactly 2000 / 2200 / 2800 at tax 0 / 0.25 / 1
- Type-weighted employee multiplier (tech 1.25, marketing 1.05, sales 0.95) active
- Trigger talent-cost factor clamped 0.1×–3× and feeds burn
- Slice 1 tax-to-burn base formula unchanged
- Additive only; no breaking changes to existing schema or UI nodes
- GET /api/companies cash/burnRate never copied onto the client sim
- Same seed + TurnCommand sequence → same metrics (turn engine)

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

### Phase 5 — Campaign turn ledger / replay (P1-1) — this PR
- Append-only ledger: command, applied effects, before/after metrics, explanations, turn/seq
- Dual path: offline engine shaping + `GET /api/campaigns/{id}/turns` (turn_commits)
- Dashboard Turn ledger panel; chart 24-month buffer remains display-only
- OpenAPI **0.8.3**

## Next Highest-Priority Phases
### Phase 2 continued — Complete business lifecycle (P0)
- Product development, launch, funding, runway, exit as real mechanics
- Separate employee productivity from cost
- Acceptance: player can form company → hire → build → launch → see revenue or insolvency

### Phase 6 — Real-world event pipeline (P1)
- Separate observation → interpretation → effect
- Event lifecycle (discovered → active → expired)
- Provenance retained
- Acceptance: one live source produces a validated, replayable effect

## Definition of Done for current slice
A player can advance turns and see an append-only ledger of commands / effects / before-after metrics / explanations; reload via `GET .../turns` reproduces the ledger when the API is available; offline tests lock engine→ledger shaping; Slice 1/2 + hire + coherence + civic pathway invariants hold.

## Open items
- A1: resolved. Axe is 0 on 5f4f021.
- P2-M1 (info): the down migration only reverts 003/002, so a full re-run after rollback fails at 001. (004 adds campaigns/turn_commits down.)

Last updated: 2026-10-27, Phase 5 turn ledger off `main` @ `855211f`.
