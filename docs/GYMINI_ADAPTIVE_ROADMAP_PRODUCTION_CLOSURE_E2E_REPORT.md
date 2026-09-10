# Gymini Adaptive Roadmap Production Closure — Browser E2E Report

Date: 2026-09-10
Harness: `c:\D_Backup\Test\fitnessassistant-playwright-e2e` (external,
real Chromium via Playwright, real dev stack — gateway :3000, web :5173,
fitness :3002, user :3004 — `docker-compose.dev.yml`). Before this run,
`gymcoach-fitness-dev`/`gymcoach-user-dev`/`gymcoach-web-dev` were
restarted to guarantee the running containers reflect this phase's
source edits (Windows Docker Desktop `tsx watch` hot-reload is
independently known to be unreliable — restarting is the confirmed-safe
way to force a fresh load rather than trusting hot-reload silently
picked the change up).

Ran: `npx tsx prepare-run.ts && npx playwright test
tests/31-fitness-roadmap.spec.ts --workers=1` → run id
`e2e_202609100318251`. **8/8 passed, 0 failed** (see full transcript
below).

```text
ok 1 TC-ROADMAP-001  (guided wizard -> Save DRAFT -> Start ACTIVE -> refresh persists)
ok 2 TC-ROADMAP-001x (TrainingCycle drill-down route reachable)
ok 3 TC-ROADMAP-006  (Expert mode still creates a DRAFT)
ok 4 TC-ROADMAP-007  (Roadmap Report K-groups + per-phase forecast cards)
ok 5 TC-ROADMAP-008  (updated forecast + original-forecast disclosure — wording re-verified below)
ok 6 TC-ROADMAP-002  (mobile 360/375/390/412, ACTIVE roadmap, no overflow)
ok 7 TC-ROADMAP-003  (dark/light theme, ACTIVE roadmap)
ok 8 TC-ROADMAP-004  (PT, no client relationship -> clean 403)

[global-teardown] Test verdict: READY (FAIL=0, total=12)
  8 passed (1.9m)
```

## §33 target matrix — honest per-item status

| Target | Status | Evidence type |
|---|---|---|
| UPDATED FORECAST | **PASS** | REAL BROWSER — TC-ROADMAP-008, this run |
| ORIGINAL FORECAST DISCLOSURE | **PASS** | REAL BROWSER — TC-ROADMAP-008, this run |
| REAL COMPLETED-RECONCILIATION CARD ("Chu kỳ vừa qua") | **BACKEND-ONLY** | See §1 below — not browser-tested this session |
| REBUILD → UPDATED FORECAST | **BACKEND-ONLY** | Same blocker as above (§1) |
| COMPLETED ROADMAP SUMMARY | **BACKEND-ONLY** | Same blocker as above (§1) |
| MOBILE 360/375/390/412 | **PASS (ACTIVE-roadmap surfaces only)** | REAL BROWSER — TC-ROADMAP-002, this run. Does **not** cover the new `CompletedRoadmapSummary` component (§1) |

### Gap F wording re-verification (this run)

`TC-ROADMAP-008` (line 593-609 of the spec) now asserts the **post-
closure** copy and passed against the live, restarted stack:
- `Khoảng dự báo tham khảo` (was "Cân nặng dự kiến") — visible, real range text matched `/\d+(\.\d+)?–\d+(\.\d+)?\s*kg/`.
- `Độ tin cậy dữ liệu cho dự báo` (was "Độ tin cậy") — visible.
- No mobile overflow introduced at 360×800 / 390×844.

This is a genuine before/after: the spec file itself was edited this
phase to match the intentional copy change (see the implementation
report §7) — not a case of the assertion being loosened to force a
pass; the same string-presence + regex-shape rigor applies to the new
text.

## 1. Why the three BACKEND-ONLY rows exist (Gap D)

Reaching a real "Chu kỳ vừa qua" card, a REBUILD-driven forecast update,
or a COMPLETED roadmap all require the exact same missing precondition:
**a real, completed `TrainingCycle` with a `COMPLETED` `CycleAssessment`**
on a phase belonging to a roadmap. The real product APIs for this chain
were identified and traced (not guessed):

```text
POST /training-cycles/:id/complete   (endInbodyId? -> TrainingCycle COMPLETED)
POST /training-cycles/:id/evaluate   (-> CycleAssessment, decision engine)
POST /fitness-roadmaps/:roadmapId/advance
  (requires the ACTIVE phase's most recent cycle to be COMPLETED/ANALYZED
  AND a COMPLETED CycleAssessment for it — fitness-roadmap.service.ts:1270-1285)
```

Standing this up from a cold seed account legitimately needs realistic
upstream state this harness does not currently build anywhere: a
WorkoutProgram with logged, completed sessions (feeding
`adherenceRate`/`strengthProgressScore` into the decision engine) and at
least one dated InBody check-in inside the cycle window. Grepped the
entire harness (`fixtures/`, all 30 existing spec files) for any
existing helper that assembles this chain — **none exists**; this would
be new, non-trivial harness infrastructure, not a small addition.

Per the master task's own explicit instruction — attempt it if the
existing APIs make it feasible, but if infeasible without "huge
unrelated work," mark the gap **honestly** as PARTIALLY VERIFIED /
BACKEND-ONLY rather than fabricating a shortcut (e.g. no raw-DB seeding
of a `TrainingCycle`/`CycleAssessment` row was used to fake this state,
which would have been a "cheat to obtain a screenshot") — this is that
judgment call. **REAL HTTP/API-level proof still exists** for the
underlying logic via the fitness-service integration tests (Gap A/B/C
tests in `fitness-roadmap.service.integration.test.ts`, run against a
real Postgres, exercising the real `advanceRoadmap`/
`applyRoadmapRebuild`/`getRoadmapProjection` service methods) — this is
**BACKEND-ONLY**, explicitly not equivalent to a browser click-through,
and is not represented as such anywhere in this report.

## Evidence-type legend (used consistently above and in the verification report)

- **REAL BROWSER** — a real Chromium session, via Playwright, against
  the live dev stack, asserting on rendered DOM.
- **REAL HTTP/API SETUP** — a real HTTP call to a running service
  (gateway or direct service port), no browser.
- **TEST FIXTURE** — a Node `node:test` integration test against a real
  Postgres, calling the real service-layer function directly (no HTTP
  layer, no browser).
- **BACKEND-ONLY** — TEST FIXTURE-level proof exists; no REAL BROWSER or
  REAL HTTP/API SETUP proof exists for this specific claim.
