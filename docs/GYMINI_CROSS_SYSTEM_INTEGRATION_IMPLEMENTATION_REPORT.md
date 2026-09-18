# Gymini Cross-System Fitness Journey Integration — Implementation Report

Date: 2026-09-10
Scope: implements the fixes named in
`docs/GYMINI_CROSS_SYSTEM_INTEGRATION_GAPS.md`. See
`docs/GYMINI_CROSS_SYSTEM_FITNESS_JOURNEY_AUDIT.md` for the pre-fix map
and `docs/GYMINI_PRE_INTEGRATION_FAILURE_TRIAGE.md` for the pre-flight
failure triage. No new forecasting model, no wizard/lifecycle redesign,
no new top-level page. Canonical Exercise Identity / AI Workout
Grounding / Exercise Catalog / MovementPattern / equipment-aware
selection / exercise substitution: read-only, zero edits.

## Fixes implemented (P0-1/P0-2/P0-3 from the gaps report)

### 1. `frontend/web/src/app/pages/client/GuidedRoadmapWizard.tsx`

`profileQuery`'s `queryFn` changed from `profileService.getProfile`
(raw `{profile}` envelope) to `() =>
profileService.getProfile().then((r: any) => r.profile)`, matching
`OnboardingWizardPage.tsx`'s own correct convention. This is the entire
fix — the prefill `useEffect` itself was already correct, it just never
received a usable object.

### 2. `backend/services/user-service/src/services/inbody.service.ts`

`createEntry` — added a `muscleMass` presence/NaN check mirroring the
existing `bodyFat` check two lines above, throwing a clean
`400 "Cần nhập Cơ bắp (kg)"` instead of letting the non-nullable-column
Prisma write crash with a raw 500. `updateEntry` (BR-06 partial-edit
path) was audited and is unaffected — it uses Prisma's real partial
`update`, not `upsert`'s `create` branch, so a missing `muscleMass`
there is already a legitimate no-op, not a bug.

### 3. `infra/compose/docker-compose.dev.yml`

Added `FITNESS_SERVICE_URL: http://fitness-service:3002` to the
`user-service` block's environment, matching the existing
`PAYMENT_SERVICE_URL`/`GYM_SERVICE_URL` pattern already documented there
for the identical class of bug. Container recreated
(`docker compose up -d user-service`) and the new env var confirmed
present; direct container-to-container `fetch` confirmed working.

## Test infrastructure added

### 4. `backend/services/auth-service/prisma/seed.ts` + harness `fixtures/auth.ts`

Added a new dedicated seed account, `crossSystemClient`
(`cross.system.client@example.test`), upsert-based like every other
dedicated account in this file — zero pre-existing profile/InBody/
roadmap/workout/nutrition state, never touched by any other spec.
Registered in the external harness's `SEED_ACCOUNTS`.

### 5. `frontend/web/src/app/pages/client/OnboardingWizardPage.tsx`

Added 5 `data-testid` attributes (`onboarding-age`, `onboarding-gender`,
`onboarding-height-cm`, `onboarding-current-weight`,
`onboarding-target-weight`) to the body-metrics step's inputs — this
step's `<label>` elements are siblings, not wrappers, of their inputs
(no `htmlFor`/`id` pairing), so `getByLabel` cannot reach them; this
matches the file's own pre-existing `data-testid="activity-level-..."`
convention for the same step. Pure test-enablement, zero behavior
change.

### 6. `tests/32-cross-system-fitness-journey.spec.ts` (new, external harness)

5 tests covering §6-19 with real browser + real HTTP/API evidence:
TC-XSYS-001 (real onboarding wizard persistence), TC-XSYS-002 (InBody
outranks profile weight in the Roadmap wizard prefill — this is the
test that caught fix #1), TC-XSYS-003 (wizard → Save DRAFT → Start
ACTIVE with real DB evidence), TC-XSYS-004 (real AI workout generation,
canonical exercise-ID grounding, equipment-aware validation, real
WorkoutProgram/WorkoutSchedule attached to the Roadmap-driven
TrainingCycle), TC-XSYS-005 (Today surface, real workout execution,
canonical-exercise history, real cycle-metrics/report trace). See the
E2E report for full run evidence.

### 7. `backend/services/fitness-service/src/__tests__/fitness-roadmap.service.integration.test.ts`

One new integration test, "Cross-System Journey — §25-29", answering
the master task's own "CRITICAL" §29 question with real evidence: real
`completeCycle` → real deterministic Adaptive Decision Engine (ADJUST,
dataQualityScore=0.85) → real `advanceRoadmap` → next TrainingCycle's
real WorkoutSchedule count (0, documented as P2-1 in the gaps report).
A 28-day-old cycle cannot be produced through a live browser/API run in
one session; the cycle's `startDate` is set via the real,
product-supported `plannedStartAt` parameter (not a raw status/date
UPDATE), and surrounding execution history is seeded directly — TEST
FIXTURE tier, matching the exact precedent already established by
`month-cycle-simulation.integration.test.ts`'s own `seedMonthCycle`
helper — while `completeCycle`/`advanceRoadmap` themselves are the real,
unmodified service functions.

## Environment repair (not app code, needed to test AI Workout Grounding at all)

The local Ollama instance was missing the fine-tuned model
`fitness-coach-qwen2.5-1.5b:q4_K_M` the AI plan-generation path requires
(`llmAvailable: false`). Its GGUF export already existed on disk
(`training/outputs/gguf-export/`) from a prior training run; imported it
into the running `gymcoach-ollama` container via `ollama create ...
--quantize q4_K_M` (worked around a known Windows Docker Desktop `docker
cp` large-file pipe issue by retrying, per this session's own prior
troubleshooting precedent). No product code changed by this step —
without it, Gap D-equivalent AI Workout Grounding verification (§10-13)
would have been BACKEND-ONLY/blocked rather than REAL BROWSER-proven.

## Bugs found and fixed

1. Guided Roadmap Wizard profile prefill — completely broken for every
   user (P0-1).
2. Manual InBody entry — raw 500 on a plausible, form-permitted omission
   (P0-2).
3. `user-service` → `fitness-service` unreachable in dev compose,
   silently breaking onboarding's NutritionGoal bootstrap and InBody
   reassessment triggers (P0-3).

## Bugs found and NOT fixed (documented, justified)

- WorkoutSchedule does not survive a Roadmap advance into the next
  cycle (P2-1) — real gap, but the existing empty-state UI already
  prevents a dead end; fixing it properly is a feature addition outside
  this phase's "smallest necessary correction" mandate.

## Files changed

```text
frontend/web/src/app/pages/client/GuidedRoadmapWizard.tsx
frontend/web/src/app/pages/client/OnboardingWizardPage.tsx
backend/services/user-service/src/services/inbody.service.ts
infra/compose/docker-compose.dev.yml
backend/services/auth-service/prisma/seed.ts
backend/services/fitness-service/src/__tests__/fitness-roadmap.service.integration.test.ts
docs/GYMINI_PRE_INTEGRATION_FAILURE_TRIAGE.md (new)
docs/GYMINI_CROSS_SYSTEM_FITNESS_JOURNEY_AUDIT.md (new)
docs/GYMINI_CROSS_SYSTEM_INTEGRATION_GAPS.md (new)
docs/GYMINI_CROSS_SYSTEM_INTEGRATION_IMPLEMENTATION_REPORT.md (new, this file)

c:\D_Backup\Test\fitnessassistant-playwright-e2e\fixtures\auth.ts (external harness)
c:\D_Backup\Test\fitnessassistant-playwright-e2e\tests\32-cross-system-fitness-journey.spec.ts (external harness, new)
```

No schema/migration changes. No API contract changes (no new/changed
endpoints — every fix is a client-side unwrap bug, a validation
message, an env var, or test infrastructure).
