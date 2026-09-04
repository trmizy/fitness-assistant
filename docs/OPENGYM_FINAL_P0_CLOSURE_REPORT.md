# openGym P0 Closure Report

Date: 2026-08-24

## Verdict

**READY.**

The deterministic backend, schema, AI-authority contract, frontend build, and browser workout P0 surfaces are verified. The active-workout route/setup flake that previously left the bundle at 12/15 has been root-caused and stabilized; specs 29-32 now pass 15/15 in three consecutive serial real-browser runs.

## Verified Passing

| Area | Result |
|---|---|
| Fitness-service targeted backend | 42/42 pass |
| Fitness-service TypeScript | `npx tsc --noEmit` pass |
| Frontend production build | `npm run build` pass |
| User onboarding/safety schema | 10/10 pass |
| AI coach context safety regression | 4/4 pass |
| TIME_LOAD browser logging | pass in spec 30 |
| TIME browser persistence | targeted pass |
| Rest timer persistence/isolation/stale cleanup | spec 31 pass in full bundle |
| Mobile active workout modes | spec 32 pass in full bundle |

## Browser E2E Status

Latest combined command:

`npx playwright test tests/29-bodyweight-pr-and-previous-performance.spec.ts tests/30-time-load-and-distance-time-previous-performance.spec.ts tests/31-rest-timer-persistence.spec.ts tests/32-workout-mobile-logging-modes.spec.ts --workers=1`

Result: **15/15 pass**, three consecutive runs.

Evidence:
- Run 1: 15/15 pass, 6.5m.
- Run 2: 15/15 pass, 6.5m.
- Run 3: 15/15 pass, 6.5m.

Passing in that same combined run:
- Bodyweight PR renders as reps, no `0kg`.
- Previous-performance reference card.
- Deterministic exercise progression card.
- TIME-mode browser persistence.
- TIME_LOAD browser persistence and previous-performance.
- DISTANCE_TIME previous-performance.
- Rest-timer reload, navigation, stale cleanup, and cross-schedule isolation.
- Mobile REPS_LOAD/TIME/DISTANCE_TIME.

## Closure Fixes

- Added real service integration for active-cycle `DELOAD` envelope overriding local exercise progression.
- Added mobile active-workout logging-mode Playwright coverage.
- Hardened Playwright workout opener/onboarding recovery and consolidated specs
  29-32 onto one diagnostic opener that waits for the active exercise UI.
- Moved setup-only API calls off the dev gateway to direct service ports and
  added a documented 20-second inter-case throttle; browser app traffic still
  uses the normal route.
- Fixed `RequireOnboarding` to fail open on transient profile-query errors.
- Let `WorkoutLogPage` derive active-day exercises from
  `schedule.programDay.exercises` when `currentProgram.days` is unavailable.
- Corrected DB assertions to read completed workout sets, not start-schedule placeholder sets.
- Added a ref-backed active exercise log mirror in `WorkoutLogPage.tsx` so an immediate complete click reads the latest slider value.
- Corrected RIR/ACSM docs: ACSM 2026 is Currier BS et al.; exact RIR threshold remains a product heuristic.

## AI Wiring Classification

Exercise-progression AI explanation is wired end-to-end and remains non-authoritative. `fitness-service` computes deterministic `status`, `nextTarget`, `reasonCodes`, `currentPerformance`, and `cycleContext`, then sends that structured context to ai-service `POST /ai/explain-exercise-progression`. ai-service may return only `explanation`; its schema has no `status`, `nextTarget`, or `decision` field, and fallback text is deterministic if ai-service or the LLM is unavailable. Broader coach/orchestrator context injection remains separate and is not claimed by this closure report.

## Known Limitations

- TIME_LOAD catalog entries exist but are STAGING, not PUBLISHED, so user-facing exercise search still does not expose loaded carries.
- No frontend unit-test script exists in `frontend/web`; build is the available project-level frontend check.

## Next P0 Cleanup

No P0 cleanup remains from this closure pass. P1 features should stay separate.
