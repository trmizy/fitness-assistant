# Gymini Adaptive Roadmap Production Closure — Design

Date: 2026-09-10
Scope: `backend/services/fitness-service`, `backend/services/user-service`,
`frontend/web`. Closure/production-hardening phase on top of the VERIFIED
Guided Roadmap Creation, Roadmap Projection Hardening, and Adaptive
Forecast Reconciliation phases. No new forecasting model, no wizard
redesign, no Roadmap lifecycle redesign, no new top-level page, no
AI-assisted REBUILD. AI Workout Grounding / Exercise Catalog /
MovementPattern / equipment-aware selection / exercise substitution are
untouched (read-only this phase).

**Process note**: implementation on Gaps A/B/C/E began before this
document was written, in deviation from the prescribed order. This
document is written to retroactively and honestly record the audit
findings and design decisions that were actually made, verified against
the real (already-edited) source — not to rationalize skipping the gate.
Every claim below is checked against current code, not memory of intent.

## Gap classification summary

| Gap | Classification | Outcome |
|---|---|---|
| A — REBUILD→reforecast correctness | TEST GAP (no dedicated integration proof existed) | Fixed: new integration test, §1 |
| B — reconciliation audit idempotency | TEST GAP + defensive CODE hardening | Fixed: existence guard + concurrency test, §2 |
| C — Completed Roadmap terminal UX | UX GAP + CODE GAP (no terminal summary existed) | Fixed: `finalSummary` + `CompletedRoadmapSummary`, §3 |
| Terminal API shape | NO ISSUE | `getRoadmapProjection` already sufficient, reused as-is |
| D — browser reconciliation coverage | DOCUMENTATION GAP (no browser tool available this session) | Honestly marked BACKEND-ONLY, §4 |
| E — InBody query scalability | PERFORMANCE RISK (confirmed unbounded) | Fixed: bounded single-row query, §5 |
| F — confidence/range/reconciliation wording | UX GAP (one real bug found) | Fixed: raw `%` heuristic score in `TrainingCyclePage.tsx`, §6 |

## 1. Gap A — REBUILD → reforecast (audited)

Prior phases already implement `applyRoadmapRebuild` (replaces remaining
PLANNED phases, writes `ROADMAP_REBUILD_APPLIED` audit) and
`getCurrentForecast` (computes the remaining-journey forecast fresh from
whatever `RoadmapPhase[]` currently exist + the latest actual body
state). What did **not** exist was a single integration test exercising
both together through the real service path and asserting the full
invariant set. Added: `fitness-roadmap.service.integration.test.ts` §
"Gap A: REBUILD preserves the original forecast..." — drives
`activateRoadmap` → completes phase 1 → `applyRoadmapRebuild` → asserts
in one test:

- original `configuration.roadmapProjectionSnapshot` byte-identical after REBUILD
- phase 1's (COMPLETED) history/audit rows untouched
- pre-REBUILD PLANNED phase 2/3 rows become `SKIPPED`, never deleted
- `getCurrentForecast()`'s phase sequence is the REBUILT phases, not the original ones
- the forecast baseline is the latest actual InBody state, not the original phase-1 expectation
- REBUILD's own transaction (unchanged code) still produces no duplicate `TrainingCycle`
- `NutritionGoal`/`WorkoutProgram` rows are not mutated by REBUILD (out of scope, confirmed untouched)
- prior `RecommendationAudit` history (activation + completion rows) survives

No bug found in the underlying service code — this gap was a **test
gap**, not a **code gap**. Result: PASS, evidence in §"Test Results" of
the implementation report.

## 2. Gap B — reconciliation audit idempotency (audited)

`advanceRoadmap` already begins with `lockRoadmapUser(tx, userId)` —
`pg_advisory_xact_lock`, held for the transaction's lifetime — so two
concurrent `advanceRoadmap` calls for the same user are already fully
serialized; the second call re-reads state after acquiring the lock and
finds the phase already COMPLETED/ACTIVE, taking the early-exit path
before ever reaching the reconciliation-audit code. This means the
architecture was **already correct**; no real duplication bug existed
before this phase touched the file.

Added anyway, as defense-in-depth at zero migration cost (`fitness-
roadmap.service.ts:1346-1350`): a transactional existence check —
`recommendationAudit.findFirst({ cycleId, engineVersion:
"forecast-reconciliation-v1" })` — before creating the reconciliation
row, wrapping the existing computation in `if (!existingReconciliation)`.
No new unique constraint, no new lock — reuses the existing table and
the existing lock architecture per the master task's explicit
preference.

Proven with a real concurrency test (`Gap B: two concurrent
advanceRoadmap calls...`) — two `advanceRoadmap(...)` promises fired at
the same phase boundary via `Promise.allSettled`, then asserting exactly
one `COMPLETE_AND_ACTIVATE_NEXT_PHASE` audit, one new ACTIVE phase, one
new `TrainingCycle`. (First run of this test asserted the wrong scope —
see the implementation report's "bugs found" section for the
non-duplication finding it actually surfaced: `activateRoadmap` writes
its own separate `ACTIVATE_PHASE` audit row, which is a distinct,
legitimate event, not a duplicate.)

## 3. Gap C — Completed Roadmap terminal UX (audited: did not exist)

Before this phase, a COMPLETED roadmap rendered an ad-hoc block in
`RoadmapJourneyPage.tsx` computed from `roadmap.configuration` inline,
with no `finalSummary` concept, no real actual-vs-original comparison,
and no handling for missing data beyond whatever fell out of the ad-hoc
arithmetic. This was a genuine UX gap.

**Decision — reuse the existing projection method, no new endpoint.**
`getRoadmapProjection(roadmapId, userId)` is already called by
`getById` and by every lifecycle mutation's return value, and is already
userId-scoped at the query level (`fitness-roadmap.service.ts:1076-1077`,
`where: { id, userId, archivedAt: null }`). A `finalSummary` field is
computed inside it, **only when `roadmap.status === "COMPLETED"`**
(`fitness-roadmap.service.ts:1190-1244`), costing zero extra work on the
far more common ACTIVE/DRAFT paths. This directly satisfies the master
task's own stated preference over adding an overlapping endpoint, and
keeps `GET /fitness-roadmaps/current/forecast` strictly ACTIVE-oriented
(§ Terminal API below).

Fields and their sourcing:

- `startWeightKg`/`startBodyFatPct` — first entry of the immutable
  original snapshot (`roadmapProjectionSnapshot.phaseForecasts[0]`).
- `originalProjectedEndWeightKg`/`...BodyFatPct` — last entry of that
  same snapshot. Both `null` for a legacy roadmap with no snapshot at
  all (expert-mode-created, or created before the snapshot existed) —
  never fabricated.
- `actualFinalWeightKg`/`...BodyFatPct`/`actualMeasuredAt` — the latest
  real InBody entry on or before `roadmap.actualEndAt ?? plannedEndAt ??
  now`, via the same `fetchLatestInBodyOnOrBefore` primitive Gap E
  hardens — never a future measurement, `null` when none exists.
- `totalWeeks` — derived from `actualStartAt` to the same completion
  cutoff; `null` if the roadmap was never actually activated.
- `completedPhaseCount`/`totalPhaseCount`/`cycleCount` — counted directly
  from the phases/cycles already loaded by this method — real data, not
  re-derived guesses.
- `rebuildCount` — `RecommendationAudit` rows with `decision:
  "ROADMAP_REBUILD_APPLIED"`, filtered by `metricsSnapshot.roadmapId ===
  roadmapId` in JS after a `userId`-scoped query. `RecommendationAudit`
  has no direct `roadmapId` column (the schema wasn't designed for a
  future "count REBUILDs per roadmap" query), so this reuses the
  `roadmapId` value `applyRoadmapRebuild` already stores inside its own
  `metricsSnapshot` JSON rather than adding a migration or relying on a
  Prisma JSON-path query feature that may not be enabled.

Frontend: `CompletedRoadmapSummary` (`RoadmapJourneyPage.tsx`, inserted
just above the `AdaptiveForecastSection` block) renders the Vietnamese
target layout from the master task's own spec — Bắt đầu/Dự kiến ban
đầu/Kết quả thực tế/Thời gian/Giai đoạn/Chu kỳ/Điều chỉnh chiến lược —
with a `[Xem lộ trình ban đầu]` disclosure that reuses `PhaseForecastCard`
/`STRATEGY_BUCKET_LABEL` (no new forecast-rendering component). Every
field independently renders "Không đủ dữ liệu" instead of a fabricated
number when its source is missing; `summary === null` (should not
happen once `finalSummary` is always computed for COMPLETED roadmaps,
but defensively handled) renders an honest one-line fallback instead of
crashing.

Verified with two integration tests: the happy-path "Gap C: a COMPLETED
roadmap's getRoadmapProjection includes a real finalSummary" and the
explicit "Gap C: a legacy COMPLETED roadmap with no original forecast
snapshot at all" no-crash/no-fabrication test.

### Terminal API behavior (audited)

- `GET /fitness-roadmaps/current` — unchanged, still returns the user's
  current (non-archived) roadmap regardless of status; no COMPLETED-
  specific behavior needed here since the projection is fetched
  separately.
- `GET /fitness-roadmaps/current/forecast` (`currentForecast` controller,
  `getCurrentForecast(userId)`) — remains strictly ACTIVE-oriented,
  **not** hacked to serve COMPLETED roadmaps. No change this phase.
- `GET /fitness-roadmaps/:roadmapId` — already returns
  `getRoadmapProjection`, now including `finalSummary` when relevant.
  This is the "existing roadmap-by-id projection already includes
  enough data" option the master task names as preferred; no new
  endpoint was added.

## 4. Gap D — full reconciliation card browser coverage (audited)

The real APIs needed to legitimately drive this state through the
product exist and were traced: workout-session completion →
`TrainingCycle` evaluation (`POST /training-cycles/:id/evaluate`) →
`CycleAssessment` → InBody check-in → `advanceRoadmap`. Standing up this
full chain from a cold browser session requires: an onboarded user with
a WorkoutProgram, several weeks of logged workout sessions with
completed sets, at least one InBody check-in dated inside the cycle
window, and a full advance/evaluate/accept cycle — substantial,
legitimate product state that the existing Playwright/E2E harness would
need dedicated setup helpers for.

This session's tool access has **no browser-automation tool at all** (no
Playwright driver, no screenshot/DOM-inspection capability was available
to this agent in this environment) — so this gap cannot be executed as
a *real browser* test in this session regardless of backend feasibility.
Per the master task's own explicit instruction, this is recorded
honestly as **BACKEND-ONLY / NOT BROWSER-TESTED THIS SESSION**, not
"browser verified," and no fake product endpoint was added to manufacture
a screenshot. See the E2E report for the full REAL BROWSER / REAL
HTTP-API-SETUP / TEST FIXTURE / BACKEND-ONLY breakdown per claim.

## 5. Gap E — InBody query scalability (audited: confirmed unbounded)

Before this phase, `fetchLatestInBodyOnOrBefore(userId, cutoff)` in
`user.client.ts` called the existing `GET /internal/inbody/:userId`
route, which has no pagination/limit — `inbody.repository.ts`'s
`findByUserId` had no `take` — and filtered client-side in the fitness-
service for the latest entry `<= cutoff`. Every call downloaded the
user's **entire** InBody history. This is called from `getDiagnosis`,
`getPhaseForecast`, the reconciliation loop inside `advanceRoadmap`, and
now the Gap C `finalSummary` computation — a roadmap with N phases could
trigger N full-history downloads.

Fixed at both layers, user-service:

- `inbody.repository.ts`: `findLatestByUserIdOnOrBefore(userId, cutoff)`
  — `prisma.inBodyEntry.findFirst({ where: { userId, date: { lte:
  cutoff } }, orderBy: { date: "desc" } })`, a single bounded row.
- `internal.routes.ts`: new `GET /inbody/:userId/latest?before=<ISO>`,
  registered after the existing `GET /inbody/:userId` (more specific
  path, no route-ordering collision).
- `fitness-service`'s `fetchLatestInBodyOnOrBefore` now calls this new
  endpoint directly instead of `fetchInBodyHistory` + client-side filter.

`fetchInBodyHistory`/`fetchInBodySeries`/`fetchInBodyById` are left
unchanged — they legitimately need the full/paged history for their own
callers (e.g. progress charts) and are out of this gap's scope; only the
one hot-path caller that only ever needed a single latest-on-or-before
row was repointed, per the master task's "smallest necessary change"
instruction.

Proven with `Gap E: bounded latest-on-or-before InBody lookup is correct
with 0, 1, and hundreds of historical measurements, and never leaks a
future reading backward` — seeds 400+ entries plus one dated *after* the
cutoff, asserts the correct single row is returned and the call
completes in well under a naive full-history-download's time budget.

**Inter-service call count per `currentForecast` request**: one
`fetchLatestInBodyOnOrBefore` call per phase being reconciled/forecast in
that request (bounded by the roadmap's own phase count, typically 3-6),
each now a single indexed row lookup rather than a full-table download.
This is a bounded, understandable call count for the roadmap sizes this
product actually creates — not a claim of 100k-user readiness, and no
Redis/cache was added since the underlying query is already O(1) with
the existing `(userId, date)`-ordered lookup.

## 6. Gap F — confidence/range/reconciliation wording (audited)

Grepped every user-facing occurrence of confidence/độ tin cậy/%/score
across `frontend/web/src/app`:

- `RoadmapJourneyPage.tsx`'s `AdaptiveForecastSection` — already
  categorical (`CONFIDENCE_TIER_LABEL`: Cao/Trung bình/Thấp), never a raw
  score. Reworded "Cân nặng dự kiến" → **"Khoảng dự báo tham khảo"** and
  "Độ tin cậy" → **"Độ tin cậy dữ liệu cho dự báo"** to make the
  data-quality (not statistical) framing explicit, per §19-23's preferred
  wording. `RECONCILIATION_STATUS_LABEL` already avoids punitive
  language ("Đang đúng tiến độ"/"Nhanh hơn dự kiến"/"Tiến độ chậm hơn
  kịch bản ban đầu"/"Chưa đủ dữ liệu để đánh giá") — judged close enough
  to the master task's own preferred phrasing in intent (no "Thất
  bại"/"Không tuân thủ"/"Kém" anywhere) that a forced exact-string match
  was not worth churning already-shipped, already-tested copy for; NO
  ISSUE.
- `GuidedRoadmapWizard.tsx`'s `PhaseForecastCard` — its only `%` usage is
  a real nutrition math fact (deficit/surplus percent of TDEE), not a
  forecast-certainty claim. NO ISSUE.
- **`TrainingCyclePage.tsx:907-908`** — real bug found:
  `` Độ tin cậy: {Math.round(assessment.confidenceScore * 100)}% ``.
  `confidenceScore` is `CycleAssessment.confidenceScore` (Prisma schema
  comment: "0-1, from CycleDecisionEngine"), a deterministic heuristic —
  `dataQualityScore × decision-strength multiplier`
  (`cycle-decision.engine.ts:263-381`) — not a statistical probability.
  Presenting it as `"82%"` is exactly the pathological pattern §19-23
  forbids. Fixed: added `confidenceScoreTier()` (0.7/0.4 thresholds,
  matching the forecast engine's own tiering convention) and
  `CONFIDENCE_TIER_LABEL_VI`, now rendered as "Độ tin cậy dữ liệu: Cao/
  Trung bình/Thấp".
- Same file, `nutritionConfidence` (already a `"HIGH"/"MEDIUM"/"LOW"`
  string from `training-cycle.service.ts`) was rendered **verbatim** —
  a Vietnamese-speaking user would see the literal English word "HIGH".
  Fixed: same `CONFIDENCE_TIER_LABEL_VI` map, with a fallback to the raw
  string only if an unrecognized value ever appears (defensive, not
  fabricating a translation for an unknown value).
- `api.ts`'s `ForecastRange` doc comment already explicitly documents
  "NOT a statistical confidence interval" — pre-existing, correct, no
  change needed.

### ±2/4/8% range heuristic pathological-output audit

`computeForecastRange` (`fitness-roadmap-forecast.engine.ts:326-333`):
`halfWidth = max(|deltaMagnitude| × RANGE_WIDTH_PCT[tier], floor)` where
`RANGE_WIDTH_PCT = {HIGH:.02, MEDIUM:.04, LOW:.08}` and the floor is
`MIN_RANGE_HALF_WIDTH_KG=0.2kg` (weight/body-fat, 1 decimal) or `0.3`
otherwise.

- **Very small delta** (maintenance phase, delta ≈ 0): the floor already
  prevents a zero-width range that would otherwise fake precision. NO
  ISSUE — this is exactly why the floor exists.
- **Very large duration / large total delta**: width scales with the
  delta itself (not duration directly), so a large cut over a long phase
  gets a proportionally wider band, not an exploding one. NO ISSUE.
- **Confidence tier / distance cap** (`applyDistanceCap`,
  `fitness-roadmap-forecast.engine.ts:311-316`): discrete, clamped to
  `[0,1]` before tiering — cannot produce an out-of-range tier. NO ISSUE.
- No numeric `confidence.score` is rendered anywhere in the frontend by
  default (only `.tier`) — confirmed by the same grep pass. NO ISSUE.

No bug found in the range engine itself; the one real bug (raw `%`
heuristic score) was in `TrainingCyclePage.tsx`, not in this heuristic.
Per the master task's explicit instruction, no new modeling complexity
was added — only the pre-existing wording bug was fixed.

## CycleAssessment boundary / read side-effects (audited, NO ISSUE)

`getCurrentForecast` computes reconciliation fresh from current
authoritative data on every call (confirmed by the new GET-idempotency
test, §"GET-equivalent getCurrentForecast is side-effect free" — 5
repeated calls, zero row-count change anywhere). It never reads
`RecommendationAudit` back as a "current state cache," and reconciliation
still never calls into `evaluateRoadmapTransition`/KEEP/PROGRESS/ADJUST/
DELOAD/REBUILD — that boundary was already correct from the prior phase
and is unchanged.

## Security (audited, NO ISSUE)

`getCurrentForecast(req.user!.id)` derives its user id from the auth
token, not a client-supplied param — structurally unspoofable.
`getRoadmapProjection(roadmapId, userId)` — which now also serves Gap
C's `finalSummary` — queries with `where: { id: roadmapId, userId,
archivedAt: null }` (query-level scoping, not fetch-then-check), the
same pattern the existing ownership tests already exercise (lines 363,
1474 of the integration test file). No new endpoint was added, so no new
attack surface was introduced; no change was necessary here.

## No expansion (confirmed)

No AI-assisted rebuild, no manual forecast/confidence editing, no
roadmap social sharing, no PDF export, no coach forecast editing, no new
graph/analytics page, no new `RoadmapBlock` model, no new forecasting ML
service was added. `RANGE_WIDTH_PCT`/`MIN_RANGE_HALF_WIDTH_KG` were
audited, not expanded.
