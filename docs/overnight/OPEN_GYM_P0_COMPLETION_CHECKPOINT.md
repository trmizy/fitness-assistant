# openGym P0 Completion Checkpoint

Date: 2026-08-24

## Current Verdict

READY WITH KNOWN LIMITATIONS.

This pass closed the remaining workout-logging P0 gap for bodyweight, timed,
and cardio/distance semantics across backend persistence, previous-performance,
progression endpoint data, and the active workout UI. It also added real-browser
coverage for the new user-visible paths.

## Implemented This Pass

- Preserved `bodyWeightAtSetKg`, `durationSeconds`, and `distanceMeters` through
  `createWorkout`, `updateWorkout`, `completeScheduleExercise`, and
  previous-performance reads.
- Added frontend active-workout controls for bodyweight-at-set, duration, and
  distance, with logging-mode-aware display and completion payloads.
- Added timed/cardio prescription and previous-performance formatting so the UI
  no longer maps non-load work into `weight`.
- Hardened the Playwright isolated-user auth setup against gateway login
  limiter saturation by falling back to direct auth-service login for setup-only
  token minting.
- Added Playwright coverage for `DISTANCE_TIME` cardio logging.

## Verification Evidence

| Command | Result |
|---|---|
| `npx tsc --noEmit` (`backend/services/fitness-service`) | Pass |
| `npx tsx --test src/__tests__/workout-logging-modes.integration.test.ts src/__tests__/previous-performance.integration.test.ts src/__tests__/exercise-progression-endpoint.integration.test.ts` | 11/11 pass |
| `npx playwright test tests/29-bodyweight-pr-and-previous-performance.spec.ts --workers=1` | 5/5 pass, run `e2e_202608240508266` |
| `npm run build` (`frontend/web`) | Fails on pre-existing unresolved `body-muscles` import in `ExerciseMuscleMap.tsx`, after transforming edited workout modules |

## Remaining Limits

- `TIME_LOAD` has schema/API foundation but no dedicated E2E scenario.
- Rest-timer reload persistence and Wake Lock are implemented but still lack a
  dedicated browser reload/WakeLock proof.
- AI-service explanation wiring is still deferred because the relevant
  ai-service files belong to a separate dirty workstream already present in the
  repo.

## Notes For Next Session

- The worktree is intentionally dirty with unrelated onboarding/safety and
  personalized-service changes; do not reset or overwrite them.
- The Playwright harness lives under `fitnessassistant-playwright-e2e/` and is
  not currently surfaced in `git status` for this repo, but it was modified for
  this pass.
- The frontend build failure is not caused by this pass; investigate
  `frontend/web/src/app/components/ExerciseMuscleMap.tsx` and the missing
  `body-muscles` package separately.
