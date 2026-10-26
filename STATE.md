# Merge-train state

Tracker for the Citizen pull requests on this merge train.
Heads below are the SHAs at this commit. They move when a branch is updated.

Last updated: 2026-10-26, after PR #4 merged to `main` at `eb02b8b`.

## Merge order

1. **PR #3** — merged.
2. **PR #1** — merged. Frontend sample world events.
3. **PR #4** — merged. UI adapted to the OpenAPI 0.4.0 trigger API.
4. **PR #5** — next. Was stacked on #4; base is now `main`. Type-weighted employee multiplier and clamped talent-cost factor in the UI.
5. **PR #2** — backend only. Its duplicate UI edits are dropped because #4 and #5 supersede them. Osiris rebases this branch backend-only after #5.
6. **PR #6** — stacked on #2. OpenAPI 0.7.0 talent multiplier and clamp.

Order: **#3 → #1 → #4 → #5 → #2 → #6**.

## Pull requests

| PR | Title | Status | Head SHA | Acceptance criteria met | Merged | Regression trace id |
| --- | --- | --- | --- | --- | --- | --- |
| [#3](https://github.com/TayDa64/citizen/pull/3) | Pin Node 22.22 and add minimal CI | Merged to `main` at `d47559c` | `02801b1` | `engines` `>=22.22.2`, `.nvmrc` `22`, CI workflow (`npm ci`, build, test); CI green | yes | Origin trace `diag-20261026-4856e83c`: the PR #1 run whose finding led to #3, not a regression of #3. CI run [40365561385](https://github.com/TayDa64/citizen/actions/runs/40365561385) is green. |
| [#1](https://github.com/TayDa64/citizen/pull/1) | Show sample world events on hype and talent cost | Merged to `main` at `7ea00f0` | `107d8fd` | Regression pass, Slice 1 numbers intact, sample world events update hype and talent cost | yes | Pre-merge `diag-20261026-04496e36` |
| [#4](https://github.com/TayDa64/citizen/pull/4) | Adapt the Citizen UI to the OpenAPI 0.4.0 trigger API | Merged to `main` at `eb02b8b` | `793b7e0` | UI on OpenAPI 0.4.0 trigger API, G1–G4 fixed, regression pass. Pre-merge: 83/83 tests, Slice 1 numbers hold, G1–G4 20/20, axe 0 violations. Brainiac confirmed. CI [40389688395](https://github.com/TayDa64/citizen/actions/runs/40389688395) | yes | Pre-merge `diag-20261026-ebca9b87` |
| [#5](https://github.com/TayDa64/citizen/pull/5) | Scale burn by the talent-cost factor | Open; next. Base is `main` (was stacked on #4) | `1769f01` | Type-weighted employee multiplier and clamped trigger talent-cost factor in the UI, parity with the server over a 15k fuzz, regression pass | no | `diag-20261026-3afe8cce` |
| [#2](https://github.com/TayDa64/citizen/pull/2) | Add real-world triggers for hype and talent cost | Open; backend-only rebase after #5 (duplicate UI edits dropped; #4/#5 supersede them) | `63f6fbc` | Backend (migrations 001–003, local-only DB guard, Host checks, triggers API), regression pass | no | `diag-20261026-3f44e8ad` |
| [#6](https://github.com/TayDa64/citizen/pull/6) | Scale burn by employees and a clamped talent-cost factor | Open; stacked on #2 | `cc0b661` | OpenAPI 0.7.0, talent multiplier and clamp, regression pass | no | `diag-20261026-feab2fe6` |

## Invariants

- With no employees and no trigger, Slice 1 numbers hold: initial cash 15000, burn 2000, tax 25%. Burn is 2000 / 2200 / 2800 at tax 0 / 0.25 / 1. One tick gives cash 14817.
- The talent multiplier is type-weighted by department and skill: the mean over active employees of `deptWeight * (1 + 0.8 * (clamp(skill) - 0.5))`, with tech 1.25, marketing 1.05, sales 0.95, other 1. It is unbounded.
- The trigger talent-cost factor is clamped to 0.1x–3x and applied once to the stacked ratio. `Burn = round(base * talentMultiplier * talentCostFactor)`, rounded once.
- The tax slider advancing a month is known, pre-existing behavior.

## Next highest-priority task

**Source: fallback**, not a later slice copied from `SLICES.md`.

`SLICES.md` lists one next slice: a real-world trigger (mock or Firecrawl) that updates hype or talent cost and shows it on the diagram and dashboard. That work is this merge train (#1 through #6). No slice after it is written down.

After these land: **Slice 3 kickoff** — persist employees and a hiring flow in the UI so the talent multiplier is driven by real data.

## Known open low items

- **N1-api** (low, pre-existing, on #6, `data.schema`): `ErrorMessage` does not allow `issues`. 400 validation and 405 bodies include `issues`. Osiris is fixing this during the rebase.
- **A1** (low, pre-existing from #1): axe moderate `landmark-one-main` and `region`.
- **S1** (low): `main`'s lockfile `engines` did not match `package.json`. Fixed by #1's lockfile.
- **R3b-style info items** (non-blocking):
  - R3b itself is fixed on #5 (`1769f01`): the per-point burn text names T2, the month the policy first changes burn.
  - Info on #5: chart month labels start at T1 instead of T0. Intentional; no tests affected (`diag-20261026-3afe8cce`).
  - N2 on #6 (info): a 4th stacked `+100` trigger is rejected with 400 and rolled back (`diag-20261026-feab2fe6`).
  - Low on #4 (finite out-of-range company hype / talent cost shown unclamped, `diag-20261026-fd2b2cd8`): fixed by #5 (R1).
