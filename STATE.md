# Citizen — State & Order of Operations

## Current Merge Sequence (do not skip)
1. PR #3 — CI / Node 22 — MERGED (d47559c)
2. PR #1 — Frontend triggers — MERGED (7ea00f0, head 107d8fd, trace diag-20261026-04496e36)
3. PR #4 — API wiring — MERGED (eb02b8b, head 793b7e0, trace diag-20261026-ebca9b87)
4. PR #5 — Type-weighted talent multiplier + clamp — MERGED (d0fbbad, head a93f3ac, trace diag-20261026-c6e15877)
5. PR #2 — Backend-only (drop duplicate UI files) — MERGED (69898fc, head 2715fe6, trace diag-20261026-19a92410)
6. PR #6 — Talent multiplier backend + 0.1×–3× clamp — MERGED (5f4f021, head e4bceaa, OpenAPI 0.7.1, trace diag-20261026-512e6d27)

Sequence complete. Post-merge regression on main 5f4f021: PASS (trace diag-20261026-8e1cd230), CI green.

**Rule:** Each PR must be green, rebased clean on main, and meet its acceptance criteria before the next is merged. Update this file after every merge.

## Invariants (must hold after every merge)
- No employees + no trigger talent change → burn exactly 2000 / 2200 / 2800 at tax 0 / 0.25 / 1
- Type-weighted employee multiplier (tech 1.25, marketing 1.05, sales 0.95) active
- Trigger talent-cost factor clamped 0.1×–3× and feeds burn
- Slice 1 tax-to-burn base formula unchanged
- Additive only; no breaking changes to existing schema or UI nodes

## Next Highest-Priority Phases (after current sequence lands)
### Phase 1 — Authoritative Game State (P0)
- Versioned GameState, TurnCommand, TurnResult
- Atomic turn commit on the server
- Campaign save/reload/replay with deterministic seed
- Acceptance: reload reproduces last committed state; failed commit leaves no partial state

### Phase 2 — Complete one business lifecycle (P0)
- Hiring, product development, launch, funding, runway, exit as real mechanics
- Separate employee productivity from cost
- Acceptance: player can form company → hire → build → launch → see revenue or insolvency

### Phase 3 — First civic feedback loop (P0)
- Minimal city metrics (budget, employment, infrastructure)
- At least one policy beyond tax that affects the company and feeds back
- Acceptance: policy change → observable business consequence → city metric update

### Phase 4 — Real-world event pipeline (P1)
- Separate observation → interpretation → effect
- Event lifecycle (discovered → active → expired)
- Provenance retained
- Acceptance: one live source produces a validated, replayable effect

## Definition of Done for current slice
A player can change the tax lever, advance months, see type-weighted talent + clamped trigger effects on burn and cash, clear events, reload, and still match the Slice 1 baseline when no employees or triggers are present.

## Open items
- A1: resolved. Axe is 0 on 5f4f021.
- P2-M1 (info): the down migration only reverts 003/002, so a full re-run after rollback fails at 001.

Last updated: 2026-10-27, main `c612958`, merge sequence complete.
