---
name: citizen-campaign-restack
description: Use when a change touches the campaign restack after an ingest — server/campaignRestack.js, the ingest call in server/eventIngest.js, commitTurn in server/campaigns.js, or the clear/apply loop in src/turnCommands.js — to check that a campaign never sits with a half-replaced trigger stack.
---

# Campaign restack: one stack at a time

## The promise, and the harm

**Promise:** a campaign's world events are always either exactly the stack it had before an ingest or exactly the stack the ingest selected. Never a mix, never empty.

**Harm when it breaks:** the campaign silently plays on with no world events (or half of them). Burn, talent cost, hype and voter support all move to the wrong values, and every month advanced in that state is billed wrongly until someone notices.

## The finding this skill was built from

Confirmed on `main` at `0a7b22abc2cc8db0ee678d0e2d5eee66ed1a4172` (`0a7b22a`). The per-commit loop has been the CIT-69 restack since it landed, and it is unchanged at that commit. This skill does not fix it.

`restackCampaignTriggers()` (`server/campaignRestack.js`) builds `[clear_triggers, apply_trigger x N]` and sends each command through its own `commitTurn()` — its own `BEGIN … COMMIT` in `server/campaigns.js`. Between the first and the last commit the campaign's `activeTriggers` is `[]` or partial. That window is visible to any reader and to any concurrent `advance_turn`. `ingestAndPersist()` (`server/eventIngest.js`) catches a throw from that loop, writes an `ingest_runs` row with `status='error'`, and leaves the campaign as it is.

A crash, a lost connection, a timeout, a deploy, or one rejected trigger in the middle therefore leaves the campaign with no world events and no repair path. A re-run of the same ingest does nothing, because `shouldRestackAfterIngest()` returns false when `changed=false`.

Replayed against a real Postgres by `npm run check:restack` (`test/model/campaign-restack-atomicity.api.js`): burn drops 2376 → 2200 and the talent cost falls back to the 4000 baseline. A month advanced in that window is billed at 2200 and is never corrected, even after the wage event is applied again. On that same Postgres, `ingestAndPersist()` writes `ingest_runs.status='error'` for the throw and does not repair the campaign; a second identical ingest returns `changed=false` and leaves the stack empty. That ingest replay is not part of `check:restack`.

## Run the check

Requires Node 22 (`.nvmrc`) and a local Postgres on the unix socket, the same setup `test/api/*.api.js` uses. It does not run as part of `npm test` or `npm run test:api`.

```sh
npm run check:restack
```

which is:

```sh
node --test test/model/campaign-restack-atomicity.api.js
```

Both tests pass while the finding is live: they assert the torn state exists. When someone makes the restack atomic, both fail with `Missing expected rejection.` — that is the signal to rewrite them as the passing form below.

## Read a result

- **Both pass** — the finding is still live. The torn stack is still what the code does.
- **`Missing expected rejection.`** — `restackCampaignTriggers()` no longer throws partway, so the restack was made one commit and the injected second `INSERT INTO turn_commits` never runs. Invert the two tests so they assert the atomic behavior: after a failed restack the stack must equal the one from before, and burn must stay 2376. A month advanced after that failure must bill 2376.
- **An assertion on trigger count, burn, talent cost, or cash fails** — the loop still throws, but the committed state changed. Read that assertion. A one-transaction loop that still inserts once per command fails this way: the throw rolls the whole restack back, so the campaign keeps its old stack.
- **Anything else** — a real change in the code path. Read the assertion that failed.

For the model itself, read the results with the pstack `/statechart` skill. Point it at `spec/CitizenRestack.tla`, `spec/CitizenRestack.cfg`, and `spec/view.ts` in this skill directory. Do not copy `/statechart`'s command line into this file or into a shell snippet here; that invocation changes between releases. The chart from the last run is `spec/chart.mmd` and the report is `spec/report.md`. `/statechart` shows each broken rule as its shortest path in plain words.

## The model

`spec/CitizenRestack.tla` models only the restack, with three variables that matter to the reader: `stack` (which world events the campaign holds), `phase`, and `reported`. `monthOnTorn` records whether a month was advanced on a stack that is neither the old one nor the full new one.

What it treats as one step, and why:

| Action | Code it stands for |
| --- | --- |
| `ClearFirst` | the `clear_triggers` commit in `restackCampaignTriggers()` |
| `ApplyOne(t)` | one `apply_trigger` commit in the same loop |
| `Succeed` | the loop draining, then `insertIngestRun(status='success')` |
| `Fail` | any throw in the loop, caught, `ingest_runs status='error'`, no repair |
| `RerunUnchanged` | `shouldRestackAfterIngest()` false when `changed=false` |
| `AdvanceTurn` | `commitTurn({type:'advance_turn'})`, legal between any two commits |

Rules, and the code each one guards:

- `AtomicRestack` — a steady campaign holds `Old` or `Full`. Guards the whole loop in `restackCampaignTriggers()`.
- `OkMeansFull` — `status='success'` implies the full stack. Guards the `insertIngestRun` call in `eventIngest.js`. Holds today.
- `NoMonthOnTornStack` — no month is committed on a stack that is neither. Guards `commitTurn` plus the concurrent `advance_turn` path.

TLC explores 19 states and 70 steps. `AtomicRestack` and `NoMonthOnTornStack` break. `OkMeansFull` holds. `spec/report.md` has the shortest paths.

The same three rules hold against a variant where the rebuild is one commit that replaces the whole stack. That run is the evidence the rules are not vacuous: they fail on the per-commit loop and pass when the loop is a single commit. The chart for the atomic variant is not kept here; recreate it with `/statechart` by replacing the three rebuild actions with one.

## What this does not cover

- The nest filter and tier sort that decide which triggers go into `Full` (`src/jurisdictionNest.js`, `nestTriggersForRestack`). The model takes `Full` as given.
- Trigger effects — burn arithmetic, the 0.1×–3× clamp, the type-weighted multiplier. Covered by `src/talentMultiplier.js` readers, `src/turnEngine.test.js`, and `test/api/talent-burn.api.js`.
- The `dispatchTurnCommands` fallback in `src/turnCommands.js`, which swallows a failed commit and re-runs the commands locally. A third bug, observed in that catch but not modeled and not executed by `check:restack`: after a torn restack the UI shows the event and the advanced month while the server campaign has neither. Worth its own model. Node API tests cannot import `src/turnCommands.js` (it pulls the Vite extensionless `citizenApi` module).
- Concurrency beyond one restack and one advance. Two simultaneous ingests for one campaign are not modeled.
- Repair of a month that was already billed. The Postgres check shows the cash drain stays at 2200/12 after the event is put back. It does not propose a compensating entry.

## Keeping it in step

**Covered code, last confirmed at `0a7b22abc2cc8db0ee678d0e2d5eee66ed1a4172`:**

| File | Functions |
| --- | --- |
| `server/campaignRestack.js` | `restackCampaignTriggers`, `buildServerRestackCommands`, `shouldRestackAfterIngest`, `applicableTriggersForCampaign` |
| `server/eventIngest.js` | `ingestAndPersist` (the `shouldRestackAfterIngest` block and its catch), `insertIngestRun` |
| `server/campaigns.js` | `commitTurn`, `listTurnCommits` |
| `src/turnCommands.js` | `buildTriggerRestackCommands`, `commandsWithTriggerRestack`, `dispatchTurnCommands` |

When any of these change, treat the model as out of date until you have re-read them and confirmed each action still maps to one step. Then move the sync commit above forward. Move it only after you have run the check and read the result with `/statechart` — not because the files changed.
