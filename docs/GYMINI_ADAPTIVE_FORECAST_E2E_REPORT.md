# Gymini Adaptive Forecast Reconciliation — Browser E2E Report

> **Correction note (2026-09-10, Adaptive Roadmap Production Closure
> phase, Gap F)**: TC-ROADMAP-008's recorded `actual` text below
> ("Cân nặng dự kiến: 78.4–78.8 kg...") reflects wording that has since
> been changed intentionally — "Cân nặng dự kiến" → "Khoảng dự báo tham
> khảo", "Độ tin cậy" → "Độ tin cậy dữ liệu cho dự báo" — to make the
> categorical, non-statistical framing of the range/confidence display
> explicit (never present the internal heuristic as a probability). The
> harness spec's own assertions were updated to match; this report's
> historical `actual` string below is left as-is (a record of what was
> true at the time), not rewritten. See
> `docs/GYMINI_ADAPTIVE_ROADMAP_PRODUCTION_CLOSURE_DESIGN.md` §6 and its
> `_E2E_REPORT.md` for the fresh re-run with the new copy.

Date: 2026-09-10
Harness: `c:\D_Backup\Test\fitnessassistant-playwright-e2e`. Real browser
(Chromium via Playwright), real dev stack (gateway :3000, web :5173,
fitness-service :3002). Spec: `tests/31-fitness-roadmap.spec.ts`,
extended with a new `TC-ROADMAP-008` (previous 7 test cases unchanged,
all still pass).

## 1. What Is Real Browser vs Fixture Preparation (explicit, per master
task §41)

```text
REAL BROWSER:  navigating the Journey tab, reading the rendered "Dự báo
  đã cập nhật" section's actual text content, clicking "Xem dự kiến ban
  đầu" and confirming it reveals the original forecast's phase card,
  resizing the viewport and measuring real horizontal overflow.
LEGITIMATE SERVICE-API PREPARATION (not raw DB writes): one
  `PUT /profile/me` call (the exact same endpoint ProfilePage's own
  "Save" button calls) to give the test account a real stored
  age/height/weight/gender/activityLevel — necessary because the
  guided wizard's own Step 1 inputs are diagnosis-time overrides that
  were never persisted back to the real UserProfile (confirmed by
  design in the prior phase), so without this call the account would
  have no real baseline for GET /fitness-roadmaps/current/forecast to
  chain from at all.
NOT ATTEMPTED THROUGH THE BROWSER: driving a phase to COMPLETED status
  with a real CycleAssessment. No realistic workout/InBody history
  exists for this synthetic account, and legitimate real HTTP APIs
  (`POST /training-cycles/:id/evaluate`) would very likely return
  INSUFFICIENT_DATA against an empty history rather than a demonstrable
  ON_TRACK/BEHIND_FORECAST outcome. This flow is instead covered by a
  real backend integration test with real Prisma writes against the
  isolated test Postgres — see §5 below and the implementation report.
```

## 2. Final Test Matrix (this run, all real)

```text
$ npx tsx prepare-run.ts && npx playwright test tests/31-fitness-roadmap.spec.ts --reporter=list

  ok TC-ROADMAP-001   guided wizard happy path (persistence path this run) (35.7s)
  ok TC-ROADMAP-001x  TrainingCycle drill-down + nav simplification         (13.2s)
  ok TC-ROADMAP-006   Expert mode minimal check                             (13.0s)
  ok TC-ROADMAP-007   K-groups/forecast cards/reopen (persistence path)     (11.4s)
  ok TC-ROADMAP-008   NEW — real "Dự báo đã cập nhật" + "Xem dự kiến ban đầu" (13.3s)
  ok TC-ROADMAP-002   mobile (4 viewports)                                  (18.0s)
  ok TC-ROADMAP-003   theme (dark/light)                                    (11.8s)
  ok TC-ROADMAP-004   PT no-relationship 403s                                (3.5s)

  8 passed (2.2m)
```

## 3. TC-ROADMAP-008 Evidence (recorded test-case log)

```text
TC-ROADMAP-008
precondition: ACTIVE roadmap, real profile set via PUT /profile/me
steps: Open Journey tab, inspect Dự báo đã cập nhật + Xem dự kiến ban
  đầu, resize to mobile
expected: Real updated-forecast range/confidence render; original
  forecast reachable via secondary disclosure; no "Chu kỳ vừa qua" card
  without a completed phase; no mobile overflow
actual: weight range text="Cân nặng dự kiến: 78.4–78.8 kg (kỳ vọng
  ~78.6 kg)"
status: PASS
```

This exact range (78.4–78.8, expected 78.6) matches the real API
response captured independently via a direct `curl` call in the
implementation report §3 — the same real number, reached two different
ways (API + rendered UI), confirming the frontend renders the backend's
real computation faithfully, not a placeholder.

## 4. What TC-ROADMAP-008 Proved Live

```text
- "Dự báo đã cập nhật" section renders with a real, non-fabricated
  weight range (low <= expected <= high, all real numbers from the
  running system).
- "Độ tin cậy" (confidence tier label) renders.
- The permanent "Đây là dự báo, không phải cam kết kết quả" disclaimer
  is present.
- "Xem dự kiến ban đầu" toggle reveals the original forecast's own
  phase card (via the SAME PhaseForecastCard component the guided
  wizard's Step 4 already uses) and toggles its own label to "Ẩn dự
  kiến ban đầu" — confirmed to actually expand/collapse, not just exist
  in the DOM.
- With zero completed phases, "Chu kỳ vừa qua" correctly does NOT
  appear — a verified absence, not an untested gap.
- No horizontal overflow at 360px or 390px with the new section
  actually rendered (not just present).
```

## 5. Reconciliation Flow — Backend Integration Test (real Postgres,
not browser)

Since a real completed-phase-with-assessment scenario is impractical to
produce through only real HTTP calls against a synthetic account with
no history, this flow is verified instead by
`fitness-roadmap.service.integration.test.ts`'s two new tests, run
against the real isolated test Postgres (`localhost:55433`,
`gymcoach_fitness_test`) — same rigor, same real database, just not
through a browser:

```text
"...full flow — create with a real forecast snapshot, activate,
  complete a cycle+assessment with a real actual measurement, advance
  -> reconciliation persisted; getCurrentForecast chains the remaining
  phase from the ACTUAL state, never the stale original"   PASS
"...temporal correctness — a later InBody measurement (after the phase
  completed) must never be used to reconcile that phase"    PASS
```

Both use a real local HTTP server standing in for user-service's own
internal profile/InBody endpoints (the exact same technique the prior
phase's `startFakeAiRoadmapDraftService` already established for
ai-service) — real `fetchUserProfile`/`fetchLatestInBodyOnOrBefore`
client code runs unmodified against it, not mocked out.

## 6. Regression — Prior Test Cases Unaffected

`TC-ROADMAP-001`/`001x`/`006`/`007`/`002`/`003`/`004` all re-ran
unchanged this pass and all still PASS — no previously-verified behavior
was weakened by this phase's changes.

## 7. What Was NOT Exercised (honest scope note)

```text
PT positive multi-role hand-off — unchanged, pre-existing, documented
  blocker (real human payment-gateway click required), outside this
  phase's scope, not re-litigated here.
A full browser-driven reconciliation demo (real "Chu kỳ vừa qua" card
  with real ON_TRACK/BEHIND_FORECAST data) — not attempted through the
  browser for the reason given in §1/§5; covered instead by a real
  backend integration test.
REBUILD's interaction with the current forecast — covered by unit/
  design-level reasoning (design doc §12: the remaining-phases query
  naturally picks up a rebuilt remainder with zero special-casing) and
  by the fact that `applyRoadmapRebuild` itself is entirely unchanged
  this phase, but not re-verified with a dedicated new integration test
  this pass (the mechanism it relies on — filtering by
  status IN (ACTIVE, PLANNED) — is exercised by every other
  getCurrentForecast test already).
```

## 8. Verdict

```text
Gymini Adaptive Forecast Reconciliation Browser E2E = VERIFIED
```

Every UI-facing Definition-of-Done item this phase's master task names
that is reachable through legitimate real HTTP setup (updated-forecast
range/confidence rendering, original-forecast secondary disclosure,
correct absence of a reconciliation card with no history, no mobile
overflow, no regression to any prior phase's verified flows) is
real-browser-verified with concrete evidence. The reconciliation-audit
persistence and temporal-correctness logic — which cannot be
demonstrated through a browser without a realistic multi-week workout
history — are verified instead by real backend integration tests
against real Postgres, documented explicitly rather than glossed over.
