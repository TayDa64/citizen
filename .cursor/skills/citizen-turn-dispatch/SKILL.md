---
name: citizen-turn-dispatch
description: Use when a change touches how the client sends turns to a live campaign — dispatchTurnCommands / retryTurnCommands / commandAlreadyApplied in src/turnCommands.js, commitCommands / onRetryTurn in src/App.jsx, or src/components/TurnSaveAlert.jsx — to check that the screen never shows a month or world event the campaign server did not commit, and that Retry never bills a month twice.
---

# Turn dispatch: the screen shows what the server committed

## The promise, and the harm

**Promise:** when a campaign is server-backed, what the player sees is the state the campaign server last committed, or the screen says it is not (a save is in flight, or the failure alert with Retry is showing). Retry never bills a month the server already billed.

**Harm when it breaks:** the player sees an advanced month and a world event the server never recorded. Every later decision is made on numbers that do not exist, and the next successful commit silently snaps the screen back. A naive Retry after a lost reply bills a second month.

## The finding this skill was built from

Confirmed on `main` at `51ce1dba3254f066a9ddf7c06b4435c215cc61aa` (`51ce1db`).

`dispatchTurnCommands()` sent each command through `api.commitTurn()` and, in a bare `catch`, re-ran the whole batch on the local engine from the pre-batch state: `applyCommandsLocally(state, list)`, returned as `mode: 'local', fallback: true`. `commitCommands()` in `src/App.jsx` put that on screen and appended a local ledger entry. With the wage event active and the campaign at turn 0, one rejected Advance Month showed burn 2464 and cash $14795 (turn 1) while the campaign stayed at 2200 / turn 0 / $15000. `src/turnSaveFailure.test.jsx` reproduces that number on `51ce1db`: `expected 'Cash: $14795' to be 'Cash: $15000'`.

**Why the fallback existed.** It came in with `be5700a` (authoritative GameState / TurnCommand foundation), whose comment in `App.jsx` says "Missing route/migration keeps Slice 1/2 playable on the local engine." That reason is real, and it is kept by `ensureCampaign()`: when `POST /api/campaigns` fails (no route, no migration 004), `campaignIdRef` stays `null` and every turn runs on the local engine exactly as before (`src/apiMode.test.jsx` "Advance Month drains cash via turn engine…" still covers it). Once a campaign *exists*, the server is the authority, so a failed commit must not be papered over locally.

## Run the check

```sh
npx vitest run src/turnSaveFailure.test.jsx src/turnCommands.test.js
```

Both run in `npm test`. No Postgres needed: the UI test drives `App` against an in-memory service that applies commits with the real `applyTurnCommand`.

For the model, use the pstack `/statechart` skill on `spec/CitizenTurnDispatch.tla` with `spec/view.ts` and one of the three configs. Do not copy `/statechart`'s command line into this file; that invocation changes between releases.

| Config | Client code it stands for | Expected |
| --- | --- | --- |
| `spec/fallback.cfg` | `51ce1db`: catch → local re-run | `ViewIsServerOrMarked`, `ViewWasOnServer` break |
| `spec/naive.cfg` | no fallback, Retry re-sends without reading the server | `EachMonthBilledOnce` breaks |
| `spec/fixed.cfg` | this fix: keep confirmed state, alert, Retry re-reads then skips what landed | all rules hold |

The last runs are in `spec/results/<config>/chart.mmd` and `report.md`.

## Read a result

- **`fixed.cfg` holds, `fallback.cfg` and `naive.cfg` break as above** — the model is as recorded. The two breaking variants are the evidence the rules are not vacuous.
- **A UI test sees `Cash: $14795` (or any billed cash) after a rejected commit** — something re-applies commands locally on a server-backed failure again. Look at the `catch` in `dispatchTurnCommands` and at `applyDispatched` in `App.jsx`.
- **"a lost reply … is not billed twice" fails with `turn` 2** — Retry re-sent `advance_turn` without checking the refetched turn. Look at `commandAlreadyApplied`.
- **"local-only play" fails** — the offline path (`!apiBase || !campaignIdRef.current` in `commitCommands`, `!api || !campaignId` in `dispatchTurnCommands`) changed.
- **An alert/role/name assertion fails** — the announcement contract changed. It must stay `role="alert"` inside `.data-source--alert` with a button named "Retry saving turn".

## The model

`spec/CitizenTurnDispatch.tla`. One Advance Month is a batch of two commits: 1 = put the world event on the campaign (stands for `clear_triggers` + `apply_trigger`, idempotent), 2 = `advance_turn` (not idempotent). `srv` is the campaign, `history` every state it ever committed, `view` the screen, `status` is idle / sending / failed.

| Action | Code it stands for |
| --- | --- |
| `YouAdvance` | `onTick` → `commitCommands(…, { restackTriggers: true })` → `dispatchTurnCommands` |
| `CommitOk` | one `api.commitTurn` resolving, `mergeCampaignTurnState` |
| `CommitRejected` | `commitTurn` throws, nothing written (validation, 5xx before COMMIT, network down) |
| `CommitLostReply` | the server COMMITs, the client gets an error (timeout, dropped connection, missing `state`) |
| `OnError` (`fallback`) | the old `catch { applyCommandsLocally(state, list) }` |
| `OnError` (`naive`/`fixed`) | `return { failed: true, state: <confirmed>, pending }`; `TurnSaveAlert` shown |
| `NaiveRetry` | a Retry that just re-sends `pending.commands` |
| `RefetchThenRetry` | `retryTurnCommands`: `api.getCampaign`, merge, `commandAlreadyApplied`, dispatch the rest |
| `Done` | end state, so `NoDeadlock` stays meaningful |

Rules, and the code each guards:

- `ViewIsServerOrMarked` — idle ⇒ screen = server. Guards the `catch` in `dispatchTurnCommands` and `applyDispatched` in `App.jsx`.
- `ViewWasOnServer` — the screen only ever shows a state the server committed. Same code; also rules out "optimistic" display.
- `EachMonthBilledOnce` — server turn ≤ months asked for. Guards `retryTurnCommands` / `commandAlreadyApplied`.

`MaxAsk = 2`; `CONSTRAINT Bounded` (server turn ≤ 3) keeps the naive variant finite. `fixed.cfg`: 16 states, 26 steps, all rules hold. `fallback.cfg`: 19 states; both view rules break in 2 steps (advance, reject). `naive.cfg`: 37 states; `EachMonthBilledOnce` breaks in 5 steps (advance, restack saves, advance lands with reply lost, Retry, saves again).

## What this does not cover

- Other writers. A second tab, an ingest restack (`server/campaignRestack.js`), or another player committing between the failure and Retry is not modeled. Retry shows whatever the server holds, so the screen stays honest, but `commandAlreadyApplied` would credit someone else's advance to this batch.
- `hire_employee` lost replies. Implemented (roster length grows ⇒ skip) and unit-tested, not modeled.
- The campaign disappearing mid-session (404 on `GET /api/campaigns/:id`). Retry keeps failing and the alert stays; it does not recreate the campaign or drop to offline play. A deliberate choice: silently forking to local is the bug this skill exists for.
- `onToggleTrigger` / `onIngestFixture` / `onClearTriggers` announce trigger changes from the `/api/triggers` read model before their campaign commit; when that commit fails the turn alert appears, but the trigger announcement is not withdrawn.
- The server-side torn restack itself — see `citizen-campaign-restack`.

## Keeping it in step

**Covered code, last confirmed at `51ce1dba3254f066a9ddf7c06b4435c215cc61aa` plus this change:**

| File | Functions |
| --- | --- |
| `src/turnCommands.js` | `dispatchTurnCommands`, `retryTurnCommands`, `commandAlreadyApplied`, `mergeCampaignTurnState` |
| `src/App.jsx` | `commitCommands`, `applyDispatched`, `onRetryTurn`, `setPendingTurn`, `ensureCampaign` |
| `src/components/TurnSaveAlert.jsx` | `TurnSaveAlert` and its message constants |

When any of these change, treat the model as out of date until you have re-read them and confirmed each action still maps to one step. Move the sync commit only after re-running the three configs and the two test files.
