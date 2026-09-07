# Nutrition — architecture and continuation

Updated 2026-09-07 from the working tree. This replaces the two root-level
Nutrition implementation reports. Implementation presence is not a claim of
deployment or a fresh test pass; several changes are still uncommitted.

## Ownership and flow

- `user-service` owns onboarding, profile preferences, screening, and InBody.
- `fitness-service` owns versioned `NutritionGoal`, `NutritionProgram`, meal
  completion, deterministic calculations, and review/application of changes.
- `TrainingCycle` and `CycleAssessment.nutrition*` provide the nutrition cycle
  and review. `NutritionGoal.trainingCycleId` links prescriptions to the cycle.
- `ai-service` queues the existing meal-plan generator. A deterministic first
  goal is usable independently of successful LLM generation.

Onboarding completion calls `/internal/onboarding/bootstrap-nutrition`.
`nutrition-onboarding-bootstrap.service.ts` reads the profile and optional
InBody, calculates the first goal, ensures a cycle, persists the goal/audit,
queues a best-effort meal plan, and sends a notification. The engine lives in
`nutrition-bootstrap.engine.ts`; adaptive decisions remain in
`nutrition-decision.engine.ts`. The database partial unique indexes enforce
one ACTIVE goal and one ACTIVE cycle per user.

## Screening

`fetchUserProfile` must populate the screening fields as well as declare their
types. `user-client-profile-snapshot.test.ts` exercises the HTTP mapping;
mocking the entire client would miss a dropped-field regression.

`nutrition-bootstrap-screening.ts` requests professional review when the status
is FOLLOW_UP_SUGGESTED or any flag is present. UNKNOWN remains unscreened.
The bootstrap uses `useMaintenanceOnly` for reported risk and persists the
review reason/audit, with an onboarding warning. This implements the existing
nonblocking policy; it is not a medical clearance workflow.

## Daily intake and suggestions

`nutrition.service.ts` shares consumed totals between `dailySummary` and
`actualProgress`. SKIPPED meals contribute zero; recorded completion uses the
stored consumed values, including partial percentages and explicit overrides.
Planned items must not override a meal's actual completion values. Free-text
`NutritionLog` and program meal logging remain two separate tables/write
paths by design (a diary entry vs. a planned-meal completion are genuinely
different concepts — not unified into one table), but a real reconciliation
bug between them was found and fixed 2026-09-07: `upsertMealCompletion`
freezes consumed totals from whatever `NutritionLog` rows exist for that
mealType+date at the moment it's called; a log added for the same
mealType+date AFTER a meal is already COMPLETED/PARTIAL (e.g. "Thêm bữa
này" or the manual Add-food form, used after already marking breakfast
done) was previously invisible to `dailySummary`/`actualProgress` even
though it visibly appeared in the meal's item list — a silent
undercount, the opposite direction from the double-counting bug fixed in
Phase 2. Fixed in `getDailyTask` by adding anything logged strictly after
`completion.updatedAt` on top of the frozen snapshot (never rewriting the
completion row itself, which would risk clobbering an explicit
`overrideCalories`). Covered by 3 new tests in
`nutrition-daily-summary.integration.test.ts` (post-completion addition,
override preserved, pre-completion log not double-counted) — 12/12 pass.

`nutrition-food-suggestion.engine.ts` uses the food catalog and Vietnamese
aliases without an LLM. The budget preference is LOW/NORMAL/FLEXIBLE.
`BeginnerNutritionSummary.tsx` shows targets, remaining intake, suggestions,
and the add-suggestion action. It is an additive summary, not three distinct
Beginner/Intermediate/Advanced interfaces.

## Smart Substitute + region personalization (2026-09-07)

Real research (see sources in `vietnamese-region-food.config.ts`'s header —
pasgo.vn, huongvietmart.vn, buffetposeidon.com, thucphamhuongduong.com) on
Bắc/Trung/Nam regional cuisine differences, applied as: (1) reordering which
already-budget-eligible protein query comes first (never bypassing the
budget tier), and (2) a short, honest cooking-style note (kho nước dừa
kiểu Nam, mắm ruốc/mắm nêm kiểu Trung, luộc/hấp thanh đạm kiểu Bắc) —
never a fabricated composite-dish nutrition number; the underlying macros
always come from the plain USDA ingredient. `UserProfile.region`
("BAC"/"TRUNG"/"NAM", optional, Settings → Dinh dưỡng) is new; unset
behaves exactly as before this change.

Four substitute modes in `nutrition-food-substitution.engine.ts`
(`POST /nutrition/food-suggestions/substitute`, wired into
`BeginnerNutritionSummary.tsx`'s "🔁 Đổi món" per suggested item):
REPLACE (different food, same role, calorie-equivalent), CHEAPER (forces
the LOW-budget pool regardless of the caller's own tier), HIGHER_PROTEIN
(strictly higher protein-per-100g at the same calories; not offered for a
carb-role item), VEGETARIAN (lacto-ovo or vegan pool, from the already-
existing but previously dead `UserProfile.dietaryPreference`; not offered
for a carb-role item, which is already vegetarian by default). Role
(PROTEIN vs CARB) is inferred from the item's own macros (≥30% of calories
from protein), matching this codebase's existing "no stored food-category
taxonomy" constraint (see `food.repository.ts`'s own note) — never a new
field.

A real, product-relevant data-quality bug was found and fixed while
building this — the test DB had never held real Food rows before
2026-09-07 (see below), so it was never exercised until now:
`firstUsableFood`'s plain alphabetical top-match regularly surfaced a
branded restaurant item ("cá basa" → "CRACKER BARREL, farm raised catfish
platter"), infant food ("trứng" → "Babyfood, cereal, egg yolks and bacon,
junior"), or an unrelated composite dish ("đậu hũ" → "Beef, tofu, and
vegetables...") ahead of the plain ingredient — a real correctness problem
for a "chay" substitute in particular (surfacing beef). Fixed at two
levels: `prisma/seed_food_aliases.ts` now ranks candidates (exclude
branded/infant-food, prefer USDA's own "NFS" generic marker, then
shortest name) before linking the first 50 as aliases, instead of an
arbitrary unordered `take: 50`; `firstUsableFood`/`usableFoodCandidates`
apply the identical ranking at query time over a larger fetch window (100,
up from 5/30) so a term with more than 50 real matches doesn't get
truncated before ranking. Several `food_aliases.vi.json` entries whose
`englishQuery` never matched real USDA naming at all ("basa fish" → 0
matches; USDA has no basa/pangasius entry at all, "cơm trắng" → "white
rice cooked" 0 matches vs. real "Rice, white, ...") were corrected to
verified-real substrings. All 21 Vietnamese terms this feature's query
lists actually use were individually re-verified against the real seeded
catalog after the fix — see `nutrition-food-substitution.engine.test.ts`
and `vietnamese-region-food.config.test.ts` (10 + 8 tests, all passing).

Verified end-to-end against the real running dev stack 2026-09-07 (real
login as an existing dev fixture user, real `PUT /profile/me`, real
gateway → fitness-service/user-service, real seeded catalog) — not just
integration tests against the isolated test DB. This required applying
this session's pending migrations to dev (fitness-service: goal-cycle
link, PT review fields, `notified_for_reassessment_at`; user-service:
`region`) and re-seeding dev's Food catalog aliases with the fixed script
— both done with explicit user approval before touching the dev database.
Confirmed working: region reordering (NAM → cá basa first), all 4
substitute modes, apply-to-log, and dailySummary correctly reflecting it.

## Calorie safety floor unification (2026-09-07)

Audit (self-directed continuation, user approved the fix direction before
implementing) found a real, three-way safety-floor inconsistency: the
deterministic engines (bootstrap + adaptive) already respected
`cycleThresholds.nutritionAdaptive.minPrescriptionCalories` (1200, "a basic
safety rail, not a clinical minimum"); the PT-modify Zod schema had a
separate, uncommented, unrelated `.min(800)`; the client's own manual goal
edit (`PUT /nutrition/goals`) had NO floor at all — just `.positive()`. A
client, or a PT acting for a client, could set an arbitrarily low (even
single-digit) calorie target through either direct-entry path while only
the AI-derived paths were actually protected. Separately, the PT-modify
path also skipped `checkNutritionGoalMacroConsistency` entirely (despite
that validator's own docstring already claiming to cover "user-facing/
PT-facing" saves — it only ever ran on the client's own save).

Fixed: both direct-entry paths (client self-edit, PT modify) now call the
SAME `assertCalorieFloor` (throws 400 with an actionable Vietnamese
message, never silently clamps — clamping is for the AI ENGINES' own
computed numbers, not a number a person explicitly typed) and the SAME
macro-consistency check, all reusing the existing 1200 constant rather
than inventing a new number. The Zod schemas (`upsertNutritionGoalSchema`,
`modifyNutritionRecommendationSchema`) were also updated to the same
constant for a friendlier request-level rejection, though the service-
level check is the authoritative one.

Critical ordering detail found and fixed while implementing: the PT-modify
validation runs BEFORE `applyNutritionReviewDecision`'s atomic claim
(`UPDATE ... WHERE nutrition_user_decision = 'PENDING'`), never after — a
recommendation can only ever be claimed once, so validating after the
claim would have let one PT typo permanently brick that recommendation
(no error recovery, the client could never have it reviewed again). A
dedicated test proves a rejected modify leaves the assessment PENDING and
a subsequent valid retry still succeeds.

Verified: 22 new/updated tests (`nutrition-goal-macro-validator.test.ts`,
`nutrition-goal-versioning.integration.test.ts`,
`coach-nutrition-review.integration.test.ts` — the last one required
fixing 3 pre-existing test fixtures whose protein/carb/fat numbers never
actually summed to their stated calories, an oversight from before this
macro check applied to the PT path at all), all passing. Verified end-to-
end against the real dev stack too: a below-floor client save is rejected
with a 400 mentioning 1200; an at-floor save succeeds.

## Diet break / maintenance-phase modeling (2026-09-07)

Self-directed continuation (user approved the research-then-implement
direction, since — unlike the calorie floor or Smart Substitute — there
was no existing threshold to unify around, and no real citable entry
exists yet in `data/processed/evidence/` for this). Real research: Byrne
et al. 2017 (MATADOR study, Int J Obes) — 2-week energy-restriction blocks
alternated with 2-week energy-balance blocks produced more fat loss, less
reduction in resting energy expenditure, and better weight retention at 6
months than continuous restriction, in a supervised trial on obese men.
That exact 2-week cadence is too aggressive for an unsupervised consumer
app; general practical coaching guidance (not a single RCT) instead
converges on suggesting a break after ~8-12 continuous weeks of dieting,
lasting 1-2 weeks at maintenance. This app uses the middle of each range
(10 weeks / 2 weeks) as an explicitly-labeled PRODUCT_HEURISTIC — same
convention as `minPrescriptionCalories`/`MACRO_CALORIE_TOLERANCE_KCAL` —
never presented as a direct citation of the study's own protocol.

New `AdaptiveNutritionDecision` value `PROPOSE_DIET_BREAK` in
`nutrition-decision.engine.ts`, checked right after the existing data-
quality/adherence/window gates and BEFORE the normal WEIGHT_LOSS pace
evaluation — it takes priority even when the current pace looks fine,
since a scheduled break benefits an on-track cut too per the research.
Proposes the user's real, freshly-computed maintenance calories (reusing
`nutrition-bootstrap.engine.ts`'s own BMR/TDEE formula via
`useMaintenanceOnly`, never a second formula) with protein held at/above
current (never lowered, general diet-break guidance) via the same
`redistributeMacros` helper `PROPOSE_ADJUSTMENT` already uses.

The two new signals (`weeksSinceDeficitPhaseStarted`,
`estimatedMaintenanceCalories`) are computed by the CALLER
(`training-cycle.service.ts`'s `computeWeeksSinceDeficitPhaseStarted`,
new), not the pure engine — matches this file's existing
`priorCycleDecisions` pattern. The deficit-duration counter walks back
through consecutive prior `TrainingCycle` rows sharing `goal=WEIGHT_LOSS`
(stopping at the first cycle with a different goal) to find the start of
the CURRENT unbroken cutting run, then resets to the most recent accepted
diet-break's own `validFrom` if one exists inside that window (detected
via `NutritionGoal.sourceAssessmentId` → that assessment's
`nutritionReasonCodes` containing `SUSTAINED_DEFICIT_DIET_BREAK_RECOMMENDED`
— a normal `PROPOSE_ADJUSTMENT` acceptance does NOT reset it). No new
schema needed — a diet break is just a normal ACCEPTED `NutritionGoal`
version through the EXACT same apply path every other adaptive
recommendation already uses; `applyNutritionReviewDecision` needed no
changes at all.

Cross-service consistency closed: ai-service has its OWN copy of the
nutrition-decision enum (`cycle-assessment.schemas.ts`, two separate
`z.enum([...])` call sites) plus a hardcoded Vietnamese label map
(`cycle-assessment.service.ts`) for the LLM explanation layer — both
updated, or `assessCycleSafe` would have Zod-rejected the whole request
for any user a diet break is proposed to (silently losing just the AI
headline/explanation, not the underlying decision — but still degraded).
Frontend: `TrainingCyclePage.tsx` (client) and `ClientFitnessSummaryCard.
tsx` (PT) both had hardcoded decision-type maps too — `TrainingCyclePage`
in particular used `nutritionCfg &&` to gate rendering the WHOLE nutrition-
assessment card, so an unrecognized decision value silently hid the entire
accept/reject UI from the client (not a crash, just invisible) — found by
reading the render logic, not by observing a failure. Both fixed; the
gate at "PROPOSE_ADJUSTMENT" that also decided whether to show 2 buttons
(accept/reject) vs. a single "Đã hiểu" acknowledge button was extended to
include PROPOSE_DIET_BREAK too, since it has real proposedChanges
requiring a genuine choice, unlike KEEP_PLAN/REQUEST_MORE_DATA.

Tests: 9 new pure-engine cases in `nutrition-decision.engine.test.ts`
(proposes correctly, prioritizes over PROPOSE_ADJUSTMENT, respects every
existing gate, 100% backward-compatible when the new fields are omitted)
+ 6 new integration cases in `diet-break.integration.test.ts` (real DB,
proves the cross-cycle walk and the diet-break-reset detection) + 3 new
ai-service cases proving the cross-service schema/label/fallback actually
handles the new value, not just typechecks. All passing; full training-
cycle/nutrition regression (146 fitness-service + 13 ai-service tests
touching this area) re-run clean after the wiring change.

Not done: no UI to show "X weeks until your next diet break is eligible"
ahead of time (the recommendation only appears once actually proposed);
no PT-initiated manual diet-break trigger outside the normal evaluate()
cadence.

## PT review and InBody

The PT client summary exposes nutrition. Coach routes/services and
`ClientFitnessSummaryCard.tsx` implement approve/modify/reject, using the
PT-client relationship boundary and attributed goal versions. Verify actual
authorization and competing client/PT decisions in the integration tests.

The old hardening report's claim that InBody reassessment is absent is stale:
`inbody-reassessment.service.ts`, `/internal/inbody/reassessment-check`, and
calls from `user-service`'s InBody service are present. The trigger checks the
active cycle, pending assessment, and cooldown (reuses
`cycleThresholds.assessment.plateauWindowWeeks`, 21 days by default — not a new
number) before reusing cycle evaluation. It proposes review rather than
silently changing calories, and suppresses nonactionable notifications
(`KEEP`+`KEEP_PLAN`/no nutrition decision never notifies; either side being
actionable does). `inbody-reassessment.integration.test.ts` (10 tests, real DB)
now actually exists and passes — gating logic (no active cycle, already-pending,
cooldown not elapsed on either cycle-start or last-assessment reference,
cooldown elapsed) and the notify-vs-suppress decision are covered directly, not
just asserted. `evaluateCycle`/`createPersistentNotification` are stubbed via
the `inbodyReassessmentDeps` seam for those tests; `getActiveCycle` runs for
real (cross-service InBody/profile reads degrade to empty data for a
nonexistent test user — never thrown). End-to-end delivery and detached work
under Lambda/real docker dev stack still need verification; a passing
integration-test suite is not the same as observed production behavior.

Concurrency-hardened 2026-09-07: the gating check (fast, synchronous) and the
actual evaluation (detached, can take ~90s) are two separate steps, so two
near-simultaneous InBody writes (a double-tap submit) could both pass gating
before either's `evaluateCycle` call creates its `CycleAssessment` row.
`evaluateCycle`'s own create()+P2002-catch already dedupes the assessment
row itself, but that alone left two real bugs, both found via a real test
before being fixed, not assumed: (1) the loser of that race gets back a
still-`PENDING` row with null decision fields, and null was being read as
"actionable" since it didn't literally equal `KEEP`/`KEEP_PLAN` — fixed by
requiring `status === "COMPLETED"` before evaluating actionability at all;
(2) even both callers eventually seeing the same `COMPLETED`+actionable row
could send two notifications for one assessment — fixed with an atomic
notify-once claim (`CycleAssessment.notifiedForReassessmentAt`, set via a
conditional `UPDATE ... WHERE notified_for_reassessment_at IS NULL`, not an
in-memory lock, since this service can run as multiple Lambda instances).
`inbody-reassessment.integration.test.ts` now has 13 tests including a real
10-concurrent-request DB test proving exactly one claim wins.

## Schema and tests

Review the additive migrations for the goal-cycle link, PT review fields,
budget preference, nutrition notifications, and cycle reassessment notifications
under the fitness-service and user-service Prisma migration directories.
Regenerate Prisma clients after migrations; do not treat a prior report's
machine-specific stale-client finding as the current result.

`scripts/prisma-test.mjs` now uses fitness-service migrations and checks required
indexes. Do not replace this with a bare `db push`: it omits partial indexes.
See [test setup](../docker/test/README.md) for environment prerequisites.

Relevant regression files in `backend/services/fitness-service/src/__tests__/`:

- `nutrition-bootstrap-screening.test.ts`, `nutrition-bootstrap.engine.test.ts`
- `nutrition-onboarding-bootstrap.integration.test.ts`
- `user-client-profile-snapshot.test.ts` (now also covers region/dietaryPreference)
- `nutrition-daily-summary.integration.test.ts`
- `coach-nutrition-review.integration.test.ts`
- `nutrition-adaptive-apply.integration.test.ts`
- `inbody-reassessment.integration.test.ts`
- `nutrition-food-substitution.engine.test.ts` (requires the real seeded Food catalog)
- `vietnamese-region-food.config.test.ts`

No application tests were rerun during documentation cleanup. Historical test
totals from the removed reports are not current release evidence.
`inbody-reassessment.integration.test.ts` (13/13),
`nutrition-food-substitution.engine.test.ts` (9/9),
`vietnamese-region-food.config.test.ts` (8/8), and the full pre-existing
fitness-service suite were re-run 2026-09-07 against a freshly `migrate
deploy`-provisioned test DB (with `INTERNAL_SERVICE_SECRET`/`INTERNAL_API_SECRET`
set to the dev-stack default, needed for tests that assert on real cross-service
data — without it, ~3 more tests fail on a plain 401, a test-invocation gap,
not a code one).

`pnpm seed` (fitness-service) + `npx tsx prisma/seed_food_aliases.ts` WERE
run against the test DB 2026-09-07 (13,159 USDA Food rows + ~2,700 Vietnamese
aliases — see the Smart Substitute section above for the real data-quality
bugs this surfaced and fixed) — the test DB is no longer missing this data.
Latest full run: 740 tests, 709 pass, 26 fail. All 26 traced to the SAME
pre-existing, unrelated cause as before (confirmed again by isolating
individual files): activity/muscle-heatmap, exercise-history/progress,
export, workout-reminder, exercise-review, and the CSV importers assert
against specific real seeded WorkoutSchedule/Exercise fixtures (e.g. a
named "Barbell Curl" row) this environment's Exercise catalog doesn't have
— a DIFFERENT, still-outstanding gap from the Food catalog one (now fixed).
One of the 26 (`Adaptive Training Cycle Evaluation`, real AI-service call)
hit the suite's 60s per-test timeout only under full-suite concurrent load;
it passes cleanly in isolation (verified) — flaky under load, not a
regression. None of the 26 touch a file changed by any nutrition/InBody/
PT-review/Smart-Substitute work.

## Remaining work

Done, not just claimed — real browser verification (Playwright + Chromium,
real login, real clicks, screenshots, zero console errors) completed
2026-09-07 for all three major surfaces built this session: Smart
Substitute (region reordering, all 4 modes, apply, daily-task reflection),
PT approve/modify/reject (including the calorie-floor rejection path), and
the diet-break proposal/accept flow. Found and fixed two real bugs THIS
way, not via API testing: (1) `inferFoodRole`'s 30% threshold misclassified
"cá basa" itself (this feature's own Miền Nam priority protein, ~21%
protein-calorie share) as carb-role — lowered to 20%, regression-tested;
(2) the calorie-floor Zod rejection displayed its English default message
("Number must be greater than or equal to 1200") instead of Vietnamese,
breaking house style, on both the PT-modify and client-self-edit forms —
fixed with custom Vietnamese messages, re-verified in the browser.

All items previously listed here as open were closed later on 2026-09-07:
the dev DB's ~553 stale `curated_vi_food_aliases` rows were deleted
(confirmed clean — only the ~2,200 correct `manual_seed` rows remain); the
Exercise/Equipment catalog seed gap was fixed at the root (self-healing
skip guard + `prisma/seed_all.ts` chaining exercises/equipment/provenance/
muscle-mapping into one idempotent pipeline, now the real `db:seed`
entrypoint) and verified end-to-end (873/873 exercises, 0 generic-machine
fallbacks, all equipment/muscle-heatmap/exercise-history tests pass); the
"X weeks until diet-break eligible" progress card was added to
TrainingCyclePage; and the PT-initiated manual diet-break trigger
(`triggerDietBreakRecommendation`, full stack) was built and browser-
verified against dev. See `docs/STATUS.md` for the detail on each.

Genuinely still open:
- Region-aware carb/veg-cooking-style personalization is coarser than
  protein (rice is genuinely near-uniform nationally per the research — see
  Smart Substitute section — so this was a deliberate choice, not an
  oversight, but a future carb-role prep-style note is a reasonable ask).
- Nothing else from the original nutrition mega-spec is outstanding. Any
  further nutrition work from here is new scope, not a continuation of an
  existing gap — needs a fresh decision on direction rather than another
  "tiếp tục".

Existing evidence and design references: [body state](body-state-and-adaptive-planning.md),
[nutrition evidence](research/fitness-nutrition-evidence.md), and
[expert review](research/nutrition-ai-product-and-expert-review.md).
