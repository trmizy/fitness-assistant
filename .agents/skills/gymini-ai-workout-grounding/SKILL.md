---
name: gymini-ai-workout-grounding
description: AI-generated workout plans, Exercise identity, equipment validation, or exercise substitution in Gymini. Load when touching AI plan generation, the Exercise catalog, WorkoutProgramExercise persistence, or the substitution engine.
---

# Gymini AI Workout Grounding

**This domain is actively owned by a parallel workstream (Codex).**
Read `gymini-parallel-agent-safety` first if Canonical Exercise
Identity / AI Workout Grounding / Exercise Catalog / Equipment /
Substitution is the current concurrent focus — treat it read-only
unless a tiny, documented compatibility fix is genuinely required.

## Invariant

`Exercise.id` is the only canonical persisted identity. The AI is a
**draft producer only** — fitness-service is the final persistence
authority.

## Never

- Auto-create an `Exercise` row from arbitrary LLM text.
- Use a fuzzy/matched name as the actual persistence identity.
- Silently fall back to a name-match when an explicit id is invalid,
  instead of rejecting.
- Allow a foreign user's `USER_CUSTOM` exercise to be referenced by
  someone else.
- Allow a `STAGING`/archived/non-`PUBLISHED` exercise into a real plan.

## Required pipeline (already implemented — reuse, don't reinvent)

```
bounded candidate allowlist (a real, capped, shuffled catalog sample)
  -> AI generation
  -> schema validation
  -> canonical-ID validation (validateExerciseIds / exerciseReferenceResolver)
  -> equipment validation (validateAiPlanExerciseEquipment) -- AI path ONLY
  -> substitution if a legitimate candidate exists
  -> persistence
```

**Known, real, current asymmetry** (found 2026-09-10, not yet a decided
product question): `workoutService.createManualProgram` — the function
BOTH the client's own self-service manual builder AND
`coachService.createAndAssignPlan` (PT) call — validates only existence/
ownership (`validateExerciseIds`), never equipment
(`validateAiPlanExerciseEquipment` exists only on the AI-generation
path). A manually-assigned exercise the client has no equipment for is
currently accepted, not rejected. This is symmetric across client and PT
paths (not a PT-specific bug) — see
`docs/GYMINI_PT_COACHING_INTEGRATION_GAPS.md` #10. Do not "fix" this
without a real product decision (should a human's deliberate manual pick
ever be equipment-gated the way unsupervised AI generation is?) — it's
not obviously a bug, and changing `createManualProgram` changes shared
behavior the client's own flow also relies on.

## Substitution

`exerciseSubstitutionService.rankSubstitutes(exerciseId,
ownedEquipmentIds, {limit})` — pure, deterministic, real
movement-pattern/muscle-overlap scoring. This is the SAME function the
product's own "Đổi bài tập" (swap exercise) UI calls during workout
execution (`WorkoutLogPage.tsx`'s `SwapExerciseModal`). Reuse it for any
new equipment-mismatch handling — never build a second substitution
implementation, and never modify this engine without a proven bug (a
real integration test showing wrong output), since it's Codex's owned
domain.

## Do not

- Merge normalized duplicate exercise names automatically (a real,
  separate catalog-hygiene decision, not something to fold into an
  unrelated task).
- Build a second AI-plan validation pipeline for a new caller (PT,
  coach, agent, etc.) — every new caller of "create a plan" should
  route through the existing `createManualProgram`/`generatePlanDraft`
  functions, adding only the auth-gate/audit-row wrapper it needs (see
  `coach.service.ts` for the established pattern).

## Definition of correct behavior

Every `Exercise.id` that ends up in a persisted `WorkoutProgramExercise`
row resolves to a real, `PUBLISHED` (or the caller's own `USER_CUSTOM`)
catalog row — verifiable by a direct DB join, not just "the AI said so."

## Common failure modes

- Treating the AI's returned exercise NAME as identity instead of the id
  it's supposed to carry.
- Assuming equipment validation runs on a path it doesn't (see the
  asymmetry above) — verify empirically (a real request with a real
  mismatched exercise) rather than assuming from the AI-generation
  path's behavior.
- Building a parallel substitution/scoring function instead of calling
  the existing `exerciseSubstitutionService`.
