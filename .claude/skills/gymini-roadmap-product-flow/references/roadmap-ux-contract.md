# Roadmap UX contract — current known issues

These were reported from real, manual UI observation (not automated
test failures) and are recorded here so a future session doesn't have
to rediscover them from scratch, and doesn't "fix" only the symptom.
**Verify still-current before fixing** — re-read the cited file/line,
since either agent may have already touched it since this was written.

## 1. Account switch leaves the old account's Roadmap visible — investigated, hardened, unresolved (2026-09-10)

See `gymini-account-session-isolation` — this is a cache-isolation bug
category, not Roadmap-specific, but Roadmap is one of the surfaces where
it was reported (repro given: full logout, then login to a different
account, same tab).

Investigated per that skill's own debugging workflow, all `BACKEND IDOR`
tier:
- **Backend**: real HTTP calls with two different seeded accounts' tokens
  against `GET /fitness-roadmaps/current` — each correctly got only its
  own data (one real roadmap, one real 404). No IDOR.
- **React Query cache**: `AppContext.tsx` already called
  `queryClient.clear()` on login, logout, and session-expiry — correct
  ordering (before `setUser`/`setIsAuth`).
- **Service worker**: disabled in dev (`shouldRegisterPwa` — `isDev`
  check) — not a factor in the environment the bug was reported in.
- **Token store / axios interceptor**: `tokenStore` is synchronous and
  written before any dependent request fires; the request interceptor
  reads it fresh per-request. No stale-token window found by inspection.
- **Gateway**: no response-caching middleware on any user-data route
  (only a text-translation cache, keyed by text, unrelated).

**Hardening applied** (real fix, not just a null result): none of the
queryFns in this codebase forward React Query's `signal` into axios, so
`queryClient.clear()` alone does not guarantee an in-flight request from
the outgoing session is truly aborted at the network level — only that
its eventual resolution has no query object left to write into. Added
`queryClient.cancelQueries()` immediately before every `queryClient.
clear()` call in `AppContext.tsx` (login, logout, session-expiry) per
this skill's own "cancel in-flight requests before/during switch"
requirement, which was not actually implemented before this session.

**Still unresolved**: the user's specific repro has not been confirmed
fixed live (no browser-automation tool available this session — this was
audited via code + real HTTP calls only, no interactive browser repro).
If it recurs after this fix, the next step is NOT more code reading — it
needs an actual two-account browser session with network tab / video
capture (see this skill's "Required regression checklist") to catch the
exact response that painted the wrong data, since every plausible
mechanism reachable by static audit has now been checked.

## 2. "Kiểm tra tiến độ" invokes `advanceRoadmap` unconditionally — FIXED (2026-09-10)

**Fixed in `RoadmapJourneyPage.tsx`** via a shared `getPhaseReadiness(phase,
pendingRebuild)` derivation (frontend-only, no backend/schema change — uses
fields `FitnessRoadmapProjection` already returns: each cycle's
`status`/`decision`, plus `pendingRebuild`). The header button and
`ActivePhaseDetail`'s empty-state now both read the same derived
`PhaseReadiness` instead of the old boolean "does an ACTIVE cycle exist":

- `ACTIVE_CYCLE` — unchanged normal view.
- `PENDING_REBUILD` — button hidden (the `PendingRebuildBanner`'s own CTA
  already covers it); a one-line pointer shown instead.
- `ANALYZING` — the real, narrow window where `completeCycle` has written
  `status: "COMPLETED"` but `runVersionedAssessment` hasn't finished
  writing the assessment yet (`training-cycle.service.ts:830-849`) — shows
  a passive "Đang đánh giá chu kỳ vừa hoàn thành..." spinner, no button.
- `INSUFFICIENT_DATA` — `CycleAssessment.decision === "INSUFFICIENT_DATA"`
  — shows a passive explanatory card instead of a clickable button that
  used to silently no-op with a misleading success toast.
- `READY_TO_ADVANCE` — the only state that renders the actionable button
  (header) and its mirror (inline in `ActivePhaseDetail`).
- `NO_CYCLE_YET` — unchanged neutral text (kept only for the true
  zero-cycles edge case).

This same fix resolved issue #5 below for free (same root cause, same
code path).

## 3. ACTIVE Journey hides most of the creation-time context — FIXED (2026-09-10)

Extended the fix from #6 below: the ACTIVE view was only re-showing the
per-phase forecast card (kcal/macro projections), not the BMR/TDEE
breakdown table or the "Nhận định lộ trình" reasoning text — exactly the
two things a real user flagged as missing when comparing against CTG
Fitness screenshots. Extracted the wizard's inline energy-breakdown JSX
(`GuidedRoadmapWizard.tsx`, was inline in Step 2) into an exported
`EnergyBreakdownCard` component (same file, next to `PhaseForecastCard`)
so Step 2 of the wizard and `ActivePhaseDetail`'s disclosure render the
exact same markup from the same `energyBreakdown`/`reasoning` shape —
`RoadmapJourneyPage.tsx` reads it from
`roadmap.configuration.diagnosisSnapshot` (was already saved by
`GuidedRoadmapWizard.tsx:buildAcceptPayload`, just never redisplayed).

**Known real limitation, not a bug**: any roadmap created before this
snapshot-saving convention existed (or whose diagnosis/forecast queries
hadn't resolved yet when the user clicked through) has `diagnosisSnapshot`/
`roadmapProjectionSnapshot` as `null` in the DB — confirmed via direct
query on a real account's ACTIVE roadmap. The new UI section correctly
renders nothing for those (no fabricated numbers) rather than erroring.
Only roadmaps created going forward through the full 4-step wizard are
guaranteed to have this data.

## 4. Calories/macros hard to rediscover after activation — VERIFIED, no bug found (2026-09-10)

Re-checked `ActivePhaseDetail` in `RoadmapJourneyPage.tsx`: `latestGoal`
is read from `activeCycle.nutritionGoals` (the live `NutritionGoal`, ACTIVE
status preferred) and labeled "Dinh dưỡng hiện tại"; the creation-time
number only appears as a secondary note ("Dự kiến ban đầu: ~X kcal/ngày")
and only when it actually differs from the live value. This already
satisfies the rule in `gymini-domain-source-of-truth` — live value first,
original estimate clearly labeled as a separate historical note. No
change made.

## 5. "Chu kỳ 1/3" next to "no active cycle" simultaneously — FIXED (2026-09-10)

Resolved as a side effect of the fix in #2 above — `ActivePhaseDetail`'s
empty-state branch now shows the real reason (analyzing / insufficient
data / pending rebuild / ready) next to the "Chu kỳ X/Y" badge instead of
a single generic line, so the two never contradict each other anymore.

## 6. Creation flow richness lost in the ACTIVE view — FIXED (2026-09-10)

`GuidedRoadmapWizard.tsx`'s Step 4 report (BMR/TDEE breakdown, K1/K2/K3-
equivalent strategy groups via `PhaseForecastCard`, "Nhận định lộ trình"
reasoning) is already at least as rich as CTG Fitness's competing report
— nothing to fix in the wizard itself. The gap was reachability: both
`roadmapProjectionSnapshot` (phase forecasts) and `diagnosisSnapshot`
(BMR/TDEE breakdown + reasoning) are saved at creation time but were
never redisplayed anywhere reachable during the roadmap's first active
cycle (`AdaptiveForecastSection`'s own original-forecast disclosure
requires reconciliation data that only exists after a cycle transition).
Fixed by adding a single disclosure inside `ActivePhaseDetail` ("Xem chẩn
đoán & báo cáo lộ trình ban đầu") that renders both snapshots via the
`EnergyBreakdownCard`/`PhaseForecastCard` components exported from
`GuidedRoadmapWizard.tsx` — no duplicate rendering logic, gated on
whichever snapshot(s) actually exist for that roadmap (see #3 above for
the real, honest limitation on older roadmaps with no saved snapshot).
Remaining open question, not assumed as part of this fix: whether the
ACTIVE view should also show *live* (re-computed) TDEE/macro numbers
alongside the frozen creation-time snapshot — that needs a real product
decision.

## Investigation order for any of the above

1. Session identity (which user, which token).
2. The real request/response payload (network tab or a direct `curl`
   with the same token) — not the frontend's assumption of the shape.
3. React Query cache state (`queryKey`, `staleTime`, is this a stale
   read from a prior account/prior data).
4. The real backend DB state for the specific roadmap/phase/cycle in
   question.
5. Frontend mapping/computation logic.
6. Copy/interaction design — only after 1-5 are ruled out as the actual
   cause.

Never fix only the visible text before identifying which of 1-5 the
real root cause is.
