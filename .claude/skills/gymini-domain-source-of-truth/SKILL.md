---
name: gymini-domain-source-of-truth
description: Which model owns which piece of Gymini's fitness/nutrition domain data. Load before adding any new field, calculation, or cross-service read that touches profile, InBody, Roadmap, TrainingCycle, Workout, Nutrition, Assessment, or Forecast data.
---

# Gymini Domain Source of Truth

## Before adding a field or calculation, ask: who owns this value?

See `CLAUDE.md`'s source-of-truth table for the short version;
`references/domain-ownership.md` here for the detailed matrix
(read/write paths, real examples of past violations that were fixed).

## The three concrete rules that have been violated before (and were fixed)

- **RoadmapPhase must NOT become authoritative for calories/macros.**
  `NutritionGoal` is the only authoritative source; a phase may
  *reference* provenance (`NutritionGoal.trainingCycleId` records which
  cycle's assessment produced a version — provenance only, never a
  consumption-scoping filter) but must never store its own competing
  calorie/macro number that the UI reads instead of the real goal.
- **Forecast weight must NOT overwrite an actual measurement.**
  `fitness-roadmap-forecast.engine.ts`'s output is a scenario, always
  labeled as such; a real InBody entry is always the truth for "what did
  they actually weigh."
- **NutritionProgram must NOT replace NutritionGoal macros.** A meal
  plan's own `dailyCaloriesTarget`/macros are what the PLAN targets —
  the client's authoritative prescription stays on `NutritionGoal`,
  compared against the plan via `nutrition-goal-plan-consistency.
  service.ts`, never silently superseded by whatever the plan says.
- **AI response must NOT become Exercise identity authority.** See
  `gymini-ai-workout-grounding` — `Exercise.id` is the only identity;
  an LLM's output is a draft that must be validated against the real
  catalog before persistence, never trusted as-is.
- **CycleAssessment remains adaptation-decision authority.** A PT or any
  other UI convenience must never set KEEP/PROGRESS/ADJUST/DELOAD/
  REBUILD directly unless a real, existing, controlled override
  workflow already exists for that exact action — check
  `training-cycle.service.ts`'s `ptReviewNutritionRecommendation`-style
  functions for the pattern of what a legitimate, audited override looks
  like before assuming a shortcut is fine.

## Checklist before adding a new field/calculation

1. Read the owner model's schema (`prisma/schema.prisma` in the owning
   service) — does an authoritative field already exist?
2. Read every writer path (grep for `.update(` / `.create(` on that
   model) — is there already a real write path you're about to
   duplicate?
3. Read every consumer (grep for reads of that field) — will a new
   parallel field silently diverge from what other surfaces already
   trust?
4. Explicitly check for a duplicate calculation already computed
   elsewhere (a second BMR/TDEE formula, a second consistency checker,
   a second readiness deriver) before writing a new one.
5. Detect duplicated persistence — if the value can be **derived** from
   existing rows (a projection/computed field), prefer that over a new
   column/table. Gymini's own precedent: `trainingReadiness`/
   `nutritionReadiness` on `getRoadmapProjection` are fully derived, no
   schema change, specifically because a schema-change alternative was
   considered and rejected as unnecessary.

## Definition of correct behavior

Any two surfaces reading "the same" value (e.g. "current calories") read
it from the exact same underlying row/service call, or from services
that are provably kept in sync by a real, tested mechanism — never from
two independently-computed numbers that can silently drift.

## Common failure modes

- A new UI surface (e.g. a PT-facing card) recomputing something the
  client-facing engine already computes, instead of calling that same
  service.
- Treating a provenance field (like `NutritionGoal.trainingCycleId`) as
  if it were a consumption-scoping filter — check every actual `WHERE`
  clause before assuming what a field is "for."
- Adding a new schema column/table for something a projection could
  express — see `gymini-scope-control`'s "no schema change by default"
  norm.
