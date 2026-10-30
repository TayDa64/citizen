---
name: citizen-campaign-restack
description: Use when a change touches the campaign restack after an ingest — server/campaignRestack.js, the ingest call in server/eventIngest.js, commitTurn in server/campaigns.js, or the clear/apply loop in src/turnCommands.js — to check that a campaign never sits with a half-replaced trigger stack.
---

# Campaign restack: one stack at a time

## The promise, and the harm

**Promise:** a campaign's world events are always either exactly the stack it had before an ingest or exactly the stack the ingest selected. Never a mix, never empty.

**Harm when it breaks:** the campaign silently plays on with no world events (or half of them). Burn, talent cost, hype and voter support all move to the wrong values, and every month advanced in that state is billed wrongly until someone notices.

## History: the finding this skill was built from

Confirmed on `main` at `0a7b22a` and still live at `51ce1db`; fixed at `b4b85d2`.

`restackCampaignTriggers()` used to send `[clear_triggers, apply_trigger x N]` through separate `commitTurn()` calls, each its own `BEGIN … COMMIT`. Between the first and the last commit the campaign held `[]` or a partial stack, visible to readers and to a concurrent `advance_turn`. A crash, lost connection or rejected trigger in that window left the campaign with no world events: burn 2376 → 2200, talent cost back to 4000, and a month advanced there was billed at 2200 and never corrected. `ingestAndPersist()` recorded `ingest_runs.status='error'` and did not repair, and a re-run with `changed=false` did nothing. Two restacks could also interleave (clear, clear, apply, apply), and each read its trigger list before taking any lock, so a slow restack could put back an older selection over a newer one.

The fix:

- `restackCampaignTriggers()` runs inside `withCampaignTransaction()` (`server/campaigns.js`): `BEGIN`, lock the campaign row (`SELECT … FOR UPDATE`, the same lock `commitTurn` takes), read the live triggers, then every `clear_triggers` / `apply_trigger` through `commitTurnOnClient()` — still one `turn_commits` row per command — then `COMMIT`. Any throw rolls all of it back.
- A concurrent `advance_turn` or second restack waits on the row lock, so it lands before or after the whole restack.
- After the applies, `findTornMonths()` appends one ledger-only `compensate_torn_month` per month that the old loop let bill on a torn stack (see below).

## Compensating a month already billed

Evidence, because `clear_triggers` alone is not enough: the client restacks before every advance with its own `clear_triggers` + `apply_trigger` commits, and a player can clear on purpose. Only an `ingest_runs` row that names this campaign as its restack target (`status='success'` with `result_json.restack.campaignId`, or `status='error'` with `restackFailed` and `campaignId`) proves a clear came from the server restack. Its restack commits are the `clear_triggers` / `apply_trigger` rows created between `started_at` and `finished_at`.

A month is torn when an `advance_turn` lands after that clear and

- before the run's last apply (successful run), or
- before the next stack change by anyone (failed run),

and the stack it billed on differs from the stack before the clear. The correct bill is that old stack: an atomic restack either had not started or, when it failed, kept it. `fullBurn` comes from replaying the turn engine on the `result_json.view` recorded before the month, with the old stack put back from its own `apply_trigger` commands; when that replay cannot reproduce the billed burn exactly, the month is skipped rather than guessed.

The entry is `{type:'compensate_torn_month', sourceSeq, month, billedBurn, fullBurn}`; cash moves by `(fullBurn - billedBurn) / 12` and nothing else changes. It is idempotent by `sourceSeq` and runs inside the restack transaction under the row lock, so two restacks never both charge. The billed month's own row is never rewritten. `POST /api/campaigns/{id}/turns` rejects the type with 400. Not covered: a restack that died without writing an `ingest_runs` row (process killed), and a database clock far from the app clock.

## Run the check

Requires Node 22 (`.nvmrc`) and a local Postgres on the unix socket, the same setup `test/api/*.api.js` uses.

```sh
npm run check:restack
```

runs `test/model/campaign-restack-atomicity.api.js` plus `test/api/campaign-restack-race.api.js` and `test/api/campaign-restack-compensation.api.js`. The last two also run in `npm run test:api`. Shared setup is `test/model/restack-fixture.js`.

## Read a result

- **All pass** — the restack is one locked transaction and torn months are compensated.
- **Atomicity: trigger count 0 or burn 2200 after the failed rebuild** — the restack commits per command again.
- **Race: month billed at 2200, or ledger `clear, clear, apply, apply`** — an advance or a second restack ran inside the window. The message says whether the competitor finished (`done`) or waited (`blocked`).
- **Race: older selection survives** — the restack reads its trigger list before taking the row lock.
- **Compensation: cash off by 176/12, or two `compensate_torn_month` rows** — detection or idempotency is broken.

Against `51ce1db`'s server code, all three race tests and both atomicity tests fail this way.

For the model, read results with the pstack `/statechart` skill. Point it at `spec/CitizenRestack.tla`, `spec/CitizenRestack.cfg` and `spec/view.ts` here. Do not copy `/statechart`'s command line into this file; that invocation changes between releases. `spec/chart.mmd` and `spec/report.md` are from the last run.

## The model

`spec/CitizenRestack.tla` models the restack as the code does it now, with two ingests that can race. Variables: `stack` (the campaign's world events), `live` (triggers stored by ingests), `pc` (each ingest's progress) and `monthOnTorn`.

| Action | Code it stands for |
| --- | --- |
| `Persist(i)` | `ingestAndPersist()` storing a changed document via `createTrigger`, outside any campaign lock |
| `Rebuild(i)` | the whole `withCampaignTransaction` in `restackCampaignTriggers()`: lock, read live triggers, clear + apply, commit; then `insertIngestRun(status='success')` |
| `Fail(i)` | any throw inside that transaction: rollback, stack untouched, `ingest_runs status='error'` |
| `AdvanceTurn` | `commitTurn({type:'advance_turn'})`, which waits for the same row lock |

Rules:

- `AtomicRestack` — the stack is always `Old` or a full selection of live triggers.
- `OkMeansFull` — an ingest reported `success` has all its triggers on the campaign.
- `NoMonthOnTornStack` — no month is committed on a stack that is neither.
- `NewestStackWins` — once both ingests restacked, the campaign holds both documents.

TLC explores 20 states and 54 steps; all four hold. They are not vacuous: splitting `Rebuild` back into a clear step and an apply step breaks `AtomicRestack`, `NoMonthOnTornStack` and `OkMeansFull`; reading the selection at `Persist` time instead of under the lock breaks `NewestStackWins` and `OkMeansFull`. Those variants are not kept here; recreate them with `/statechart`.

## What this does not cover

- The nest filter and tier sort that decide which triggers go into a selection (`src/jurisdictionNest.js`, `nestTriggersForRestack`). The model takes each document's selection as given. Checked by `citizen-trigger-math`; the restack reads the chain from the `jurisdictions` table inside the same locked transaction.
- Trigger effects — burn arithmetic, the 0.1×–3× clamp, the type-weighted multiplier. Covered by `src/talentMultiplier.js` readers, `src/turnEngine.test.js` and `test/api/talent-burn.api.js`; the arithmetic promises are checked by `citizen-trigger-math`.
- The `dispatchTurnCommands` fallback in `src/turnCommands.js`, which swallows a failed commit and re-runs the commands locally. The client's own restack-before-advance is still one HTTP commit per command, so it can still be torn on the client side; the server lock only keeps a server restack from landing inside one of its commits.
- Compensation is not in the model; it is checked against Postgres only.

## Keeping it in step

**Covered code, last confirmed at `b4b85d20e3c03083defef2ea8e26c02fe0930276`:**

| File | Functions |
| --- | --- |
| `server/campaignRestack.js` | `restackCampaignTriggers`, `findTornMonths`, `buildServerRestackCommands`, `shouldRestackAfterIngest`, `applicableTriggersForCampaign` |
| `server/eventIngest.js` | `ingestAndPersist` (the `shouldRestackAfterIngest` block and its catch), `insertIngestRun` |
| `server/campaigns.js` | `withCampaignTransaction`, `lockCampaign`, `commitTurnOnClient`, `commitTurn`, `listTurnCommits` |
| `src/turnEngine.js` | `parseTurnCommand` / `applyCommandMutation` for `compensate_torn_month` |
| `src/turnCommands.js` | `buildTriggerRestackCommands`, `commandsWithTriggerRestack`, `dispatchTurnCommands` |

When any of these change, treat the model as out of date until you have re-read them and confirmed each action still maps to one step. Then move the sync commit above forward. Move it only after you have run the check and read the result with `/statechart` — not because the files changed.
