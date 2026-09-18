# Gymini Adaptive Roadmap Production Closure — Final Verification Report

Date: 2026-09-10
Status: **PARTIALLY VERIFIED** — every backend/UX item is implemented
and evidence-backed by real integration tests and/or real browser E2E;
the one gap (Gap D's full "Chu kỳ vừa qua" / REBUILD / Completed-summary
browser coverage) is honestly BACKEND-ONLY, not fabricated as browser-
verified. See the E2E report §1 for exactly why, and the design doc §4
for the classification.

## 1. Definition-of-Done Checklist (master task §37)

```text
Dedicated REBUILD -> reforecast integration test passes                  VERIFIED
  — TEST FIXTURE, real Postgres, real advanceRoadmap/applyRoadmapRebuild/
  getCurrentForecast service methods. All 12 named invariants asserted
  in one test, PASS.
Original forecast survives REBUILD unchanged                             VERIFIED
  — same test: configuration.roadmapProjectionSnapshot asserted
  deep-equal before/after REBUILD.
Rebuilt future phase sequence drives current forecast                    VERIFIED
  — same test: getCurrentForecast()'s phase sequence asserted to be the
  REBUILT phases, chained from the latest actual state.
Reconciliation audit idempotent                                          VERIFIED
  — existence-guard added (fitness-roadmap.service.ts:1346-1350) +
  dedicated concurrency test.
Concurrent/retried transition cannot create duplicate logical audit      VERIFIED
  — Gap B test: 2 concurrent advanceRoadmap calls -> exactly 1
  COMPLETE_AND_ACTIVATE_NEXT_PHASE audit, 1 new phase, 1 new cycle.
Completed Roadmap terminal UX exists/proven                              VERIFIED
  — finalSummary (backend) + CompletedRoadmapSummary (frontend) + 2
  integration tests (happy path + legacy-no-snapshot). Frontend build
  clean. Browser-rendered with a real COMPLETED roadmap: NOT DONE this
  session (Gap D infra blocker) — BACKEND-ONLY, honestly marked as such.
Completed summary uses actual data + preserves original comparison      VERIFIED
  — finalSummary sources: original snapshot (immutable), latest real
  InBody on/before completion cutoff (never future), real phase/cycle/
  rebuild counts.
Current forecast read side-effect free                                  VERIFIED
  — dedicated test: 5x repeated getCurrentForecast calls, 0 row-count
  change anywhere.
Historical InBody lookup proven bounded/fixed                            VERIFIED
  — Gap E: new bounded single-row query (user-service), repointed hot
  caller, test with 0/1/400+ entries incl. a future-dated one that must
  not leak backward.
No obvious N+1                                                           VERIFIED
  — the one N+1 risk found (full-history download per lookup) is fixed;
  call count is now O(phases) single-row lookups, documented in the
  design doc §5.
User-facing confidence clearly heuristic/data-quality-based               VERIFIED
  — Gap F: 2 real bugs fixed (raw "%" confidenceScore, verbatim English
  nutritionConfidence enum) — both now render Cao/Trung bình/Thấp.
Numeric confidence not presented as probability                          VERIFIED
  — same fix; no numeric confidence.score rendered anywhere by default
  (grep-confirmed).
Forecast ranges explicitly non-statistical                               VERIFIED
  — wording changed to "Khoảng dự báo tham khảo"; api.ts's ForecastRange
  doc comment already said this; ±2/4/8% heuristic audited, no
  pathological-output bug found (design doc §6).
Reconciliation wording non-punitive                                      VERIFIED (pre-existing, re-confirmed)
  — RECONCILIATION_STATUS_LABEL already avoids "Thất bại"/"Không tuân
  thủ"/"Kém"; judged NO ISSUE, not rewritten to force an exact string
  match to the master task's own example wording.
Full reconciliation card browser-tested when legitimately feasible       NOT DONE — honestly marked
  — traced the real API chain needed; no existing harness infra
  assembles it; would be substantial new harness work, not a small
  addition. BACKEND-ONLY via TEST FIXTURE evidence only. See E2E report §1.
Mobile passes                                                            PARTIALLY VERIFIED
  — ACTIVE-roadmap surfaces (updated forecast, disclosure) pass at
  360/375/390/412 via real browser (TC-ROADMAP-002/008, this run).
  CompletedRoadmapSummary specifically not browser-tested (same Gap D
  blocker) — frontend build confirms it compiles/renders without a
  build error, not a mobile-viewport visual check.
Security regression passes                                               VERIFIED
  — getCurrentForecast(req.user!.id) is unspoofable (userId from auth
  token); getRoadmapProjection (incl. new finalSummary) query-scoped by
  userId (fitness-roadmap.service.ts:1076-1077), same pattern the
  existing ownership tests already exercise. No new endpoint added, so
  no new attack surface.
Backend regression passes                                                VERIFIED
  — 248/248 pass, 0 fail (scoped to this phase's + master task's named
  suites — see §2). Exit code 0.
Parallel AI Workout/Catalog work untouched                                VERIFIED
  — zero edits to any Exercise/MovementPattern/Equipment/Catalog file
  this phase; the one pre-existing failure in that domain
  ("every exercise has a movementPattern set") was observed, not
  touched, and is called out below as a pre-existing issue outside this
  phase's ownership.
```

## 2. Test results

Scoped regression (master task §30-32's named suites — fitness-roadmap
integration, forecast engine, reconciliation engine, fitness-diagnosis,
CycleAssessment/cycle-decision(+feedback), cycle metrics, nutrition
decision, nutrition bootstrap(+screening)/macro validation, coach,
training-cycle-metrics):

```text
DATABASE_URL -> isolated test Postgres (gymcoach_fitness_test:55433)
npx tsx --test <13 files listed above>
tests 248
pass 248
fail 0
duration_ms 9100
exit code 0
```

Of these, 6 are new this phase (Gaps A/B/C×2/E + the GET-side-effect
test) — all PASS. The remaining 242 are the pre-existing baseline for
these same suites — all still PASS, confirming no regression was
introduced.

`npx tsc --noEmit` clean (exit 0) for both `fitness-service` and
`user-service` after every edit.

`npm run build` (frontend/web) — clean, twice (once after `Completed
RoadmapSummary` was added, once after the Gap F wording edits).

**Not re-run this phase**: the full unscoped `src/__tests__/*.test.ts`
glob, which also pulls in Exercise Catalog/MovementPattern/import-batch
suites outside this phase's ownership. A first attempt at running the
full glob stalled indefinitely partway through an unrelated Exercise
Catalog import test with zero CPU activity and zero active Postgres
connections (a pre-existing environment/infra issue in that suite, not
something this phase's edits could have caused — none of this phase's
files are anywhere near that code path). Killed and re-run scoped to
avoid burning further time on an out-of-scope suite; see §3.

## 3. Pre-existing issues observed (not caused by, not fixed by, this phase)

- `every exercise has a movementPattern set` — FAIL, Exercise Catalog/
  MovementPattern domain, explicitly owned by the parallel AI Workout
  Grounding work and out of this phase's scope. Observed only because
  it appeared in the (subsequently aborted) full-suite run; not
  investigated or touched, per the master task's explicit instruction
  to leave that work read-only.
- The full unscoped test-file glob stalling on an Exercise Catalog
  import test — same domain, same non-ownership; reported here for
  visibility, not diagnosed or fixed.
- 4 other pre-existing failures observed in that same aborted full run
  (`getFilterOptions`/`listFoods` filters, 2 food-classification backfill
  cases) are in the nutrition-catalog/food-classification domain, not
  named in this phase's required regression scope, and not touched.

## 4. Bugs found and fixed this phase

1. `TrainingCyclePage.tsx` — `confidenceScore` rendered as a raw `%`
   (statistical-looking) instead of a categorical tier. Fixed.
2. `TrainingCyclePage.tsx` — `nutritionConfidence` rendered as a literal
   English enum string instead of a Vietnamese label. Fixed.

No bugs found in Gap A (REBUILD/reforecast), Gap B (idempotency
architecture), Gap C (terminal-state data sourcing), or the ±2/4/8%
range heuristic (Gap F) — those were TEST/UX/PERFORMANCE/DOCUMENTATION
gaps (missing proof, missing UX, unbounded query, missing browser
coverage), not logic bugs; the underlying service code was already
correct where it existed, and the missing UX/query-boundedness was
added net-new.

## 5. Final verdict

**PARTIALLY VERIFIED.** Every backend correctness, idempotency,
security, performance, and wording item is VERIFIED with real evidence.
The one incomplete item is Gap D's full browser-rendered "Chu kỳ vừa
qua"/REBUILD-forecast/Completed-summary coverage, honestly marked
BACKEND-ONLY rather than fabricated — this is a real, acknowledged gap,
not a hidden one.

**ROADMAP WORKSTREAM: NOT FULLY CLOSED** — specifically because of the
one open Gap D item. Recommended: either (a) accept BACKEND-ONLY
coverage for this item as sufficient for closure (the underlying logic
is proven at the TEST FIXTURE level, and the missing piece is browser-
harness infrastructure, not product risk), or (b) a small, explicitly-
scoped follow-up whose only job is building the harness helper for
"drive a TrainingCycle through complete -> evaluate -> advance" — which
would then also unlock spec `25`-style session-lifecycle tests for any
future roadmap phase. Everything else in this phase's Definition of
Done is ready to close.
