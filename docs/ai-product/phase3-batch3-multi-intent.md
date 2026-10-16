# Phase 3 — Batch 3: Bounded Multi-Intent + Cross-Domain Continuity — Completion Report

**Implementation owner**: Claude Code. **Date**: 2026-10-05. Engineering report, not a research artifact.

## 1. Starting limitation

Batches 1-2 built the read foundation (Enterprise Data Layer + Context Assembler) and the canonical turn
type (`UnifiedTurnUnderstanding`), both purely observational/additive — neither changed a single user-visible
answer. Batch 3 is the first batch this phase explicitly allows to change behavior. Investigation at the
start of this batch found `GlobalRoute.MULTI` already does far more than Batch 1/2's own docs implied:
`global-turn.ts`'s MULTI handler already answers every `READ_STATE` part and every `RECOMMEND` part **except**
PT/PROGRAM, joining them into one combined answer. The real starting limitation was narrower than the brief
assumed: exactly one composition (READ + RECOMMEND(PT/PROGRAM)) was genuinely unhandled, falling back to an
"offer to search separately" string instead of a real recommendation.

## 2. Supported compositions

| Composition | Example | Handled by |
|---|---|---|
| READ + READ | "Mục tiêu của tôi là gì và tôi đang có PT không?" | `EXISTING_MULTI` (global-turn.ts, unchanged, already worked) |
| READ + RECOMMEND (non-PT/PROGRAM) | nutrition macro + "giảm cân được không" | `EXISTING_MULTI` (unchanged, already worked) |
| READ + RECOMMEND(PT) | "PT hiện tại của tôi là ai và PT nào phù hợp hơn với tôi?" | **`BOUNDED_EXECUTOR`** (new this batch) |
| READ + RECOMMEND(PROGRAM) | current program + "chương trình nào phù hợp hơn?" | **`BOUNDED_EXECUTOR`** (new this batch, same rule as PT) |

## 3. Unsupported / deferred compositions

- **≥3 operations in one turn** (e.g. 3 reads, or 2 independent RECOMMENDs) — marked `UNSUPPORTED` with a
  `reasonUnsupported` string by the planner; left to `global-turn.ts`'s own existing graceful-degradation
  (`offers` mechanism). Nothing new is forced.
- **Workout READ + exercise-replacement PROPOSAL** (Class C) and **RECOMMEND + PROPOSE in one turn** (Class D)
  — see §10. Deferred, not built, because no safe existing write path exists.

## 4. Planner architecture

`services/bounded-turn/planner.ts::planBoundedTurn(route: GlobalRouteResult): BoundedTurnPlan` — pure,
synchronous, zero I/O (no axios/prisma/llm import anywhere in the module; proven by a test that calls it with
zero stubs and still gets a deterministic result). Only acts when `route.route === "MULTI"`; every other route
produces a trivial `SINGLE` plan handled entirely by the existing dispatcher. It classifies each MULTI `part`
into an allowlisted `ReadOperationKind`/`RecommendationOperationKind` (mirroring `ReadTopic`/`RecommendTopic`
1:1 — never a free-form `{tool, args}` shape), counts them against `MAX_READS=2`/`MAX_RECOMMENDATIONS=1`, and
sets `handledBy`:
- `"EXISTING_MULTI"` when the composition is already correctly handled today (most compositions).
- `"BOUNDED_EXECUTOR"` only for a RECOMMEND part with topic `PT`/`PROGRAM` alongside ≤1 READ part, within
  limits — the one real gap.
- `"UNSUPPORTED"` when the composition exceeds the limits, with a human-readable reason.

The planner consumes `GlobalRouteResult` directly (the brief's own allowed input), not `UnifiedTurnUnderstanding`
— `route.parts` already carries everything losslessly (Batch 2's own mapping table documents this), so routing
through the canonical type first would be unneeded indirection over data the raw route already has.

## 5. Executor architecture

`services/bounded-turn/executor.ts::executeBoundedTurn(plan, identity, question, deps)` — the ONLY new
*executable* behavior this batch adds. Given a `BOUNDED_EXECUTOR` plan, it:
1. Resolves `AgentPreferences` from the real, already-known profile context (`getUserFitnessContext`) via
   `AgentPreferencesSchema.safeParse` — returns `null` (safe fallback to the existing offer-only text) if
   goal/days are missing, or if PT budget is missing (never guesses a budget).
2. Calls the **same, unmodified, already-exported** `findPTCandidates`/`findTrainingPrograms` tool, the real
   `scorePT`/`scoreTrainingProgramV2` from `@gym-coach/shared`, and the real `narrateRecommendations`/
   `narrateProgramRecommendations` LLM-claim-selection narrators — a second caller of the existing PT/PROGRAM
   search primitives, never a rewrite or a parallel implementation.
3. Slices to the top 3 candidates and composes one short inline sentence, combined with the READ part's own
   already-answered text (via the existing `readState` function).
4. Returns `null` on **any** incompleteness/failure at any step (incomplete preferences, empty candidate list,
   a thrown error from the search) — the caller's existing offer-only fallback remains the safety net.

**Dependency injection, not a direct import**: `executor.ts` takes a structurally-typed `BoundedTurnDeps`
parameter rather than importing `fitnessAgentDeps` from `fitness-agent.service.ts` directly, because that file
is the executor's own caller (a direct import would be circular) and because tests stub narration/tools by
reassigning properties on the shared `fitnessAgentDeps` object — a separately-imported raw function binding
would not pick up those stubs. The caller passes its own already-existing `fitnessAgentDeps` object through
unchanged, verified by reference equality (`fitnessAgentDeps.tools === fitnessAgentTools`).

**Read-only by design**: unlike the full `FIND_PT`/`FIND_TRAINING_PROGRAM` workflow, this never persists a
recommendation row and never creates a `FitnessAgentAction` — it is an inline, same-turn answer, not the start
of a selectable search session. A user who wants to act on it is pointed at the existing dedicated flow
("Nhắn 'tìm PT cho tôi' nếu bạn muốn xem đầy đủ và chọn").

## 6. Operation allowlist

`services/bounded-turn/types.ts`: `ReadOperationKind` mirrors `ReadTopic` 1:1, `RecommendationOperationKind`
mirrors `RecommendTopic` 1:1. `ProposalOperationKind` is declared as `never` (an uninhabited union) —
the shape exists in the type system for Batch 4 without pretending anything implements it today.
`MAX_READS=2`, `MAX_RECOMMENDATIONS=1`, `MAX_PROPOSALS=0` are exported constants, not magic numbers scattered
through the planner.

## 7. Cross-domain interruption design

No new code. The interruption-preserving mechanism in `global-turn.ts`'s `runGlobalTurn` was already generic
(proven for `CREATE_WORKOUT_PLAN` in Phase 2B); this batch adds a test proving the exact same mechanism for a
**second** workflow type, `FIND_PT`, to generalize the proof rather than leaving it as a single-workflow
anecdote (§9).

## 8. Resume behavior

Also unchanged mechanism, newly proven for `FIND_PT`: a workflow waiting on `expectedSlot: "budgetVnd"`
survives an unrelated `READ_STATE` turn byte-for-byte (same `id`/`status`/`expectedSlot`/`slotsJson`), then
resumes correctly from the SAME row when the user supplies the budget value, never creating a second,
competing `AgentWorkflowSession` row.

## 9. Context Assembler integration

Not touched, not needed. The executor reads preferences via the existing `getUserFitnessContext` tool (the
same transport Batch 1's Enterprise Data Layer wraps for other call sites) — adding a direct Context Assembler
call here would duplicate a read path this batch has no evidence needs deduplicating (the PT/PROGRAM composite
is a rare, bounded, single-call-site turn, not a hot path with the N+1 pattern Batch 1 targeted).

## 10. Proposal / HITL integration — Class C/D deferred

Class C (workout-schedule READ + exercise-replacement PROPOSAL, e.g. "đổi bài đó giúp tôi") and Class D
(RECOMMEND + PROPOSE) were investigated and explicitly **not built** this batch. Traced the real "Đổi bài tập"
swap feature (cited by the `gymini-ai-workout-grounding` skill) to its actual persistence:
`WorkoutLogPage.tsx::SwapExerciseModal` records the swap into that one log entry's `notes` field
(`WorkoutLogPage.tsx:1148-1150`) — **session/log-time only**, never written back to
`WorkoutProgramExercise`. No existing endpoint (checked `exercise.routes.ts`, `workout.routes.ts`) supports
"replace exercise X with Y in my active program going forward." Building one would mean adding a new
fitness-service write path — a real, non-trivial change crossing into Codex's actively-owned AI-workout-
grounding domain, not a "tiny documented compatibility fix." Per the brief's own conditional permission
("if existing services support it safely") and the project's parallel-agent-safety rule, this class is
deferred and documented here, not faked with an unsafe new write path. `ProposalOperationKind` stays `never`
in `types.ts` with a comment explaining exactly this.

## 11. Feature flag behavior

`GYMINI_UNIFIED_AI_COACH` (`conversational-intelligence/index.ts::unifiedCoachMode()`), default `off`:
- `off` — the bounded-turn plan is never even computed; zero behavior change, zero new log lines.
- `shadow` — the plan IS computed and logged (`bounded_turn_plan` structured event) for observability; the
  executor is **never** called, so the visible answer is byte-identical to `off`. Verified: the `flag SHADOW`
  route-parity test asserts the PT composite answer contains neither new candidate name, matching `off`
  exactly.
- `on` — the executor runs for `BOUNDED_EXECUTOR` plans only; every other plan (`EXISTING_MULTI`/
  `UNSUPPORTED`) is completely unaffected by this flag's value.

Documented dependency: Batch 3 behavior can only ever engage when `CONVERSATIONAL_INTELLIGENCE_V2` is also
`on` (MULTI only exists inside `runGlobalTurn`) — `CONVERSATIONAL_INTELLIGENCE_V2`'s own default remains
unchanged (`off`).

## 12. PT multi-intent evidence

`__tests__/bounded-turn-route-parity.test.ts::"flag ON..."` — real `fitnessAgent.tryTurn()` call with
`GYMINI_UNIFIED_AI_COACH=on` and `CONVERSATIONAL_INTELLIGENCE_V2=on`: "PT hiện tại của tôi là ai và PT nào
phù hợp hơn với tôi?" returns one combined answer containing both the real current-PT fact (from the real
READ, via stubbed `readerDeps.get`) and real recommendation candidate names (from stubbed
`findPTCandidates`/`narrateRecommendations`, scored by the real `scorePT`). No raw internal score string
(e.g. `rankScore`, a bare decimal) ever appears in the user-facing text.

## 13. Nutrition multi-intent evidence

Not newly built — already covered by the pre-existing `EXISTING_MULTI` path, confirmed working end-to-end by
the brief's own canonical Example B and by the unchanged 132/132 pass on
`conversational-intelligence-{global,v2,remediation}.test.ts` (§17), which already exercises nutrition-macro +
recommendation composites.

## 14. Workout READ/proposal evidence — deferred

Not applicable this batch — see §10. No test exists for Class C/D because nothing was built; the absence is
intentional, not an oversight.

## 15. Interruption/resume evidence

`__tests__/bounded-turn-route-parity.test.ts::"interruption/resume generalized to a SECOND workflow type
(FIND_PT)..."` — real DB, real `fitnessAgent.tryTurn()` calls: start `FIND_PT` (budget intentionally unknown
so it genuinely pauses, `expectedSlot: "budgetVnd"`) → an unrelated goal `READ_STATE` question is answered
AND the workflow row is asserted byte-identical (`id`/`status`/`expectedSlot`/`slotsJson`) before vs. after →
resume with "1 triệu rưỡi" completes the SAME row, never a second one. Generalizes Phase 2B's
`CREATE_WORKOUT_PLAN`-only proof to a second workflow type, per the brief's §33.

## 16. LLM-call-count evidence

`__tests__/bounded-turn-executor.test.ts::"T11..."` — a closure-based counting spy on `narrateRecommendations`
asserts **exactly one** call for the full PT-composite execution (read + score + narrate + compose) — the
same single narration call the existing one-shot PT search path already makes; the planner/executor
themselves add zero extra LLM calls (`planBoundedTurn` is proven synchronous by construction; `executor.ts`
imports nothing from `llm.service.ts` for anything other than the one pre-existing narration call it reuses).

## 17. No-write-before-confirmation evidence

Three independent lines of evidence, all real:
1. Code inspection: `executeBoundedTurn` contains zero `prisma.*.create`/`update` calls and zero
   `FitnessAgentAction` construction — it only reads and composes text.
2. `__tests__/bounded-turn-route-parity.test.ts::"cross-user isolation..."` asserts
   `agentWorkflowSession.count({where:{userId}})` is exactly `0` after a `BOUNDED_EXECUTOR`-handled turn for
   both users — a read-only composite creates no workflow row.
3. `__tests__/bounded-turn-executor.test.ts::"T11..."` asserts `result.blocks.length === 0` — no
   `PT_RECOMMENDATIONS` card, no hire action, nothing selectable/confirmable was created.

## 18. Partial-failure evidence

`__tests__/bounded-turn-executor.test.ts::"T21/partial failure..."` — `readerDeps.get` throws (simulating a
user-service outage); the recommendation still succeeds and is returned — a failed READ never discards an
otherwise-successful recommendation. `"T22..."` — the inverse: `findPTCandidates` itself throws; the whole
composite returns `null` (the existing offer-only fallback takes over) — never a hallucinated recommendation.
Both reused in the real-DB route-parity suite via the "incomplete preferences" case (missing `budgetVnd` →
`null`, falls back to the existing offer text, never guesses a budget).

## 19. Cross-user evidence

`__tests__/bounded-turn-route-parity.test.ts::"cross-user isolation..."` — two distinct users (`u-a-*`,
`u-b-*`) issue the PT-composite turn concurrently (`Promise.all`); each resolves independently through its own
authenticated identity, and neither creates a workflow row attributable to the other. Also structurally true
by construction: `executeBoundedTurn` takes `identity: AgentIdentity` as an explicit parameter on every call,
no shared module-level per-user cache exists in `bounded-turn/*`.

## 20. Focused tests

```
cd backend/services/ai-service
NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test \
  INTERNAL_SERVICE_SECRET=test_internal_service_secret_32_chars_minimum \
  JWT_SECRET=test_jwt_secret_32_chars_minimum_value REDIS_URL=redis://localhost:56379 \
  npx tsx --test src/__tests__/bounded-turn-planner.test.ts src/__tests__/bounded-turn-executor.test.ts \
  src/__tests__/bounded-turn-route-parity.test.ts
# -> tests 21, pass 21, fail 0 (11 planner + 5 executor + 5 route-parity)
```

## 21. Regression tests

```
npx tsx --test src/__tests__/conversational-intelligence-global.test.ts \
  src/__tests__/conversational-intelligence-v2.test.ts src/__tests__/conversational-intelligence-remediation.test.ts \
  src/__tests__/enterprise-data-layer.test.ts src/__tests__/context-assembler.test.ts \
  src/__tests__/turn-understanding-adapters.test.ts src/__tests__/turn-understanding-route-parity.test.ts \
  src/__tests__/bounded-turn-planner.test.ts src/__tests__/bounded-turn-executor.test.ts \
  src/__tests__/bounded-turn-route-parity.test.ts
# -> tests 132, pass 132, fail 0 (byte-identical to pre-Batch-3 on every pre-existing file, plus the 21 new)

LLM_PROVIDER=mock npx tsx --test src/__tests__/*.test.ts  (full suite)
# -> see §22 for the exact numbers from this batch's own run
```

## 22. Full-suite result

```
LLM_PROVIDER=mock npx tsx --test src/__tests__/*.test.ts
# -> tests 860, pass 850, fail 6, skipped 4  (duration ~42.7s)
```
860 = 839 (Batch 2 baseline) + 21 new (11 planner + 5 executor + 5 route-parity). The 6 failures are the
exact same 6, by name, as the Batch 2 baseline — `ollama chat payload is unchanged`, `ollama health still
requires both local models` (Ollama model-name drift, pre-existing/environmental since Phase 2),
`selection wording is unchanged: 'Tôi tập được thứ 3, 5, 7' still SELECTS those days`, and the
Bodyweight/Home-gym/Commercial-gym equipment-persona tests (Pipeline B/legacy-mode live-fitness-service
requirements) — zero new failures, 4 skipped unchanged. Re-run twice to rule out log contamination from an
earlier (correctly discarded) run against a real, unavailable local Ollama provider; both clean runs agree.

## 23. Intentional behavior changes

Exactly one, gated behind a flag that defaults off: when `GYMINI_UNIFIED_AI_COACH=on` AND
`CONVERSATIONAL_INTELLIGENCE_V2=on` AND the turn is a READ + RECOMMEND(PT/PROGRAM) composite with complete
preferences, the user now gets a real inline recommendation instead of an "offer to search separately"
message. With the flag at its default (`off`) or `shadow`, there is no behavior change at all — confirmed by
the route-parity tests and the unchanged regression suite.

## 24. Remaining limitations

- Class C/D (workout READ + exercise-replacement PROPOSAL) has no safe implementation path today — see §10.
  Would need a real fitness-service endpoint for persisting a program-template exercise swap, a decision that
  belongs to the AI-workout-grounding domain owner, not this batch.
- The bounded executor only covers PT/PROGRAM RECOMMEND compositions — any other RECOMMEND topic paired with
  a READ already works via `EXISTING_MULTI` and was never broken, so there was nothing further to bound.
- `MAX_READS=2`/`MAX_RECOMMENDATIONS=1`/`MAX_PROPOSALS=0` are hard limits with no escalation path (e.g. a
  3-part turn is simply marked unsupported, not partially executed) — acceptable for this batch's bounded
  scope, worth revisiting only if real user turns are observed hitting the limit (no evidence of that yet;
  nothing instruments how often `UNSUPPORTED` fires in production).
- `unifiedCoachMode()`'s `shadow` state logs a plan but there is no dashboard/alert consuming
  `bounded_turn_plan` events yet — purely a structured-log trail today, same maturity level as Batch 2's
  `turn_understanding` event.

## 25. Recommended Batch 4 entry point

If a future batch wants to pursue Class C/D, the entry point is a real product/architecture decision (not an
engineering one): should "đổi bài tập" semantics gain a second mode — "swap for this one session" (today's
behavior, unchanged) vs. "replace in my program going forward" (a new, persisted `WorkoutProgramExercise`
mutation) — and if so, whose domain builds the new fitness-service endpoint. Until that decision exists,
`ProposalOperationKind` should stay `never`. Separately, `compareUnderstandings` (Batch 2, built but unwired)
remains available if a future batch wants shadow-mode disagreement detection between the legacy and canonical
turn representations.

**Stop after Batch 3. Batch 4 is not started.**
