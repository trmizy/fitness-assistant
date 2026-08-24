# Exercise & Nutrition Data — Impact Map

> Gate 1 deliverable for the exercise/anatomy/nutrition data-expansion
> roadmap. Read-only audit: schema, seed provenance, and live-DB ground
> truth (queried directly, not assumed) as of 2026-08-19, against the
> **local dev** Docker stack (`postgres:5432`, `gymcoach_fitness` /
> `gymcoach_auth` databases inside `infra/compose/docker-compose.dev.yml`).
> No production database was located or touched — see "Environment"
> below.

## Environment confirmation (rule #8)

- `gymcoach-fitness-dev` container's `DATABASE_URL` points at
  `postgresql://gymcoach:***@postgres:5432/gymcoach_fitness` — the
  Docker-Compose-network Postgres instance, dev credentials
  (`gymcoach`/dev password), not a cloud/managed production host.
- No `.env.production`, production connection string, or production
  deployment config was found referenced by anything touched in this
  audit. All queries in this document and its companion reports were run
  read-only against this local dev instance.
- Per rule #9, if a production database is ever identified in a later
  gate, only read-only audit continues there — no mutation without
  explicit review.

## 1. Current data provenance — exactly how today's rows got here

This matters more than the schema alone: **three separate, historically
uncoordinated seed paths** exist for exercises, and the live DB reflects
only some of them.

| Seed file | Wired into `db:seed`? | Source dataset | Rows it would add | Actually reflected in live DB? |
|---|---|---|---|---|
| `prisma/seed.ts` | ❌ No (orphaned) | `data/data.csv` | N/A | **File referenced (`data/data.csv`) no longer exists on disk — this script cannot run at all.** Dead code, not a live risk, but should not be trusted or resurrected without rebuilding its input. |
| `prisma/seed_exercises.sql` | ❌ No (not called by any npm script or compose service found) | Hand-authored, 207 English exercises, hardcoded UUIDs | 207 | **Not present** — none of its hardcoded UUIDs exist in the live `exercises` table (verified directly: 3 sampled IDs, 0 matches). Orphaned/unused file. |
| `prisma/seed_exercises_json.ts` | ✅ **Yes** — `package.json`'s `"prisma".seed` and `db:seed` both point here | `prisma/raw_exercises.json` = **free-exercise-db** (yuhonas/free-exercise-db), verbatim structure (`name/force/level/mechanic/equipment/primaryMuscles/secondaryMuscles/instructions/category/images/id`) | 873 | ✅ **Yes — this is the actual seed source for all 873 of the base 883 `exercises` rows.** English-only. `videoUrl` built from a live hotlink to `raw.githubusercontent.com/yuhonas/free-exercise-db/...` (see license review — image rights undocumented). Guarded by `if (existingCount > 0) return` — safe against accidental re-seed-and-duplicate, but only because it checks *total* count, not per-row (see Gate 2 risk note). |
| `prisma/seed_equipment_gap_exercises.ts` | Manual (`npx tsx prisma/seed_equipment_gap_exercises.ts`) | Hand-authored, ~10 exercises for equipment left with zero coverage (suspension trainer, assisted pull-up/dip, glute machine) | ~10 | ✅ Yes — accounts for the 883 vs 873 gap. Idempotent by exercise-name existence check. |
| `prisma/seed_movement_patterns.ts` | Manual | Code-classification pass (regex on name + type/bodyPart fallback), **not** an external dataset | 0 new rows — backfills `movementPattern`/`mechanics`/`difficultyLevel` on existing rows | ✅ Yes — confirmed live: 883/883 have `movementPattern`, 795/883 `mechanics`, 882/883 `difficultyLevel`. **Uses an UPPERCASE taxonomy** (`SQUAT`, `HORIZONTAL_PUSH`, `HIP_EXTENSION`, ...) that is **a different vocabulary** from `data/catalog/taxonomy/ref_movement_patterns.csv`'s lowercase snake_case taxonomy (`squat`, `horizontal_push`, `hip_hinge`, ...) used by the curated `gym_exercises.csv`. **These two taxonomies do not share a common code today — reconciling them is real Gate 4 work, not a formality.** |
| `data/catalog/plans/gym_exercises.csv` (+ its `ref_*.csv` taxonomy siblings) | N/A — a **design-time asset**, never wired to any seed script | Original curated content (`source_type: curated_vi` per its own field), Vietnamese + English, 205 exercises, richer schema than the live `Exercise` model (setup/execution_steps/breathing/common_errors/regressions/progressions/contraindications/rep-ranges by goal/tempo) | 205 | ❌ **Confirmed NOT imported.** Live-DB check: `vietnameseNamed: 0` — **zero** of the 883 live exercises have a Vietnamese name. This is the single highest-value, lowest-risk gap for Phase 1: the content already exists, is originally authored (no external license question), and just needs a careful, additive linking pass into the live schema (see §7). |
| `prisma/seed_food_aliases.ts` + `prisma/data/food_aliases.vi.json` | Manual | Original curated content, 195 Vietnamese alias→English-query pairs | Up to 195 `FoodAlias` rows (fan-out per matching food) | ❌ **Confirmed NOT run against this DB.** Live `food_aliases` table has **0 rows**, despite the seed script and its 195-entry input file both existing and being ready. Zero risk, additive, real gap — flagged for Gate 5, not run in this pass. |
| `prisma/seed_equipment.ts` | Manual | Derived from `raw_exercises.json` itself (not a new external source) | Backfills `Equipment`/`ExerciseEquipment` | ✅ Yes — 46 `Equipment` rows, 983 `ExerciseEquipment` links live. |
| `prisma/process-usda.ts` → `data/nutrition/foods_seed.csv` | Manual (`db:process-usda`), then `seedFoods()` inside `seed_exercises_json.ts` | USDA FoodData Central (`sr_legacy` + `survey_fndds`) | 13,159 (confirmed live) | ✅ Yes — `foods` table: 7,756 `sr_legacy` + 5,403 `survey_fndds` = 13,159. `skipDuplicates: true` on the batch insert (real idempotency, unlike the exercise seed's coarser count-based guard). |

**Conclusion**: the live catalog is **not** a blend of multiple sources today — it is cleanly free-exercise-db (exercises) + USDA (foods), in English only, with a much richer *original* Vietnamese exercise catalog sitting ready-but-disconnected on disk, and a *second*, incompatible movement-pattern taxonomy already baked into the live schema alongside it. Any Phase 1 work must reconcile that taxonomy mismatch, not just "import the CSV."

## 2. Schema map — exercise domain

```mermaid
erDiagram
  Exercise ||--o{ WorkoutExercise : "logged in"
  Exercise ||--o{ WorkoutProgramExercise : "prescribed in"
  Exercise ||--o{ ExerciseEquipment : "requires"
  Equipment ||--o{ ExerciseEquipment : "required by"
  Equipment ||--o{ UserEquipment : "owned by users"
  Workout ||--o{ WorkoutExercise : contains
  WorkoutExercise ||--o{ WorkoutSet : contains
  WorkoutProgram ||--o{ WorkoutProgramDay : contains
  WorkoutProgramDay ||--o{ WorkoutProgramExercise : contains
  WorkoutProgramDay ||--o{ WorkoutSchedule : "scheduled as"
  WorkoutSchedule ||--o| CycleSessionFeedback : "rated by"
  CycleSessionFeedback ||--o{ ExerciseSessionFeedback : "per-exercise notes"
  ExerciseSessionFeedback }o--|| Exercise : "about (exerciseId, no FK)"
  TrainingCycle ||--o{ WorkoutSchedule : "sessions of"
  TrainingCycle ||--o{ CycleAssessment : "evaluated by"
```

Note: `ExerciseSessionFeedback.exerciseId`, `CycleFeedbackSummary.mostLikedExercises` / `mostDislikedExercises` / `exercisesWithPainReports` (JSON arrays of exerciseId), and every `exerciseId` referenced from **ai-service**'s `WorkoutPlan.content` / `PersonalizedServiceOrder.draftContent` / `PersonalizedServicePlanVersion` JSON blobs are **FK-by-value, not real foreign keys** (cross-table-but-same-DB for the JSON-array cases, cross-*service* for ai-service). Nothing enforces referential integrity there at the database level — an exercise ID must never change for this reason alone, independent of the explicit "don't change old PKs" rule.

### Per-model detail (exercise domain)

| Model | PK | Real FK | Unique | Index | Cascade | Soft delete | Versioned | Consumer | Producer | Snapshot or live-reference? | Impact if catalog changes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `Exercise` | `id` (uuid) | — | — | `[bodyPart,typeOfActivity]`, `[typeOfEquipment]` | N/A (referenced, not referencing) | No | No | `WorkoutExercise`, `WorkoutProgramExercise`, `ExerciseEquipment`, ai-service plan JSON (by value) | `seed_exercises_json.ts` et al. | **Live reference** — every consumer reads current name/instructions live, no snapshot. Confirmed 787/883 rows are actually referenced by some `WorkoutExercise`/`WorkoutProgramExercise` row today; 96 are unreferenced. | **HIGH.** Renaming or reclassifying a referenced exercise changes what a user's past workout log *displays* going forward (name/instructions aren't snapshotted — see §4/§6 recommendation for `exerciseNameSnapshot`). Changing `id` breaks every JSON-by-value reference silently. |
| `Equipment` | `id` (uuid) | — | `slug` | `[category]` | N/A | `active: Boolean` (soft) | No | `ExerciseEquipment`, `UserEquipment`, onboarding equipment step | `seed_equipment.ts` | Live reference | Medium — slug is the stable public identifier already, by design comment in the schema itself. |
| `ExerciseEquipment` | `id` | `exerciseId`→Exercise (cascade), `equipmentId`→Equipment (cascade) | `[exerciseId,equipmentId]` | both FKs | **Cascade delete** — deleting an Exercise or Equipment row deletes these links | No | No | Deterministic equipment-filtered exercise selection (`/internal/exercises/for-ai-plans`) | `seed_equipment.ts` | Live | Medium — cascade means an accidental Exercise delete silently removes its equipment links too (another reason deletion is off the table, not just by policy). |
| `WorkoutExercise` | `id` | `workoutId`→Workout (cascade), `exerciseId`→Exercise (**no cascade — RESTRICT by default**) | `[workoutId,programExerciseId]` | 3 indexes | Workout delete cascades; Exercise has no explicit `onDelete` → **Prisma default is a DB-level restrict, meaning an Exercise with any logged history literally cannot be deleted at the DB level even if someone tried** | No | No | Workout history display, volume/1RM calculations | User workout logging | **This is real user history** — 115,599 rows live. | An Exercise referenced here is structurally undeletable already; the schema itself already protects history from an accidental delete, independent of policy. |
| `WorkoutSet` | `id` | `workoutExerciseId`→WorkoutExercise (cascade) | — | `[workoutExerciseId]` | Cascades from WorkoutExercise | No | No | PR/1RM/volume calculations (once built — not yet a dedicated table, see §5) | User set logging | **Real user history** — 461,449 rows live. Already carries RPE/RIR/setType/tempo/rangeOfMotion/side/painScore — most of Phase 2's logging-field wishlist already exists at the schema level. | Not directly catalog-dependent (references the exercise only transitively via WorkoutExercise). |
| `WorkoutProgram(Day/Exercise)` | uuid each | Cascades within program → day → exercise | `[userId,sourcePlanId]`, `[programId,dayNumber]` | multiple | Program delete cascades through days/exercises | `status`/`archivedAt` (soft) | `version: Int` | Active/historical plan display | AI generation, manual coach assignment | **Prescription, not outcome** — a template, still live-referencing Exercise | Same live-reference risk as Exercise itself. |
| `WorkoutSchedule` | `id` | `programDayId`→WorkoutProgramDay (SetNull), `workoutId`→Workout (SetNull), `trainingCycleId`→TrainingCycle (SetNull) | `[userId,date]` | 6 indexes | **SetNull, not cascade** — a schedule row survives its program/workout being removed, just loses the link | No | No | Calendar view, cycle session counting | Scheduling flow | 26,220 rows live, only 196 `COMPLETED` | Low-medium — SetNull is already a safe design here. |
| `ExerciseSessionFeedback` | `id` | `sessionFeedbackId`→CycleSessionFeedback (cascade); `exerciseId` **by value, no FK** | — | both | Cascades from session feedback | No | No | `CycleFeedbackSummary` aggregation (`mostLikedExercises` etc.) | Post-session feedback UI | Subjective feedback, real user history | Exercise ID stability directly affects whether historical "liked/disliked exercise" analytics keep resolving to a name. |

## 3. Schema map — nutrition domain

```mermaid
erDiagram
  Food ||--o{ FoodAlias : "has aliases"
  Food ||--o{ NutritionProgramMealItem : "used in"
  NutritionProgram ||--o{ NutritionProgramDay : contains
  NutritionProgramDay ||--o{ NutritionProgramMeal : contains
  NutritionProgramMeal ||--o{ NutritionProgramMealItem : contains
  NutritionProgramMeal ||--o{ NutritionMealCompletion : "completion tracked"
  NutritionGoal }o--|| User : "userId, no FK (cross-service)"
  NutritionLog }o--|| User : "userId, no FK — free-text foodName, NOT linked to Food"
```

### Per-model detail (nutrition domain)

| Model | PK | Real FK | Unique | Cascade | Snapshot or live-reference? | Consumer | Notes |
|---|---|---|---|---|---|---|---|
| `Food` | `id` (uuid), `fdcId` (unique, USDA's own ID) | — | `fdcId` | N/A | Live reference | `NutritionProgramMealItem.foodId`, AI meal-plan generator (`nutrition.processor.ts`, per this session's earlier work) | 13,159 rows. `foodForm`/`isSupplement`/`realisticServingMaxG` already added (this session's earlier AI-nutrition-overhaul work) and backfilled for 2,117 rows. **No `FoodNutrient` normalized table** — macros are flat columns (`calories/protein/carbs/fats`), **no micronutrients, no barcode/GTIN field, no `source`/`license`/`importedAt` provenance columns beyond the single `source: 'sr_legacy'\|'survey_fndds'` string.** This is the real Gate 4 schema gap for nutrition. |
| `FoodAlias` | `id` | `foodId`→Food (cascade) | `[foodId,alias,language]`, `[foodId,aliasNormalized,language]` | Cascades from Food | Live reference | Vietnamese food search | **0 rows live** despite 195 ready entries in `food_aliases.vi.json` (see §1) — a real, additive, zero-risk gap. |
| `NutritionProgramMealItem` | `id` | `mealId`→Meal (cascade), `foodId`→Food (**SetNull**) | — | Meal cascades; Food is SetNull | **This is where the snapshot gap actually bites**: `quantity/unit/calories/proteinGrams/carbGrams/fatGrams` are stored **as their own columns on this row already** (not purely derived from a live Food join) — so a meal item **already substantially self-snapshots its nutrition values** at creation time. `customFoodName` exists as a fallback when `foodId` is null. **Good news**: this table's design already protects history reasonably well; a Food being edited later does not retroactively change what a past meal item says it had, since the macro columns are already copied at write time, not recomputed live. | AI/manual meal-plan display | Confirms nutrition history is architecturally safer than exercise history today — worth explicitly validating with a test in Gate 13, not just assumed from reading the schema. |
| `NutritionMealCompletion` | `id` | `mealId`→Meal (cascade) | `[userId,mealId,logDate]` | Cascades from Meal | Stores its own `consumedCalories/consumedProtein/consumedCarbs/consumedFat` — same self-snapshotting pattern as above | Adherence tracking | 0 rows live currently (feature not yet exercised by real usage in this dev DB). |
| `NutritionLog` | `id` | — (plain `userId`) | — | N/A | **Pure free-text snapshot already** — `foodName: String`, no `foodId` at all, macros stored directly on the row | Legacy/manual food-logging | 207,650 rows live. Completely decoupled from the `Food` catalog by design — a catalog change can **never** affect this table, structurally. |
| `NutritionGoal` | `id` | — (plain `userId`) | Partial unique: one `ACTIVE` per user | N/A | Already versioned (`status: ACTIVE\|SUPERSEDED`, from this session's earlier work) | AI coach, macro validator | Not catalog-dependent at all (raw calorie/macro numbers, no Food references). |

## 4. Cross-service reference map (no real FK — the actual biggest integrity risk found)

Every `userId` field across `fitness-service`, `ai-service`, and the
`exerciseId`/`foodId` values embedded in ai-service's JSON plan content are
**plain UUID references with no database-level foreign key**, by
architecture (separate microservice databases). This audit's live-DB query
found a concrete, previously undocumented consequence of that:

- `auth-service.users`: **119 total rows**, of which **114** match the
  E2E-test-user email pattern (`e2e-{prefix}-{runId}-{uuid}@example.com`,
  per `fitnessassistant-playwright-e2e/fixtures/isolatedTestUser.ts`).
  Only **5** are real, non-test human accounts (confirmed by inspecting
  the actual email addresses).
- `fitness-service` workout data references **2,944 distinct `userId`
  values** (2,945 for schedules, 2,941 for nutrition logs) — roughly
  **25× more distinct user IDs than exist in `auth-service` at all**,
  test or real.
- **Conclusion**: the overwhelming majority of fitness-service's raw row
  counts (461,449 `workout_sets`, 207,650 `nutrition_logs`, 29,018
  `workouts`) are **orphaned remnants of historical E2E test runs** whose
  corresponding `auth-service` user was deleted (or the run's cleanup
  step never completed) — not organic production usage, and not
  traceable back to any currently-existing account. This is a **local dev
  environment finding specific to this sandbox**, not a claim about any
  hypothetical production deployment.
- This does **not** change the safety rules — every one of those rows is
  still real data that rule #1 forbids deleting, and this audit does not
  delete anything. It **does** mean the "protect user history" concern
  for *this specific dev database* is dominated by test-run debris volume
  rather than a small number of real users with large histories — useful
  context for how urgently a cleanup mechanism is needed (a genuine,
  separate finding worth a follow-up ticket: **E2E test runs have no
  cross-service teardown for fitness-service data today**), not
  something to act on inside this data-expansion task.

## 5. AI/RAG domain

- ai-service owns **no** `Exercise`/`Food` model of its own — confirmed
  via schema grep. `WorkoutPlan`/`NutritionPlan`/`PersonalizedService*`
  store generated content as JSON, referencing fitness-service IDs by
  value.
- `KnowledgeSource`/`KnowledgeDocument`/`KnowledgeChunk`/
  `KnowledgePipelineRun`/`KnowledgeReviewItem` are the RAG/evidence-registry
  tables built during this session's earlier nutrition-overhaul work
  (Qdrant `fitness_evidence` collection) — a real precedent for how a
  reviewed, versioned, sourced knowledge pipeline already looks in this
  codebase; the Gate 5 exercise/nutrition import pipeline should follow
  the same *shape* (source → review → publish), not invent a new one.
- 24 files in `ai-service/src` reference `exerciseId` — plan generation,
  equipment validation, plan-similarity/moderation analysis, evaluation
  harnesses. All by-value. Any exercise ID reassignment is a breaking
  change across all of them.

## 6. Frontend / UI surface

- `frontend/web/src/app/components/InBodySegmentalDiagram.tsx` — an
  existing **hand-built inline-SVG body silhouette** component, but for a
  *different* concept (5-region InBody body-composition segments:
  left/right arm, trunk, left/right leg) — not a per-muscle exercise
  heatmap. Useful precedent (the team already builds custom SVG body
  diagrams rather than reaching for a library), **not directly reusable**
  for the ~29-muscle-region training heatmap Phase 1 needs.
- No existing muscle-map/anatomy-selector component was found anywhere
  in `frontend/web`.
- `frontend/web/src/app/types/index.ts` and `services/api.ts` carry the
  current `Exercise`/`Food` TypeScript shapes consumed by the UI — any
  additive schema field needs a corresponding additive type change here;
  not otherwise audited field-by-field in this pass (deferred to Gate 4
  implementation, not needed to complete the impact map).

## 7. Impact matrix

| Thay đổi dự kiến | Bảng bị ảnh hưởng | Service | API | UI | Cache/RAG | Risk | Test cần có |
|---|---|---|---|---|---|---|---|
| Link `gym_exercises.csv`'s 205 curated VI/EN entries onto the live `Exercise` rows (additive alias/localization, not replacement) | `Exercise`, new `ExerciseAlias`-equivalent | fitness-service | `/exercises` read endpoints, `/internal/exercises/for-ai-plans` | Exercise list/detail screens | ai-service's exercise-selection prompt context | Medium — touches 883 live rows, all with real FK-by-value consumers | Name-matching dry-run report (Gate 3) before any write; regression on workout-plan generation after |
| Reconcile the two movement-pattern taxonomies (live UPPERCASE vs catalog lowercase snake_case) | `Exercise.movementPattern` | fitness-service | any consumer filtering by movement pattern (recommendation engine) | — | — | Medium — silent semantic drift if merged carelessly (e.g. is live `SQUAT` the same population as catalog `squat`? Needs verification, not assumption) | Mapping-table unit test with 100% coverage of both vocabularies |
| Populate 195 Vietnamese `FoodAlias` rows from the existing, unused seed | `FoodAlias` | fitness-service | Food search | Food search UI | — | **Low** — purely additive, table currently empty, script already idempotent-by-try/catch | Re-run-twice idempotency test |
| Import wger as a secondary exercise source | `Exercise`, new `ExerciseSource` | fitness-service | same as above | same as above | — | Medium-high — external network dependency, per-entry license must be captured, real duplicate-detection needed against the 883 existing + 205 catalog entries | Full Gate 3 duplicate report required before any write |
| Normalize `Food` nutrients (`FoodNutrient`, micronutrients) | New table, `Food` | fitness-service | Nutrition detail views | Macro/micro display | AI nutrition prompt context | Medium — additive table, but touches how 13,159 rows' data is read everywhere nutrition data is displayed | Read-path regression across AI nutrition chat, meal-plan generation, food search |
| Add `Recipe`/`RecipeIngredient` for Vietnamese dishes | New tables | fitness-service | New endpoints | New recipe UI | AI meal-plan generator | Low (additive, new tables) but **product-shape** risk — must not let a recipe be silently treated as a single `Food` row with fabricated aggregate macros | Macro-consistency validator (already built this session for planned meals) reused/extended for recipe-level aggregation |
| Muscle-map SVG UI (`body-muscles`) | New `Muscle`-canonical table + `ExerciseMuscle` mapping | fitness-service (data), frontend (UI) | New muscle-map endpoint | New component | — | Low — new, additive, no existing consumer to break | Renders correctly with partial/unmapped-muscle data without crashing (explicit requirement in the task) |

## 8. What this impact map does **not** yet cover (explicitly deferred to later gates)

- The actual duplicate-candidate scoring between the 883 live exercises,
  the 205 curated catalog entries, and any future wger import — that is
  Gate 3's job, informed by this map but not done here.
- The canonical schema's exact column-by-column design — Gate 4.
- Any code change, migration, or import execution — explicitly out of
  scope until the dry-run/impact-report gate the user's own instructions
  require.
