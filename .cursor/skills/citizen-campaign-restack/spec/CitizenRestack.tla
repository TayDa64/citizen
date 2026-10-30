---- MODULE CitizenRestack ----
\* A campaign restack after a changed ingest, as the code does it now.
\*
\*   server/eventIngest.js  ingestAndPersist()
\*     -> writes the ingest's triggers (createTrigger), outside any campaign
\*        lock, then calls restackCampaignTriggers()
\*   server/campaignRestack.js  restackCampaignTriggers()
\*     -> withCampaignTransaction (server/campaigns.js): BEGIN, lock the
\*        campaign row, read the live triggers, clear_triggers + apply_trigger
\*        x N + any compensate_torn_month, COMMIT. Any throw rolls it all back.
\*   server/campaigns.js  commitTurn()
\*     -> every advance_turn takes the same row lock.
\*
\* Because the restack is one transaction under the row lock, no other
\* writer or reader sees it half done, so it is ONE step here (Rebuild).
\* Two ingests can race: each persists its document, then rebuilds.
EXTENDS Naturals, FiniteSets

CONSTANTS Stale, New1, New2, I1, I2

Ingests == {I1, I2}
Doc(i) == IF i = I1 THEN {New1} ELSE {New2}  \* what each ingest adds
Old == {Stale}                               \* the stack before any ingest
AnyStack == SUBSET {Stale, New1, New2}

\* Every stack a restack can legitimately leave: the old one, or the nest
\* selection of the triggers live at some moment (one or both documents).
Legit == {Old, Doc(I1), Doc(I2), Doc(I1) \cup Doc(I2)}

VARIABLES stack, live, pc, monthOnTorn

vars == <<stack, live, pc, monthOnTorn>>

TypeOK ==
  /\ stack \in AnyStack
  /\ live \in SUBSET {New1, New2}
  /\ pc \in [Ingests -> {"idle", "persisted", "ok", "error"}]
  /\ monthOnTorn \in BOOLEAN

Init ==
  /\ stack = Old
  /\ live = {}
  /\ pc = [i \in Ingests |-> "idle"]
  /\ monthOnTorn = FALSE

\* The ingest stores its changed trigger document (no campaign lock yet).
Persist(i) ==
  /\ pc[i] = "idle"
  /\ live' = live \cup Doc(i)
  /\ pc' = [pc EXCEPT ![i] = "persisted"]
  /\ UNCHANGED <<stack, monthOnTorn>>

\* The whole restack commits at once: under the row lock it reads the live
\* triggers and replaces the stack with them; insertIngestRun says success.
Rebuild(i) ==
  /\ pc[i] = "persisted"
  /\ stack' = live
  /\ pc' = [pc EXCEPT ![i] = "ok"]
  /\ UNCHANGED <<live, monthOnTorn>>

\* Any throw inside the transaction: it rolls back, the stack is untouched,
\* ingest_runs records status=error.
Fail(i) ==
  /\ pc[i] = "persisted"
  /\ pc' = [pc EXCEPT ![i] = "error"]
  /\ UNCHANGED <<stack, live, monthOnTorn>>

\* A month advances. It waits for the row lock, so it lands before or after
\* a whole Rebuild, never inside one.
AdvanceTurn ==
  /\ monthOnTorn' = (monthOnTorn \/ stack \notin Legit)
  /\ UNCHANGED <<stack, live, pc>>

Done ==
  /\ \A i \in Ingests : pc[i] \in {"ok", "error"}
  /\ UNCHANGED vars

Next == (\E i \in Ingests : Persist(i) \/ Rebuild(i) \/ Fail(i))
     \/ AdvanceTurn \/ Done

\* The campaign's world events are always the old stack or a full selection,
\* never a mix and never nothing.
AtomicRestack == stack \in Legit

\* An ingest reported as successful has all of its triggers on the campaign
\* (a later restack only adds to what is live, it never drops them).
OkMeansFull == \A i \in Ingests : pc[i] = "ok" => Doc(i) \subseteq stack

\* No month is ever advanced on a stack that is neither old nor full.
NoMonthOnTornStack == monthOnTorn = FALSE

\* When both ingests have restacked, the campaign holds both documents: the
\* restack that commits last read the triggers under the lock, so it cannot
\* put back an older selection.
NewestStackWins ==
  (\A i \in Ingests : pc[i] = "ok") => stack = Doc(I1) \cup Doc(I2)

Spec == Init /\ [][Next]_vars

====
