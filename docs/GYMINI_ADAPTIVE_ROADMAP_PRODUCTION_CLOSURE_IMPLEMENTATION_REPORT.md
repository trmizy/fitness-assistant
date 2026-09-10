# Gymini Adaptive Roadmap Production Closure — Implementation Report

Date: 2026-09-10
Scope: closure/production-hardening phase on top of the VERIFIED Guided
Roadmap Creation, Roadmap Projection Hardening, and Adaptive Forecast
Reconciliation phases. Implements
`docs/GYMINI_ADAPTIVE_ROADMAP_PRODUCTION_CLOSURE_DESIGN.md`. No new
forecasting model, no wizard/lifecycle redesign, no new top-level page,
no AI-assisted REBUILD. AI Workout Grounding / Exercise Catalog /
MovementPattern / equipment-aware selection / exercise substitution are
untouched.

## 1. Gap E — bounded InBody lookup (user-service)

`backend/services/user-service/src/repositories/inbody.repository.ts` —
added `findLatestByUserIdOnOrBefore(userId, cutoff)`:
```ts
async findLatestByUserIdOnOrBefore(userId: string, cutoff: Date) {
  return prisma.inBodyEntry.findFirst({
    where: { userId, date: { lte: cutoff } },
    orderBy: { date: "desc" },
  });
},
```
`backend/services/user-service/src/services/inbody.service.ts` — added
`getLatestOnOrBefore(userId, cutoff)`, a thin passthrough.

`backend/services/user-service/src/routes/internal.routes.ts` — added
`GET /inbody/:userId/latest?before=<ISO>` (registered after the existing
`GET /inbody/:userId`, more specific path, no ordering collision):
validates `before` as a required, parseable ISO date (400 otherwise),
returns the single entry or `null`.

## 2. Gap E — repointed hot-path caller (fitness-service)

`backend/services/fitness-service/src/clients/user.client.ts` —
`fetchLatestInBodyOnOrBefore(userId, cutoff)` rewritten to call the new
bounded endpoint directly instead of `fetchInBodyHistory()` + client-
side filtering. `fetchInBodyHistory`/`fetchInBodySeries`/
`fetchInBodyById` are unchanged — they legitimately need full/paged
history for their own callers (progress charts), out of this gap's
scope.

## 3. Gap B — reconciliation-audit idempotency guard (defense-in-depth)

`backend/services/fitness-service/src/services/fitness-roadmap.service.ts`
(`advanceRoadmap`, `COMPLETE_AND_ACTIVATE_NEXT_PHASE` branch,
~line 1346): wraps the existing reconciliation computation + audit
creation in

```ts
const existingReconciliation = await tx.recommendationAudit.findFirst({
  where: { cycleId: cycle.id, engineVersion: "forecast-reconciliation-v1" },
  select: { id: true },
});
if (!existingReconciliation) { /* existing computation, unchanged */ }
```

No migration. Reuses the existing `RecommendationAudit` table and the
existing `lockRoadmapUser` advisory-lock architecture — no second lock
system introduced. See design doc §2 for why this is defense-in-depth
rather than a fix for a real bug (none was found).

## 4. Gap C — Completed Roadmap terminal summary (backend)

`fitness-roadmap.service.ts`'s `getRoadmapProjection` — added a
`finalSummary` block, computed only when `roadmap.status ===
"COMPLETED"` (see design doc §3 for the full field-by-field sourcing
rationale), added to the method's return object. No new endpoint; reuses
the same userId-scoped `findFirst` query every other caller of this
method already relies on.

## 5. Gap C — Completed Roadmap terminal summary (frontend)

`frontend/web/src/app/services/api.ts` — added `RoadmapFinalSummary`
interface; extended `FitnessRoadmapProjection` with `finalSummary:
RoadmapFinalSummary | null`.

`frontend/web/src/app/pages/client/RoadmapJourneyPage.tsx` — replaced
the previous ad-hoc COMPLETED-status block with
`<CompletedRoadmapSummary data={data} />`, and added that component
(inserted immediately before the `AdaptiveForecastSection`/"Adaptive
Forecast Reconciliation" block). Renders Bắt đầu/Dự kiến ban đầu/Kết quả
thực tế/Thời gian/Giai đoạn/Chu kỳ/Điều chỉnh chiến lược, each field
independently null-safe ("Không đủ dữ liệu" per missing field, never a
fabricated number), plus a `[Xem lộ trình ban đầu]` disclosure reusing
the existing `PhaseForecastCard`/`STRATEGY_BUCKET_LABEL` components (no
new forecast-rendering component).

## 6. Gap F — confidence/range/reconciliation wording

`frontend/web/src/app/pages/client/RoadmapJourneyPage.tsx`
(`AdaptiveForecastSection`): "Cân nặng dự kiến" → "Khoảng dự báo tham
khảo"; "Độ tin cậy" → "Độ tin cậy dữ liệu cho dự báo" (both still
render the same categorical `CONFIDENCE_TIER_LABEL` tier, no numeric
score exposed).

`frontend/web/src/app/pages/client/TrainingCyclePage.tsx` — real bug
fixed: `` Độ tin cậy: {Math.round(assessment.confidenceScore * 100)}% ``
(a raw percentage of an internal deterministic heuristic, presented as
if it were a statistical probability) replaced with a categorical tier
via new `confidenceScoreTier()` (0.7/0.4 thresholds, matching the
forecast engine's own convention) + `CONFIDENCE_TIER_LABEL_VI`. Same
file's `nutritionConfidence` (a `"HIGH"/"MEDIUM"/"LOW"` string rendered
**verbatim**, i.e. showing the literal English word to a Vietnamese
user) now maps through the same `CONFIDENCE_TIER_LABEL_VI` table.

No change to `fitness-roadmap-forecast.engine.ts`'s `±2/4/8%` range
heuristic — audited (design doc §6) for pathological output on small
deltas/large durations/maintenance phases and found already correctly
guarded by its existing floor (`MIN_RANGE_HALF_WIDTH_KG`). No new
modeling complexity added, per the master task's explicit instruction.

## 7. External E2E harness maintenance (not app code)

`c:\D_Backup\Test\fitnessassistant-playwright-e2e\tests\
31-fitness-roadmap.spec.ts`'s `TC-ROADMAP-008` asserted the literal
pre-closure strings ("Cân nặng dự kiến"/"Độ tin cậy"). Updated the two
assertions to the new copy — an intentional wording change made this
same phase, not an app bug, so updating the harness's own literal-string
match is ordinary test maintenance, not weakening a previously-green
assertion's rigor. Re-ran the full spec against the live dev stack after
the change — see the E2E report.

## Bugs found

1. `TrainingCyclePage.tsx:907-908` — internal `confidenceScore` heuristic
   (0-1, `dataQualityScore × decision-strength`, `cycle-decision.
   engine.ts`) rendered as a raw `"NN%"`, indistinguishable from a
   statistical confidence percentage. Real, user-facing bug; fixed (§6).
2. Same file — `nutritionConfidence` rendered as the literal English
   enum string (`"HIGH"`) instead of a Vietnamese label. Real,
   user-facing bug; fixed (§6).

No other bugs found in Gaps A/B/C/D/E's own logic — those gaps were
TEST/UX/PERFORMANCE/DOCUMENTATION gaps (missing proof, missing UX,
unbounded query, missing browser coverage), not code-correctness bugs in
the underlying service logic, which was already correct.

## Files changed

```text
backend/services/user-service/src/repositories/inbody.repository.ts
backend/services/user-service/src/services/inbody.service.ts
backend/services/user-service/src/routes/internal.routes.ts
backend/services/fitness-service/src/clients/user.client.ts
backend/services/fitness-service/src/services/fitness-roadmap.service.ts
backend/services/fitness-service/src/__tests__/fitness-roadmap.service.integration.test.ts
frontend/web/src/app/services/api.ts
frontend/web/src/app/pages/client/RoadmapJourneyPage.tsx
frontend/web/src/app/pages/client/TrainingCyclePage.tsx
docs/GYMINI_ADAPTIVE_ROADMAP_PRODUCTION_CLOSURE_DESIGN.md (new)
docs/GYMINI_ADAPTIVE_ROADMAP_PRODUCTION_CLOSURE_IMPLEMENTATION_REPORT.md (new, this file)
docs/GYMINI_ADAPTIVE_FORECAST_RECONCILIATION_DESIGN.md (correction note appended)
docs/GYMINI_ADAPTIVE_FORECAST_E2E_REPORT.md (correction note appended)

c:\D_Backup\Test\fitnessassistant-playwright-e2e\tests\31-fitness-roadmap.spec.ts
  (external harness, not part of this repo — wording-assertion maintenance only)
```
