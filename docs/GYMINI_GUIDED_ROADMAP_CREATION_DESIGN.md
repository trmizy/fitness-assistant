# Gymini Guided Roadmap Creation — Design

Date: 2026-09-09
Scope: `backend/services/fitness-service`, `backend/services/ai-service`,
`frontend/web`
Status: Design gate before code, written after auditing real source (not
guessed).

## 1. Current Roadmap Creation UX (audited)

`RoadmapJourneyPage.tsx`'s `NoRoadmapState` currently offers two flat,
equal buttons: "Tạo bằng AI" (a form: goal chips + a bare `timeframeWeeks`
number input + optional image, then a raw phase-list review) and "Tạo thủ
công" (`name`/`goalType`/one `phaseType` + `durationWeeks`). Both are
admin-form-shaped — the user must already understand `phaseType`
(`FAT_LOSS`/`LEAN_GAIN`/...) to use the manual path, and the AI path's
review is a bare phase list with no body-composition context, no energy
numbers, no "why," and no distinction between "diagnosis" and "proposal."
This is exactly the problem this task exists to fix.

## 2. Existing Reusable Profile Data

`fetchUserProfile(userId)` (fitness-service's `user.client.ts`, calls
user-service) already returns, real and populated for onboarded users:
`age`, `gender`, `heightCm`, `currentWeight`, `startingWeight`, `goal`,
`activityLevel`, `experienceLevel`, `injuries`, `safetyScreeningStatus`,
`safetyScreeningFlags`, `nutritionBudgetLevel`, `region`,
`dietaryPreference`, `hasCompletedOnboarding`. This is reused as-is — no
new profile-fetch code, no duplicate profile form.

## 3. Existing InBody / Body-Composition Data

`fetchLatestInBodyOnOrBefore(userId, now)` (same client) returns the most
recent real `InBodyEntrySnapshot`: `weight`, `bodyFatPct`, `muscleMass`
(skeletal muscle mass), `visceralFat`, `bmr` (device-measured), `status`.
Reused as-is.

## 4. Existing BMR/TDEE Logic

`nutrition-bootstrap.engine.ts`'s `computeInitialNutritionPrescription` is
the **one** authoritative BMR/TDEE calculation in the product (Mifflin-St
Jeor, `10*kg + 6.25*cm - 5*age + genderTerm`, InBody-measured BMR always
preferred when present — same priority order the master task itself
specifies), combined with a real `activityMultiplier` table
(`cycleThresholds.nutritionBootstrap.activityMultiplier`, 1.2–1.9 across
the 5 `ActivityLevel` values) to produce `maintenanceCalories` (= TDEE) and
goal-driven `targetCalories`/macros. **Reused directly, not
reimplemented** — the new diagnosis endpoint (§15) calls this exact
function with `goal: "MAINTENANCE"` to get a goal-neutral BMR/TDEE for the
energy-expenditure screen, and again with the wizard's real selected goal
for the target-calorie context handed to the AI draft prompt.

**Decision on the CTG-style "steps / resistance training / other / TEF"
line-item breakdown**: the existing engine produces one combined
`activityMultiplier`, not real separately-measured components. Fabricating
independently-measured step/training/TEF numbers would be fake precision
(explicitly forbidden, §40 of the master task). Instead: the **top-line
TDEE stays 100% the existing engine's real number** (`maintenanceCalories`,
never a competing calculation), and a new, clearly-labeled
`buildEnergyBreakdown()` function (§15) allocates the real
`(maintenanceCalories - bmr)` gap across illustrative components (a
rough NEAT/steps estimate, a resistance-training kcal estimate from
sessions/week, a small TEF slice) that are proportioned to **always sum
back to the exact same real TDEE**. The UI labels these sub-lines "ước
tính" and never lets them drift from the authoritative total.

## 5. Existing Training/Activity Data

`UserProfileSnapshot.activityLevel` (5-band enum, already collected at
onboarding) is the authoritative activity input the BMR engine already
consumes. There is no existing "daily steps" or "training days/week" field
on `UserProfile` — the wizard collects these as **wizard-scoped inputs
only** (not persisted to the profile, not a new profile field), used
purely to (a) suggest an `activityLevel` band for the breakdown/BMR call
and (b) proportion the illustrative breakdown's steps/training sub-lines
(§4). No new persisted schema.

## 6. Existing Nutrition Context

`NutritionGoal` (current ACTIVE goal, if any) and nutrition onboarding are
unchanged and untouched by this pass — the wizard's energy/macro
projections are diagnosis-time estimates only (§18), never a second
nutrition engine, never written to `NutritionGoal` directly.

## 7. Existing Goal Image Service

`POST /ai/agent/goal-image` (`fitness-goal-vision.service.ts`) — unchanged,
not touched. Its own schema (`GoalVisualAttributesSchema`) already returns
only `muscularity` / `relativeLeanness` / `focusMuscles` / `confidence` /
`usable` — **never a body-fat percentage or measurement** (confirmed by
reading the service's own prompt and schema: "never a body measurement").
This directly answers §6.3/§14 of the master task: **no existing service
supports current-body AI body-fat scanning** — only goal-image style
attributes for a *desired* look. The wizard therefore:

```text
"Quét bằng AI" (current-body-fat AI scan): NOT implemented — no safe
  existing service. Shown as visually present but disabled, labeled
  "Sắp ra mắt" (Coming soon), per the master task's explicit instruction
  to mark it unavailable rather than fabricate or quietly repurpose the
  goal-vision endpoint.
Goal image upload (desired-physique reference): reused as-is, moved into
  Step 3 (Mục tiêu) per §12 of the master task.
```

## 8. Existing Equipment Data

`UserEquipment` (user-service, synced via
`syncAvailableEquipmentToUserProfile`) exists and is used by workout
generation — not needed by this wizard (roadmap phases are strategic, not
exercise-level, per the architecture's own hard invariant, §42). Not
touched.

## 9. Existing Safety Screening

`nutritionBootstrapScreening(profile)` (`nutrition-bootstrap-screening.ts`)
— `professionalReviewRequired` when `safetyScreeningStatus ===
"FOLLOW_UP_SUGGESTED"` or any `safetyScreeningFlags` present. Reused
as-is by the diagnosis endpoint, and already independently wired into the
AI roadmap draft's own safety behavior (`FOLLOW_UP_SUGGESTED` forces
`RECOVERY` in the goal-aware fallback and forces a warning — unchanged
from the hardening pass).

## 10. Existing Roadmap AI Draft Contract

`generateAiRoadmapDraft`/`roadmap-draft.service.ts` (ai-service) — unchanged
core contract (`summary`/`reasoningSummary`/`confidence`/`phases[]`/
`warnings[]`/`assumptions[]`, phase types/durations/reasons only, never
calories/macros). **Extended** (not replaced) with additional optional
context fields the wizard now collects (target weight/body fat/timeframe,
already-partially-supported `timeframeWeeks`), so the LLM's `reasoning
Summary` can reference the user's actual stated target — see §15.

## 11. New Wizard Information Architecture

One component tree, one route entry point (`RoadmapWizard`, rendered in
place of the old `NoRoadmapState`'s two-button chooser, inside the
existing `RoadmapJourneyPage.tsx` — no new top-level route):

```text
Step 1: Thông tin cơ bản    — prefilled profile + body-fat method picker
Step 2: Tập luyện & Hoạt động — activity inputs + energy expenditure breakdown
Step 3: Mục tiêu             — goal choice + target details + goal image
Step 4: Báo cáo & Lộ trình   — Fitness Diagnosis + Roadmap Report (combined)
```

State: one `useState` object in the wizard's root component, threaded down
as props (no new state library — matches the existing `AiDraftPanel`'s own
already-simple `useState`-per-field convention, just consolidated into one
object since there are now ~15 fields across 4 steps instead of ~3).
Back/Next never clears state. No network write until Step 4's explicit
Save/Start action (§13/§21 below) — Step 4 itself makes two **read-only**
calls (diagnosis + AI draft generation), matching §37's "no database write
during analysis steps."

## 12. Data Ownership Rules

```text
Wizard-only, never persisted as new schema: dailyGoalSteps, trainingDaysPerWeek,
  bodyFatInputMethod, targetBodyFatPercent (until Save/Start, at which point
  target fields ride inside the already-existing FitnessRoadmap.targetMetrics
  JSON — an existing, already-generic field, not a new column).
Server-owned, prefilled, editable only through existing APIs: age/gender/
  height/weight/activityLevel/experienceLevel (profile), bodyFatPct/BMR
  (InBody, read-only in the wizard — the wizard never writes InBody).
Derived, never independently editable: BMR, TDEE, FFMI, energy breakdown
  sub-lines, diagnosis text, roadmap phases — always recomputed from inputs,
  never hand-typed (§9 of the master task).
```

## 13. Save Draft vs Start Journey

Unchanged backend actions, reused exactly as-is (§21/§42 of the master
task — "do NOT invent another activation workflow"):

```text
"Lưu để xem sau"  -> POST /fitness-roadmaps/ai-draft/accept (existing,
                      unchanged) -> FitnessRoadmap DRAFT, RoadmapPhase[]
                      PLANNED, zero TrainingCycle created.
"Bắt đầu lộ trình" -> the same accept call, immediately followed by the
                      existing POST /fitness-roadmaps/:id/activate ->
                      FitnessRoadmap ACTIVE, first RoadmapPhase ACTIVE,
                      first TrainingCycle ACTIVE (via
                      activatePhaseInTransaction, unchanged).
```

This is a deliberate, explicit two-button choice at the wizard's own final
screen (distinct from the closure phase's earlier "Accept a bare phase
list ≠ Activate" decision, which was about an *ambiguous single button*
after a *thin* review — here the user has just seen a full Diagnosis +
Roadmap Report, and the master task's own §21 spec calls for exactly two
clearly-labeled buttons at that point). The already-built
`DraftRoadmapDetail` review screen (prior pass) is unchanged and still
handles a saved-for-later DRAFT the next time the user opens Lộ trình.

## 14. Training Navigation Simplification

`TrainingPage.tsx`'s three equal tabs (`Nhật ký tập` / `Chu kỳ tập luyện` /
`Lộ trình`) collapse to two: `Hôm nay` (today's workout log, unchanged
component) and `Lộ trình` (the Journey, now showing the current
TrainingCycle **inline** — see
`docs/GYMINI_TRAINING_INFORMATION_ARCHITECTURE.md` for the full before/
after). `TrainingCyclePage.tsx` and its route are **not deleted** — it
becomes a drill-down (`RoadmapJourneyPage` links to it via a "Xem chi tiết
chu kỳ" action), matching §24 of the master task exactly.

## 15. Required API Additions

```text
NEW: POST /fitness-roadmaps/diagnosis (fitness-service)
  Read-only. Input: wizard's Step 1–3 fields (all optional overrides of
  stored profile/InBody values — see §12). Output: real BMR/TDEE (via
  computeInitialNutritionPrescription, goal-neutral), the illustrative
  energy breakdown (§4), current FFMI (new, standard formula — see §16),
  current-vs-target projection, and deterministic (non-AI, template-based,
  same discipline as reasonCodesToVietnamese) diagnosis reasoning text.
  Zero database write. Zero AI call (kept fast/always-available, same
  "must work even if ai-service is down" principle nutrition-bootstrap
  already follows).

EXTENDED (not replaced): generateAiRoadmapDraftSchema (fitness-service) +
  GenerateRoadmapDraftRequestSchema (ai-service) gain optional
  targetWeightKg/targetBodyFatPercent/trainingDaysPerWeek fields, threaded
  into the existing prompt for richer, still-goal-aware reasoning. No new
  ai-service route.
```

No `RoadmapBlock` table, no new Prisma model, no new migration anywhere in
this pass (confirmed by design — see §16 for exactly where FFMI/diagnosis
data lives).

## 16. Migration Decision

**None.** FFMI is computed on the fly from
`weight * (1 - bodyFatPct/100) / heightM²` (the standard formula; no
InBody field stores it directly, and none needs to — it's arithmetic on
already-real inputs). The Step-4 diagnosis/report payload is **ephemeral**
(the response body only) while the user is still in the wizard; if they
choose "Lưu để xem sau," the same already-generic
`FitnessRoadmap.configuration` JSON field the closure pass already uses
for `configuration.aiDraft` gains a sibling `configuration.diagnosisSnapshot`
key — additive, same pattern, zero schema change, so a re-opened DRAFT's
`DraftRoadmapDetail` screen can still show the diagnosis that produced it.

**K1/K2/K3 phase grouping (§16 of the master task)**: a pure frontend
presentation grouping, derived by chunking `RoadmapPhase[]` on `phaseType`
family transitions (e.g. every run of `FAT_LOSS`/`DIET_BREAK`/`MINI_CUT`
phases groups under one "Giảm mỡ" block label until a `LEAN_GAIN`/
`RECOMPOSITION`/`PERFORMANCE`/`MAINTENANCE` phase starts a new block) —
**no new table**, matching the master task's own explicit instruction.

## 17. Test Strategy

```text
Backend: new integration tests for the diagnosis endpoint (real Postgres,
  real profile/InBody stand-ins via the existing coachDeps-style stub
  seam) — energy breakdown sums to the real TDEE exactly, FFMI computed
  correctly, safety-screening-aware reasoning, missing-data ->
  "Không đủ dữ liệu" never a fabricated number.
Backend: extended generateAiRoadmapDraft test coverage for the new
  optional target fields (goal-aware fallback tests already cover the
  base contract — carried, not weakened).
Frontend: build (vite build) — no dedicated unit-test runner for this
  frontend exists in the repo (confirmed: no vitest/jest config), matches
  every other frontend change so far in this workstream.
E2E: extend tests/31-fitness-roadmap.spec.ts with the full wizard happy
  path (real browser, real backend, real dedicated roadmap.client account),
  plus a DB-evidence assertion that Save creates zero TrainingCycle and
  Start creates exactly one.
```
