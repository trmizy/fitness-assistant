# 08 — Agent Design and Input/Output Contracts

Written **after** FR/EX/AC (`04`–`06`) were fixed — the agent boundaries below exist because the BPM needs exactly
these responsibilities, not the reverse. Every component already exists in the codebase (`02-as-is-process.md`);
this file formalizes its contract for this one BPM.

## Minimum agent architecture

### Enterprise Data Agent

**Research responsibility**: *"What is true?"*

- **Inputs**: `userId`, `sessionId`, the required data topics for this turn (profile, equipment, existing program,
  workflow/draft state).
- **Outputs**: authoritative enterprise/business data only — profile fields, equipment, exercise-search results,
  existing workflow/action state. **Must not invent a missing business fact** — a missing profile field is
  returned as missing (`null`/absent), never guessed.
- **Current implementation**: `fitnessAgentDeps.tools.getUserFitnessContext` (profile + coach context),
  `profileExtractor.extract` (personalization shape used by the generator and revision loop),
  `searchExerciseByName` (canonical catalog lookup), the `AgentWorkflowSession`/`FitnessAgentAction` repository
  reads inside `tryConfirmationBoundary`.

### Fitness Recommendation Agent

**Research responsibility**: *"Given the authoritative context and the user's requirements, what workout plan
should be proposed?"*

- **Inputs**: structured user context (entities/constraints, `07-context-model.md`), enterprise context (from the
  Enterprise Data Agent), domain constraints (exercise catalog eligibility).
- **Outputs**: a workout-plan **draft** (weekly schedule, canonical exercise IDs, sets/reps/rest), a rationale/
  summary, and validation metadata (unmatched-exercise count, safety warnings). **Must not directly persist a
  program.**
- **Current implementation**: `recommendationEngine.recommend` (the deterministic plan-template engine, shared
  with other recommendation surfaces) + `generateWorkoutDraft`'s exercise-ID resolution + `proposeWorkoutPlan`'s
  draft-row creation (a `FitnessAgentAction`, not a `WorkoutProgram`) + `tryReviseWorkoutPlanDraft` for the revision
  loop.

No third "general fitness agent" is introduced — the brief's own instruction not to add agents just to look
sophisticated is followed: everything else in this BPM is either Conversational Intelligence (context/intent
understanding, below), the existing Workflow/HITL layer (state machine, not a reasoning agent), Deterministic
Validation (pure rule-checking, not a reasoning agent), or the Business Service (persistence, not a reasoning
agent).

## Conversational Intelligence's role

Conversational Intelligence is treated as a **Context/Intent Understanding Layer**, not an unrestricted autonomous
business agent, for this BPM specifically:

| Part | Deterministic parsing | LLM-assisted understanding | State reconciliation | Policy |
|---|---|---|---|---|
| Route classification (`START_WORKFLOW` vs. others) | `router.ts` keyword/pattern rules | optional typed-JSON fallback, only when the deterministic router is unsure, and only within an allow-listed route/topic schema | — | the fallback's output can never itself execute a write — see `conversational-intelligence/global/llm-route.ts`'s allow-listing, reused evidence from the X1–X4 closure |
| Slot answer parsing (`daysPerWeek`, `sessionMinutes`) | `slot-values.ts` parsers | not used — these are narrow numeric/enum parses, intentionally kept deterministic | slot value stored in `AgentWorkflowSession.slotsJson` | a slot is only ever set from a value that passed its own parser |
| Correction/reference detection | `CORRECTION`/`REFERENCE` route rules | may assist disambiguation of which prior value a correction targets | the LATER value always wins (FR05) | never averaged, never silently dropped |
| Interruption/resume | deterministic "does this route belong to the active workflow" check | not needed | workflow/draft row is read-only during an interruption | the workflow/draft is **never** mutated by an interrupting turn |
| Confirmation/status (text) | `classifyConfirmationUtterance` — anchored regex, no LLM at all | not used (deliberately) | `deriveConfirmationState`/`mergeConfirmationState` read DB state | the model is **never** consulted for a confirmation/status utterance — this is the exact property the X1–X4 closure hardened |

**The LLM must not directly decide business persistence** — for this BPM, the only thing the LLM-assisted path can
ever influence is which deterministic route/slot-parse is chosen when the deterministic layer is genuinely unsure;
it never calls the Business Service, never sets a slot value outside that value's own deterministic parser, and
never authors the final persisted `WorkoutProgram` payload (that is always exactly the last-previewed draft,
FR18).

## Formal component I/O table

| Component | Input | Input source | Output | Output consumer | Authority level | Can write business state? | Failure behaviour |
|---|---|---|---|---|---|---|---|
| Conversational Intelligence | raw user utterance, current route/workflow context | gateway → ai-service turn handler | classified route/topic, or `null` (defer) | the turn dispatcher (next row) | advisory — classifies/proposes only | **No** | on ambiguous/unsafe output, defers to deterministic fallback or asks the user; never guesses a write |
| Orchestrator / Workflow-HITL | classified route, slot answers, confirm/dismiss calls | Conversational Intelligence output; direct HTTP endpoints | workflow/draft state transitions, clarification questions, preview blocks | the user (via chat response), the Business Service (on confirm only) | authoritative for **process state** (not business truth) | **No** — only orchestrates; the actual write happens one row down | expired/claimed-by-another-request conditions are handled explicitly (TTL, atomic claim), never silently retried into a double write |
| Enterprise Data Agent | `userId`, `sessionId`, requested data topics | Orchestrator / Fitness Recommendation Agent | authoritative profile/equipment/program/action/workflow data | Orchestrator, Fitness Recommendation Agent | **authoritative read** | **No** (read-only for this BPM) | a read failure is surfaced as an honest "can't retrieve your info right now," never a fabricated profile |
| Fitness Recommendation Agent | structured context, enterprise context | Orchestrator, Enterprise Data Agent | draft payload + rationale + validation metadata | Orchestrator (to show the user) | **proposal only** | **No** | empty/partial generation is disclosed (EX07/EX08), never silently hidden |
| Deterministic Validation | draft payload at confirm time | Business Service (called from the confirm handler) | pass/fail + reason | Business Service / back to the user via the Orchestrator | **authoritative gate** | **No** (blocks or allows, does not itself write) | a failed validation blocks persistence and returns the reason; it never "fixes" the draft silently |
| Business Service | validated draft payload, `(userId, sourcePlanId)` | Orchestrator (confirm handler only) | persisted `WorkoutProgram`/`WorkoutProgramDay`/`WorkoutProgramExercise`/`WorkoutSchedule` rows | the user's own program/schedule views | **sole write authority** | **Yes — the only component that can** | a downstream failure (DB/transaction error) is caught, reported honestly, and the action's claim is released for retry, never left in a false `COMPLETED` state |
