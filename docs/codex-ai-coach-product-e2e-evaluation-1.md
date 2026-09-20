# CODEX — GYMINI AI COACH PRODUCT E2E EVALUATION #1

Date: 2026-09-18. Evaluated HEAD `96c1040f` plus the current uncommitted capability changes. Production files modified by Codex: **NONE**. Claude remains implementation owner.

## 1. Decision

**RETURN TO CLAUDE**

Confirmed findings: **CRITICAL 0 / HIGH 0 / MEDIUM 7 / LOW 1**. These are scoped findings, not a certification of untested live paths. The signed-off workflow foundation remains signed off. The new product capabilities do not yet satisfy the complete acceptance scenario.

Evidence types used throughout:

- **Workflow integration:** real AI-service action/session/workflow database; external context, catalog, queue, model, and write boundaries stubbed explicitly.
- **Domain integration:** real fitness-service import functions, real catalog and database, isolated generated user IDs; no authenticated HTTP gateway in this harness.
- **Processor fixture:** real nutrition processor and invariant, controlled model/food-service outputs; no live BullMQ job.
- **Browser component:** real production React components and CSS, fixture props in an isolated Playwright session; not a logged-in chat journey.

Reproducible fixtures and output: `test/codex-ai-coach-product-e2e-1/`. Tests assert observed behavior, including known defects; successful probe execution does NOT mean product acceptance passed.

## 2. Current architecture verified

Read the requested Claude audit/design/evaluation/completion documents, foundation closure/sign-off, target architecture, and meeting summary; inspected status, diffs, and last 20 commits. Current code supersedes several claims in those documents:

- No active cycle AND no active roadmap phase permits workout persistence with a null cycle reference.
- Nutrition generation uses deterministic numeric defaults/explicit parameters, not LLM-selected calorie/macronutrient targets.
- The nutrition invariant validates consistency; it is not a profile-derived calorie clamp or protein-floor engine.
- Nutrition import creates `NutritionProgram`, not `NutritionGoal`.

The shared orchestrator was not redesigned or reopened. Other concurrent migration/document changes were left untouched.

## 3. CREATE_WORKOUT_PLAN call graph

`parseFitnessAgentIntent` -> registered `createWorkoutPlanWorkflow` -> missing slots or immediate resume -> `proposeWorkoutPlan` -> `generateWorkoutDraft` -> existing `recommendationEngine.recommend` -> trim -> `searchExerciseByName` -> pending `FitnessAgentAction` -> `WORKOUT_PLAN_PREVIEW` -> revision -> `execute` -> `fitnessAgentTools.importAiPlanToSchedule` -> `/workouts/from-ai-plan` -> `workoutService.importAiPlanToSchedule` -> program/schedules.

No second hidden exercise generator was found. Generation delegates to `llm/recommendation_engine.ts`; new logic resolves IDs and trims the returned days.

## 4. Workout golden flow

PASS at workflow integration boundary: known days, missing duration -> only duration question -> `1 tiếng` -> 60 -> preview. Existing golden test verifies revisions and confirmation with stubbed catalog/write transport. Real domain import independently succeeds. This is not a claim that a live authenticated chat request exercised every service in one uninterrupted run.

## 5. Workout slot reuse/no-repeat

PASS: known days and duration produce an immediate preview, with no unnecessary workflow row. Profile/goal are reused. However, actual preferred weekdays are reduced to a count and are not forwarded on save; see M7.

## 6. Workout canonical exercise identity

Draft payload exercises use resolved `exerciseId`; unknown names are dropped, and the real import rejects an invented ID before writing. Substitution goes through the existing substitute service.

The rendered block contains names/sets/reps, not the IDs themselves (`buildWorkoutPlanPreviewBlock`, `fitness-agent.service.ts:155`). Therefore the literal assertion that every wire-level preview exercise includes an ID is false; canonical identity is retained in the server action payload. No raw-name identity persistence was reproduced.

## 7. Workout revision

PASS: named squat substitution, lighter leg day, unsupported superset preservation, and duration trimming in existing integration tests. Independent 20/45/60/90-minute revisions keep three days and do not increase exercise count. A later longer duration does not restore already-trimmed exercises.

FAIL: `Tôi không có máy cable.` returns null from the action revision handler with cable exercises unchanged. `Tôi không muốn deadlift.` substitutes the exact Deadlift but leaves Romanian Deadlift. Keyword extraction retains `co`/`muon` because shorter regex alternatives match first. See M6.

Day-count changes regenerate through the existing engine; alternative-plan requests use catalog substitution. Neither stores durable exclusions, so regeneration is not a durable preference update. No new business writes occur during these draft edits.

## 8. Workout confirmation/idempotency

PASS for sequential confirmation twice: existing integration test records one import and the second confirmation returns the completed result. Fitness DB has the `(userId, sourcePlanId)` unique constraint. No concurrent HTTP double-click/lost-response stress certification is claimed.

PASS save-intent collision: `lưu lịch tập này` returns the same pending workout action; no competing `SAVE_GENERATED_PLAN` row. It presents confirmation rather than silently saving.

## 9. Workout without TrainingCycle

Real isolated domain test: no roadmap, no cycle -> import succeeds, schedule `trainingCycleId = null`. `allowCreate: false` does not mean all cycle-less users get 409.

Conditional dependency: an ACTIVE roadmap phase with no matching active cycle produces 409 (`workout.service.ts:83`). The chat catches and displays the upstream error with a training-page link, but does not offer a specific cycle-activation recovery. This conditional branch was code-inspected, not seeded and executed in this pass.

## 10. replaceExisting semantics

Real import removed both a past IN_PROGRESS manual schedule and a future NOT_STARTED manual schedule belonging to the isolated test user. Exact predicate: `{ userId, workoutId: null }`, with no date, program, cycle, or status restriction (`workout.service.ts:2689`). Active programs are archived. Rows with linked workout logs are outside this deletion predicate.

The new preview explicitly says confirmation replaces the current unfinished schedule (`fitness-agent.service.ts:160`), and the frontend renders that note. Consequently, this is broad replacement, but not proven undisclosed deletion. It is not counted as a separate HIGH/MEDIUM defect. A user wanting append-only scheduling cannot obtain it through this action. Replacement disclosure should remain visible.

## 11. Workout injury safety

Actual injury representation: `UserProfile.injuries: String[]`; `profileExtractor` maps it to `profile.training.injuries` (`profile_extractor.ts:160`). The new preview warning checks `profile.injuries` instead (`fitness-agent.service.ts:140`). With `training.injuries = ['knee pain']`, the independent workflow probe generated a workout with **warnings: []**. M5 covers this concrete warning omission.

The generic FOLLOW_UP_SUGGESTED warning does work when that separate status exists. Injury text contributes notes in the recommendation engine, not per-exercise exclusion; those recommendation notes are not a replacement for the missing preview warning.

Template selection blocks injured/flagged profiles (`agent-program.service.ts:17`) and excludes any exercise with contraindications (`:46`). Generated-plan import has no equivalent gate. No injury-to-exercise medical mapping or live nonempty contraindication on the sampled generated exercises was established, so this report does not invent a contraindicated diagnosis or classify an unproven mandatory global-rule bypass as HIGH.

## 12. Workout experience-level safety

Experience affects the recommendation summary, not exercise eligibility (`recommendation_engine.ts:562`). A BEGINNER draft includes Romanian Deadlift; the real catalog row is `difficultyLevel: intermediate`. Template selection would exclude that row for BEGINNER (`agent-program.service.ts:47`). Import checks identity/equipment, not beginner eligibility.

This is a real policy difference between generated workouts and template selection. The template gate is not currently a shared mandatory import validator. Treat the missing generated-workout eligibility capability as a documented limitation; do not describe the generated path as equally screened. The independently actionable safety regression is M5's missing promised warning.

## 13. Workout equipment safety

PASS real database test: user equipment deliberately mismatched a published exercise's required equipment; import returned 400 and did not persist that plan. Unknown exercise ID also rejected. With no saved granular equipment, the validator intentionally uses its existing compatibility fallback; that is not proof of equipment ownership.

Catalog substitution preserves canonical IDs and final import still revalidates equipment. The conversational request to exclude cable currently fails earlier (M6).

## 14. CREATE_NUTRITION_PLAN call graph

Intent -> `createNutritionPlanWorkflow` (`mealsPerDay`) -> complete/resume -> `proposeNutritionPlan` -> health check -> `queueNutritionPlanGeneration` -> `NutritionPlan` row + BullMQ task -> `processNutritionPlanJob` -> food catalog/model template -> deterministic expansion -> invariant -> completed row -> next-turn poll -> action PREVIEW -> optional requeue -> explicit execute -> `/nutrition/from-ai-plan` -> `nutritionService.importAiPlan` -> `NutritionProgram`/days/meals/items.

There is no NutritionGoal creation in this graph. Existing goal ID is recorded only for traceability.

## 15. Nutrition async lifecycle

PASS normal lifecycle: missing meals -> one completed workflow -> pending action with phase GENERATING -> completed plan -> PREVIEW. `NutritionPlan` owns job output/status; `FitnessAgentAction` owns conversational generation/preview state. No competing active slot workflow remains after generation starts. No authoritative nutrition program is written by merely queueing or previewing.

## 16. Nutrition polling

PASS: three `xong chưa` messages while queued produce no extra job. Completion promotes the same action; subsequent revisions reuse its ID. FAIL unrelated follow-up handling after task switching: see M4.

## 17. Nutrition revision

Independent probes executed all eight requested phrases: no fish, peanut allergy, lower budget, Vietnamese/easy-to-buy meals, fewer meals, more meals, change breakfast, change this dish. Each queued one replacement job with the expected restrictions/meals parameter; meal counts changed 4 -> 3 -> 4.

These are full regenerations. No previous meal content is passed to the worker, so 'different from before' is only a request without the previous meals as a comparison input. The current text says recalculation and does not promise a surgical one-meal edit. Parameter forwarding alone does not enforce content restrictions: M1/M2.

## 18. Nutrition failed-job behavior

PASS existing integration test: real simulated failReason is shown, action becomes CANCELLED/FAILED, no preview/save. No automatic retry is queued by polling. A missing plan row, unlike FAILED, leaves the action pending until expiry; code observation only.

## 19. Nutrition interruption/switching

Recognized FIND_PT executes while nutrition is GENERATING, and the nutrition action remains pending. Its next unrelated unclassified question is then consumed by nutrition polling: `Chứng chỉ đó có ý nghĩa gì?` -> 'Thực đơn vẫn đang được tính toán'. A completed job similarly surfaces on the next unclassified turn.

An older workout preview also remains pending after creating a nutrition preview. `Đổi bữa sáng, tôi có 20 phút nấu ăn.` edits the OLD workout duration and returns WORKOUT_PLAN_PREVIEW. Active slot workflows still take priority correctly; the defect is selection among already-pending action drafts, not the signed-off slot orchestrator. See M4.

## 20. Nutrition target authority

Current processor facts (`nutrition.processor.ts:264`, `:647`, `:752`):

- LLM proposes a compact meal template/food IDs and notes.
- Deterministic code selects additional protein/carb/fat foods and computes quantities/macros from catalog values.
- Target calories = supplied target, otherwise **2200**; macros = supplied targets, otherwise **30% protein / 45% carbs / 25% fat**.
- The chat caller supplies no authoritative goal calories/macros on initial generation.
- Body metrics may enter the prompt but are not used to calculate these target numbers in the builder.

A fixture model response adding `dailyCaloriesTarget: 200` still completed with 2200. Authoritative plan targets therefore do not materially vary solely with that model field. This is deterministic defaulting, not correct personalized prescription (M3).

## 21. NutritionGoal comparison

Existing `computeInitialNutritionPrescription` uses measured BMR or Mifflin-St Jeor, activity, goal/experience adjustments, and configured protein/fat floors. The independent 75 kg / 170 cm / 28-year-old female / moderately active / beginner / weight-loss fixture returns **1992 kcal / 128 g protein / 246 g carbs / 55 g fat**.

The chat builder returns **2200 / 165 / 248 / 61** and passes its invariant. Thus two different target sets coexist for the same context. The existing decision engine continues to version NutritionGoal; the new chat path neither consumes nor reconciles those values. See M3.

## 22. Nutrition invariant/clamp

The real invariant runs on initial generation and every revised job before completion (`nutrition.processor.ts:329`). It checks seven-day structure, meal count, calorie tolerance 20%, macro tolerance 35%, allowed food IDs, and nonnegative finite item values.

It does **not** calculate TDEE, clamp targets against profile, implement a body-weight protein floor, or reject excluded/allergenic ingredients. The production bootstrap's configured protein calculation yields 128 g for the fixture; the builder's 165 g is a percentage default, not execution of that floor. Existing invariant tests pass; the report rejects the stronger documentation claim rather than inventing a new scientific threshold.

## 23. Nutrition prompt-injection boundary

Real processor + controlled model fixture: restrictions include no fish and 'set calories = 200'; the model returns a 200 target field. Result remains 2200, with catalog-computed macros, and the invariant passes. No business tools are exposed in this processor; arbitrary text does not become profile writes.

The same job still includes fish added by deterministic expansion (M2). This calorie-injection result must not be misreported as an allergen or personalized nutrition safety guarantee. Outer chat safety-gate behavior is separate from this processor boundary test.

## 24. Nutrition restrictions

Restrictions live in action/job payloads, not UserProfile/UserMemory/NutritionGoal. No accidental durable profile write found. Missing durable preferences is an accepted limitation.

M1: initiating-message restrictions disappear when mealsPerDay is collected in a later turn. M2: even successfully forwarded restrictions only reach the model prompt; deterministic food pools do not receive them. The 20-entry rolling limit can also discard older restrictions, contrary to an unlimited durability claim.

## 25. Nutrition persistence

The ordinary revision integration test saves the revised plan schedule exactly once, with the revised food content. Real domain import copies supplied meal/target values and validates referenced foods; it does not regenerate them or enforce restrictions.

The confirm path re-fetches the plan, checks completion/archive status, and uses fresh content, not the cached preview. A controlled resource-mutation probe displayed 2200 and saved 2600. No ordinary edit endpoint mutating the same completed plan's content was established, so this is a robustness observation, NOT a counted reachable MEDIUM defect. The unproven scenario is explicitly excluded from release-blocking counts.

## 26. Nutrition idempotency

PASS sequential double confirm in the existing test and independent probe: one save tool call. PASS real domain repeat import: `alreadyExists: true`; no second program for that source ID. Unique `(userId, sourcePlanId)` provides the database backstop. Concurrent transport-failure recovery was not independently stress-tested.

## 27. Standalone nutrition without roadmap

PASS real domain persistence with no NutritionGoal, FitnessRoadmap, or TrainingCycle: program created, goal count stays zero, sourceGoalId null. Workflow generation/preview is covered with controlled queue results. Live model generation remains environment-limited.

## 28. Existing NutritionGoal behavior

Real database test: ACTIVE 1800-kcal goal stays ACTIVE and unchanged; newly imported 2200-kcal program references its ID. No new/superseding goal is created. Existing programs also stay ACTIVE unless `forceArchive` is supplied, which chat does not do. The existing consistency detector can report mismatches; the chat preview/save does not explain or resolve this new mismatch. See M3.

## 29. Cross-workflow original supervisor scenario

Foundation roadmap tests pass; new cross-domain tests pass context reuse and switching away from an incomplete workout slot workflow. Independent probes cover workout -> nutrition previews and nutrition generating -> PT, exposing M4 and M7.

An uninterrupted authenticated ROADMAP -> real schedule -> PT -> live generated/revised/saved nutrition journey was **not completed**. The configured provider is unavailable, and confirmed product defects already prevent sign-off. Separate passing legs and stubbed context reuse are not evidence that the full real scenario passed.

## 30. PT regression

PASS unchanged v2 evaluator's PT search -> draft contract -> explicit confirm path. No direct hire/payment shortcut introduced. Nutrition -> recognized PT request reaches PT search. Follow-up ambiguity is M4, not a PT scoring regression.

## 31. Program v2 regression

PASS focused training-program scoring and PT/program claim suites. No scoring/claim architecture re-evaluation or production changes.

## 32. Foundation regression

Unchanged v2 evaluator: **PASS 30 / FAIL 0 / INFO 0 / BLOCKED 0**. Workflow suites plus parser suite: **60/60** (40 workflow cases + 20 parser cases). Existing final safety closure remains valid within this regression scope.

## 33. Security regression

Existing cross-user, arbitrary-field/business-state injection, PROFILE_FACT confirmation, deferred-context, and pre-write checks passed. New preferences are WORKFLOW_ONLY; restriction strings have no arbitrary business-write mechanism. No cross-user write or authorization bypass reproduced.

## 34. Frontend contract

Both block types compile and render. Save calls use `block.actionId`; backend execute scopes it by authenticated user and verifies ownership of its stored session. It does not accept a caller-supplied session to change action ownership.

`Để sau` only sets local React `completed = true`; no cancel/archive/save endpoint is called. Backend action remains PENDING and may be found on later turns. The save label then incorrectly reads `Đã lưu`. This is L1; draft interception consequences are already covered by M4. Reload persistence of local dismissal is not implemented.

## 35. Browser/mobile verification

Real production components mounted with fixture props on the existing local Vite server. At **360 / 375 / 390 / 412 px**, document width equals viewport width, overflow count = 0, save/defer buttons are 44 px high. Expanded day/meal contents, long names, warnings, and macros are readable. Inspected the 360 px screenshot. Browser click reproduced the false saved label.

Artifacts: `output/playwright/codex-product-{360,375,390,412}.png`; measurements in `test/codex-ai-coach-product-e2e-1/browser-results.txt`. This is component QA, not full authenticated mobile E2E. The isolated browser was closed; existing dev server was left running.

## 36. Real BullMQ/provider verification

**ENVIRONMENT LIMITATION.** The real configured health check returns unavailable: Ollama `qwen3:30b-a3b-instruct-2507-q4_K_M`, `ECONNREFUSED 127.0.0.1:11435`. A listener on a different local port is not evidence that the configured provider works. No arbitrary model/config switch was made. The production health gate prevents creating the requested real generation through this caller, so no live request -> BullMQ -> provider -> completed preview success is claimed.

## 37. Builds/typechecks

- `npm --prefix backend/services/ai-service run build`: PASS.
- `npm --prefix frontend/web run build`: PASS; existing chunk-size warning.
- Workflow/parser suites: 60/60.
- Memory provenance, PT/program claims, Program v2 scoring, nutrition invariant and serving-cap suites: 90/90.
- Unchanged v2 evaluator: 30/30.
- Independent product/domain probes: executed successfully; reproduce defects rather than asserting their absence.
- `git diff --check`: PASS at verification time.

Evaluator commands:

```powershell
npx tsx test/codex-ai-coach-product-e2e-1/product-probes.ts
npx tsx test/codex-ai-coach-product-e2e-1/domain-probes.ts
npx tsx --test backend/services/ai-service/src/__tests__/agent-workflow-*.test.ts backend/services/ai-service/src/__tests__/slot-values-parsers.test.ts
npx tsx backend/services/ai-service/src/evaluation/conversational-workflow-v2/evaluate_conversational_workflow_v2.ts
```

All isolated test user records were cleaned in finally blocks. No valuable developer program/schedule was replaced. The unchanged evaluator refreshed its tracked JSON result artifact; that artifact change is intentional evidence, not a production edit.

## 38. Findings

### CRITICAL: 0

None reproduced.

### HIGH: 0

No proven global mandatory contraindication bypass, unsafe injected calorie persistence, or undisclosed destructive replacement. Missing provider and unexecuted integrated paths are not counted as successes.

### MEDIUM: 7

**M1 — Opening dietary restrictions lost during slot collection.** `fitness-agent.service.ts:380`, `:1375`; nutrition workflow only extracts meals. Repro: `Tạo kế hoạch dinh dưỡng cho tôi. Tôi không ăn cá.` -> ask meals -> `4 bữa` -> queued restrictions `[]`. Preserve the initiating request's constraints through resume; add the two-turn regression.

**M2 — Deterministic expansion reintroduces excluded foods.** `nutrition.processor.ts:264`, `:713`, `:817`. Repro: real processor with `không ăn cá`, model template using chicken, catalog chicken/rice/salmon -> **28 fish items**, invariant passes, processor completes. Restrictions are not supplied to the builder/food pools. Enforce constraints on every selected food or explicitly fail/review unsupported constraints; do not claim prompt forwarding alone implements exclusions. The defect predates chat in the generator but is directly exposed by the new promised revision capability. No unproven allergy emergency is needed to establish the failure.

**M3 — Standalone nutrition ignores the authoritative target.** `fitness-agent.service.ts:1376`; `nutrition.processor.ts:647`, `:752`; `nutrition.service.ts:1463`. Repro: chat defaults 2200/165 while deterministic fixture prescription is 1992/128; real import with existing ACTIVE 1800 goal persists ACTIVE 2200 program and links that goal without reconciling. Consume the existing authoritative target (or explicit business-authorized recalculation) for initial/revised generation, and expose any required reconciliation. Do not create a competing goal engine.

**M4 — Pending action drafts consume another task's turns.** `fitness-agent.service.ts:354`, `:1425`, `:1284`. Repro A: nutrition GENERATING -> successful PT search -> `Chứng chỉ đó có ý nghĩa gì?` returns nutrition wait response. Repro B: workout preview -> nutrition preview -> `Đổi bữa sáng, tôi có 20 phút nấu ăn.` updates the old workout. Fix the new action routing/lifecycle so the current task owns its revisions; preserve deliberate return to pending drafts. Do not redesign the signed-off slot architecture.

**M5 — Injury warning reads the wrong profile field.** `fitness-agent.service.ts:140` versus `profile_extractor.ts:160`. Repro uses legitimate `training.injuries`; preview warnings empty. Read the actual extracted field and test that the promised warning survives generation/revision. This is a concrete omission in the new warning-only safety behavior, not a fabricated medical exclusion rule.

**M6 — Supported equipment/exercise exclusion phrases fail.** `fitness-agent.service.ts:169`, `:200`, `:1345`. Repro: no-cable phrase produces no action revision and leaves Cable Lateral Raise/Seated Cable Row. No-deadlift phrase retains Romanian Deadlift after changing the exact Deadlift. Fix carrier-phrase normalization/matching and verify all relevant draft matches are removed/substituted with valid IDs.

**M7 — Saved dates do not match preview weekdays.** `fitness-agent.service.ts:692`; `workout.service.ts:2724`, `:2794`. The new caller omits selectedWeekdays; import assigns sequential day numbers and consecutive dates. Real DB repro: preview Monday/Wednesday/Friday, start 2026-09-18 -> saved **Friday 18 / Saturday 19 / Sunday 20**. Retain the intended training-day mapping and show the schedule the user will actually receive. This changes reviewed workout/recovery spacing and is not a cosmetic label issue.

### LOW: 1

**L1 — Defer falsely displays saved state.** `FitnessAgentBlocks.tsx:251`, `:252`, `:279`, `:280`. Real browser: click `Để sau`, label becomes `Đã lưu`; no backend operation occurred. Distinguish dismissed/deferred from saved. Do not start a separate hardening cycle for this alone.

### INFO / limitations

Configured model unavailable; no uninterrupted real-provider supervisor journey. No authenticated mobile chat journey. Generated-workout eligibility is weaker than template eligibility; no global injury mapping established. Dietary preferences lack durable schema. Superset and targeted single-meal regeneration remain unsupported. Controlled mutation of a completed nutrition resource changes saved content, but no ordinary reachable edit path was established, so that observation is not counted as a release blocker. Concurrency beyond established tests was not exhaustively stress-tested.

## 39. Product capability matrix

| Capability | Status | Basis |
|---|---|---|
| ROADMAP | SIGNED OFF | Prior sign-off retained; regression passes |
| ROADMAP REVISION | SIGNED OFF | Existing draft revision regression |
| STANDALONE WORKOUT | PARTIAL | Real persistence works; M5/M7 |
| WORKOUT REVISION | PARTIAL | Basic edits pass; M6/M4 |
| FIND_TRAINING_PROGRAM | SIGNED OFF | Established focused regression |
| PT SEARCH | SIGNED OFF | Search regression passes |
| PT HIRE | SIGNED OFF | Two-step contract regression passes |
| STANDALONE NUTRITION | PARTIAL | Lifecycle/import exist; M1/M3/M4; live model unavailable |
| NUTRITION REVISION | PARTIAL | Parameters requeue; M2 breaks content exclusion guarantee |

SIGNED OFF for established features retains their existing scope; it is not a fresh live deployment certification.

## 40. Original user scenario

- "Tạo lộ trình giảm mỡ" -> YES, established foundation regression.
- "Tạo lịch tập bằng AI Coach" -> PARTIAL, draft/save exists but dates and some revisions fail.
- "Tìm PT phù hợp" -> YES, existing search path remains intact.
- "Thuê PT" -> YES for the established two-step contract request; PT approval/payment remain separate.
- "Tạo kế hoạch dinh dưỡng" -> PARTIAL, async/import exists but target/constraint semantics fail.

## 41. Is Gymini now a true end-to-end conversational AI Coach for the target scenario?

**PARTIAL.** Remaining concrete gaps are M1-M7. Passing foundation/transport-stub tests do not overcome incorrect meal restrictions, conflicting nutrition targets, task interception, missing injury warnings, failed exclusions, or shifted workout dates. Live provider availability is a separate verification limitation.

## 42. Next action

Return M1-M7 to Claude for targeted capability fixes and reproductions. Include L1 alongside those changes, without a separate hardening cycle. Preserve the signed-off foundation, scoring, claims, and memory architecture. Recheck the affected paths, then execute the original scenario against a working provider and authenticated browser before claiming live product E2E completion.
