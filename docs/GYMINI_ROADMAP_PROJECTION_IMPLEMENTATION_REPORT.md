# Gymini Roadmap Projection & Strategy Report Hardening — Implementation Report

Date: 2026-09-10
Scope: corrective + product-depth phase on top of the VERIFIED Gymini
Guided Roadmap Creation phase. No wizard redesign, no lifecycle
redesign, no new top-level pages. Fixes the three issues named in the
master task: (A) semantically-wrong K-group algorithm, (B) missing
per-phase quantitative projection, (C) TEF-as-remainder fabricated
energy-breakdown line. See
`docs/GYMINI_ROADMAP_PROJECTION_HARDENING_DESIGN.md` for the design gate
this implements.

## 1. New Backend Module — `fitness-roadmap-forecast.engine.ts`

`backend/services/fitness-service/src/services/fitness-roadmap-forecast.engine.ts`
(new file). Pure calculation, no I/O, no AI dependency. Deliberately
named "forecast" in code (not "projection") to avoid colliding with
`fitness-roadmap.service.ts`'s existing, unrelated `getRoadmapProjection()`
(reloads a roadmap's current DB state after a mutation) — confirmed via
grep before choosing the name, not assumed.

```text
deriveStrategyGroups(phases) -> StrategyGroup[]
  Context-aware K1/K2/K3 grouping (design doc §11). Classifies each
  phaseType as PRIMARY (FAT_LOSS/MINI_CUT -> CUT; LEAN_GAIN/
  RECOMPOSITION/PERFORMANCE -> BUILD) or BRIDGE (DIET_BREAK/MAINTENANCE/
  RECOVERY). A run of consecutive bridge phases is resolved as one unit
  by comparing the bucket before it to the bucket of the next primary
  phase after it — same campaign continues through it if they match,
  otherwise it becomes its own standalone "Chuyển tiếp / Duy trì" block.
  Live-verified (not just unit-tested): a real POST /fitness-roadmaps/
  projection call with FAT_LOSS -> DIET_BREAK -> FAT_LOSS phases returned
  strategyGroups=[{"key":"K1","bucket":"CUT","phaseIndexes":[1,2,3]}] —
  exactly one campaign, matching the master task's own worked example.

forecastPhaseSequence(context, phases) -> PhaseForecastResult[]
  Chains a phase-by-phase body-composition/BMR-TDEE/nutrition scenario
  forward (design doc §9/§10). Phase N's start state is always phase
  N-1's projected end state — never re-derived from the original
  starting point (live-verified: phase 2's projectedStartWeightKg ===
  phase 1's projectedEndWeightKg in the real curl output below).
  Every number either comes directly from computeInitialNutritionPrescription
  (the one authoritative nutrition engine — reused, never reimplemented)
  or a conservative, literature-referenced derivation of its own output:
    - Body-composition delta: derived from that phase's own real
      deficitOrSurplusKcal via a ~7700 kcal/kg tissue-energy-density
      approximation (a first-order simplification of the same
      hall-2011-dynamic-energy-balance source the deficit fraction
      itself already cites), clamped to the exact same safety ceiling
      assessTargetRealism() already uses (refactored into a shared
      exported MAX_SAFE_WEEKLY_RATE_PCT constant so the two can never
      drift apart).
    - Fat/lean partition: FAT_LOSS/MINI_CUT assumes 80% fat / 20% lean
      of the delta (garthe-2011 + issn-protein-2017, both already cited
      by the nutrition engine for this exact scenario); LEAN_GAIN
      assumes 50/50 (slater-2019, already cited for the surplus
      fraction) — neither ever implies "100% fat" or "100% muscle."
    - MAINTENANCE/DIET_BREAK/RECOVERY/RECOMPOSITION: net-neutral weight
      projection (the conservative default the master task explicitly
      asked for when no reliable directional model exists), with an
      explicit assumption note for RECOMPOSITION explaining why.
    - BMR/TDEE: start-of-phase uses a real measured BMR ONLY for the
      very first phase (today's actual state); every later phase always
      uses Mifflin-St Jeor, since a future body state was never
      measured — live-verified via a dedicated unit test.
```

## 2. New API — `POST /fitness-roadmaps/projection`

Read-only. Zero database write, zero AI call — same contract discipline
as `/diagnosis`. Kept as a **separate** route from `/diagnosis` per the
design doc's own reasoning (§13): diagnosis has no phase sequence yet
(Step 2), projection needs one (post-AI-draft, Step 4).

```text
models/fitness-roadmap.models.ts: + roadmapPhaseForecastInputSchema,
  RoadmapPhaseForecastInput (phases: Array<{phaseIndex, phaseType, name,
  plannedStartAt, plannedEndAt}>.passthrough() — accepts both the AI
  draft's pre-Save phase shape and a persisted RoadmapPhase[]'s shape)
services/fitness-roadmap.service.ts:
  + resolveEffectiveDiagnosisContext(userId, input) — extracted shared
    helper (refactored out of getDiagnosis, now used by both) so the two
    endpoints' profile/InBody-override resolution can never silently
    drift apart.
  + getPhaseForecast(userId, input) — calls deriveStrategyGroups +
    forecastPhaseSequence, returns { strategyGroups, phaseForecasts,
    dataCompleteness }.
controllers/fitness-roadmap.controller.ts: + projection handler
routes/fitness-roadmap.routes.ts: + POST /projection
```

Gateway: no change needed — the existing `/fitness-roadmaps` proxy
prefix already covers it.

Live-verified against the real dev stack (FAT_LOSS -> DIET_BREAK ->
FAT_LOSS, 82kg/178cm/29/MALE/22%bf/MODERATELY_ACTIVE):

```json
{"strategyGroups":[{"key":"K1","bucket":"CUT","phaseIndexes":[1,2,3]}],
 "phaseForecasts":[
   {"phaseIndex":1,"phaseType":"FAT_LOSS","durationWeeks":8,
    "projectedStartWeightKg":82,"projectedEndWeightKg":79.6,
    "projectedStartBodyFatPct":22,"projectedEndBodyFatPct":20.2,
    "estimatedStartTdee":2779,"estimatedEndTdee":2742,
    "projectedCalories":2446,"projectedDeficitOrSurplusKcal":-333,
    "assumptions":["Giả định khoảng 80% cân nặng giảm là mỡ, 20% là khối nạc — không phải toàn bộ là mỡ."]},
   {"phaseIndex":2,"phaseType":"DIET_BREAK","durationWeeks":2,
    "projectedStartWeightKg":79.6,"projectedEndWeightKg":79.6,
    "projectedDeficitOrSurplusKcal":0,
    "assumptions":["Giai đoạn này được giả định giữ cân nặng ổn định (ước tính thận trọng)."]},
   {"phaseIndex":3,"phaseType":"FAT_LOSS","durationWeeks":8,
    "projectedStartWeightKg":79.6,"projectedEndWeightKg":77.2,
    "estimatedStartTdee":2742,"estimatedEndTdee":2705}],
 "dataCompleteness":{"baseline":true,"bodyComposition":true}}
```

Confirms live: (1) the diet break stays inside ONE K1 campaign, not
three groups; (2) phase 2's start weight (79.6) exactly equals phase 1's
end weight, and phase 3's start (79.6) equals phase 2's end — continuous
chaining, not independent re-derivation; (3) TDEE evolves phase-to-phase
(2779 → 2742 → 2705) as projected weight drops; (4) the fat/lean
partition assumption is surfaced explicitly, never silently applied.

## 3. Energy-Breakdown Semantics Fix (Issue C)

`fitness-diagnosis.engine.ts`'s `computeEnergyBreakdown()`: a component
now only gets its own labeled row when the input that would justify it
(`trainingDaysPerWeek > 0` / `dailyGoalSteps > 0`) is actually present.
The fixed-15%-of-gap "TEF" line — previously a fabricated residual
bucket mislabeled as a specific physiological quantity — is **removed
entirely**. Everything not attributable to real steps/training evidence
now folds into one honestly-named `"Hoạt động & tiêu hao khác"` row.
Top-line BMR/TDEE numbers are unchanged — still 100%
`computeInitialNutritionPrescription`'s real output, still reconciled
exactly. Live-verified (same zero-steps/zero-training input the prior
phase's own verification report captured):

```text
Before: components = [steps:0, training:0, TEF:986, other:0]  (4 rows,
  one of them a fabricated fixed-percentage line)
After:  components = [{"label":"Hoạt động & tiêu hao khác","kcal":986}]
  (1 honest row, same real 986 kcal gap, no fake specificity)
```

## 4. Frontend — Collapsible Strategy Timeline

`GuidedRoadmapWizard.tsx`: removed the old local, phaseType-only
`phaseBucket()`/`groupPhasesIntoK()` (Issue A's own bug) — Step 4 now
calls the new `fitnessRoadmapService.getPhaseForecast()` right after the
AI draft resolves, and renders `strategyGroups`/`phaseForecasts` exactly
as the server computed them. Each K-group is a collapsible `<button>`
header (first/current group open by default, later groups collapsed —
design doc §15, avoids a permanently long mobile page) showing phase
count + total weeks; expanding it reveals one `PhaseForecastCard` per
phase (dates, duration, deficit/surplus badge, projected intake,
weight/body-fat/FFMI start→end, TDEE start→end, protein/carb/fat, the
phase's own assumption notes, and a permanent "Ước tính khi tạo lộ
trình — sẽ điều chỉnh theo dữ liệu thực tế" label). `PhaseForecastCard`
and `STRATEGY_BUCKET_LABEL` are exported so `RoadmapJourneyPage.tsx`'s
`DraftRoadmapDetail` can reuse the exact same rendering — never two
different renderings of the same data.

`buildAcceptPayload()` now also writes `configuration.roadmapProjectionSnapshot`
(additive sibling key next to the existing `configuration.diagnosisSnapshot`/
`aiDraft` — no schema change) at Save/Start time.

## 5. Draft-Reopen Fix (Issue in prior phase's own §3 audit)

`DraftRoadmapDetail` (`RoadmapJourneyPage.tsx`) now reads
`configuration.roadmapProjectionSnapshot` back and renders the same
collapsible strategy timeline a user saw at Step 4 — fixes the prior
phase's confirmed write-only-field gap (the snapshot was being written
but never read anywhere). Falls back to the old bare phase list only
for DRAFTs created before this snapshot existed (or PT-created ones
without it) — never breaks on missing data.

## 6. ACTIVE Journey — Projected vs Actual (Issue in master task §27)

`ActivePhaseDetail` now accepts an optional `projectionSnapshot` prop
and, when the active phase's real `NutritionGoal.calories` differs from
that phase's originally-projected `projectedCalories`, shows one small
secondary line under the real number: "Dự kiến ban đầu: ~X kcal/ngày ·
Điều chỉnh từ dự kiến ban đầu dựa trên dữ liệu thực tế." Never visually
equal-weighted with the real, active number — the real NutritionGoal
value stays the primary, larger text.

## 7. Adaptive Message — Verified Still Single, Not Regressed

The permanent "Lộ trình này không cố định..." paragraph stays exactly
where the prior phase's own E2E-caught-and-fixed bug left it: one
dedicated, always-visible element in the wizard's Step 4 report and
(new this phase) one in `DraftRoadmapDetail`'s reopen view — never
inside `reasoning` text, never duplicated on the same screen. Explicitly
re-verified live this phase (E2E `adaptiveMsgCount === 1` on both the
wizard screen and the reopened draft — see the E2E report).

## 8. Documentation Consistency Fix (master task §29)

`docs/GYMINI_GUIDED_ROADMAP_IMPLEMENTATION_REPORT.md` still described
(in its own §1 prose and a captured curl example) the pre-fix behavior
of both `buildDiagnosisReasoning` (claimed it "always includes" the
adaptive messaging — no longer true) and `computeEnergyBreakdown`
(showed a `"Tiêu hao tiêu hóa (TEF)"` row — no longer exists). Both
corrected in place with explicit "CORRECTION" callouts pointing at this
phase's design doc, rather than silently editing history.

## 9. Build/Regression Evidence

```text
fitness-service tsc --noEmit:                 EXIT 0
frontend vite build:                          EXIT 0 (no new chunk-size
  regressions; TrainingCyclePage/TrainingPage split unaffected)

fitness-roadmap.service.integration.test.ts:  47/47 PASS (was 44, +3 new
  getPhaseForecast tests — real Postgres, port 55433)
coach.service.integration.test.ts:             7/7  PASS (unchanged)
fitness-diagnosis.engine.test.ts:             14/14 PASS (was 12, +2 new
  energy-breakdown semantics tests)
fitness-roadmap-forecast.engine.test.ts (new):21/21 PASS
pure baseline (5 engine/util files):         128/128 PASS (unchanged)
                                             ─────────────
                                             217/217 PASS, 0 fail
```

ai-service was NOT touched this phase (confirmed via `git status` before
and after every edit) — its last-verified state from the prior phase
(22/22) stands, not re-run redundantly.

## 10. Files Changed (this phase)

```text
Backend — fitness-service:
  src/services/fitness-roadmap-forecast.engine.ts (NEW)
  src/__tests__/fitness-roadmap-forecast.engine.test.ts (NEW, 21 tests)
  src/services/fitness-diagnosis.engine.ts (energy-breakdown fix,
    exported MAX_SAFE_WEEKLY_RATE_PCT)
  src/__tests__/fitness-diagnosis.engine.test.ts (+2 tests)
  src/models/fitness-roadmap.models.ts (+ roadmapPhaseForecastInputSchema)
  src/services/fitness-roadmap.service.ts (+ resolveEffectiveDiagnosisContext
    refactor, + getPhaseForecast)
  src/controllers/fitness-roadmap.controller.ts (+ projection handler)
  src/routes/fitness-roadmap.routes.ts (+ POST /projection)
  src/__tests__/fitness-roadmap.service.integration.test.ts (+3 tests)

Backend — auth-service:
  prisma/seed.ts (+ roadmap.client4@example.test, fourth dedicated E2E account)

Frontend:
  src/app/pages/client/GuidedRoadmapWizard.tsx (K-grouping now server-
    derived; collapsible strategy timeline; PhaseForecastCard + 
    STRATEGY_BUCKET_LABEL exported; roadmapProjectionSnapshot persisted)
  src/app/pages/client/RoadmapJourneyPage.tsx (DraftRoadmapDetail reads
    the snapshot back; ActivePhaseDetail shows projected-vs-actual note)
  src/app/services/api.ts (+ RoadmapPhaseForecastInput/Result types,
    getPhaseForecast client function)

External E2E harness (c:\D_Backup\Test\fitnessassistant-playwright-e2e):
  fixtures/auth.ts (+ SEED_ACCOUNTS.roadmapClient4)
  tests/31-fitness-roadmap.spec.ts (+ TC-ROADMAP-007, 3 sub-cases)

Docs:
  docs/GYMINI_ROADMAP_PROJECTION_HARDENING_DESIGN.md (design gate)
  docs/GYMINI_ROADMAP_PROJECTION_IMPLEMENTATION_REPORT.md (this file)
  docs/GYMINI_ROADMAP_PROJECTION_E2E_REPORT.md (new)
  docs/GYMINI_ROADMAP_PROJECTION_VERIFICATION_REPORT.md (new)
  docs/GYMINI_GUIDED_ROADMAP_IMPLEMENTATION_REPORT.md (corrected, §8 above)
```

No migration added (`prisma migrate status` still shows the same
applied-migration count as every prior phase — re-confirmed, no drift).
No file belonging to the parallel Canonical Exercise Identity / AI
Workout Grounding / Equipment / MovementPattern / Substitution / Catalog
work was touched — confirmed via `git status` before this phase's first
edit and cross-referenced against the diff list above.
