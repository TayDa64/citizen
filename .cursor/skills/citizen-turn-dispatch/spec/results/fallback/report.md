# CitizenTurnDispatch

TLC reached 19 states and 33 steps. The chart draws 13 states and 18 arrows.
The chart does not draw 1 steps that stay in one chart state.
The view hides 7 steps, so the chart does not draw them.

## ViewIsServerOrMarked breaks
The shortest path has 2 steps:
0. Screen month 0, no event; server month 0, no event
1. you advance a month: Saving: Screen month 0, no event; server month 0, no event
2. the server rejects a step: Screen month 1, event on; server month 0, no event

## ViewWasOnServer breaks
The shortest path has 2 steps:
0. Screen month 0, no event; server month 0, no event
1. you advance a month: Saving: Screen month 0, no event; server month 0, no event
2. the server rejects a step: Screen month 1, event on; server month 0, no event

## Rules that hold
TypeOK, EachMonthBilledOnce, NoDeadlock
