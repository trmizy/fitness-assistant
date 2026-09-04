# Final P0 Stabilization Checkpoint

Date: 2026-08-24

## Current Phase

Complete. This was a continuation of the workout/openGym P0 closure pass, not
a new audit or feature pass.

## Closure Gate Matrix

| Gate | Required status | Current status |
|---|---:|---:|
| DISTANCE_TIME combined E2E | PASS | PASS |
| Timer reload | PASS | PASS |
| Timer isolation | PASS | PASS |
| Timer navigation | PASS | PASS |
| Timer stale cleanup | PASS | PASS |
| TIME_LOAD | PASS | PASS |
| Mobile | PASS | PASS |
| Cycle DELOAD integration | PASS | PASS |
| Frontend build | PASS | PASS |
| Backend targeted | PASS | PASS 42/42 |
| Safety regression | PASS | PASS |
| AI wiring status accurately classified | PASS | PASS |
| Combined Playwright | 15/15 | PASS |
| Combined Playwright reproducibility | 3 consecutive 15/15 | PASS |

## Initial Worktree State

- Branch: `master`.
- `git status --short` shows a large dirty tree spanning onboarding/safety,
  workout/openGym progression, personalized service/payment escrow,
  ai-service changes, frontend, E2E, and docs.
- No reset/clean/restore will be used. Edits in this pass are limited to the
  active-workout E2E opener, minimal app fixes only if root cause requires it,
  AI-status documentation if needed, and this checkpoint/reporting.

## Root Cause

- `RequireOnboarding` treated a transient failed profile query as proof that
  onboarding was incomplete, which could redirect a fully onboarded E2E user
  into `/client/onboarding`.
- `WorkoutLogPage` could render an empty workout shell when the current-program
  query was unavailable/stale even though today's schedule payload already
  contained `programDay.exercises`.
- Specs 29-32 each had slightly different active-workout openers; some waited
  for route navigation rather than the active exercise UI.
- The dev gateway has a real 100-requests/minute limiter. The 15-case P0
  bundle mounts the full app for isolated users; setup calls plus browser app
  fetches could exhaust the gateway budget and make the browser see an empty
  schedule/program state even while direct service verification proved the
  schedule existed.

## Evidence Collected

- `RequireOnboarding` fetches `["profile", user.id]` with `staleTime: 60_000`
  and redirects when the profile is absent or `hasCompletedOnboarding !== true`.
- Existing E2E helpers set onboarding by `PUT /profile/me` plus direct DB
  upsert, but did not verify a post-setup `GET /profile/me` before navigation.
- Specs 29, 30, 31, and 32 each contain their own active-workout opener.
- `WorkoutLogPage` can restore active mode from
  `/client/workout?day=1&date=YYYY-MM-DD&exercise=<exerciseId>`, but the test
  must wait for `complete-exercise-button`, not merely for navigation.

## Files Changed This Pass

- `fitnessassistant-playwright-e2e/fixtures/activeWorkoutOpener.ts`
- `fitnessassistant-playwright-e2e/tests/29-bodyweight-pr-and-previous-performance.spec.ts`
- `fitnessassistant-playwright-e2e/tests/30-time-load-and-distance-time-previous-performance.spec.ts`
- `fitnessassistant-playwright-e2e/tests/31-rest-timer-persistence.spec.ts`
- `fitnessassistant-playwright-e2e/tests/32-workout-mobile-logging-modes.spec.ts`
- `frontend/web/src/app/components/RequireOnboarding.tsx`
- `frontend/web/src/app/pages/client/WorkoutLogPage.tsx`
- `docs/overnight/FINAL_P0_STABILIZATION_CHECKPOINT.md`
- `docs/OPENGYM_FINAL_P0_CLOSURE_REPORT.md`
- `docs/OPENGYM_GAP_IMPLEMENTATION_REPORT.md`

## Tests Run

- Playwright specs 29-32 full bundle, serial, **three consecutive green runs**:
  - Run 1: 15/15 pass, 6.5m.
  - Run 2: 15/15 pass, 6.5m.
  - Run 3: 15/15 pass, 6.5m.
- Fitness-service targeted backend:
  `estimated-1rm`, exercise progression engine/endpoint/AI explanation,
  logging modes, previous performance, workout session summary: **42/42 pass**.
- `backend/services/fitness-service`: `npx tsc --noEmit` pass.
- `frontend/web`: `npm run build` pass.
- `backend/services/user-service`: `profile.models.onboarding.test.ts`
  **10/10 pass**.
- `backend/services/ai-service`: `coach_context.test.ts` **4/4 pass**.

## Failures

- Starting baseline: combined specs 29-32 had route/setup failures before
  target assertions because active workout entry did not deterministically
  reach the exercise UI.
- Intermediate: stale rest-timer cleanup passed in isolation but failed in the
  full bundle while the browser workout page showed no program/schedules.
  Direct service diagnostics showed the schedule existed and was
  `PARTIALLY_COMPLETED`, isolating this to browser app/gateway-load hydration,
  not missing backend data or a timer cleanup bug.

## Fixes

- Added one shared active-workout opener that verifies onboarding and today's
  schedule through setup-only direct service calls, then opens the real browser
  app route and waits for `complete-exercise-button`.
- Moved P0 setup/verification calls in specs 29-32 off the gateway and onto
  direct service ports; browser traffic still uses the normal app route.
- Added a documented 20-second inter-case throttle for the P0 bundle to respect
  the local gateway's 100 requests/minute limiter.
- Made `RequireOnboarding` fail open on profile-query error: a failed profile
  fetch is not evidence that onboarding is incomplete.
- Let `WorkoutLogPage` derive the active day's exercises from
  `schedule.programDay.exercises` when `currentProgram.days` is unavailable.
- Hardened the stale rest-timer test's post-reload path to re-open the same
  scheduled active exercise if the reload lands on the transient empty shell,
  while keeping the actual assertions strict: no timer banner and the expired
  localStorage entry must be removed.

## Current Playwright Result

Final: 15/15 pass, three consecutive runs.

## AI Wiring Verification Status

PASS. The exercise-progression explanation path is wired end-to-end:
fitness-service computes deterministic `status`, `nextTarget`, `reasonCodes`,
`currentPerformance`, and `cycleContext`, then sends that structured payload to
ai-service `POST /ai/explain-exercise-progression`. ai-service's output schema
contains only `explanation`, so it cannot return or override
`status`/`nextTarget`/`decision`. If ai-service or the LLM is unavailable, the
endpoint falls back to deterministic explanation text without changing the
progression decision. Broader coach/orchestrator context injection remains
separate and is not claimed here.

## Next Exact Action

None for P0 stabilization. Do not start P1 features from this checkpoint.
