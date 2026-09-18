# Gymini Adaptive Forecast Reconciliation, Confidence Ranges & Post-Cycle Reforecasting — Design

> **Correction note (2026-09-10, Adaptive Roadmap Production Closure
> phase, Gap E)**: §3's claim that `fetchLatestInBodyOnOrBefore` works
> by "filtering client-side over `fetchInBodyHistory()`" describes the
> mechanism as it existed at the time this doc was written, and is now
> **obsolete**. It was confirmed to download the user's full InBody
> history on every call (a genuine N+1/unbounded-fetch risk at scale)
> and was changed to call a new bounded, single-row, server-side
> endpoint (`GET /internal/inbody/:userId/latest?before=`, user-service).
> The `date <= cutoff` filtering *semantics* this doc describes are
> unchanged and still correct — only where the filtering happens moved.
> See `docs/GYMINI_ADAPTIVE_ROADMAP_PRODUCTION_CLOSURE_DESIGN.md` §5.

Date: 2026-09-10
Scope: `backend/services/fitness-service`, `frontend/web`. Corrective +
depth phase on top of the VERIFIED Guided Roadmap Creation and Roadmap
Projection Hardening phases. No wizard redesign, no navigation change,
no new decision engine. Written after auditing real source — see §1–§6.

## 1. Current Original-Forecast Model (audited)

`GuidedRoadmapWizard.tsx`'s `buildAcceptPayload()` writes
`configuration.roadmapProjectionSnapshot = forecastQuery.data` (the full
`{strategyGroups, phaseForecasts}` response) exactly once, at Save/Start
time. Grep-confirmed: **nothing in the codebase ever writes to this key
again** after that first write — no lifecycle method
(`advanceRoadmap`/`applyRoadmapRebuild`/`activatePhase`/...) touches
`FitnessRoadmap.configuration`. It is therefore **already immutable in
practice** — this phase's job is to formalize that as an explicit rule
(never add a write path to it) and start USING it as the historical
baseline, not to add new protection code.

## 2. Current Projection Assumptions (audited)

`fitness-roadmap-forecast.engine.ts`'s `forecastPhaseSequence()`
produces one **point estimate** per phase (`projectedEndWeightKg`,
`projectedEndBodyFatPct`, etc.) via a fixed fat/lean partition (80/20
loss, 50/50 gain) and a safety-ceiling-clamped linear weekly rate. These
constants are literature-referenced (garthe-2011/issn-protein-2017/
slater-2019, already cited elsewhere in the codebase) — not deleted,
still the correct MEDIAN/expected assumption. This phase adds a
LOW/HIGH band around that same expected value (§8), it does not replace
the underlying computation.

## 3. Available Actual Body-State Sources (audited)

```text
fetchLatestInBodyOnOrBefore(userId, cutoff: Date) — user.client.ts,
  already the exact "temporal correctness" primitive this phase needs
  (§16/§38): returns the latest real InBody entry with date <= cutoff,
  filtering client-side over fetchInBodyHistory(). Reused as-is, no new
  body-state ownership model introduced.
fetchUserProfile(userId) — currentWeight, as the fallback when no InBody
  exists at all (same fallback order getDiagnosis/getPhaseForecast
  already use).
```

## 4. Available CycleAssessment Metrics (audited)

`CycleAssessment.computedMetrics` (full `CycleMetricsResult`, JSON) —
already includes `adherenceRate`, `strengthProgressScore`,
`bodyWeightTrend`, `dataCompletenessScore`. `CycleAssessment.
dataQualityScore` (0-1, from `cycle-metrics.engine.ts`'s
`computeDataCompletenessScore` × `inbody-quality.evaluator.ts`'s
`confidenceMultiplier`) is the product's own existing, already-computed
"how good is our data" signal for a completed cycle — reused directly
for forecast confidence (§9), never re-derived.

## 5. Available Nutrition-Adherence / Training-Performance Metrics (audited)

Both already live inside the same `computedMetrics` object §4 names —
`adherenceRate` (workout-schedule completion) and
`strengthProgressScore` (e1RM trend). No separate nutrition-adherence
metric exists at the roadmap level today (nutrition adherence is
tracked per-meal via `NutritionMealCompletion`, a much finer grain than
this phase needs) — reconciliation uses the two cycle-level signals
that already exist, does not add a new nutrition-adherence aggregate.

## 6. Original-vs-Current Forecast Ownership

```text
Original Forecast   = FitnessRoadmap.configuration.roadmapProjectionSnapshot
                       Immutable. Written once, at Save/Start. Never
                       overwritten by this phase or any future one.
Current Forecast     = NEVER PERSISTED. Computed fresh, on every read,
                       from (a) the roadmap's own un-completed
                       RoadmapPhase[] (ACTIVE + PLANNED — unchanged by
                       this phase; REBUILD already replaces this array
                       correctly, so a rebuilt remainder is picked up
                       automatically with zero special-casing) and
                       (b) the LATEST real actual body state as of now.
                       Reuses forecastPhaseSequence() UNCHANGED — this
                       phase does not touch that function's signature,
                       only calls it with a different starting context.
Reconciliation       = computed fresh, on every read, comparing each
                       COMPLETED phase's ORIGINAL forecast entry against
                       the real actual state at/before that phase's own
                       actualEndAt (temporal correctness, §16). Persisted
                       as an audit trail only (§12 below), never as the
                       read path's source of truth.
```

Chosen persistence strategy: **Option A** (compute-on-demand) for both
Current Forecast and Reconciliation reads — the master task's own
preferred option. This sidesteps needing to hook into every lifecycle
transition (`advanceRoadmap`/`applyRoadmapRebuild`/deload/adjust) to
"trigger" a reforecast: because Current Forecast is always freshly
derived from whatever the roadmap's phase list and the user's latest
real data currently are, a REBUILD's new remaining phases, an advanced
phase's newly-ACTIVE status, or a fresh InBody entry are all picked up
automatically on the very next read — zero new lifecycle wiring, zero
risk of a stale cached forecast.

## 7. Uncertainty / Range Design

`PhaseForecastResult`'s existing point fields
(`projectedEndWeightKg`/`projectedEndBodyFatPct`) are **not renamed or
removed** — 21 existing unit tests and the persisted
`roadmapProjectionSnapshot` shape depend on them, and they remain the
correct EXPECTED value. A new, additive `ForecastRange` shape wraps a
subset of fields:

```ts
interface ForecastRange {
  low: number;
  expected: number;
  high: number;
}
```

`low <= expected <= high` always (enforced by construction, not just
asserted). Range width is **explicitly a categorical band tied to
confidence tier**, not a statistical confidence interval — documented as
such everywhere it appears (API doc comment + a UI disclaimer), per the
master task's own explicit instruction to prefer "categorical
disclaimer... rather than fake mathematics" when no defensible
statistical horizon model exists (none does, confirmed by grep — no
day-to-day body-weight-variance constant exists anywhere in this
codebase):

```text
HIGH confidence   -> ±2% of the phase's own projected delta magnitude
MEDIUM confidence -> ±4%
LOW confidence    -> ±8%
(floored at ±0.2kg for weight so a near-zero-delta MAINTENANCE phase
 still shows a small, honest band instead of a meaningless 0.00kg width)
```

Missing body-fat baseline -> the whole body-composition range (weight
range is still shown; body-fat/FFMI stay `null`) — same "never
fabricate" rule the existing engine already follows for point values.

## 8. Confidence — Deterministic, Reused Inputs Only

**Does not invent new inputs.** Reuses exactly:

```text
bodyFatMethod          (already resolved by resolveEffectiveDiagnosisContext)
InBody measurement age  (fetchLatestInBodyOnOrBefore's own .date field)
completedCycleCount     (already computed by generateAiRoadmapDraft's own
                         prisma.trainingCycle.count query — same pattern reused)
CycleAssessment.dataQualityScore (already computed by
                         cycle-metrics.engine.ts, reused directly for
                         post-cycle reconciliation confidence — never
                         re-derived)
```

Deterministic scoring (0-1 scale, same scale `dataQualityScore` already
uses, for consistency):

```text
bodyFatSourceScore:
  inbody, <=90 days old   -> 1.0   (RECENT_INBODY_MEASUREMENT)
  inbody, >90 days old    -> 0.6   (STALE_INBODY_MEASUREMENT)
  manual                  -> 0.4   (MANUAL_BODY_FAT_ESTIMATE)
  visual_reference         -> 0.25 (VISUAL_REFERENCE_BODY_FAT_ESTIMATE)
  none                     -> 0.1  (NO_BODY_FAT_DATA)

cycleHistoryAdjustment:
  0 completed cycles       -> -0.2 (NO_COMPLETED_CYCLES_YET)
  1 completed cycle        -> -0.1 (LIMITED_CYCLE_HISTORY)
  2+ completed cycles      ->  0.0 (SUFFICIENT_CYCLE_HISTORY)

score = clamp01(bodyFatSourceScore + cycleHistoryAdjustment)
  — blended with the latest CycleAssessment.dataQualityScore (simple
  average) when one is available (post-cycle reconciliation context),
  since that score already independently captures workout-logging/
  InBody/feedback completeness for that specific cycle.

tier: score >= 0.7 -> HIGH; score >= 0.4 -> MEDIUM; else LOW
```

Every reasonCode above is surfaced to the caller — the UI can render
"✓ recent InBody measurement / △ only one completed TrainingCycle"
exactly as the master task's own example shows, without inventing new
copy per call site.

## 9. Body-Fat Source Distinction (§10 of the master task)

Preserved and reused unchanged: `resolveEffectiveDiagnosisContext`'s
existing "InBody measurement always outranks manual/visual estimate"
priority (prior phase, unchanged). This phase only ADDS the recency
check on top (a same-day InBody entry scores differently from a
190-day-old one, even though both are "inbody" method) — new, additive,
never weakens the existing priority order.

## 10. Reconciliation Algorithm

New pure module, `fitness-roadmap-reconciliation.engine.ts` (deliberately
separate from the forecast engine — different responsibility, same
"pure, no I/O, no AI" discipline):

```text
reconcilePhase(original: PhaseForecastResult, actual: {
  weightKg: number | null;
  bodyFatPct: number | null;
  measuredAt: string | null;
  adherenceRate: number | null;
  strengthProgressScore: number | null;
}): PhaseReconciliationResult

  weight: { expected: original.projectedEndWeightKg, actual, delta } | null
  bodyFat: same shape, null if either side missing
  adherence, performance: passed through for display (already-real cycle
    metrics, never re-derived)
  status: ON_TRACK | AHEAD_OF_FORECAST | BEHIND_FORECAST | INSUFFICIENT_DATA
  reasonCodes: string[]
```

Status classification (§12/§25 — never a scale-weight-only verdict):

```text
No actual weight measurement available          -> INSUFFICIENT_DATA
Otherwise, weightProgressRatio =
  actualDeltaKg / expectedDeltaKg  (both signed the same direction for a
  real phaseType; a maintenance phase's near-zero expected delta is
  handled as its own case — "stable, as expected" is ON_TRACK by
  definition, never divided by ~0)
  ratio >= 1.15                                  -> AHEAD_OF_FORECAST
  0.85 <= ratio < 1.15                           -> ON_TRACK
  ratio < 0.85:
    adherenceRate != null && adherenceRate >= 0.85  -> ON_TRACK
      (reasonCode: WEIGHT_BEHIND_BUT_ADHERENCE_STRONG)
    strengthProgressScore != null && strengthProgressScore >= 0.5
                                                      -> ON_TRACK
      (reasonCode: WEIGHT_BEHIND_BUT_PERFORMANCE_STRONG)
    otherwise                                        -> BEHIND_FORECAST
```

This directly implements the master task's own worked example (§12):
weight slower than forecast + adherence 92% + strength +4.1% must never
auto-classify as failure — the adherence/strength escape hatches above
guarantee that.

**Reconciliation never touches `CycleAssessment.decision`** — it is a
pure comparison function with no knowledge of `KEEP`/`PROGRESS`/
`ADJUST`/`DELOAD`/`REBUILD`, and no write path to `CycleAssessment` at
all (confirmed by construction: the module takes plain data in, returns
plain data out, never receives a Prisma client).

## 11. Post-Cycle Reforecast Trigger

**No explicit "trigger" is implemented.** Per §6's Option-A decision,
Current Forecast is always freshly computed on read. The moment a phase
completes (`advanceRoadmap`'s existing `COMPLETE_AND_ACTIVATE_NEXT_PHASE`
branch, unchanged) and/or a new InBody entry exists, the very next call
to the new read endpoint (§14) reflects it automatically — reforecast
"happens" continuously, not as a discrete event needing new wiring.

## 12. REBUILD Interaction

`applyRoadmapRebuild` (unchanged, not touched by this phase) already
replaces the roadmap's remaining `PLANNED` phases with a new sequence
while leaving completed phases' history intact. Current Forecast's
"remaining phases" query (`status IN (ACTIVE, PLANNED)`) picks up
whatever phase list currently exists — a rebuilt remainder is forecast
correctly with zero special-casing, exactly matching §19's requirement
("new remaining phase sequence receives a new current forecast... do
not mutate completed phases"). Original Forecast is unaffected (§4's
immutability already covers this).

## 13. Persistence / Audit Decision

**No new Prisma model.** Reconciliation results ARE persisted, but only
as an audit trail, into the **existing** `RecommendationAudit` table
(already generic across `engineVersion`s — "legacy-v2"/"adaptive-v1"/
"nutrition-adaptive-v1", zero schema change needed to add a fourth) at
the exact moment a `CycleAssessment` completes and a phase-boundary
reconciliation becomes computable (i.e. inside `advanceRoadmap`'s
existing transaction, right where it already writes ONE
`RecommendationAudit` row for the transition decision — this phase adds
a SECOND, distinct row with `engineVersion: "forecast-reconciliation-v1"`,
never mixed into the transition-decision row):

```text
RecommendationAudit.decision        = reconciliation.status (ON_TRACK/...)
RecommendationAudit.reasonCodes     = reconciliation.reasonCodes
RecommendationAudit.metricsSnapshot = the full PhaseReconciliationResult
  (expected/actual/delta/adherence/performance) — a debuggable,
  replayable snapshot, same convention every other engineVersion row
  already follows
RecommendationAudit.assessmentId    = the completed cycle's assessment id
```

Current Forecast itself is **never persisted** (§6) — read fresh every
time, so there is nothing to keep in sync, nothing to invalidate, and no
risk of the audit snapshot going stale relative to live data.

## 14. UI Information Architecture

```text
DRAFT roadmap (§30 of the master task):
  DraftRoadmapDetail — UNCHANGED from the Projection Hardening phase.
  Original forecast only. No reconciliation section, no "on track" label
  (there is no execution yet to be on/off track against).

ACTIVE roadmap (§31):
  RoadmapJourneyPage's ActivePhaseDetail gains a new, compact "Chu kỳ
  vừa qua" comparison card (only when at least one phase has completed
  AND a reconciliation is available) — dự kiến/thực tế/chênh lệch +
  adherence + strength + a one-line Gymini assessment sentence (mapped
  from the reasonCode, never raw AI text).
  Below it, an "Dự báo đã cập nhật" section (only when the roadmap has
  remaining phases) shows the Current Forecast's near-term range +
  confidence tier + a one-line reason-for-change sentence.
  The ORIGINAL forecast becomes a secondary, collapsed
  "Xem dự kiến ban đầu" disclosure — never shown expanded by default
  once real data exists, matching §31's explicit hierarchy instruction.

COMPLETED roadmap (§32):
  A final summary card: starting state, original projected end, actual
  final state, phases/cycles completed, rebuild count (from a simple
  count of "how many times applyRoadmapRebuild succeeded for this
  roadmap" — reusing the SAME query pattern generateAiRoadmapDraft's own
  completedCycleCount already uses, not a new counter column).
  Original forecast stays permanently accessible (never deleted).
```

## 15. API Design

Audited `POST /fitness-roadmaps/projection` (Roadmap Projection
Hardening phase) — **not replaced**. It stays exactly what it is: a
zero-context, caller-supplied-phases-and-state read, used by the wizard
BEFORE a roadmap exists. It has no concept of "this roadmap's actual
history," so extending it with a `mode` parameter would be a poor fit
(it doesn't even take a `roadmapId`).

**New, minimal-surface addition**: `GET /fitness-roadmaps/current/forecast`
— read-only, authenticated, resolves the caller's own ACTIVE roadmap
(reuses the exact ownership scoping `getCurrentRoadmap` already applies
— `userId` + `status: "ACTIVE"` + `archivedAt: null`), returns:

```text
{
  originalForecast: RoadmapPhaseForecastResult | null,  // from
    configuration.roadmapProjectionSnapshot, verbatim, immutable
  currentForecast: {
    strategyGroups, phaseForecasts (with ForecastRange fields added),
    confidence: { tier, score, reasonCodes }
  } | null,  // null only if the roadmap has zero remaining phases
    (fully COMPLETED) or insufficient baseline data — never fabricated
  reconciliations: PhaseReconciliationResult[]  // one per COMPLETED phase
    that has a matching original forecast entry
}
```

404 when the caller has no ACTIVE roadmap (matches `getCurrentRoadmap`'s
existing contract exactly — same error shape, same status code). No PT
read access added this phase (§34 — PT roadmap read already exists via
`GET /coach/clients/:clientId/roadmap`, unchanged, untouched; adding
forecast data there is explicitly out of this phase's scope per the
master task's own "do not expand PT permissions... unless naturally
needs to display" — it does not naturally need to for this phase's
Definition of Done).

## 16. Test Strategy

```text
Unit (fitness-roadmap-reconciliation.engine.test.ts, new):
  reconcilePhase — delta arithmetic, INSUFFICIENT_DATA when actual
  missing, the adherence/strength "not automatic failure" escape hatch,
  AHEAD/ON_TRACK/BEHIND boundaries, maintenance-phase (near-zero
  expected delta) special-cased correctly.
Unit (fitness-roadmap-forecast.engine.test.ts, extended):
  ForecastRange low<=expected<=high always; missing body-fat -> range
  null; confidence tier mapping — recent InBody > stale InBody > manual
  > visual > none; 0/1/2+ completed cycles; rounding stability.
Integration (fitness-roadmap.service.integration.test.ts, extended):
  GET-equivalent getCurrentForecast — original snapshot returned
  unchanged; current forecast's phase 2 start == actual state after
  phase 1 (not the stale original phase-1-end value); zero
  NutritionGoal/WorkoutProgram writes; REBUILD's new remainder picked
  up automatically; temporal correctness (an InBody entry dated AFTER a
  phase's actualEndAt must never be used to reconcile that phase).
Frontend build only (no unit-test runner in this repo, unchanged
  convention).
E2E: extend tests/31-fitness-roadmap.spec.ts using legitimate existing
  service/API calls (never raw DB corruption) to advance a roadmap
  through one real completed cycle+assessment, then verify the Journey
  page's "Chu kỳ vừa qua" + "Dự báo đã cập nhật" sections render real
  data, original forecast is still reachable, and mobile/no-overflow at
  the standard 4 widths.
```
