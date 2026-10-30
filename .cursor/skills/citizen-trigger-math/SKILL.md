---
name: citizen-trigger-math
description: Use when a change touches which world events bind a home (src/jurisdictionNest.js, nestTriggersForRestack, applicableTriggersForCampaign, listTriggers) or what they do to the numbers (combinedEffects / setTaxRate in src/simulationCore.js, stackTriggerEffects, src/talentMultiplier.js, src/talentBurn.js) — to check the nest filter, tier sort, effect stacking, the 0.1–3× clamp and the talent multiplier against their promises.
---

# Trigger math: which events bind, and what they cost

## The promises, and the harm

Two areas the restack skill (`citizen-campaign-restack`) takes as given. Each promise is one named check; the name is the test title prefix.

**Area 1 — the nest filter and tier sort.** Harm when broken: a campaign is billed for a peer city's wage law, or misses its own county's.

| Check | Promise | File |
| --- | --- | --- |
| `NestExactChain` | the result is exactly the triggers whose jurisdiction is the home or an ancestor (checked against an independent parent-pointer walk) | `jurisdiction-nest.model.api.js` |
| `NestNoPeersOrStrangers` | no sibling, cousin, descendant, NULL or unknown jurisdiction ever binds | same |
| `NestNoDuplicates` | unique ids in, unique ids out, nothing invented | same |
| `NestTierOrder` | federal → state → county → city, then `client_id` ascending | same |
| `NestPermutationStable` | input order never changes the output | same |
| `NestIdempotent` | filtering a filtered stack changes nothing | same |
| `NestFailClosed` | null / `''` / unknown home gives `[]`; a parent cycle terminates | same |
| `NestSeedLocks` | `mv` binds mv + sc_county + ca + us; sunnyvale and NULL never bind `mv` | same |
| `NestSqlMatchesJs` | `JURISDICTION_CHAIN_CTE` and `FILTER_TRIGGERS_FOR_HOME_SQL` bind the same set as the JS chain, on 25 random forests in Postgres | `jurisdiction-nest-db.model.api.js` |
| `CampaignNestFromDb` | a campaign restacks from the DB `jurisdictions` rows, not the in-code seed | same |
| `ClientRestackMatchesServer` | a UI restack built from `GET /api/triggers` lands on the same stack and burn as the server restack | same |

**Area 2 — effect arithmetic.** Harm when broken: burn, talent cost and hype drift from what the event says, and every month advanced is billed wrong.

| Check | Promise | File |
| --- | --- | --- |
| `FactorWithinClamp` | `talentCostFactor` ∈ [0.1, 3] for any stack, client and server | `trigger-math.model.api.js` |
| `CostEffectsAreMonotone` | adding a cost cut never raises talent cost; adding a cost rise never lowers it | same |
| `ClearReturnsToBaseline` | any stack then clear (or remove one by one) gives exactly the Slice 1 numbers | same |
| `OrderIndependent` | every application order gives identical numbers; re-applying an id does not compound | same |
| `TaxAndEventsCommute` | `set_tax` and `apply_trigger` commute; a tax round trip restores hype | same |
| `MultiplierAsDocumented` | mean of weight(dept) × (1 + 0.8 (skill − 0.5)), 4 dp, weights tech 1.25 / marketing 1.05 / sales 0.95 / other 1; the mix sums exactly | same |
| `Slice1Baselines` | burn 2200 with no events, 2376 with the 8% wage event, talent cost 4000, factor 1.08 | same |
| `ClientMatchesServer` | `stackTriggerEffects`/`talentBurn.js` and `combinedEffects`/`talentMultiplier.js` agree on cost, hype, factor, clamp flag, multiplier and burn | same |

## The findings this skill was built from

Found on `main` at `51ce1dba3254f066a9ddf7c06b4435c215cc61aa` and fixed in the commit that added this skill. Each fix has a regression test in `test/unit/trigger-math-regressions.api.js` or `test/api/nest-restack-regressions.api.js`.

1. **Talent cost sign flip** (`CostEffectsAreMonotone`). `∏(1 + delta)` went negative for a cut below −100%, and two such cuts multiplied back up. `[-2]` → $0 (burn 220) but `[-2, -2]` → $4000 (burn 2200); `[-3, -3]` → $16000 (factor 3, burn 6600). Fix: each term is floored, `Math.max(0, 1 + delta)`, in both `combinedEffects` and `stackTriggerEffects`.
2. **UI restack bound peers and NULL** (`ClientRestackMatchesServer`). `GET /api/triggers` was unfiltered, so the UI pushed sunnyvale and NULL-jurisdiction events onto the campaign while `/api/companies` left them out. With mv 8%, sunnyvale 50%, NULL 20%: UI campaign burn 4277, preview 2376. Fix: `listTriggers` filters to the home chain (`COMPANIES_READ_MODEL_HOME`) with the same CTE.
3. **Server restack used the in-code seed** (`CampaignNestFromDb`). `applicableTriggersForCampaign` called `nestTriggersForRestack` with `JURISDICTION_SEED`, so a home present in the DB but not the seed (`pa`, under `sc_county`) got `[]`. Fix: pass `listJurisdictionRows(pool)`.
4. **Hype tax round trip drift at the clamp** (`TaxAndEventsCommute`). Hype 0 (event −0.4051) at tax 0.5 came back as 0.05 at tax 0.25; hype 1 at tax 0 came back 0.95 instead of 0.99. The rebias subtracted the old bias from an already-clamped value. Fix: `setTaxRate` rebiases from the unclamped stacked hype when the company hype is exactly what the stack produced (`stackedHypeForTax`), else the old rule.

## Run the checks

Node 22 (`.nvmrc`). The `*-db.model.api.js` file and `check:restack` need the local Postgres on the unix socket that `test/api` uses; the pure files do not.

```sh
npm run check:model          # every test/model/*.api.js, including check:restack's file (needs Postgres)
node --test test/model/jurisdiction-nest.model.api.js test/model/trigger-math.model.api.js   # pure only
npm run check:restack        # restack atomicity, race and compensation (citizen-campaign-restack)
```

Seeds are fixed (`DEFAULT_SEED` 20261029, 400 runs per property). Override with `MODEL_SEED=… MODEL_RUNS=…` to explore; a CI run must use the default.

## Read a failure

`forAll` throws `PropertyFailure` with the check name, seed, run number and the generated input as JSON. Re-run with that `MODEL_SEED` to reproduce, then cut the input by hand to the smallest stack that still fails and put it in a regression test.

- **One Nest check fails alone** — a change to `src/jurisdictionNest.js`. `NestTierOrder` + `NestPermutationStable` together usually means the `client_id` tie-break moved.
- **`NestSqlMatchesJs`** — the CTE and `ancestorChainIds` disagree. Fix whichever drifted; both are the contract.
- **`ClientMatchesServer` with one other Area 2 check** — the change landed on one side only (`talentMultiplier.js` vs `talentBurn.js`, `combinedEffects` vs `stackTriggerEffects`).
- **`Slice1Baselines`** — a constant moved. If on purpose, update the slice docs and the check together.
- **`ClientRestackMatchesServer` / `CampaignNestFromDb`** — the server read path (`listTriggers`, `applicableTriggersForCampaign`) no longer uses the DB chain.

Each check was proved able to fail by breaking the code one way at a time (21 mutations, every check failed at least once). The mutation table is in the PR body for the commit that added this skill.

## The code each check guards

| File | Functions | Checks |
| --- | --- | --- |
| `src/jurisdictionNest.js` | `ancestorChainIds`, `filterTriggersForHome`, `sortTriggersForRestack`, `nestTriggersForRestack`, `JURISDICTION_CHAIN_CTE`, `FILTER_TRIGGERS_FOR_HOME_SQL` | all Nest* |
| `server/campaignRestack.js` | `applicableTriggersForCampaign` | `CampaignNestFromDb`, `ClientRestackMatchesServer` |
| `server/triggers.js` | `listTriggers`, `recomputeCompanies` | `ClientRestackMatchesServer`, `CampaignNestFromDb` |
| `src/simulationCore.js` | `combinedEffects`, `applyActiveTriggers`, `clearTriggers`, `setTaxRate`, `stackedHypeForTax`, `readApiSnapshot` | Area 2 |
| `src/triggerContract.js` | `stackTriggerEffects` | `ClientMatchesServer`, `FactorWithinClamp` |
| `src/talentMultiplier.js` | `DEPARTMENT_WEIGHTS`, `talentCostFactorOf`, `effectiveBurnRate`, `talentMixFromEmployees` | `FactorWithinClamp`, `MultiplierAsDocumented`, `Slice1Baselines` |
| `src/talentBurn.js` | `departmentWeight`, `composeTalentMultiplier`, `resolveTalentCostFactor`, `burnFromTax` | `ClientMatchesServer`, `FactorWithinClamp` |
| `src/civicFeedback.js` | `computeCivicFromTax`, `hypeBiasFromHeadroom` | `TaxAndEventsCommute` |

## What this does not cover

- **The UI campaign merge** — `mergeCampaignTurnState` in `src/turnCommands.js` still calls `rebiasHype` on the clamped hype, so the finding-4 drift remains on that path. Not fixed here; Node tests cannot import that file (Vite extensionless `citizenApi` import).
- **Cycles in SQL** — the JS chain stops on a cycle (`NestFailClosed`); the recursive CTE is not run on cyclic data. The `parent_id` FK and seed make one unlikely, not impossible.
- **Duplicate ids into `nestTriggersForRestack`** — it does not dedupe; the callers' SQL returns unique `client_id`s. `NestNoDuplicates` only covers unique input.
- **Column max** — the server `stackTriggerEffects` throws above the NUMERIC(12,2) max; the client clamps silently (SLICES.md). `ClientMatchesServer` skips stacks the server refuses to store. Intended, documented, not changed.
- **Restack atomicity** — see `citizen-campaign-restack`.
- **Voter support and civic effects beyond the hype bias.**

## Keeping it in step

**Sync commit:** checks written against `51ce1dba3254f066a9ddf7c06b4435c215cc61aa` plus the fixes in the commit that added this skill. When a file in the table above changes, re-read the functions, run `npm run check:model`, and only then move the sync commit forward. If a promise changes on purpose, change its check and this file in the same commit.
