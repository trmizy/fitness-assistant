# Gymini Cross-System Fitness Journey — Browser E2E Report

Date: 2026-09-10
Harness: `c:\D_Backup\Test\fitnessassistant-playwright-e2e` (external,
real Chromium via Playwright, real dev stack — gateway :3000, web :5173,
fitness :3002, user :3004, ai :3003, real local Ollama). Dedicated
account: `cross.system.client@example.test` (`crossSystemClient`),
zero pre-existing state, never touched by any other spec.

Final full-spec run: `npx tsx prepare-run.ts && npx playwright test
tests/32-cross-system-fitness-journey.spec.ts --workers=1` → run id
`e2e_202609100617307`.

```text
ok 1 TC-XSYS-001 (19.3s)  real onboarding persists all fields
ok 2 TC-XSYS-002 (9.6s)   InBody outranks stale profile weight in wizard prefill
ok 3 TC-XSYS-003 (9.3s)   wizard -> Save DRAFT -> Start ACTIVE, real DB evidence
ok 4 TC-XSYS-004 (8.9s)   real AI workout generation, canonical IDs, equipment-aware, attaches to ACTIVE cycle
ok 5 TC-XSYS-005 (9.9s)   Today surface, real execution, canonical history, real cycle report

[global-teardown] Test verdict: READY (FAIL=0, total=10)
5 passed (1.0m)
```

Same suite, run individually earlier in this phase (before the repeat-
run repeatability fix), also produced a real AI-generation FAILED
attempt (semantic-validation fail-closed rejection) followed by a real
retry that reached COMPLETED — see §33 matrix row 4 below.

## §39/§50 evidence-type legend

- **REAL BROWSER** — real Chromium, real DOM interaction/assertion.
- **REAL HTTP/API** — real HTTP call to a running service, no browser,
  no DB write.
- **TEST FIXTURE** — real Postgres, real service-layer function call
  (never a raw status/date UPDATE for the mutation under test), with
  documented surrounding data seeded directly.

## §33-equivalent target matrix (this phase's own scope)

| Target | Status | Evidence |
|---|---|---|
| Onboarding persists all required fields | **PASS** | REAL BROWSER + REAL HTTP/API (TC-XSYS-001) |
| Roadmap wizard prefill from onboarding + InBody hierarchy | **PASS** | REAL BROWSER + REAL HTTP/API (TC-XSYS-002) — this is the test that caught the P0-1 bug, then confirmed the fix |
| Roadmap Save/Start, exactly 1 phase/1 cycle | **PASS** | REAL BROWSER + REAL HTTP/API (TC-XSYS-003) |
| Real AI workout generation reaches COMPLETED | **PASS** | REAL BROWSER — real Ollama-backed generation, ~210s, `fallbackUsed:false`, `semanticPass:true`. One earlier attempt (different run) reached FAILED via the real fail-closed semantic validator (`exercise_outside_day_candidates`) — a real, correct safety rejection, not a crash; a retry succeeded. |
| Canonical Exercise ID grounding | **PASS** | REAL HTTP/API — all 12 generated exercise ids independently verified against the real catalog (PUBLISHED, real movementPattern/loggingMode) |
| Equipment-aware generation (HOME preference) | **PASS** | REAL HTTP/API — every required-equipment slug on the generated exercises (kettlebell/dumbbell/bodyweight) is a real member of `HOME_EQUIPMENT` |
| WorkoutProgram/Schedule attach to the Roadmap-driven cycle | **PASS** | REAL HTTP/API — DB query confirms every WorkoutSchedule row's `trainingCycleId` matches the Roadmap-activated cycle |
| Today surface (no Roadmap/Phase/Cycle navigation needed) | **PASS** | REAL BROWSER — "Buổi tập sắp tới" shows today's real entry directly on the default tab |
| Workout execution + completion | **PASS** | REAL HTTP/API — real `startSchedule`/`completeScheduleExercise` calls, 100% progress, real Workout row created |
| Canonical exercise history | **PASS** | REAL HTTP/API — 12 real WorkoutSet rows across 4 canonical exercise ids |
| Cycle metrics/report reflects real execution | **PASS** | REAL HTTP/API — `GET /training-cycles/:id/report` returns the real cycle with the just-logged data |
| Real completeCycle → Adaptive Decision Engine → advanceRoadmap | **PASS** | TEST FIXTURE — real Postgres, real service calls; decision=ADJUST, dataQualityScore=0.85 |
| Next-cycle WorkoutSchedule readiness (§29) | **ANSWERED (P2 gap)** | TEST FIXTURE — real next cycle created, 0 WorkoutSchedule rows; see gaps report P2-1 |
| Mobile viewports | **NOT RUN THIS PHASE** | Roadmap/Journey mobile viewports already PASS-verified in the prior Roadmap closure phase (tests/31, TC-ROADMAP-002); this phase's new surfaces (AI plan generation panel, Today's execution flow) were not additionally re-tested at 360/375/390/412 — see gaps report as a documentation note, not a new P-classified gap (no code in this phase touched responsive layout). |

## Not real-browser-tested this phase (honestly marked)

- **Nutrition generation/execution (§20-23)** — NutritionGoal creation
  was verified end-to-end via REAL HTTP/API (the internal bootstrap
  endpoint, called directly after fixing P0-3's connectivity bug) and
  via direct DB inspection (correct `trainingCycleId` linkage,
  `triggeredBy=ONBOARDING`). The AI meal-plan generation UI
  (`CurrentNutritionProgram.tsx`) was not driven through a real browser
  this phase — same class of "real, slow LLM generation" as the workout
  plan, and this session's effort budget went to closing out the
  higher-priority §25-29 cycle-completion chain instead. BACKEND-ONLY
  for the meal-plan-specific UI flow; NutritionGoal itself is REAL
  HTTP/API-proven.
- **REBUILD downstream (§31)** — REBUILD's own Roadmap-internal
  correctness is VERIFIED from the prior closure phase (unchanged,
  re-confirmed by the unmodified regression suite still passing). Its
  downstream workout/nutrition-artifact behavior was not separately
  re-tested this phase; by the same architecture proven in §29 (no
  `trainingCycleId` FK on WorkoutProgram, standing NutritionGoal), it is
  expected to behave identically to a normal advance (P2-1 applies
  equally) — reasoned from the same evidence, not independently proven
  by a dedicated REBUILD-then-check-schedule test.
- **AI-unavailable failure injection (§32)** — observed opportunistically
  (the local Ollama model was genuinely missing at the start of this
  phase, `llmAvailable:false`): the real "Tạo kế hoạch tập luyện bằng AI"
  button stayed disabled (`blockLlmActions`), a clean, correct fail-
  closed UI state, not a crash or partial write. Once the model was
  imported, this natural failure-injection window closed; a deliberate
  ai-service-stop-mid-request test was not additionally run.
