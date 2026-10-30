# CitizenTurnDispatch

TLC reached 37 states and 59 steps. The chart draws 28 states and 43 arrows.
The chart does not draw 3 steps that stay in one chart state.
The view hides 3 steps, so the chart does not draw them.

## EachMonthBilledOnce breaks
The shortest path has 5 steps:
0. Screen month 0, no event; server month 0, no event
1. you advance a month: Saving: Screen month 0, no event; server month 0, no event
2. the server saves a step: Saving: Screen month 0, event on; server month 0, event on
3. a step saves but the reply is lost: Save failed, Retry shown: Screen month 0, event on; server month 1, event on
4. you press Retry: Saving: Screen month 0, event on; server month 1, event on
5. the server saves a step: Screen month 2, event on; server month 2, event on

## Rules that hold
TypeOK, ViewIsServerOrMarked, ViewWasOnServer, NoDeadlock
