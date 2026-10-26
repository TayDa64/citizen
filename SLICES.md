# Citizen Slices

## Slice 1 (completed in this iteration)
**Tax policy modulates company burn rate, visible and adjustable.**

### What works
- Interactive civic-tax node in the existing WorkflowDiagram.
- Simple effects resolver (`src/simulation.js`) that applies a formula: burnRate = base * (1 + taxRate * 0.4).
- Cash decreases on each tick.
- Highcharts dashboard shows cash and burn rate history.
- Existing diagram nodes and edges are preserved.

### Invariants for later slices
- Do not remove or rename node id `civic-tax`.
- Effects stay data-driven (formulas in the style of the Postgres `effects` table).
- Real-world triggers (Firecrawl) will later feed the same state objects.
- Keep the React Flow diagram as the system map.

### Next suggested slice
Real-world trigger (mock or Firecrawl) updates hype or talent cost and appears in the diagram + dashboard.

## Slice 2
**A sample world event updates hype and talent cost, and the effect is visible.**

### What works
- `src/triggers.js` is the RealWorldTrigger contract (id, type, label, source, timestamp, effect.hype, effect.talentCost) plus frozen `mock:local` samples.
- `applyTrigger`, `removeTrigger`, and `clearTriggers` in `src/simulation.js` stack those effects from the Slice 1 baseline. No active trigger leaves burn on the Slice 1 formula.
- The diagram shows the talent-cost delta on the infrastructure node and edge, and adds a hype node when hype moves.
- The dashboard draws a dashed Highcharts plot line and band at the trigger month, with a before/after readout.
- World-event buttons are keyboard operable and announce the effect in an `aria-live="polite"` region.

### Local test
```bash
npm install
npm test
npm run dev
```
Drag the tax slider, click “Advance Month”, watch the chart. Apply “Policy change” and confirm talent cost +12% without moving cash until the next month.
