# Phase 3 — Current AI Architecture Map

**Purpose**: ground-truth map of Gymini's current AI/conversational implementation (ai-service), produced before
any Phase 3 "Unified Context-Aware AI Coach" implementation. Engineering reference, not a research artifact.
**Date**: 2026-10-05. **Method**: direct code inspection + 3 parallel research passes (data access, recommendation

> **Batch 1 update (2026-10-05)**: the nutrition-goal-validation inconsistency flagged in §C below (only
> `profile_extractor.ts` guarded `/nutrition/goals` against the DEFAULT/non-ACTIVE placeholder) is now
> **resolved** for `readers.ts`/`nutrition_context.ts` — see `docs/ai-product/phase3-batch1-context-
> foundation.md`. The rest of §C's fragmentation findings still stand as described; not re-verified here.
systems, model abstraction); old docs were not trusted as current — every claim below is grounded in file:line.

---

## A. Conversational Intelligence

Two parallel, overlapping typed "turn understanding" layers exist, plus the legacy regex router — not yet one:

1. **Legacy regex router** — `services/fitness-agent-intent.ts::parseFitnessAgentIntent` — plain regex → `kind`
   (`CREATE_WORKOUT_PLAN`, `PT`, `PROGRAM`, `EVALUATE`, `CYCLE_COMPLETE/CANCEL`, `WORKOUT_START/SKIP/CANCEL`,
   `REVIEW`, `SELECT`, `ROADMAP_*`, `CREATE_PLAN_BUNDLE`, `SAVE_GENERATED_PLAN`, `CREATE_NUTRITION_PLAN` — 15+
   kinds). Always runs; the only router in production today, since CI-V2 defaults off (see below).
2. **`conversational-intelligence/interpreter.ts::interpretDeterministic`** — produces a rich typed
   `SemanticInterpretation`: `primaryIntent` (`CORRECT_INFORMATION | START_WORKFLOW | ASK_RECOMMENDATION |
   ANSWER_QUESTION | PROVIDE_INFORMATION | CONFIRM | DISMISS | UNKNOWN`), `entities` (span-consuming, unit-aware
   extraction via `entity-extractor.ts`), `corrections`, `references`, `goalSignals`, `requestedAction`. This is
   **structurally almost exactly** what Phase 3 §5 asks for as the unified turn object — it already exists, just
   scoped to the profile/goal-change workflow path (`agent-workflow/orchestrator.ts::handleSemanticTurn`), not
   wired as the universal entry point for every domain.
3. **`conversational-intelligence/global/router.ts::classifyGlobal`** — a *separate* top-level classifier,
   producing `GlobalRouteResult` (`READ_STATE | RECOMMEND | WRITE_ACTION | START_WORKFLOW | KNOWLEDGE_QA |
   SLOT_ANSWER | CORRECTION | CANCEL | SWITCH_WORKFLOW | REFERENCE | EXPLAIN_AND_PROPOSE | NEGATE_ACTION | MULTI |
   UNKNOWN`), internally reusing `interpretDeterministic`/`signals.ts` for some checks but not exposing the same
   shape. Drives `global-turn.ts::runGlobalTurn` — cross-domain READ/RECOMMEND/interruption handling.
4. **Typed LLM fallback** — `global/llm-route.ts::llmRoute` — only consulted when the deterministic router
   returns `UNKNOWN`; closed output enum (`READ_STATE|RECOMMEND|KNOWLEDGE_QA|OTHER`), topic must be corroborated
   by evidence regex in the message text (`EVIDENCE` map), pain/injury wording always rejected, can never start a
   workflow or propose a write (`limitLlmRoute`, reapplied by the caller so a substituted model can't bypass it).
   Well-designed, reusable pattern for "ask the model only when deterministic rules are unsure, then re-validate
   in TypeScript."
5. **Correction/reference handling** — `signals.ts::detectCorrections`/`detectReferences`/`hasCorrectionCue` —
   real deterministic patterns for "3 buổi" → "À không, 4 buổi" (later value wins, never averaged), and reference
   kinds `ACCEPT_PROPOSAL | LOWER_OPTION | HIGHER_OPTION | MIDDLE_OPTION | FIRST_ITEM | THIS_ITEM |
   PREVIOUS_STATE` — the "bài đó"/"mức đó" pronoun-resolution the brief's §9 wants already has deterministic
   coverage, not built from scratch.
6. **Provenance** — `belief-state.ts` — `BeliefSource` enum `CURRENT_CORRECTION > CURRENT_USER >
   CONFIRMED_WORKFLOW > AUTHORITATIVE_DB > STABLE_MEMORY > INFERENCE` (`SOURCE_RANK`), used for *reasoning only*
   — persistence is untouched until confirm. This is **already the provenance model the brief's §8 describes**,
   under a different name.
7. **Interruption/resume** — `global-turn.ts::runGlobalTurn` returns a `result` directly, before the slot
   orchestrator (`runWorkflowTurn`) is ever called — verified empirically in this repo's own Phase 2B work: an
   unrelated READ while a `CREATE_WORKOUT_PLAN` workflow is `COLLECTING_SLOTS` leaves that workflow row
   byte-identical. **Critical caveat**: this entire mechanism (points 3-4-7) is gated behind
   `CONVERSATIONAL_INTELLIGENCE_V2`, which **defaults to `"off"` in code AND in the real dev/prod compose** —
   confirmed in `conversational-intelligence/index.ts:25` and `docs/research/workout-plan-bpm/02-as-is-process.md:8-10`.
   **In today's actual running system, cross-domain interruption/multi-intent/typed-LLM-fallback do not engage
   at all** — only the legacy per-workflow slot orchestrator (item 1) runs.

## B. Agent Orchestration

- **Dispatcher**: `services/fitness-agent.service.ts::tryTurnUnguarded` — fixed order: `ownSession` →
  `tryConfirmationBoundary` → `accumulateNutritionWorkflowConstraints` → `tryExplainRecommendation` →
  `runGlobalTurn` (CI-V2 only) → `runWorkflowTurn` (slot orchestrator) → dispatch on `effectiveKind` (15+ kinds,
  see A.1) → `routePendingDraftTurn` (free-text revision on an existing draft) → food-substitution/meal-log
  specialists → generic RAG/chat pipeline (`orchestrator.service.ts`) as the final fallback.
- **Workflow types** (slot-collection state machine, `agent-workflow/orchestrator.ts::runWorkflowTurn`, generic
  across all 5): `create-workout-plan`, `create-nutrition-plan`, `update-goal`, `roadmap` (= `CREATE_PLAN_BUNDLE`/
  `CREATE_ROADMAP`), `find-pt-program`. States: `COLLECTING_SLOTS → AWAITING_SLOT_CONFIRMATION → WRITING →
  COMPLETED` or `CANCELLED`/`EXPIRED` (`agent-workflow/types.ts`). The orchestrator owns *which fields are
  required* and *transition rules*; domain generation/ranking/writes live one layer down in
  `fitness-agent.service.ts`'s own methods (`proposeWorkoutPlan`, `proposeNutritionPlan`, etc.) — not in the
  workflow files themselves (each is a small ~70-line slot declaration).
- **Pending-action lifecycle** (`FitnessAgentAction`, real Postgres row): `PENDING → EXECUTING → COMPLETED`, or
  `CANCELLED`. Confirm is an atomic conditional `updateMany` (only one caller can ever claim `PENDING→EXECUTING`);
  a downstream failure releases the claim back to `PENDING`, never stuck/falsely-completed (verified with real
  DB tests, Phase 2). Expiry (`expiresAt`, 15 min) is computed at read time, **never** a persisted status flip —
  this already matches the brief's §16 lifecycle almost exactly (its `PROPOSED`/`PENDING_CONFIRMATION` map onto
  the single `PENDING` status plus the draft-vs-workflow distinction; no new states are needed).
- **Dismissal**: `dismissDraft`, scoped to `CREATE_WORKOUT_PLAN`/`CREATE_NUTRITION_PLAN` kinds only today — PT/
  program recommendations use a separate `fitnessRecommendation` row (no dismiss concept; they're read-only
  until `SELECT`→`prepare`).
- **Confirmation-boundary truthfulness** (`confirmation-boundary.ts`, `tryConfirmationBoundary`) — independently
  hardened in the X1-X4 remediation program (reused evidence, not re-verified this phase) — a bare "đã lưu chưa?"
  always resolves from real DB state, never from the assistant's own prior chat text.

## C. Authoritative Data Access (today's de facto "Enterprise Data Agent")

**No consolidated Enterprise Data Agent exists.** Confirmed 5-6 independent HTTP mechanisms, each re-deriving
overlapping facts about the same user, via 3 different transport abstractions (raw `axios`, the Zod-validated
`domain()` helper, and the Lambda-or-HTTP `requestService()`):

| Domain | Independent call sites found | Fragmented? | Most authoritative |
|---|---|---|---|
| Profile/goal/weight/height | 5 (`profile_extractor.extract`; `getUserFitnessContext`→`/profile/agent/context`; `user.client.fetchUserGoalAndLevel`→`/internal/profile/:id`; `worker-user-context`→`/internal/profile/:id`; `readers.ts::readGoal` chains into #2) | **Yes** | `profile_extractor.ts::extract` |
| Workout program/history/schedule | 5-6 — `/workouts/programs/current` alone has 3 separate call sites (`profile_extractor`, `workout_schedule_context`, `readers.ts::readProgram`) | **Yes** | `workout_schedule_context.ts` for schedule; no single authority for program-current |
| Nutrition targets/history | 4+ — `/nutrition/goals` has 3 call sites with **inconsistent validation** (only `profile_extractor` guards against the DEFAULT/non-ACTIVE placeholder; `readers.ts`/`nutrition_context.ts` don't) | **Yes, worst case** | `profile_extractor.ts`'s `nutritionGoal` derivation |
| Equipment | No direct typed read of real `UserEquipment`; only transitive via 2 internal fitness-service endpoints, one of which (`validate-plan-equipment`) has 2 independent ai-service callers (`fitness-agent-tools.ts` via `domain()`, `ai.worker.ts` via `requestService()`) | Partially | `ai.worker.ts`'s final-invariant call (explicitly the pipeline's "last word") |
| PT/contract state | 1 reader (`readContracts`) + 1 search (`findPTCandidates`, a real server-side rank/search, not a plain read) | **No** — cleanest domain | n/a |
| Exercise catalog | 1 each (`searchExerciseByName`, `getExerciseSubstitute`) | **No** | n/a |

Only `profile_extractor.ts` caches (15s TTL) or applies a freshness/validity guard. In at least two cases
(workout schedule questions, nutrition questions) **two independent HTTP paths fire in the same chat turn** for
the same user — real, measurable duplicate latency and a window for inconsistent snapshots.

## D. Recommendation Systems

Better separated than data access, but genuinely duplicated in specific places:

- **Exercise/workout (chat)**: `recommendation_engine.ts::recommend()` returns a pure-data `RecommendationResult`
  across 12 intent types; narration is a separate, per-intent-selected step (`response_formatter.ts` deterministic
  template, OR real LLM via `promptBuilder`+`callLLM` for 6 specific intents) — clean split, deterministic
  fallback always available.
- **Program ranking**: `scoreTrainingProgramV2` (`@gym-coach/shared/fitness-agent-scoring.ts`) — pure
  numeric/components scoring (v1 `scoreTrainingProgram` still exists but is dead in production, evaluator-only).
  Narration (`narrateProgramRecommendations`) is an LLM **claim-ID selector** over a deterministic claim catalog
  — explicitly forbidden from inventing numbers/facts — then deterministically rendered to text.
- **PT ranking**: `scorePT`, same claim-ID-selection/render pattern (`recommendation_narrator.ts`), independently
  implemented in near-identical shape to the program one. `tryExplainRecommendation` reuses the **persisted**
  structured `why[]`/`compatibility.total` — no re-scoring, no new LLM call. This is the cleanest example of the
  "structured recommendation authoritative, narration presentation-only" pattern (brief §13/§14) already in
  production, built before this brief existed.
- **Nutrition**: target/macro computation (`nutrition_calculator.ts`) is 100% deterministic, zero LLM. Actual
  meal-plan generation is a **third, separate mechanism** (`nutrition.processor.ts`, real LLM call constrained to
  one day's food-role *structure* only, deterministic quantity expansion + bounded-least-squares repair +
  invariant gate) — same "LLM picks a narrow structural choice, math does the rest" family as the PT/program
  narrators, but with no shared type.
- **Real duplication flags for Phase 3**:
  1. **Three workout-plan-producing mechanisms** with no shared structured-recommendation type: rank existing
     admin templates (`scoreTrainingProgramV2`), deterministically generate a novel plan from the exercise
     catalog (`generateWorkoutDraft`, the chat agent's path — Phase 2's own equipment-filtering fix lives here),
     and have the LLM generate a novel plan's JSON directly (`ai.worker.ts`'s `processAiTaskJob`, the
     `/plans/workout/generate` wizard path). A user can reach either (b) or (c) depending on UI entry point.
  2. **Three "meal plan" shapes** with no shared type: `NutritionTargets`, `MealPlanTemplate` (chat-only),
     `NutritionPlanContent` (persisted/repaired).
  3. **The claim-catalog narration pattern is implemented twice** (PT, program) with near-identical
     schema/fallback/logging — a real candidate to collapse into one generic module.

## E. AI Model Abstraction

- **`llmService`** (`services/llm.service.ts`) — `callLLM`/`callLLMChat`/`callLLMStream`/`generateEmbedding`/
  `getHealthStatus`. Provider-branched (`mock|anthropic|bedrock|ollama|generic-OpenAI-compatible`), no retry of
  its own (single call, throws typed `LlmError` on failure — connection-refused vs timeout vs other, explicitly
  distinguished since callers regex-match the wording). Several independent timeout knobs exist
  (`LLM_TIMEOUT_MS` default 60000, `AI_CHAT_LLM_TIMEOUT_MS` for chat, `CYCLE_ANALYSIS_LLM_TIMEOUT_MS` for
  `callLlmJson` default 80000, `AI_PLAN_TIMEOUT_MS` for plan generation 65-120s clamp, `callLLMStream`'s own
  120000 default) — functioning but not consolidated into one config surface.
- **`callLlmJson`** (`llm/json_llm_call.util.ts`) — the one shared "JSON-mode LLM call + Zod validation + retry
  (default 2 attempts) + never-throw-return-null-on-exhaustion" pattern, used at **14 real production call
  sites** across interpretation, routing, roadmap/plan drafts, cycle assessment, recommendation narration, and
  nutrition structure generation. `redactErrorDetail` prevents logging untrusted model output. This is exactly
  the brief's §20 requirement ("every LLM structured response must use callLlmJson + Zod") — **already the
  universal convention**, not something to introduce.
- **Qwen3 4B**: `qwen3:4b-instruct-2507-q4_K_M` is the real default everywhere that matters — code fallback,
  both `.env.example` files, and all three compose files (test/dev/prod). No 30B reference exists in any
  `.env.example`/compose file; every 30B mention found is a benchmarking/eval-script artifact or a historical
  code comment, never a configured runtime default.
- **Feature flags** (AI/conversational, `process.env`-gated): `CONVERSATIONAL_INTELLIGENCE_V2` (default `off`),
  `CONVERSATIONAL_INTELLIGENCE_V2_LLM` (default `off`), `ENABLE_TOOL_CALLING` (default `false`),
  `ENABLE_LLM_SELF_EVAL`, `ENABLE_RECOMMENDATION_NARRATION`/`ENABLE_PROGRAM_RECOMMENDATION_NARRATION` (both
  **default ON**, opt-out), `DEBUG_INTENT_ROUTING` (default off, local-only). The existing
  `docs/production-readiness/01-system-inventory.md` flag table is accurate but not exhaustive — missing the
  narration/self-eval/debug flags above.
- **Telemetry**: a real structured-trace family already exists (`ci_global_trace`, `ci_global_llm_route`,
  `ci_v2_turn`, `ci_confirmation_boundary`, `ci_turn_transition`, workflow-level events) — deliberately
  **ids/enums only, never raw message text**, per an explicit in-code design comment. One exception:
  `"AI coach intent routing resolved"` (`orchestrator.service.ts`) logs raw message text, but only when
  `DEBUG_INTENT_ROUTING=true` (off by default, never set in any compose/.env.example — manual local debug only).
- **Model-failure handling**: confirmed real, consistent guard code at 4+ sites — Anthropic safety-refusal →
  thrown error (never silently passed through); empty-answer → deterministic fallback; any `callLLM` throw →
  caught, logged with a `fallbackReason`, deterministic answer substituted; `callLlmJson` invalid/empty JSON →
  retried then `null` → caller's own deterministic template. No site found that mutates state before this guard
  clears.

## F. Batch 5 status (factual, as of 2026-10-06)

- Flags and defaults: `GYMINI_UNIFIED_AI_COACH` (`off`/`shadow`/`on`, default `off`), `CONVERSATIONAL_INTELLIGENCE_V2` (default `off`),
  `CONVERSATIONAL_INTELLIGENCE_V2_LLM` (default `off`). Production compose sets none of them. See
  [phase3-batch5-rollout-readiness.md](phase3-batch5-rollout-readiness.md) §2.
- Reader fallback (`conversational-intelligence/global/readers.ts` `readState`): authorization errors (401/403) are rethrown; profile-read
  errors are classified by `profile-errors.ts`; for `GOAL`/`PROFILE_FACT` other errors are rethrown; other readers keep the degraded text.
- AI-unavailable fallback (`llm/orchestrator.service.ts` `buildAiUnavailableFallback`): states only that no answer was produced and nothing
  was recorded or changed.
- Semantic route acceptance (`conversational-intelligence/global/llm-route.ts`): accepts the typed model route without a read/write mismatch
  guard. Observed to accept `READ_STATE` for a pending-draft revision (open item N2).
- Equipment gate: draft-time validation fails open; confirm-time validation in fitness-service is the backstop (open item N4).
