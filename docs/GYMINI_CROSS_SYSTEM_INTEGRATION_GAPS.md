# Gymini Cross-System Integration Gaps

Date: 2026-09-10
Scope: every integration gap found while driving a real dedicated user
(`cross.system.client@example.test`) through Onboarding → Roadmap →
Workout → Nutrition → CycleAssessment → Advance. P0/P1 fixed in this
phase; P2 documented, one exception justified below; P3 documented only.

## P0 — journey cannot continue / corrupt state / security

### P0-1. Guided Roadmap Wizard never received onboarding data (FIXED)

`GuidedRoadmapWizard.tsx`'s profile query read
`profileService.getProfile()`'s raw `{profile: {...}}` envelope without
unwrapping it (`OnboardingWizardPage.tsx` unwraps correctly one file
over — `.then(r => r.profile)` — this wizard didn't). Every
`p.age`/`p.gender`/`p.heightCm`/`p.currentWeight` check silently
evaluated `undefined` forever. **This broke the entire §6 "onboarding
context reaches Roadmap" requirement for every user, permanently** —
100% reproducible, not edge-case.

Fix: unwrap `.then((r) => r.profile)`, matching the existing correct
convention. Verified live: TC-XSYS-002 (real browser) — age/gender from
onboarding profile and weight/bodyFat from a real InBody entry (which
correctly outranks the stale profile weight) all appear pre-filled.

### P0-2. Manual InBody entry crashed with a raw 500 (FIXED)

`inbody.service.ts:createEntry` derives `bodyFat` from
`weight × bodyFatPct/100` when missing, with a clean 400 fallback — but
had no equivalent handling for `muscleMass`, a **non-nullable** DB
column the manual-entry form (both `InBodyModule.tsx` and this phase's
own API-level testing) presents as optional. A real user submitting
weight + body-fat and leaving "Cơ bắp (kg)" blank got an uncaught
`PrismaClientValidationError` → raw 500, matching the exact class of bug
the file's own comment says was already fixed once for `bodyFat`
("found live via TC-AI-001... reject with a real 400, not a raw 500").

Fix: same pattern — reject with a clean, actionable 400
("Cần nhập Cơ bắp (kg)") when `muscleMass` is missing/NaN. Verified with
direct HTTP calls: 400 without it, 200 with it.

### P0-3. `user-service` could never reach `fitness-service` in dev compose (FIXED)

`fitness-service.client.ts`'s `resolveFitnessServiceUrl()` falls back to
`http://localhost:3002` whenever `FITNESS_SERVICE_URL` is unset and
`NODE_ENV !== "production"`. Inside the `gymcoach-user-dev` container,
`localhost` is the container itself — `docker-compose.dev.yml`'s
`user-service` block never set `FITNESS_SERVICE_URL` (unlike
`api-gateway`/`ai-service`, which do). Every call through this client —
`bootstrapNutritionSafe` (onboarding → initial NutritionGoal) and
`triggerInBodyReassessmentSafe` (new InBody → cycle reassessment check)
— failed with `ECONNREFUSED`, silently (both are explicitly
best-effort/non-blocking, so profile saves and InBody entries still
"succeeded" with no visible error). Same class of gap as the
already-documented `PAYMENT_SERVICE_URL`/`GYM_SERVICE_URL` fixes in the
same file.

Fix: added `FITNESS_SERVICE_URL: http://fitness-service:3002` to
`user-service`'s compose block. Verified: direct container-to-container
fetch now succeeds; the real internal bootstrap endpoint, called
end-to-end, creates a real, correctly `trainingCycleId`-linked
NutritionGoal (§20 confirmed connected).

## P1 — major business flow broken

None found beyond the three P0 items above, which are severe enough to
be classified P0 (silent, 100%-reproducible breakage of core cross-
system connections) rather than P1.

## P2 — important UX/data inconsistency (documented, not fixed this phase)

### P2-1. WorkoutSchedule does not automatically carry into the next TrainingCycle

**The central §29 question, answered with real evidence** (dedicated
integration test, `fitness-roadmap.service.integration.test.ts`
"Cross-System Journey — §25-29", real Postgres, real
`completeCycle`/`advanceRoadmap` service calls):

```text
real ADJUST decision, dataQualityScore=0.85
real next TrainingCycle created (cycle2Id populated)
cycle2's real WorkoutSchedule count = 0
```

Also confirmed live via the real AI-plan-save flow (TC-XSYS-004): a
generated plan's schedule window (Sep 11 – Oct 7) sat entirely inside
cycle 1's own span (Sep 10 – Oct 10), never reaching cycle 2 (starts Oct
10). `WorkoutProgram` has no `trainingCycleId`; only the individual
`WorkoutSchedule` rows generated for it do, and generation is a bounded,
one-time, user-chosen window (`durationWeeks`/`repeatWeeks`), not an
ongoing subscription. This is a real, reproducible architectural gap.

**Why P2, not P0/P1** ("blocking cross-system defect" per §29's own
framing): the product does **not** leave the user at a silent dead end.
`WorkoutLogPage.tsx`'s real empty state — directly observed this session
via a real browser DOM snapshot — is:

```text
"Bạn chưa có lịch tập hiện tại" (You have no current schedule)
[Tạo thủ công] [Tạo bằng AI]
```

The same 2-click Generate → Save flow already proven working in TC-
XSYS-004 is immediately available. A real user hitting cycle 2 sees a
clear, actionable prompt, not a blank/broken page. This downgrades the
severity from "dead end" to "no automatic continuity, real manual step
required, already guided by an existing UI."

**Not fixed this phase** — auto-extending or auto-regenerating a
schedule across a Roadmap advance is a real feature addition (deciding
how many weeks to extend, whether to reuse the same days/exercises or
re-run AI generation, etc.), not a "smallest necessary correction," and
risks exactly the kind of scope expansion §48 explicitly prohibits.
**Recommended follow-up** (not implemented): either (a) have
`advanceRoadmap`'s response include a `nextCycleHasNoSchedule: boolean`
flag the frontend can use to proactively prompt "Tạo lịch tập cho chu kỳ
mới" right after advance, or (b) extend `createManualProgram`/
`importAiPlanToSchedule`'s `repeatWeeks` default to the roadmap phase's
own remaining duration when a Roadmap is active. Both are small,
targeted, and out of this phase's scope.

### P2-2. Goal-mismatch banner is a real, working consistency check (NO ISSUE — documented for completeness)

Directly observed: `WorkoutLogPage.tsx` shows "Lịch tập chưa đồng bộ với
mục tiêu mới / Mục tiêu hồ sơ của bạn đã đổi sang Giảm mỡ, nhưng lịch
tập hiện tại vẫn là Giảm mỡ tăng cơ" when `UserProfile.goal` and the
active `WorkoutProgram.goal` diverge (real in this session: onboarding
goal was WEIGHT_LOSS, the AI plan's free-text goal was "Giảm mỡ tăng
cơ"). This is a real, working, non-blocking cross-system consistency
check — noted here only because it was directly observed, not because
it's a defect.

## P3 — minor (documented only)

### P3-1. `assess-cycle` AI-explanation call logs "Invalid URL" in a test-only context

Observed in the §25-29 integration test: `completeCycle`'s unified path
calls `assessCycleSafe` (the AI-generated natural-language explanation
of the deterministic decision) and it fails with "Invalid URL" because
`AI_SERVICE_URL` isn't set/mocked in this specific test's environment.
This is fail-soft by design (the deterministic decision itself — ADJUST
— was computed and persisted correctly regardless); the log line is
test-environment noise, not a product defect, and out of scope to chase
further (AI-service mocking for this specific test file wasn't
previously established, and adding it is not required to answer §25-29's
real question).

### P3-2. `assessment-ready` notification push fails in the test/dev environment

`getaddrinfo ENOTFOUND chat-service` observed in the same test —
`training-cycle.service.ts`'s best-effort notification push to
chat-service isn't reachable from the isolated test DB context. Fail-
soft by design, does not affect the real decision/advance flow, out of
scope (chat-service notification delivery is not part of this phase's
integration boundary).
