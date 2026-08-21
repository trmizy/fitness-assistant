# Body State & Adaptive Planning

Root-cause data-model reference for the "real-time body profile / evidence-based adaptive
nutrition" refactor. Explains what each concept means in THIS codebase, which model/field
backs it, and why the separation exists. See `docs/research/fitness-nutrition-evidence.md`
for the scientific evidence backing the AI rules referenced below.

## The core bug this fixes

`UserProfile.currentWeight` (user-service) is a denormalized cache, overwritten by every
InBody sync. Before this refactor, there was no field anywhere representing the user's
**original starting weight** — so "how much have I lost since I started" could not be
computed, and nothing prevented a UI/AI surface from treating the latest measurement as if it
were the baseline.

## The five concepts, and where each one actually lives

```
BASELINE ≠ CURRENT STATE ≠ GOAL ≠ MEASUREMENT ≠ PRESCRIPTION
```

| Concept | Model / field | Service | Mutability |
|---|---|---|---|
| **Measurement** | `InBodyEntry` | user-service | Append-only (one row per user per calendar day; already existed, reused as-is) |
| **Current state** | `UserProfile.currentWeight` | user-service | Overwritten on every InBody sync — this is intentional, it's a "latest" cache |
| **Journey baseline** | `UserProfile.startingWeight` / `startingWeightSource` | user-service | **Set once** — the first time this profile ever has a weight recorded (onboarding or first InBody), never touched again |
| **Per-cycle baseline** | `TrainingCycle.baselineMetrics` (JSON) | fitness-service | Set once per cycle, at that cycle's activation — cycle 2's baseline is cycle 1's *end* weight, not the all-time start |
| **Goal** | `UserProfile.targetWeight` | user-service | Only changes on an explicit user-driven profile edit — never touched by a measurement write |
| **Prescription** | `NutritionGoal` (versioned) | fitness-service | New ACTIVE row per change; the old row becomes `SUPERSEDED`, never deleted or overwritten |

### Why two different "baseline" concepts?

`UserProfile.startingWeight` answers **"where did this person's whole journey begin"** — set
once, forever, spanning every training cycle they'll ever run.

`TrainingCycle.baselineMetrics` answers **"where did THIS specific 4-week block begin"** —
reset at the start of every new cycle. A user who started at 80kg, finished cycle 1 at 76.8kg,
and started cycle 2 the next day has:

```
UserProfile.startingWeight        = 80    (never changes again)
Cycle #1.baselineMetrics.weight   = 80    (cycle 1's own start)
Cycle #2.baselineMetrics.weight   = 76.8  (cycle 2's own start — cycle 1's end)
```

Both are real, correct, and answer different questions. Neither is "wrong."

`TrainingCycle.baselineMetrics`/`targetMetrics` are not new columns — they were added in
migration `20260721000000_adaptive_cycle_evaluation` and sat completely unused until this
refactor wired them up in `training-cycle.service.ts` (`startCycle`/`startDraftCycle`).

## The flow

```
Measurement (InBody upload / manual entry)
    │
    ▼
Append to InBodyEntry (user-service) — idempotent per (userId, dateOnly)
    │
    ▼
profileRepository.upsert() — the single choke point:
    │  • ALWAYS updates currentWeight
    │  • sets startingWeight ONLY if it was never set before (set-once rule,
    │    see profile-starting-weight.util.ts)
    │  • NEVER touches targetWeight
    ▼
CurrentBodyState reflected immediately (React Query cache invalidated —
ClientDashboard/TrainingEquipmentSettingsPage's query keys were fixed to
actually match the invalidation target; see the query-key mismatch note below)
    │
    ▼
Trend computation (weight-trend.util.ts, fitness-service) — rolling average
over cycleThresholds.weightTrend.trendWindowDays, confidence LOW/MEDIUM/HIGH
based on sample count. A single day's reading never drives a decision.
    │
    ▼
Weekly/cycle evaluation (existing cycle-decision.engine.ts, extended with
this trend data as a Phase 2 input — see "What's deferred" below)
    │
    ▼
Recommendation (KEEP_PLAN / PROPOSE_ADJUSTMENT / ...) — never auto-applied
    │
    ▼
If accepted: new NutritionGoal version (ACTIVE), old one SUPERSEDED
```

## Frontend

- `ProfilePage.tsx` and `WorkoutLogPage.tsx`'s body-metrics panel both show **Cân nặng bắt đầu
  / Hiện tại / Mục tiêu / Đã thay đổi / Còn lại** — sourced from `startingWeight` (immutable),
  the latest weight, and `targetWeight`. Neither ever displays `startingWeight` as anything
  other than what it is: a fixed snapshot.
- Query-key bug fixed: `ClientDashboard.tsx` used to query `["profile"]` while the InBody
  upload flow invalidates `["profile", user.id]` — not a prefix match, so the dashboard's
  profile query never refreshed after an upload. `TrainingEquipmentSettingsPage.tsx` had the
  same problem with a third key, `["profile", "me"]`. Both now use the canonical
  `["profile", user?.id]` key.

## AI context shape

`ai-service`'s `CoachContext` (`coach/coach_context.types.ts`) now carries a `journey` block
(`starting_weight_kg`, `current_weight_kg`, `target_weight_kg`, `changed_since_start_kg`,
`remaining_to_goal_kg`) computed once in `coach_context_builder.ts` — the model is never asked
to subtract these itself. The redundant flat-text rendering of weight/body-composition data in
`prompt_builder.ts`'s `compactProfile()` was removed since the structured `CoachContext` JSON
(which always accompanies it in the same prompt) already covers it — sending the same numbers
twice in two shapes was a real risk of future drift/contradiction, not harmless redundancy.

`prompt_builder.ts` now also carries an explicit **BODY DATA & ADAPTIVE REASONING RULES**
block (both `vi`/`en`) — see spec §22 rules, e.g. never confuse baseline/current/target, treat
BIA and wearable calories as estimates, use trend not single-day deltas, never silently change
a goal, always explain *why* an adjustment is proposed.

## Evidence registry

7 evidence entries (`data/processed/evidence/*.jsonl`) are live in the actual RAG pipeline
(`fitness_evidence` Qdrant collection) — 6 new ones added this pass, 1 (ISSN protein 2017)
already existed. See `docs/research/fitness-nutrition-evidence.md` for the full list with
citations, findings, applicability, and limitations.

## Phase 1 deferrals — resolved in Phase 2

- ✅ **Adaptive Nutrition Decision Engine** — implemented, see below.
- ✅ **`WorkoutLogPage.tsx` InBody state unification** — it now reads from the same
  `["inbody-history"]` React Query cache key `InBodyModule.tsx` uses (`inbodyHistoryQuery`,
  `WorkoutLogPage.tsx`), and its own manual-entry save now calls
  `queryClient.invalidateQueries({queryKey:["inbody-history"]})` instead of a private
  `getHistory()` + local-state refetch. An InBody update made on any screen now reflects on
  every other mounted screen without an F5.
- ⏸ **Wearable/active-calories handling** — still zero implementation anywhere in the codebase.
  Left as a Phase 3 item (see below); at most, `activeCaloriesEstimate` naming is reserved in
  comments so a future wearable integration doesn't collide with `TDEE`/`prescribedCalories`.
- ⏸ **Full Profile/Progress UI redesign** — still out of scope; Phase 2 adds a nutrition
  recommendation card and a minimal version-history view (below), not a full redesign.

## Phase 2 — Adaptive Nutrition Decision Engine

### Architecture: deterministic engine decides, LLM only explains

`nutrition-decision.engine.ts` (fitness-service) is a **pure function**,
`evaluateNutritionAdaptive(input): NutritionDecisionResult` — no I/O, no LLM call, fully unit
tested (21 cases). It owns every business-critical branch: data-quality gating, safety gating,
adherence gating, and the calorie/macro math. The LLM (`ai-service`'s existing
`/ai/assess-cycle` endpoint, reused rather than duplicated) is only ever allowed to turn the
engine's already-decided output into a Vietnamese explanation
(Observation/Interpretation/Recommendation). `cycle-assessment.service.ts` **overrides** the
LLM's echoed `nutritionSummary.nutritionDecision` back to the engine's real value if the model
ever deviates, and strips a hallucinated `nutritionSummary` entirely if the engine produced no
nutrition result at all — the LLM cannot move the decision even if prompted to.

### State diagram

```
DATA ARRIVES (InBody sync / nutrition log / workout log / weekly check-in)
    │
    ▼
UPDATE CURRENT STATE (UserProfile.currentWeight, unchanged from Phase 1)
    │
    ▼
UPDATE TREND (weight-trend.util.ts — reused as-is from Phase 1, rolling window,
              LOW/MEDIUM/HIGH confidence by sample count)
    │
    ▼
QUALITY / SAFETY GATE (nutrition-decision.engine.ts, gate order below)
    │
    ├─ severe pain/safety flag ──────────────► ESCALATE
    ├─ elevated/rising pain ─────────────────► EARLY_REVIEW
    ├─ weightTrendConfidence=LOW or
    │  measurementQuality=LOW or
    │  nutritionAdherence=null ──────────────► REQUEST_MORE_DATA
    ├─ low adherence + plateau ──────────────► KEEP_PLAN (reason: address
    │                                           behavior, not target)
    ├─ no active prescription/unresolved
    │  weight ────────────────────────────────► REQUEST_MORE_DATA
    ├─ evaluation window too short ──────────► KEEP_PLAN
    ├─ on-target for the active goal ────────► KEEP_PLAN
    └─ off-target, data sufficient ──────────► PROPOSE_ADJUSTMENT
                                                 (bounded calorie delta,
                                                  protein-floor-preserving
                                                  macro redistribution)
```

Safety is checked **before** data-quality — a pain/safety flag routes to EARLY_REVIEW/ESCALATE
even from thin data, since "not enough data to adjust calories" must never be read as
"not enough data to worry about pain."

### Signals (reused, none fabricated)

`weightTrend`/`weightTrendRate` (from `weight-trend.util.ts`), `nutritionAdherence`,
`proteinAdherence`, `trainingAdherence` (from `CycleMetricsResult`, already computed by the
existing cycle-metrics engine), `recovery`, `painOrDiscomfort` (from the existing weekly
check-in `requiresAttention`/pain-flag fields — no new safety thresholds invented),
`bodyComposition`, `measurementQuality` (from the existing InBody data-quality evaluator).
There is no sleep or hunger signal — no such data source exists in this codebase, so none is
fabricated; the spec's own instruction to never invent a signal is honored literally.

### Config, not magic numbers

All step sizes and bounds live in `cycle-thresholds.config.ts`'s `nutritionAdaptive` section
(`calorieAdjustmentStepKcal`, `min`/`maxCalorieAdjustmentKcal`, `minPrescriptionCalories`,
`minAdherenceForAdjustment`, `weightLossPaceSlow/FastPctPerWeek`, `maintenanceToleranceKgPerWeek`,
`proteinFloorGPerKg`/`proteinCeilingGPerKg`), each commented **PRODUCT_HEURISTIC** with the
paper that informed the *direction* of the choice — never claimed as "science says exactly
150 kcal." Protein floor/ceiling (1.4–2.0 g/kg/day) is the one genuinely evidence-sourced range,
from Jäger et al. 2017 (PMID 28642676).

### Macro redistribution — protein is never scaled down with calories

A calorie cut redistributes into carbs/fat first; protein is held inside the 1.4–2.0 g/kg
range and only reduced if the calorie floor makes the current protein g/kg mathematically
impossible — a proportional "scale everything down together" approach (which would silently
cut protein on every deficit) is explicitly rejected. Fat is held stable; carbs absorb the
remainder. All three unit tests assert the reconciled macros sum back to the proposed calorie
target.

### Versioning & apply workflow (reused, extended)

The engine never writes to the database — it returns a `NutritionDecisionResult`. A human
(the user) must explicitly **accept** it via `POST /training-cycles/:id/nutrition-recommendation/accept`,
which:

1. Atomically claims the `PENDING` nutrition decision on the `CycleAssessment` row
   (`updateMany` with a `nutritionUserDecision: "PENDING"` WHERE clause — the same
   compare-and-swap pattern the pre-existing training accept/reject already used), returning
   409 if it was already claimed. Proven race-safe with a real `Promise.allSettled` concurrency
   test: exactly one of two simultaneous accepts wins.
2. Creates a **new** `NutritionGoal` version (ACTIVE) via the existing Phase-1 versioned
   `nutritionRepository.upsertGoal`, superseding — never mutating — the previous ACTIVE row.
   `triggeredBy: "AI_ADAPTIVE"`, `reason` set from the engine's `reasonCodes`.
3. Records a separate `RecommendationAudit` row (`engineVersion: "nutrition-adaptive-v1"`),
   independent from the training decision's own audit trail on the same cycle — accepting a
   training recommendation must never also mark the nutrition one as reviewed, and vice versa
   (a real cross-contamination bug was found and fixed here, see the Phase 2 report).

Retrying the same accept call twice applies exactly once (second call 409s) — no duplicate
`NutritionGoal` versions are ever created.

### Evidence traceability

`evidenceIds` on every decision are real slugs from `data/processed/evidence/_index.json`
(e.g. `hall-2011-dynamic-energy-balance`, `garthe-2011-weight-loss-rate-athletes`,
`tinsley-2022-bodycomp-standardization`, `brewer-2021-inbody-validation`) — not invented IDs.
`cycle-assessment.service.ts` never persists an evidence ID the LLM invents; only the engine's
own list is ever attached to the assessment.

### Frontend

`TrainingCyclePage.tsx`'s `AdaptiveAssessmentCard` renders the nutrition recommendation as a
**separate card** from the training recommendation — separate decision space, separate
accept/reject, per the spec's explicit instruction not to conflate the two. Shows the decision
label, confidence, the AI's Observation/Interpretation/Recommendation explanation, the proposed
calorie/macro numbers with a "chưa áp dụng" (not yet applied) disclaimer, and — for
EARLY_REVIEW/ESCALATE — a safety notice that explicitly defers to a medical/PT professional
rather than diagnosing.

## Phase 3 roadmap (explicitly out of scope for Phase 2)

- Wearable/active-calories integration (`activeCaloriesEstimate` naming reserved only).
- Full NIH dynamic-energy-balance TDEE model (Phase 2 only audited that
  `TDEE estimate != prescribedCalories != actual calories out` are never conflated in naming;
  it did not implement the full adaptive-thermogenesis model).
- A dedicated, richer nutrition-version-history UI beyond the minimal current/previous view
  shipped this phase.
- Expanding E2E coverage beyond the PROPOSE_ADJUSTMENT→accept flow to also drive
  KEEP_PLAN/REQUEST_MORE_DATA/EARLY_REVIEW/ESCALATE through the browser (currently covered at
  the engine-unit and service-integration level only; see the Phase 2 report's E2E section for
  the explicit scope boundary and reasoning).
