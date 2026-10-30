---- MODULE CitizenTurnDispatch ----
\* What the player sees vs what the campaign server holds, across one
\* server-backed turn: the client sends a batch of commits, each commit can
\* succeed, be rejected, or land on the server with its reply lost, and the
\* player can retry.
\*
\*   src/App.jsx          commitCommands() -> dispatchTurnCommands()
\*   src/turnCommands.js  dispatchTurnCommands(): one api.commitTurn() per
\*                        command, each its own server transaction
\*                        (server/campaigns.js commitTurn)
\*
\* A batch is the Advance Month batch with the restack in front, reduced to
\* two commands:  1 = put the world event on the campaign (clear/apply, which
\* are idempotent), 2 = advance_turn (not idempotent: it bills a month).
\*
\* Mode picks the client code under test:
\*   "fallback"  main @ 51ce1dba: a failed commit is caught and the whole
\*               batch is re-run on the local engine from the pre-batch view
\*   "naive"     no local fallback, Retry re-sends from the failed command
\*               without reading the server first
\*   "fixed"     no local fallback, Retry re-reads the campaign, skips a
\*               command the server already applied, then re-sends the rest
EXTENDS Naturals, FiniteSets

CONSTANTS Mode, MaxAsk

Cmds == 2
Snap(e, t) == [events |-> e, turn |-> t]

VARIABLES
  srv,      \* campaign state on the server: [events, turn]
  history,  \* every state the server has ever committed
  view,     \* what the player sees: [events, turn]
  status,   \* "idle" | "sending" | "failed"  (failed = banner + Retry shown)
  pc,       \* next command of the batch to send (1..Cmds)
  start,    \* the view when the batch started
  asked     \* months the player has asked for

vars == <<srv, history, view, status, pc, start, asked>>

States == [events: 0..1, turn: 0..(MaxAsk + Cmds)]

TypeOK ==
  /\ srv \in States /\ view \in States /\ start \in States
  /\ history \subseteq States
  /\ status \in {"idle", "sending", "failed"}
  /\ pc \in 1..Cmds
  /\ asked \in 0..MaxAsk

Init ==
  /\ srv = Snap(0, 0)
  /\ history = {Snap(0, 0)}
  /\ view = Snap(0, 0)
  /\ status = "idle"
  /\ pc = 1
  /\ start = Snap(0, 0)
  /\ asked = 0

Apply(s, i) ==
  IF i = 1 THEN [s EXCEPT !.events = 1] ELSE [s EXCEPT !.turn = s.turn + 1]

\* The player presses Advance Month (with a world event to restack).
YouAdvance ==
  /\ status = "idle"
  /\ asked < MaxAsk
  /\ asked' = asked + 1
  /\ status' = "sending"
  /\ pc' = 1
  /\ start' = view
  /\ UNCHANGED <<srv, history, view>>

\* api.commitTurn resolves; mergeCampaignTurnState puts the reply on screen.
CommitOk ==
  /\ status = "sending"
  /\ srv' = Apply(srv, pc)
  /\ history' = history \cup {srv'}
  /\ view' = srv'
  /\ IF pc = Cmds
       THEN status' = "idle" /\ pc' = pc
       ELSE pc' = pc + 1 /\ UNCHANGED status
  /\ UNCHANGED <<start, asked>>

\* What the client does with a thrown commit, by Mode.
OnError ==
  IF Mode = "fallback"
    THEN /\ view' = Apply(Apply(start, 1), 2)  \* applyCommandsLocally(state, list)
         /\ status' = "idle"
    ELSE /\ view' = view                       \* keep last confirmed
         /\ status' = "failed"

\* The server rejects the commit (validation, 5xx before COMMIT, network
\* down before the request lands). Nothing is written.
CommitRejected ==
  /\ status = "sending"
  /\ OnError
  /\ UNCHANGED <<srv, history, pc, start, asked>>

\* The commit lands and the reply is lost (timeout, dropped connection).
CommitLostReply ==
  /\ status = "sending"
  /\ srv' = Apply(srv, pc)
  /\ history' = history \cup {srv'}
  /\ OnError
  /\ UNCHANGED <<pc, start, asked>>

\* Retry without reading the server first.
NaiveRetry ==
  /\ Mode = "naive"
  /\ status = "failed"
  /\ status' = "sending"
  /\ UNCHANGED <<srv, history, view, pc, start, asked>>

\* Retry: GET /api/campaigns/:id, show it, and skip the failed command when
\* the server already shows its effect (turn moved past the last confirmed
\* turn for advance_turn; idempotent commands are simply re-sent).
RefetchThenRetry ==
  /\ Mode = "fixed"
  /\ status = "failed"
  /\ view' = srv
  /\ LET landed == pc = 2 /\ srv.turn > view.turn
     IN IF landed
          THEN IF pc = Cmds
                 THEN status' = "idle" /\ pc' = pc
                 ELSE status' = "sending" /\ pc' = pc + 1
          ELSE status' = "sending" /\ pc' = pc
  /\ UNCHANGED <<srv, history, start, asked>>

Done ==
  /\ status = "idle" /\ asked = MaxAsk
  /\ UNCHANGED vars

Next ==
  \/ YouAdvance
  \/ CommitOk
  \/ CommitRejected
  \/ CommitLostReply
  \/ NaiveRetry
  \/ RefetchThenRetry
  \/ Done

Spec == Init /\ [][Next]_vars

\* Keeps the naive variant finite: a lost-reply retry loop bills without end.
Bounded == srv.turn <= MaxAsk + 1

\* ---- Rules ----

\* When server-backed, the screen equals the server's committed state, or
\* the screen says it is not: a save is in flight or the failure banner shows.
ViewIsServerOrMarked ==
  status = "idle" => view = srv

\* The screen never shows a campaign the server never held.
ViewWasOnServer ==
  view \in history

\* Every month the player asked for is billed once, never twice.
EachMonthBilledOnce ==
  srv.turn <= asked
====
