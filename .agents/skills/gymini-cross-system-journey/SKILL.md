---
name: gymini-cross-system-journey
description: Bugs or features that cross more than one Gymini service/domain in the client's fitness journey (onboarding through nutrition through cycle assessment). Load for any task spanning Roadmap+Workout, Workout+Nutrition, PT+Client, or any "test the whole flow" request.
---

# Gymini Cross-System Journey

## The canonical client journey

```
Onboarding
  -> Profile/InBody
  -> (Diagnosis)
  -> Roadmap -> RoadmapPhase -> TrainingCycle
  -> AI/Manual Workout -> canonical Exercise IDs -> WorkoutProgram -> WorkoutSchedule
  -> execution (real logged sets)
  -> NutritionGoal -> NutritionProgram
  -> measurement (InBody)
  -> CycleAssessment
  -> advance/rebuild
  -> next-cycle readiness (trainingReadiness/nutritionReadiness)
  -> updated forecast
```

The PT-coaching overlay reads/writes into this same graph through a
real, per-request `Contract.status === ACTIVE` gate — see
`gymini-account-session-isolation` for why "PT never supplies their own
context" (equipment, identity) is a hard rule, and
`gymini-domain-source-of-truth` for what each node above actually owns.

## For every cross-system task, trace explicitly

1. **Producer** — which real service/function creates this data.
2. **API** — the actual route + request/response shape (read the
   controller, not just the frontend call site).
3. **Owner model** — per `gymini-domain-source-of-truth`.
4. **Consumer(s)** — every place that reads it; are they all reading the
   SAME thing, or has a second computation crept in somewhere?
5. **Foreign IDs** — does a row on one side of the join reference the
   right id on the other (e.g. `WorkoutSchedule.trainingCycleId` must
   match the row's TRUE owning cycle, not just "the current active
   one" computed some other way)?
6. **Authorization** — for a cross-role read (PT reading client data),
   confirm the real relationship check runs fresh, per request.
7. **Idempotency** — does retrying/double-clicking/refreshing duplicate
   a generation job, a schedule, an ACTIVE row?
8. **Failure recovery** — if an async step (AI generation, a webhook)
   fails, does the upstream lifecycle (Roadmap advance, Contract
   activation) stay valid and recoverable, or does it get stuck/corrupt?

## Do not call individually-green subsystems proof of cross-system correctness

A passing `fitness-roadmap.service.integration.test.ts` and a passing
`nutrition-goal-plan-consistency.integration.test.ts` do NOT prove the
Roadmap-driven cycle's `NutritionGoal` is actually the one being used —
that requires an explicit trace/test of the join between them. See
`docs/GYMINI_CROSS_SYSTEM_VERIFICATION_REPORT.md` and
`docs/GYMINI_CYCLE_TRANSITION_VERIFICATION_REPORT.md` for the actual
cross-system identity chains that were live-proven (real userId ->
roadmapId -> cycleId -> nutritionGoalId, etc.) — reuse that evidence
pattern for any new cross-system claim.

## PT-specific cross-system notes

- A PT's own equipment/context must never be used — every PT-facing
  mutation (`coachService.createAndAssignPlan`, etc.) is always keyed by
  `clientUserId`, never by the PT's own profile.
- A PT can **recommend** (create a DRAFT the client must accept) or
  **assign** (an immediate-effect action, e.g. workout assignment,
  nutrition-recommendation modify) — these have different real
  semantics; don't assume one implies the other. See
  `docs/GYMINI_PT_PERMISSION_MATRIX.md`'s "PT RECOMMENDS vs PT ASSIGNS
  vs CLIENT ACCEPTS" section for the exact current contract.
- Contract-gated E2E testability: real payment cannot be automated
  unattended (no MOCK provider exists, deliberately). The established
  pattern is a REAL SERVICE FIXTURE — drive the real request → accept →
  pay HTTP chain, then complete settlement with a correctly-*signed*
  forged gateway callback (same technique
  `fitnessassistant-playwright-e2e/fixtures/paymentSecrets.ts` and
  `ptContractFixture.ts` already use) — never a direct `Contract` DB
  write, never a disabled auth check. See `gymini-real-e2e-verification`
  for the evidence-label discipline this requires.

## Definition of correct behavior

A real end-to-end identity chain (PT -> Contract -> Client -> Roadmap ->
Phase -> Cycle -> Workout -> Nutrition -> Assessment) can be produced and
verified with real IDs from a real run — not asserted from reading
several independently-passing unit suites.

## Common failure modes

- Assuming a green backend suite for service A plus a green suite for
  service B implies the join between them works.
- A new cross-system read re-deriving something instead of calling the
  existing authoritative projection (see `gymini-domain-source-of-truth`).
- Skipping the idempotency/failure-recovery trace because "the happy
  path works."

See `references/client-journey.md` for the current real API/route list
for each step of the chain.
