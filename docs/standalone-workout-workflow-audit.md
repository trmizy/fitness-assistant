# Standalone CREATE_WORKOUT_PLAN — Audit

Date: 2026-09-18. Pre-implementation audit for the "AI Coach Product
Capability Expansion" task, covering what already exists in the codebase
for workout-plan generation/persistence before any new code was written.
Code wins documentation — every claim below was verified by reading the
actual source, not by trusting a prior doc.

## 1. Three distinct "workout generation" mechanisms already exist

| Mechanism | Where | Persists? | Exercise identity |
|---|---|---|---|
| Real LLM async job | `POST /plans/workout/generate` → `ai.worker.ts` → `WorkoutPlan` row (BullMQ) | Only via a later `/save-to-workout-log` call | Real `Exercise.id`, equipment-validated |
| Deterministic template | `llm/recommendation_engine.ts` (`recommendationEngine.recommend`) | Never — chat-only prose today | Free-text exercise NAMES, no id |
| Pre-authored template selection | `WorkoutProgramTemplate` + `agent-program.service.ts` | Yes, via `applyTrainingPlan` | Real `Exercise.id` (curated at template-authoring time) |

FIND_TRAINING_PROGRAM/`CREATE_PLAN_BUNDLE`'s workout leg uses the THIRD
mechanism (finds an existing eligible template, deterministic ranking
v2) and is explicitly out of scope — this task's CREATE_WORKOUT_PLAN
generates a fresh draft, it does not select from `WorkoutProgramTemplate`.

`SAVE_GENERATED_PLAN` (already shipped, chat-only) already bridges the
SECOND mechanism into a real write: it re-runs
`intentRouter.route`/`inputParser.parse`/`recommendationEngine.recommend`
against the same question that produced the last chat answer, resolves
every returned exercise NAME against the real catalog via
`fitnessAgentTools.searchExerciseByName` (dropping anything unmatched —
never persisting a raw string), and calls
`fitnessAgentTools.importAiPlanToSchedule` (`workout.service.ts`'s
`importAiPlanToSchedule`, `POST /workouts/from-ai-plan`).

**Decision**: CREATE_WORKOUT_PLAN reuses this exact SAVE_GENERATED_PLAN
pipeline as its generation engine (`generateWorkoutDraft` in
`fitness-agent.service.ts`) rather than inventing a fourth mechanism. The
only new logic is a deterministic session-length trim (see §3) and the
workflow shell that collects `daysPerWeek`/`sessionMinutes` before
generating.

## 2. `importAiPlanToSchedule` is the single real persistence boundary

`workout.service.ts::importAiPlanToSchedule` (called via
`POST /workouts/from-ai-plan`):

- Idempotent per `(userId, sourcePlanId)` — `@@unique([userId, sourcePlanId])`.
  Re-confirming the SAME `FitnessAgentAction.id` as `sourcePlanId` is
  therefore a no-op the second time, not a duplicate write.
- Fail-closed exercise resolution via
  `exerciseReferenceResolver.resolve()` — strict, zero fuzzy matching.
- Auto-runs `validateAiPlanExerciseEquipment` internally — CREATE_WORKOUT_PLAN
  does not need to duplicate equipment validation in ai-service.
- `replaceExisting` defaults `true` — destructive: deletes ALL incomplete
  `WorkoutSchedule` rows for the user, not scoped to one program. Reused
  as-is (same behavior `SAVE_GENERATED_PLAN` already accepts).
- `allowCreate: false` internally — will not create a new `TrainingCycle`;
  409s if an active roadmap phase exists with no active cycle. Not
  worked around — this is existing, intentional business behavior.

`applyTrainingPlan` (`agent-program.service.ts::apply`) is a DIFFERENT
mechanism for TEMPLATE selection (fingerprint-staleness-checked, richer
set prescriptions, injury/experience gates via `candidates()`) — confirmed
NOT the right tool for AI-generated content, since generated content has
no template `id`/`fingerprint` to check against.

## 3. Real gaps found (and how CREATE_WORKOUT_PLAN handles each)

- **No session-length consumption anywhere.** `recommendation_engine.ts`'s
  `buildWorkoutPlanTemplate` reads `trainingDaysPerWeek`, never a duration.
  Handled by a new, isolated, deterministic trim
  (`trimDayForSessionMinutes` in `fitness-agent.service.ts`) applied AFTER
  generation — bounded (`Math.max(3, sessionMinutes / 8)` exercises/day),
  never expands a day, only shortens it.
- **No reusable injury/experience-level validator for GENERATED plans.**
  Only `agent-program.service.ts`'s `candidates()` gate exists, and that is
  specifically for TEMPLATE selection. Rather than duplicate/invent a
  second gate, CREATE_WORKOUT_PLAN surfaces `safetyScreeningStatus`/
  `injuries` as an honest, visible WARNING on the preview
  (`workoutSafetyWarnings`) — mirroring `roadmap-draft.service.ts`'s own
  soft-warning treatment of the identical `FOLLOW_UP_SUGGESTED` signal —
  rather than a false sense of a hard block that doesn't really exist.
  This is a disclosed, real gap, not silently ignored.
- **No coarse-vs-granular substitution mismatch to avoid duplicating.**
  `recommendation_engine.ts` has its own coarse 3-tier equipment
  substitution (full-gym / dumbbell-only / bodyweight-only). The live
  "Đổi bài tập" workout-execution UI instead uses the granular, real,
  movement-pattern/muscle-overlap-scored
  `exerciseSubstitutionService.rankSubstitutes` via
  `GET /exercises/:id/substitute`. CREATE_WORKOUT_PLAN's own revision loop
  (named-exercise exclusion, "cho phương án khác") reuses the SECOND one
  — added as a new `fitnessAgentTools.getExerciseSubstitute` wrapper —
  never `recommendation_engine.ts`'s own coarse mechanism, and never a
  third, new substitution implementation.

## 4. Intent routing

`intentRouter.route()`'s own routing regex is Unicode-diacritic-aware
(e.g. `l[iị]ch t[aậ]p`), unlike `input_parser.ts`'s cruder ASCII-only
`inferIntent`. `proposeSaveGeneratedPlan`'s existing override
(`parsedInput.routeIntent = routedIntent.intent`) means the GOOD regex is
what actually determines routing — confirmed safe to feed a synthesized
Vietnamese question ("Tạo lịch tập N buổi mỗi tuần cho tôi") through the
same call for CREATE_WORKOUT_PLAN's own generation.

`intentRouter`'s `inferMuscleGroup` (used by the "Ngày chân nhẹ hơn."
revision) is NOT diacritic-aware (`question.toLowerCase()` only, no accent
stripping) — a real, easy-to-miss inconsistency inside the same module.
Found while wiring the day-intensity revision; worked around by feeding
already-normalized (`normalizeAgentText`) text into `intentRouter.route`
specifically for that one call, which is safe because its OTHER regexes
accept the plain-ASCII branch of their character classes too.

## 5. Collision found: `SAVE_GENERATED_PLAN`'s intent regex

`fitness-agent-intent.ts`'s `mentionsSaveGeneratedPlan` check
(`/\b(gan|luu|ap dung|apply|save)\b/` + `/\b(lich tap|...)\b/`) is checked
BEFORE the new `mentionsCreateWorkoutPlan` check, and would misfire on a
natural "lưu lịch tập này" while a CREATE_WORKOUT_PLAN draft (a different,
newer mechanism) is pending, since `proposeSaveGeneratedPlan` has no
awareness of the new action type. Fixed with a small guard at the top of
`proposeSaveGeneratedPlan` that redirects to the real pending draft
instead of creating a competing action — see
`standalone-workout-workflow-design.md` §4.

## 6. What was intentionally NOT touched

- `agent-workflow/orchestrator.ts` — zero changes. CREATE_WORKOUT_PLAN's
  slots are plain `WORKFLOW_ONLY`, so the existing candidate/finalize/
  pre-write validation stages and PROFILE_FACT confirmation path are
  simply not exercised (there is no `validateContext` on either slot);
  nothing new was added to the orchestrator's state machine.
- `exerciseSubstitutionService`, `validateAiPlanExerciseEquipment`,
  `exerciseReferenceResolver` — reused verbatim via existing entry points,
  never modified.
- `WorkoutProgramTemplate`/FIND_TRAINING_PROGRAM/`applyTrainingPlan` —
  untouched; a fully separate code path from CREATE_WORKOUT_PLAN.
