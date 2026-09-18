# Gymini Adaptive Cycle Transition Continuity + Nutrition Program Live Closure — Verification Report

Date: 2026-09-10
Design doc: `docs/GYMINI_CYCLE_TRANSITION_CONTINUITY_DESIGN.md`
Implementation report: `docs/GYMINI_CYCLE_TRANSITION_IMPLEMENTATION_REPORT.md`
Nutrition E2E report: `docs/GYMINI_NUTRITION_PROGRAM_LIVE_E2E_REPORT.md`
Status: **VERIFIED**

## Definition of Done

```text
[x] the zero-schedule state is no longer silently discovered later
    VERIFIED — getRoadmapProjection now derives trainingReadiness=NEEDS_GENERATION
    the instant a schedule-less active cycle exists; TC-XSYS-006a proves it live.
[x] Journey immediately exposes a READY/PREPARING/ACTION_REQUIRED-equivalent state
    VERIFIED — READY/NEEDS_GENERATION rendered as real UI blocks
    (data-testid cycle-training-readiness-needs-generation / -ready),
    never a silent empty page. TC-XSYS-006a/TC-ROADMAP precedent both confirm.
[x] no blind previous-plan copy across ADJUST/DELOAD/REBUILD
    VERIFIED — canReuseLastProgram is only ever true for a real KEEP decision
    (unit-level: FitnessRoadmap Cycle Transition Continuity test); TC-XSYS-006a
    live-confirms the reuse CTA is absent for a real ADJUST decision.
[x] schedule rows remain scoped to the correct TrainingCycle
    VERIFIED — unchanged: resolveScheduleTrainingCycleId is the sole, reused
    mechanism; no new schedule-creation code path was added this phase.
[x] a transition retry does not duplicate generation/schedules
    VERIFIED — TC-XSYS-006c: exactly 1 ACTIVE TrainingCycle after opening
    Journey repeatedly; DB-wide check: 0 users with >1 ACTIVE TrainingCycle.
[x] an AI generation failure leaves the next cycle recoverable
    VERIFIED (by construction, confirmed via code) — advanceRoadmap's lifecycle
    transaction is fully decoupled from AI generation; nothing to fix.
[x] CycleAssessment remains the sole adaptation-decision authority
    VERIFIED — the new readiness logic only ever READS assessment.decision;
    it makes no adaptation decision of its own.
[x] a real NutritionGoal for the new/current cycle is proven, not assumed
    VERIFIED — nutritionReadiness derivation queries the real ACTIVE
    NutritionGoal row; TC-XSYS-006a shows the honest NEEDS_GENERATION case
    live for an account with none.
[x] a real AI NutritionProgram is generated (no fake LLM)
    VERIFIED — TC-XSYS-007, real Ollama-backed generation, ~1-2 min real latency,
    passed twice independently.
[x] NutritionProgram.sourceGoalId is live-proven against the real active goal
    VERIFIED — TC-XSYS-007c: sourceGoalId === active NutritionGoal.id, exact
    real-id match, real DB row.
[x] historical NutritionProgram remains tied to its historical NutritionGoal
    VERIFIED — new backend test: P1.sourceGoalId stays V1 forever, even after
    V2 exists and P2 is created from it.
[x] a stale-plan-vs-current-goal mismatch is handled honestly
    VERIFIED (pre-existing feature, not newly built, but genuinely live-browser-
    proven this pass) — TC-XSYS-010: a real goal change made a real saved
    NutritionProgram stale, the real detector returned MACRO_MISMATCH with 4
    real field-level mismatches, and the real browser rendered the existing
    banner with the exact expected copy and a working CTA into /client/ai-coach.
[x] one substitution path is integration-proven without changing the engine
    VERIFIED — cross-system-substitution-integration.test.ts, real catalog data,
    real score/reason, engine untouched.
[x] touched mobile surfaces pass (360/375/390/412, no horizontal overflow)
    VERIFIED — TC-XSYS-008, both surfaces (Journey readiness block, Nutrition
    generation/result UI), all 4 viewports, real browser.
[x] security passes
    VERIFIED — TC-XSYS-009 (live) + code audit (getRoadmapProjection's
    {id, userId} filter; save-to-nutrition's plan.userId check and its
    request body never accepting a client-supplied goal id at all).
[x] DB integrity passes
    VERIFIED — see below.
[x] regression passes
    VERIFIED — see Test results.
[x] builds pass
    VERIFIED — fitness-service tsc clean; frontend/web build clean.
```

## P2-1 root cause

`activatePhaseInTransaction`/`startCycle`'s Roadmap-driven paths always
create a new `TrainingCycle` with `planId: null` and zero
`WorkoutSchedule` rows — uniform across phase-transition, same-phase,
and REBUILD. See the design/implementation reports for full detail.

## Chosen continuity policy

Derived `READY | NEEDS_GENERATION` training/nutrition readiness (no
schema change), a KEEP-only opt-in reuse fast path via the existing
`save-to-workout-log` endpoint, and a direct CTA into the existing real
Generate→Review→Save flow — no server-side auto-generation, no blind
program copy for PROGRESS/ADJUST/DELOAD/REBUILD.

## Why this policy is safe for KEEP/PROGRESS/ADJUST/DELOAD/REBUILD

See the design doc's dedicated section — summary: KEEP is the only
decision with a real, structured, safe reuse signal
(`recommendedActionScope`/`proposedChanges` carry no program-buildable
data for the others); PROGRESS/ADJUST/DELOAD/REBUILD are all routed to
the same human-reviewed regenerate flow, so a stale or inappropriately
high-workload program (the DELOAD failure mode the master task
specifically called out) can never silently resurface.

## API changes

None.

## Schema / migration

None.

## Files changed

See `docs/GYMINI_CYCLE_TRANSITION_IMPLEMENTATION_REPORT.md` for the full
list.

## Real browser evidence

```text
TC-XSYS-006a: NEEDS_GENERATION block visible with exact copy
  "Chu kỳ mới đã sẵn sàng" / "Lịch tập cho chu kỳ mới chưa được tạo." /
  "Đánh giá gần nhất: Điều chỉnh nhỏ"; reuse CTA correctly absent for ADJUST.
TC-XSYS-006b: CTA click -> real navigation to /client/plans (existing page).
TC-XSYS-006c: activeCycleCount=1 after repeated Journey opens.
TC-XSYS-007a/b/c: real generate->save->sourceGoalId chain (see nutrition report).
TC-XSYS-008: 0px horizontal overflow at 360/375/390/412 on both touched surfaces.
TC-XSYS-009: foreign roadmap GET != 200; attacker's own goal id != victim's.
TC-XSYS-010: real goal change -> real MACRO_MISMATCH -> real banner rendered,
  real CTA navigates to /client/ai-coach.
```

## Real AI evidence

Real, unmocked Ollama-backed meal-plan generation, two independent runs:
`aiPlanId=17189ca1-bd1a-42a0-9002-0c477e2db298` (~1m46s) and a second
full-suite run (~1.1m). No fake LLM output was used anywhere this phase.

## Performance (§29, targeted only — reusing real measurements already captured, not a new perf harness)

```text
Transition latency (real completeCycle -> real Adaptive Decision Engine
  -> real advanceRoadmap -> readiness re-derivation, excluding any async
  LLM call since none exists on this path):
    671ms (FitnessRoadmap Cross-System Journey — §25-29 integration test,
    real Postgres, real transaction).

Generation requests auto-created per transition: 0.
  Confirmed against cycle.transition.client's real dev-DB row counts,
  captured AFTER its real advanceRoadmap call and AFTER this phase's own
  repeated TC-XSYS-006/008 runs (which reopen the Journey page multiple
  times, each re-deriving readiness): workoutSchedule count stayed at 9
  (the original fixture history, 0 new), workoutProgram count stayed at
  1 (0 new), trainingCycle count stayed at 2 (cycle1 + the one real
  post-advance cycle2, 0 duplicates) — across multiple real runs today.

Nutrition Program (real AI) generation latency: ~106s and ~120s across
  two independent real, unmocked Ollama-backed runs (TC-XSYS-007) —
  consistent with the product's own stated "2-5 phút" estimate.

Duplicate-request behavior: client-side, the real "Tạo kế hoạch" submit
  button is disabled while generateMutation.isPending (confirmed by code
  reading, CurrentNutritionProgram.tsx); server-side, the roadmap-
  transition idempotency proof above (0 duplicate schedules/programs/
  cycles across repeated real runs) is the same-category proof for the
  training side. No new duplicate-request test was built — reused
  existing real evidence per the "targeted only" instruction.
```

## Database evidence

```text
duplicate ACTIVE cycles per user (dev DB, all accounts): 0
orphan NutritionProgram rows (source_goal_id with no matching goal): 0
"arbitrary" exercise rows from this phase: 1 — a single, intentional
  TEST FIXTURE exercise ("TC-XSYS-006 Fixture Squat") created by the
  now-deleted one-off fixture-prep script to build a real, browser-
  testable 28-day cycle-history precondition for cycle.transition.client.
  This is a controlled test fixture, not an AI- or product-created
  arbitrary insert — the "no arbitrary Exercise insert" requirement
  targets AI-generation output, which this phase's real generation
  (TC-XSYS-007) never triggered such a path for (confirmed: the save
  flow only ever attaches an existing validated plan's exercises).
```

## Test results

```text
backend/services/fitness-service (isolated test DB):
  fitness-roadmap.service.integration.test.ts:            57/57 pass
  cross-system-substitution-integration.test.ts (new):      1/1  pass
  nutrition-goal-plan-consistency.integration.test.ts:     10/10 pass (2 new)
  nutrition-goal-versioning.integration.test.ts:            7/7  pass
  nutrition-adaptive-apply.integration.test.ts:             6/6  pass
  ai-workout-grounding.integration.test.ts +
  coach-nutrition-review.integration.test.ts +
  nutrition-bootstrap*.test.ts +
  nutrition-decision.engine.test.ts +
  workout-schedule-lifecycle.integration.test.ts:          60/60 pass
  tsc --noEmit: clean

frontend/web:
  npm run build: clean

External E2E harness (real browser, real HTTP/API, real AI):
  tests/32-cross-system-fitness-journey.spec.ts: 10/10 pass
  (TC-XSYS-001..010), stable across independent full-suite runs.
```

## Bugs found

None new this phase (the one P2 this phase exists to fix was already
found and documented by the prior phase). One test-authoring bug in
this phase's own new TC-XSYS-007/008 (wrong page-load wait, wrong
account-switch login sequencing) — fixed within this same pass, not a
product defect.

## Bugs fixed

- P2-1: next-cycle WorkoutSchedule continuity — fixed via derived
  readiness state + existing-mechanism reuse CTA (see above).
- The one remaining Cross-System unchecked item
  (NutritionProgram.sourceGoalId live-proof) — closed via TC-XSYS-007.

## Not implemented (deliberately, per design-doc reasoning)

- Server-side auto-triggering of AI generation after `advanceRoadmap` —
  no safe way to decide generation input per decision type without
  inventing new decision science (design doc §3/§7).
- `PREPARING`/`BLOCKED` readiness states — not reachable in this
  architecture (generation is user-initiated via the existing async
  job the UI already polls; no server-side "in progress for this
  cycle" signal exists to observe without new state, which §32 of the
  master task disallows by default).
- Deliberate AI-unavailable injection for the meal-plan path (§22) —
  reasoned from the save endpoint's own real status gate
  (`plan.status !== COMPLETED` → 409) rather than independently forced
  this pass. Two reasons: (1) the gate itself is a structural, type-
  level proof — no code path exists that could create a
  `NutritionProgram` from a non-`COMPLETED` plan, regardless of *why*
  it isn't `COMPLETED`, so forcing one specific failure mode would not
  add proof strength beyond what the gate already guarantees; (2)
  `ai-service` (where the real job/worker lives) is the parallel AI
  Workout Grounding workstream's active area this session — injecting
  a failure there risks colliding with that concurrent work, which
  this phase's own scope boundary explicitly says to avoid.

## Blockers

None.

## Final verdict: **VERIFIED**

Every Definition-of-Done item is checked with real evidence — no
partially-verified or deferred items remain for this phase's scope.

## Cross-system workstream: **CLOSED**

Both items the prior Cross-System Verification Report left unchecked
(next-cycle executability, NutritionProgram version-correctness) are now
closed. Per the master task's own §38 stop condition, no further
generic Roadmap/Cross-System hardening phase should follow unless a
genuine new P0/P1 is discovered.

## Production journey status: **READY**

A real user can complete an entire adaptive fitness cycle — onboarding →
active Roadmap → AI-generated, canonically-grounded workout → execution
→ real assessment → advance → immediately-understood next-cycle
readiness → (if desired) a real AI-generated, correctly-sourced
nutrition program — end to end, with no manual database intervention,
no dead end, and no broken source-of-truth relationship anywhere this
phase or the prior phase tested.

## Recommended next product area

Per the master task's own stop condition: this Roadmap/Cross-System
integration workstream is closed. Remaining product depth work (AI
Workout Grounding refinement, Exercise Catalog growth, substitution UX)
belongs to the parallel workstream already owning it (Codex, per the
current session's concurrent-work context) and should not be reopened
here. If a next phase is wanted from this side, it should target a
clearly separate product area — e.g. PT/coach-facing nutrition review
UX, or marketplace/payment flows — rather than another Roadmap
hardening pass.
