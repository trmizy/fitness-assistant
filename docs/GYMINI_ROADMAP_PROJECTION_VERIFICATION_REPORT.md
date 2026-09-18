# Gymini Roadmap Projection & Strategy Report Hardening — Final Verification Report

Date: 2026-09-10
Status: **VERIFIED** — every Definition-of-Done item the master task
names for this corrective/depth phase is implemented and evidence-
backed. The one carried-over gap (PT positive human-payment path) is
outside this phase's required scope, unchanged from every prior phase.

## 1. Definition-of-Done Checklist

```text
FAT_LOSS→DIET_BREAK→FAT_LOSS renders as ONE K campaign     VERIFIED — real
  unit test + a direct live curl to POST /fitness-roadmaps/projection,
  both showing strategyGroups=[{key:"K1",bucket:"CUT",phaseIndexes:[1,2,3]}]
K-grouping is context-aware, not phaseType-bucket-only      VERIFIED —
  deriveStrategyGroups() resolves bridge phases (DIET_BREAK/MAINTENANCE/
  RECOVERY) by comparing the campaign before and after the bridge run,
  9 real unit tests covering every scenario the master task names
No RoadmapBlock table added                                  VERIFIED —
  pure function over an already-in-hand phases[] array; prisma
  migrations count unchanged (53, re-confirmed)
Each phase has a projection object                            VERIFIED —
  forecastPhaseSequence() returns one PhaseForecastResult per phase,
  wired into the wizard's Step 4 report and DraftRoadmapDetail's reopen
Projected current/end body state chains correctly              VERIFIED —
  unit test + live curl: phase 2's projectedStartWeightKg exactly equals
  phase 1's projectedEndWeightKg
BMR/TDEE can evolve phase-to-phase when supported               VERIFIED —
  live curl shows TDEE 2779 -> 2742 -> 2705 across 3 chained phases;
  unit test confirms only phase 0 may use a measured BMR
Projected nutrition uses the existing nutrition engine/rules     VERIFIED —
  every calorie/macro number in forecastPhaseSequence comes directly
  from computeInitialNutritionPrescription, never reimplemented
Projections never become RoadmapPhase source-of-truth             VERIFIED —
  every field prefixed projected*/estimated*; stored only inside
  configuration.roadmapProjectionSnapshot (additive JSON, no schema
  change), never read back as authoritative by any backend service
Estimates are visually labelled as estimates                       VERIFIED —
  every PhaseForecastCard carries "Ước tính khi tạo lộ trình — sẽ điều
  chỉnh theo dữ liệu thực tế" plus phase-specific assumption text
TDEE display no longer uses misleading TEF-as-remainder            VERIFIED —
  computeEnergyBreakdown() no longer fabricates a fixed-15%-of-gap TEF
  line; live-verified real output now shows one honest "Hoạt động &
  tiêu hao khác" row for the same zero-steps/zero-training input that
  previously produced a fake TEF=986 line
Step 4 shows detailed collapsible strategy blocks                   VERIFIED —
  E2E TC-ROADMAP-007a: K-group headers render, expand/collapse
  confirmed working live, real forecast card fields visible
DRAFT reopen preserves a meaningful report                           VERIFIED —
  E2E TC-ROADMAP-007b: reopened DRAFT still shows the strategy timeline
  + real forecast cards, not a bare phase list (fixes the prior phase's
  confirmed write-only-snapshot gap)
ACTIVE Journey prioritizes actual data over old projections           VERIFIED —
  ActivePhaseDetail's real NutritionGoal number stays primary; the
  projected number (when it differs) appears only as a small secondary
  note, never equal-weighted
Adaptive message appears once                                          VERIFIED —
  E2E-asserted count===1 on both the wizard Step 4 screen and the
  reopened DraftRoadmapDetail screen (TC-ROADMAP-007a/007b)
Docs match final implementation                                        VERIFIED —
  docs/GYMINI_GUIDED_ROADMAP_IMPLEMENTATION_REPORT.md's stale
  buildDiagnosisReasoning/TEF claims corrected in place with explicit
  CORRECTION callouts (master task §29)
Mobile passes                                                           VERIFIED —
  0px overflow at 360/390 with the K-group report actually expanded;
  existing TC-ROADMAP-002 (4 viewports) still PASS, unaffected
Real browser E2E passes                                                 VERIFIED —
  7/7 tests PASS, real dev stack, real Ollama call, real Postgres DB
  evidence (see the companion E2E report)
Backend regression passes                                               VERIFIED —
  217/217 (fitness-service); ai-service untouched, its prior 22/22 stands
No parallel Exercise/AI Workout files overwritten                       VERIFIED —
  git status checked before this phase's first edit and again before
  this report; zero overlap with the parallel agent's known file paths
```

## 2. Backend Regression (real Postgres, port 55433,
`gymcoach_fitness_test`)

```text
fitness-roadmap.service.integration.test.ts:  47/47 PASS (44 carried + 3 new)
coach.service.integration.test.ts:             7/7  PASS (unchanged)
fitness-diagnosis.engine.test.ts:             14/14 PASS (12 carried + 2 new)
fitness-roadmap-forecast.engine.test.ts (new):21/21 PASS
pure baseline (5 engine/util files):         128/128 PASS (unchanged)
                                             ─────────────
                                             217/217 PASS, 0 fail, 0 skipped

fitness-service build (tsc --noEmit):         EXIT 0
frontend build (vite build):                  EXIT 0
```

No previously-passing test was weakened, skipped, or deleted — every
count above is a net increase over the prior phase's own verified
baseline (217 vs the prior phase's 191, +26 net new tests, all real).

## 3. Browser E2E (real dev stack — see
`docs/GYMINI_ROADMAP_PROJECTION_E2E_REPORT.md` for full detail)

```text
TC-ROADMAP-001   persistence path (roadmapClient3, already ACTIVE)    PASS
TC-ROADMAP-001x  TrainingCycle drill-down + nav simplification         PASS
TC-ROADMAP-006   Expert mode minimal check                              PASS
TC-ROADMAP-007   NEW — K-groups, forecast cards, reopen, mobile          PASS
TC-ROADMAP-002   mobile (4 viewports)                                    PASS
TC-ROADMAP-003   theme (dark/light)                                       PASS
TC-ROADMAP-004   PT negative-path 403                                      PASS
                                                                     7/7 PASS
```

## 4. Live API Evidence (beyond unit tests — see implementation report
§2/§3 for full payloads)

```text
POST /fitness-roadmaps/projection with FAT_LOSS->DIET_BREAK->FAT_LOSS:
  real server response groups all 3 phases into ONE K1 CUT campaign;
  phase-to-phase weight/TDEE chaining confirmed exact in the real numbers.
POST /fitness-roadmaps/diagnosis (zero steps/training, same account/
  inputs as the prior phase's own captured example): energyBreakdown
  now returns exactly one "Hoạt động & tiêu hao khác" component instead
  of the previous 4-row split including a fabricated TEF line.
```

## 5. Data-Ownership Re-Confirmation

```text
Every new field is projected*/estimated* — grep-confirmed no bare
  weight/calories/tdee field name exists anywhere in
  fitness-roadmap-forecast.engine.ts's return types.
roadmapProjectionSnapshot is written only at Save/Start time
  (GuidedRoadmapWizard.tsx's buildAcceptPayload) and read only for
  display (DraftRoadmapDetail, ActivePhaseDetail) — never read by any
  backend service, never treated as authoritative.
getPhaseForecast is userId-scoped (via resolveEffectiveDiagnosisContext,
  the same shared helper getDiagnosis already used and was security-
  reviewed for in the prior phase) and zero-write — confirmed by code
  review (no prisma.*.create/update/delete calls anywhere in the new
  engine or service method) and by a real integration test asserting
  zero FitnessRoadmap/RoadmapPhase/TrainingCycle rows are created by a
  getPhaseForecast call.
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
Forcing a live browser AI draft to produce the exact multi-phase
  FAT_LOSS/DIET_BREAK/FAT_LOSS sequence — cannot be forced (non-
  deterministic AI output); the grouping algorithm itself is instead
  proven by 9 real unit tests plus one direct API curl call bypassing
  the AI draft — documented as a deliberate, honest testing-strategy
  choice, not a gap glossed over.
```

## 8. Final Verdict

```text
Gymini Roadmap Projection & Strategy Report Hardening = VERIFIED
```

Every corrective issue the master task named (Issue A: semantically-
wrong K-grouping; Issue B: missing per-phase quantitative projection;
Issue C: TEF-as-remainder fabrication) is fixed, reused-not-reinvented
(the one authoritative nutrition engine, never duplicated), and
live-verified against the real dev stack with real database and API
evidence — not code-reviewed-only, not simulated. Every prior phase's
verified behavior (guided wizard, Save/Start DB semantics, navigation
simplification, expert mode, PT negative path) was re-run this phase
and remains green, unweakened.
