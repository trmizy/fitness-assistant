# Domain ownership matrix (detailed)

Verify against current code before relying on this — schemas evolve.
Service names in brackets show which microservice's Prisma schema owns
the model.

| Domain | Model | Owns | Real/known read paths | Notes |
|---|---|---|---|---|
| Identity | `User` [auth-service] | account identity, role | every service, via JWT | Never trust a body-supplied user id for the acting identity. |
| Profile | `UserProfile` [user-service] | demographics, goal, activity level, experience, injuries | fitness-service via `fetchUserProfile` (cross-service HTTP) | Cached snapshot type in fitness-service's `user.client.ts`, not a live join. |
| Body state | `InBody` entries [user-service] | measured weight/body-fat/muscle/etc. | fitness-service via `fetchInBodyHistory`/`fetchInBodySeries`/`fetchInBodyById`/`getLatestOnOrBefore` | `TrainingCycle.startInbodyId`/`endInbodyId` captured once at cycle boundaries, never backfilled. |
| Journey | `FitnessRoadmap` [fitness-service] | the long-term plan, `status`, `createdByRole` | `fitness-roadmap.service.ts` | One ACTIVE + one non-archived DRAFT per user, enforced service-side. |
| Strategy | `RoadmapPhase` [fitness-service] | one strategic phase, `phaseType`, `status` | same service | Never authoritative for calories/macros — see SKILL.md. |
| Execution block | `TrainingCycle` [fitness-service] | one cycle's execution/evaluation window | `training-cycle.service.ts` | `planId` always null for Roadmap-driven cycles. |
| Prescription | `WorkoutProgram`/`WorkoutProgramDay`/`WorkoutProgramExercise` [fitness-service] | the training plan structure | `workout.service.ts` | `WorkoutProgramExercise.order` is 1-based (schema `.min(1)`) — a real bug existed from a 0-based caller, see `docs/GYMINI_PT_COACHING_IMPLEMENTATION_REPORT.md`. |
| Scheduled execution | `WorkoutSchedule` [fitness-service] | which program day is scheduled on which real date, for which cycle | `resolveScheduleTrainingCycleId` | THE real program↔cycle link (not a cycle-level field). |
| Exercise identity | `Exercise` [fitness-service] | canonical exercise catalog row | `exerciseReferenceResolver.validatePlanningExerciseIds` | See `gymini-ai-workout-grounding`. |
| Nutrition prescription | `NutritionGoal` [fitness-service] | authoritative calories/macros, versioned | `nutritionRepository.upsertGoal`/`findGoalByUserId` | Real atomic SUPERSEDE+INSERT versioning chain; `previousGoalId` links versions; `trainingCycleId` is provenance-only. |
| Meal plan | `NutritionProgram` [fitness-service] | the actual meal plan a client follows | `nutrition.service.ts` | `sourceGoalId` stamped once, at creation time, from the then-active `NutritionGoal` — never rewritten later even if the goal changes again. |
| Consistency | (derived, no table) | is the current `NutritionProgram` still aligned with the current `NutritionGoal` | `nutrition-goal-plan-consistency.service.ts`, `GET /nutrition/active-state` | Already fully implemented, including a real UI banner in `NutritionPage.tsx` — audit before "building" this again. |
| Decision authority | `CycleAssessment` [fitness-service] | the deterministic training decision (`decision`) + a separate nutrition decision (`nutritionDecision`) on the same row | `cycle-decision.engine.ts`, `nutrition-decision.engine.ts` | `aiSummary`/`nutritionAiHeadline`/`nutritionAiExplanation` are LLM explanation only, never override the deterministic `decision`. |
| Coaching relationship | `Contract` [user-service] | the PT-client relationship, `status` | `contract.repository.ts`'s `findActivePtClientPair` (strict ACTIVE-only) vs. `findActiveOrCompletedByPair` (broader, used by a different, unrelated InBody endpoint — a known, documented inconsistency, see `docs/GYMINI_PT_PERMISSION_MATRIX.md`) | Re-verified fresh on every PT-facing request — never cached. |
| Payment | `PaymentTransaction`, `Wallet`, `WalletLedgerEntry` [payment-service] | real money movement | `webhook.service.ts`'s `handleEvent`/`settleContractPayment` | The MOCK provider was deliberately removed as a security fix — never resurrect it, never bypass signature verification. |
| Forecast | (computed, not persisted as truth) | a non-binding scenario | `fitness-roadmap-forecast.engine.ts`, `fitness-roadmap-reconciliation.engine.ts` | Reconciliation compares forecast vs. actual — the actual side always wins for "what really happened." |
