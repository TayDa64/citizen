---- MODULE CitizenRestack ----
\* A campaign restack after a changed ingest, as the code does it.
\*
\*   server/campaignRestack.js  restackCampaignTriggers()
\*     -> [clear_triggers, apply_trigger x N], and each is a separate
\*        commitTurn() with its own BEGIN ... COMMIT (server/campaigns.js)
\*   server/eventIngest.js
\*     -> catches a failure in that loop, writes ingest_runs status=error,
\*        and never puts the campaign back the way it was
\*   shouldRestackAfterIngest() is false when changed=false, so an identical
\*   re-run does not rebuild the stack either
EXTENDS Naturals, FiniteSets

CONSTANTS Stale, New1, New2

Full == {New1, New2}   \* what the nest filter selects for this campaign
Old  == {Stale}        \* what the campaign carried before the ingest
AnyStack == SUBSET {Stale, New1, New2}

VARIABLES stack, phase, reported, monthOnTorn

vars == <<stack, phase, reported, monthOnTorn>>

TypeOK ==
  /\ stack \in AnyStack
  /\ phase \in {"steady", "building"}
  /\ reported \in {"none", "ok", "error"}
  /\ monthOnTorn \in BOOLEAN

Init ==
  /\ stack = Old
  /\ phase = "steady"
  /\ reported = "none"
  /\ monthOnTorn = FALSE

\* First commit of the loop: clear_triggers.
ClearFirst ==
  /\ phase = "steady"
  /\ stack' = {}
  /\ phase' = "building"
  /\ reported' = "none"
  /\ UNCHANGED monthOnTorn

\* One more commit of the loop: apply_trigger for one selected trigger.
ApplyOne(t) ==
  /\ phase = "building"
  /\ t \in Full
  /\ t \notin stack
  /\ stack' = stack \cup {t}
  /\ UNCHANGED <<phase, reported, monthOnTorn>>

\* The loop drains; insertIngestRun records status "success".
Succeed ==
  /\ phase = "building"
  /\ stack = Full
  /\ phase' = "steady"
  /\ reported' = "ok"
  /\ UNCHANGED <<stack, monthOnTorn>>

\* Any commit in the loop throws: a 400 from trigger validation, a lost
\* connection, a timeout, a restart. The campaign keeps whatever the loop
\* had committed so far.
Fail ==
  /\ phase = "building"
  /\ phase' = "steady"
  /\ reported' = "error"
  /\ UNCHANGED <<stack, monthOnTorn>>

\* The same ingest runs again and the trigger document is identical, so
\* changed=false and shouldRestackAfterIngest() is false: no rebuild.
RerunUnchanged ==
  /\ phase = "steady"
  /\ phase' = "steady"
  /\ stack' = stack
  /\ UNCHANGED <<reported, monthOnTorn>>

\* A month advances. Each commit took and released its own row lock, so this
\* can land between two commits of the loop.
AdvanceTurn ==
  /\ monthOnTorn' = (monthOnTorn \/ stack \notin {Old, Full})
  /\ UNCHANGED <<stack, phase, reported>>

Done ==
  /\ phase = "steady"
  /\ UNCHANGED vars

Next == ClearFirst \/ (\E t \in Full : ApplyOne(t)) \/ Succeed \/ Fail
     \/ RerunUnchanged \/ AdvanceTurn \/ Done

\* In a steady campaign the world events are either exactly the ones the
\* campaign had or exactly the ones the ingest selected - never a mix, and
\* never nothing.
AtomicRestack == phase = "steady" => stack \in {Old, Full}

\* A restack reported as successful has every selected trigger on the campaign.
OkMeansFull == reported = "ok" => stack = Full

\* No month is ever advanced on a stack that is neither the old one nor the
\* fully rebuilt one.
NoMonthOnTornStack == monthOnTorn = FALSE

Spec == Init /\ [][Next]_vars

====
