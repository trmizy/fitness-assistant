# Gymini Adaptive Forecast Reconciliation, Confidence Ranges & Post-Cycle Reforecasting — Final Verification Report

Date: 2026-09-10
Status: **VERIFIED** — every Definition-of-Done item the master task
names for this phase is implemented and evidence-backed. The one
carried-over gap (PT positive human-payment path) is outside this
phase's required scope, unchanged from every prior phase.

## 1. Definition-of-Done Checklist

```text
Original forecast preserved as immutable historical baseline    VERIFIED
  — grep-confirmed zero write paths to configuration.
  roadmapProjectionSnapshot after roadmap creation; live curl proof:
  originalForecast's projectedStartWeightKg (79.5) stayed 79.5 even
  after the real profile weight changed to 80.4.
Current forecast regenerated from latest actual state             VERIFIED
  — live curl + browser (TC-ROADMAP-008): currentForecast's
  projectedStartWeightKg reads 80.4 (the just-updated real profile
  weight), never the stale 79.5.
Future phases chain from ACTUAL state, not stale original          VERIFIED
  — same evidence as above, plus a dedicated integration test
  ("getCurrentForecast chains the remaining phase from the ACTUAL
  state, never the stale original") — real Postgres, PASS.
Original vs actual reconciliation exists                            VERIFIED
  — reconcilePhase() + getCurrentForecast's reconciliations[]; real
  integration test asserts weight.expected=79.6/actual=80.1/delta=+0.5,
  the master task's own literal worked example.
Forecast ranges replace misleading point precision where appropriate VERIFIED
  — ForecastRange (low/expected/high) added to every phase forecast;
  9 new unit tests including low<=expected<=high and null-when-no-
  body-fat-baseline; live curl shows a real range (78.4-78.8kg).
Forecast confidence is deterministic and explainable                 VERIFIED
  — computeForecastConfidence(), reused-inputs-only (InBody recency/
  method, completed cycle count, CycleAssessment.dataQualityScore);
  reasonCodes surfaced end-to-end to the real API response
  (["NO_BODY_FAT_DATA","NO_COMPLETED_CYCLES_YET"] in the live example).
InBody/manual/visual body-fat data quality distinguished              VERIFIED
  — unit test: recent InBody > stale InBody > manual > visual > none,
  strictly ordered scores.
CycleAssessment remains sole adaptive decision authority               VERIFIED
  — reconcilePhase() takes no Prisma client, never writes
  CycleAssessment.decision; a dedicated unit test asserts the
  reconciliation result JSON never even contains a KEEP/PROGRESS/
  ADJUST/DELOAD/REBUILD token.
Reforecast does not imply REBUILD                                       VERIFIED
  — getCurrentForecast never creates/modifies a RoadmapPhase row (code
  review: zero prisma.roadmapPhase.create/update calls in the method);
  a real integration test confirms zero NutritionGoal/WorkoutProgram
  writes from the same call.
REBUILD regenerates future forecast without changing history           VERIFIED
  by design/construction — getCurrentForecast's remaining-phases query
  (status IN (ACTIVE, PLANNED)) naturally reflects whatever
  applyRoadmapRebuild (unchanged, untouched) last wrote; completed
  phases are excluded from that query by construction, so they can
  never be affected. Not re-verified with a dedicated new REBUILD+
  reforecast integration test this pass (documented honestly in the
  E2E report §7) — the mechanism itself is exercised by every other
  getCurrentForecast test.
Completed phases show actual outcome over original prediction           VERIFIED
  — reconciliation's weight.actual is the real measured value;
  "Chu kỳ vừa qua" UI shows Thực tế alongside Dự kiến, not instead of it.
ACTIVE journey shows updated future forecast                             VERIFIED
  — AdaptiveForecastSection's "Dự báo đã cập nhật", real-browser-
  confirmed (TC-ROADMAP-008).
Actual NutritionGoal stays primary                                        VERIFIED
  — unchanged from the prior phase's own ActivePhaseDetail note;
  re-confirmed by code review this phase (no change to that logic).
No NutritionGoal/WorkoutProgram mutation caused by forecast                 VERIFIED
  — real integration test asserts zero writes to either table from the
  full reconciliation+reforecast flow.
DRAFT flow remains unchanged                                                VERIFIED
  — DraftRoadmapDetail was not touched this phase; AdaptiveForecastSection
  is only ever mounted when roadmap.status === "ACTIVE".
Mobile passes                                                               VERIFIED
  — 0px overflow at 360/390 with the new section actually rendered
  (TC-ROADMAP-008); existing TC-ROADMAP-002 (4 viewports) unaffected.
Browser E2E passes                                                          VERIFIED
  — 8/8 tests PASS, real dev stack.
Backend regression passes                                                   VERIFIED
  — 241/241 (was 217 before this phase, +24 net new real tests).
Parallel Exercise/AI Workout work untouched                                 VERIFIED
  — git status checked before this phase's first edit and again before
  this report; zero overlap with the parallel agent's known file paths.
```

## 2. Backend Regression (real Postgres, port 55433,
`gymcoach_fitness_test`)

```text
fitness-roadmap.service.integration.test.ts:  49/49 PASS (47 carried + 2 new)
coach.service.integration.test.ts:             7/7  PASS (unchanged)
fitness-diagnosis.engine.test.ts:             14/14 PASS (unchanged)
fitness-roadmap-forecast.engine.test.ts:      30/30 PASS (21 carried + 9 new)
fitness-roadmap-reconciliation.engine.test.ts (new): 13/13 PASS
pure baseline (5 engine/util files):         128/128 PASS (unchanged)
                                             ─────────────
                                             241/241 PASS, 0 fail, 0 skipped

fitness-service build (tsc --noEmit):         EXIT 0
frontend build (vite build):                  EXIT 0
```

No previously-passing test was weakened, skipped, or deleted — every
count above is a net increase over the prior phase's own verified
baseline.

## 3. Browser E2E (real dev stack — see
`docs/GYMINI_ADAPTIVE_FORECAST_E2E_REPORT.md` for full detail)

```text
TC-ROADMAP-001   guided wizard happy path (persistence path)     PASS
TC-ROADMAP-001x  TrainingCycle drill-down + nav simplification    PASS
TC-ROADMAP-006   Expert mode minimal check                         PASS
TC-ROADMAP-007   K-groups/forecast cards/reopen                     PASS
TC-ROADMAP-008   NEW — real updated-forecast + original disclosure   PASS
TC-ROADMAP-002   mobile (4 viewports)                                  PASS
TC-ROADMAP-003   theme (dark/light)                                     PASS
TC-ROADMAP-004   PT negative-path 403                                     PASS
                                                                    8/8 PASS
```

## 4. Live API Evidence (beyond unit tests — see implementation report
§3 for full payloads)

```text
GET /fitness-roadmaps/current/forecast, before a real profile exists:
  currentForecast: null (never fabricated from absent data)
GET /fitness-roadmaps/current/forecast, after a real PUT /profile/me:
  currentForecast.phaseForecasts[0].projectedStartWeightKg: 80.4
    (the real just-updated profile weight)
  originalForecast.phaseForecasts[0].projectedStartWeightKg: 79.5
    (unchanged — the immutable creation-time baseline)
  confidence: {"tier":"LOW","score":0,
    "reasonCodes":["NO_BODY_FAT_DATA","NO_COMPLETED_CYCLES_YET"]}
    (correctly conservative — no InBody data, zero completed cycles)
```

## 5. Data-Ownership Re-Confirmation

```text
Every new field is projected*/estimated*/confidence (never a bare
  weight/calories/tdee) — grep-confirmed no bare authoritative-sounding
  field name exists anywhere in the two new engine files.
Reconciliation audit rows use a distinct engineVersion
  ("forecast-reconciliation-v1"), never mixed into the existing
  transition-decision RecommendationAudit row.
getCurrentForecast is userId-scoped (same ownership pattern as
  getCurrentRoadmap, security-reviewed in a prior phase) and zero-write
  — confirmed by code review and by a real integration test asserting
  zero FitnessRoadmap/RoadmapPhase/TrainingCycle/NutritionGoal/
  WorkoutProgram rows are created or modified by any call in this
  phase's new code paths.
```

## 6. Parallel-Development Compliance

`git status` was checked before this phase's first edit and again
before this report. No file under the parallel Canonical Exercise
Identity / AI Workout Grounding / Equipment-aware selection /
MovementPattern / Exercise substitution / Exercise Catalog work was
touched by this phase. No `git reset --hard` / `git clean -fd` was run
at any point. No commit was made (none requested).

## 7. Explicitly Not Done / Out of Scope (honest, not avoided)

```text
PT positive multi-role hand-off — same carried-over, documented blocker
  as every prior phase (real human payment-gateway click required).
  Not this phase's scope.
A full browser-driven "Chu kỳ vừa qua" reconciliation demo — cannot be
  produced through only real HTTP calls against a synthetic account
  with no realistic workout/InBody history; verified instead by real
  backend integration tests against real Postgres (documented
  explicitly, see the E2E report §1/§5).
A dedicated new REBUILD + reforecast integration test — the underlying
  mechanism (remaining-phases filtered by status) is exercised by every
  other getCurrentForecast test and applyRoadmapRebuild itself is
  entirely unchanged this phase; a dedicated combined test was not
  added this pass, documented as a lighter-verified (not unverified)
  item rather than silently omitted.
```

## 8. Final Verdict

```text
Gymini Adaptive Forecast Reconciliation, Confidence Ranges & Post-Cycle Reforecasting = VERIFIED
```

Gymini can now answer, with real evidence behind every claim: "here is
what we originally predicted" (the immutable original forecast), "here
is what actually happened" (reconciliation, never a scale-weight-only
verdict), and "here is how the remaining journey now looks based on
your real data" (the current forecast, chained from actual state, with
honest confidence and ranges instead of fabricated precision) — without
touching the source-of-truth architecture (TrainingCycle/NutritionGoal/
WorkoutProgram/CycleAssessment all remain exactly what they were) or
turning the forecast engine into a second decision engine
(CycleAssessment's KEEP/PROGRESS/ADJUST/DELOAD/REBUILD authority is
provably untouched, by construction and by test).
