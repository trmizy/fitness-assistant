# Gymini Adaptive Forecast Reconciliation, Confidence Ranges & Post-Cycle Reforecasting — Implementation Report

Date: 2026-09-10
Scope: corrective + depth phase on top of the VERIFIED Guided Roadmap
Creation and Roadmap Projection Hardening phases. No wizard redesign, no
lifecycle redesign, no navigation change, no new decision engine. See
`docs/GYMINI_ADAPTIVE_FORECAST_RECONCILIATION_DESIGN.md` for the design
gate this implements.

## 1. Forecast Engine Extensions — Confidence & Ranges

`fitness-roadmap-forecast.engine.ts` (extended, not replaced — the 21
tests from the prior phase all still pass unchanged):

```text
computeForecastConfidence(context) -> {tier, score, reasonCodes}
  Deterministic, reused-inputs-only (design doc §8) — never an AI
  confidence score. Inputs: bodyFatMethod + InBody measurement recency
  (<=90 days = full score, else stale), completedCycleCount (0/1/2+),
  and CycleAssessment.dataQualityScore when available (blended in via a
  simple average — never re-derived, the exact same score
  cycle-metrics.engine.ts's own computeDataCompletenessScore already
  produces). Live-verified: recent InBody scores strictly higher than
  stale InBody, which scores higher than manual, which scores higher
  than visual-reference, which scores higher than none.

computeForecastRange(expected, deltaMagnitude, tier, decimals) -> {low, expected, high}
  Explicitly a CATEGORICAL uncertainty band tied to confidence tier
  (±2%/±4%/±8% of the phase's own delta magnitude, floored at ±0.2kg),
  NOT a statistical confidence interval — documented as such in the
  function's own doc comment and in every place it surfaces in the UI,
  per the master task's explicit "categorical disclaimer, not fake
  mathematics" instruction (no defensible per-distance statistical model
  exists anywhere in this codebase, confirmed by grep before choosing
  this approach). low <= expected <= high always, by construction.

applyDistanceCap(baseTier, phasePosition)
  A farther-future phase's confidence is capped (phase 0 -> up to HIGH,
  phase 1 -> capped at MEDIUM, phase 2+ -> capped at LOW) — a simple,
  monotonic, discrete rule (never a fabricated numeric widening
  formula) satisfying "near-term narrower/higher confidence, far-future
  wider/lower confidence" without inventing evidence that doesn't exist.
```

`PhaseForecastResult` gained `projectedEndWeightRangeKg`,
`projectedEndBodyFatPctRange` (null when no body-fat baseline exists —
never fabricated), and `confidence` — additive fields, the existing
point-estimate fields (`projectedEndWeightKg` etc.) are unchanged and
still the correct expected value everything else (persisted snapshots,
21 prior tests) depends on.

## 2. New Module — `fitness-roadmap-reconciliation.engine.ts`

Pure, deterministic, zero I/O, zero AI — same discipline as every other
engine in this codebase.

```text
reconcilePhase(original, actual) -> PhaseReconciliationResult
  Compares a completed phase's original forecast to its actual outcome.
  Status classification (design doc §10) NEVER judges from weight alone
  — the master task's own worked example (weight behind forecast but
  adherence 92%/strength +4.1% must never auto-fail) is a literal unit
  test, passing: WEIGHT_BEHIND_BUT_ADHERENCE_STRONG and
  WEIGHT_BEHIND_BUT_PERFORMANCE_STRONG both resolve to ON_TRACK.
  A dedicated test (`reconcilePhase: reconciliation never emits or
  references a CycleAssessment decision value`) asserts by construction
  that this module has zero knowledge of KEEP/PROGRESS/ADJUST/DELOAD/
  REBUILD — CycleAssessment (unchanged, untouched) remains the sole
  authority for "what should we do next," this module only answers
  "what happened relative to forecast."

buildForecastChangeExplanation(codes) -> string
  Deterministic, template-based Vietnamese (design doc's own §23) —
  never raw AI text, never blames the user (§24: no "thất bại"/"không
  tuân thủ" anywhere in the label set).
```

## 3. New API — `GET /fitness-roadmaps/current/forecast`

Read-only, authenticated, resolves the caller's own ACTIVE roadmap
(same ownership scoping `getCurrentRoadmap` already uses). Kept
separate from the existing `POST /fitness-roadmaps/projection`
(pre-Save, caller-supplied-context) — this new endpoint has no
equivalent without a real, persisted, ACTIVE roadmap to read history
from.

```text
fitness-roadmap.service.ts:
  + resolveEffectiveDiagnosisContext refactor (already existed from the
    prior phase; unchanged here)
  + getCurrentForecast(userId):
    - originalForecast: configuration.roadmapProjectionSnapshot,
      returned byte-for-byte, NEVER overwritten by this or any prior
      write path (confirmed by grep: nothing else in the codebase
      writes this key after roadmap creation)
    - currentForecast: forecastPhaseSequence() called with TODAY's real
      actual state (profile + latest InBody) as the starting context,
      over the roadmap's own remaining (ACTIVE+PLANNED) phases — reuses
      the SAME chaining function unchanged, just different inputs. A
      REBUILD's new remainder or a fresh InBody entry is picked up
      automatically on the very next read, zero special-casing.
    - reconciliations: one entry per COMPLETED phase with a matching
      original forecast entry, using the real InBody on/before that
      SPECIFIC phase's own actualEndAt (temporal correctness, §16 —
      live-verified: a later InBody reading is never used to reconcile
      an earlier-completed phase, see the temporal-correctness
      integration test).
    - changeReasonCodes/changeExplanation: deterministic comparison of
      the current baseline against the matching original entry, plus
      reconciliation/recency signals already computed above.
controllers/fitness-roadmap.controller.ts: + currentForecast handler
routes/fitness-roadmap.routes.ts: + GET /current/forecast
```

Live-verified against the real dev stack (`roadmap.client4@example.test`,
a single-FAT_LOSS-phase ACTIVE roadmap):

```json
// BEFORE setting a real profile (age/height/weight/gender/activityLevel
// all null — the guided wizard's own Step 1 inputs are diagnosis-time
// overrides, never persisted back to the real UserProfile):
{"originalForecast": {...}, "currentForecast": null, "reconciliations": []}

// AFTER a real PUT /profile/me call (the same legitimate endpoint
// ProfilePage itself uses) sets currentWeight=80.4:
{"originalForecast": {"phaseForecasts":[{"projectedStartWeightKg":79.5, ...}]},
 "currentForecast": {"phaseForecasts":[{
    "projectedStartWeightKg":80.4,   // the REAL actual state, not the
                                       // stale original 79.5
    "projectedEndWeightRangeKg":{"low":78.4,"expected":78.6,"high":78.8},
    "confidence":{"tier":"LOW","score":0,
      "reasonCodes":["NO_BODY_FAT_DATA","NO_COMPLETED_CYCLES_YET"]}
 }]},
 "reconciliations": []}
```

Confirms live: the current forecast chains from the REAL actual state
(80.4kg), never the stale original (79.5kg) — exactly the master task's
own "Phase 2 starts 80.4, not 79.6" worked example, now proven against
the real running system, not just a unit test.

## 4. Reconciliation Audit Persistence (design doc §13)

Inside `advanceRoadmap`'s existing transaction, right at the moment a
phase transitions to `COMPLETED` (the `COMPLETE_AND_ACTIVATE_NEXT_PHASE`
branch, unchanged), a **second, distinct** `RecommendationAudit` row is
now written (`engineVersion: "forecast-reconciliation-v1"`, never mixed
into the existing transition-decision row) — zero schema change, reusing
the same generic table every prior `engineVersion` already shares.
Best-effort: absent for a roadmap with no forecast snapshot at all
(e.g. an expert-mode roadmap), never blocks phase completion either way.

## 5. Frontend — `AdaptiveForecastSection`

New component in `RoadmapJourneyPage.tsx`, mounted only for an ACTIVE
roadmap, right after the existing `ActivePhaseDetail`:

```text
"Chu kỳ vừa qua" — the most recent reconciliation (dự kiến/thực tế/
  chênh lệch + adherence + strength + a one-line Gymini assessment
  sentence, mapped from the reconciliation status — never raw text).
  Absent entirely when no phase has completed yet (a correct absence,
  not a loading state or an error).
"Dự báo đã cập nhật" — the near-term (first remaining phase)'s range +
  confidence tier + the deterministic change-explanation sentence +
  the permanent "Đây là dự báo, không phải cam kết kết quả" disclaimer.
"Xem dự kiến ban đầu" — a collapsed-by-default secondary disclosure
  (master task §31's explicit hierarchy) reusing the SAME
  PhaseForecastCard/STRATEGY_BUCKET_LABEL the guided wizard's own Step 4
  already uses — never a second rendering of the same data shape.
```

`ActivePhaseDetail`'s existing "Dự kiến ban đầu: ~X kcal/ngày" note
(prior phase) is unchanged — the real `NutritionGoal.calories` stays the
primary, larger number.

A COMPLETED roadmap's existing summary card (unchanged branch) gained a
compact final-comparison row (starting weight / originally-projected end
weight / phases+cycles completed) sourced directly from the still-intact
`configuration.roadmapProjectionSnapshot` — no new API call, since
`GET /current/forecast` is ACTIVE-only by design (matches
`getCurrentRoadmap`'s own contract) and a COMPLETED roadmap has no
"current" forecast concept left to compute.

## 6. Build/Regression Evidence

```text
fitness-service tsc --noEmit:                 EXIT 0
frontend vite build:                          EXIT 0

fitness-roadmap.service.integration.test.ts:  49/49 PASS (was 47, +2 new
  Adaptive Forecast Reconciliation integration tests — real Postgres)
coach.service.integration.test.ts:             7/7  PASS (unchanged)
fitness-diagnosis.engine.test.ts:             14/14 PASS (unchanged)
fitness-roadmap-forecast.engine.test.ts:      30/30 PASS (was 21, +9 new
  confidence/range tests)
fitness-roadmap-reconciliation.engine.test.ts (new): 13/13 PASS
pure baseline (5 engine/util files):         128/128 PASS (unchanged)
                                             ─────────────
                                             241/241 PASS, 0 fail
```

ai-service was NOT touched this phase (confirmed via `git status`) — its
last-verified state stands, not re-run redundantly.

## 7. A Real Bug This Phase's Own Test Suite Caught (and the fix)

The first run of the new reconciliation integration test failed:
`reconciliationAudits[0].decision` was not one of the three expected
values. Root cause: the test's fake InBody fixture used a hardcoded
future-relative date (`"2026-10-09"`) while `advanceRoadmap`'s own
`phaseCompletedAt` is `new Date()` — real wall-clock "now." Since this
whole engagement's environment clock is itself set to a date inside
2026, and the fixture date happened to fall AFTER that real "now,"
`fetchLatestInBodyOnOrBefore`'s own `date <= cutoff` filter correctly
(by design) found zero matching entries, silently degrading the test to
the `INSUFFICIENT_DATA` path — proving the temporal-correctness logic
itself works, just not exercising the intended non-INSUFFICIENT_DATA
path. Fixed by computing the fixture date relative to `Date.now()`
instead of a hardcoded string. A second, smaller hygiene bug (restoring
`process.env.USER_SERVICE_URL` to `undefined` coerces it to the literal
string `"undefined"`, not a cleared variable) was fixed alongside it.

## 8. Files Changed (this phase)

```text
Backend — fitness-service:
  src/services/fitness-roadmap-forecast.engine.ts (confidence + range
    extensions, additive)
  src/services/fitness-roadmap-reconciliation.engine.ts (NEW)
  src/__tests__/fitness-roadmap-forecast.engine.test.ts (+9 tests)
  src/__tests__/fitness-roadmap-reconciliation.engine.test.ts (NEW, 13 tests)
  src/services/fitness-roadmap.service.ts (+ getCurrentForecast,
    reconciliation-audit persistence inside advanceRoadmap)
  src/controllers/fitness-roadmap.controller.ts (+ currentForecast handler)
  src/routes/fitness-roadmap.routes.ts (+ GET /current/forecast)
  src/__tests__/fitness-roadmap.service.integration.test.ts (+2 tests,
    incl. a fake local user-service HTTP stand-in for real InBody data)

Frontend:
  src/app/pages/client/RoadmapJourneyPage.tsx (+ AdaptiveForecastSection;
    COMPLETED-roadmap final-comparison row)
  src/app/services/api.ts (+ ForecastRange, ForecastConfidence,
    PhaseReconciliationResult, CurrentForecastResult types,
    getCurrentForecast client function)

External E2E harness (c:\D_Backup\Test\fitnessassistant-playwright-e2e):
  tests/31-fitness-roadmap.spec.ts (+ TC-ROADMAP-008)

Docs:
  docs/GYMINI_ADAPTIVE_FORECAST_RECONCILIATION_DESIGN.md (design gate)
  docs/GYMINI_ADAPTIVE_FORECAST_IMPLEMENTATION_REPORT.md (this file)
  docs/GYMINI_ADAPTIVE_FORECAST_E2E_REPORT.md (new)
  docs/GYMINI_ADAPTIVE_FORECAST_VERIFICATION_REPORT.md (new)
```

No migration added (53 migration directories, unchanged). No file
belonging to the parallel Canonical Exercise Identity / AI Workout
Grounding / Equipment / MovementPattern / Substitution / Catalog work
was touched — confirmed via `git status` before this phase's first edit
and cross-referenced against the diff list above.
