# CitizenRestack

TLC reached 19 states and 70 steps. The chart draws 8 states and 12 arrows.
The chart does not draw 40 steps that stay in one chart state.

## NoMonthOnTornStack breaks
The shortest path has 2 steps:
0. Playing, 1 world event
1. an ingest starts rebuilding [after a change]: Rebuilding, no world events
2. you advance a month: Rebuilding, no world events

## AtomicRestack breaks
The shortest path has 2 steps:
0. Playing, 1 world event
1. an ingest starts rebuilding [after a change]: Rebuilding, no world events
2. a step of the rebuild fails: Restack failed, no world events

## Rules that hold
TypeOK, OkMeansFull, NoDeadlock
