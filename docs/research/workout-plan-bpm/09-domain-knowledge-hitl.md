# 09 — Domain Knowledge and Human-in-the-Loop Design

## Domain knowledge required by this BPM, and where it lives

| Knowledge category | Where it lives | Evidence |
|---|---|---|
| Exercise-to-muscle mapping | Enterprise DB (`Exercise.muscleGroupsActivated`, `bodyPart`) | `prisma/schema.prisma:80-95` |
| Equipment requirements per exercise | Enterprise DB (`ExerciseEquipment` join table, `Equipment` catalog) | `prisma/schema.prisma:173-188` |
| Experience suitability | Partially enterprise DB (`Exercise` has no direct experience-level field today); partially a **deterministic rule** at the template-selection layer only, not yet for AI-generated drafts (named gap) | `fitness-agent.service.ts:199-201` (soft warning text, not a filter) |
| Movement category / pattern | Enterprise DB, free-text/taxonomy-driven (`Exercise.movementPattern`, `type` enum) | `prisma/schema.prisma:86,95` |
| Exercise substitutions | Deterministic rule engine (`exerciseSubstitutionService.rankSubstitutes` — movement-pattern/muscle-overlap scoring), reused by this BPM's revision loop, not reimplemented | `02-as-is-process.md` (revision loop), `gymini-ai-workout-grounding` skill |
| Goal-specific exercise selection | Deterministic rule (`recommendationEngine`'s existing template logic) | `generateWorkoutDraft`, `02-as-is-process.md` |
| Weekly training constraints (day count, weekday labeling) | Deterministic rule (`resolveSelectedWeekdays`, `applyWeekdayLabels`) | `fitness-agent.service.ts` (generation helpers) |
| Session volume constraints (fit within `sessionMinutes`) | Deterministic rule (`trimDayForSessionMinutes`) | `fitness-agent.service.ts:163` |
| Incompatible exercise/equipment combinations | Deterministic rule, enforced at **confirm time** (`validateAiPlanExerciseEquipment`) | `workout.service.ts:541` |
| Natural-language goal/frequency/equipment phrasing | Prompt instruction + deterministic parser fallback (LLM used only when the deterministic parse is genuinely unsure, within an allow-listed schema) | `conversational-intelligence/global/llm-route.ts` |
| Expert-curated exercise metadata/labels | Expert annotation (offline catalog curation — `data/catalog/...` CSV sources, import pipelines) | out-of-band, not part of this BPM's runtime |

No category is assumed to "live inside the LLM" by default — every row above states a concrete, inspectable
location, consistent with the brief's own instruction.

## Human-in-the-Loop: two distinct roles

### User HITL (runtime)

Present throughout the BPM, already implemented:

- **Clarification** — answering a missing-slot question (step 5 in `03-to-be-bpm.md`).
- **Correction** — supplying a replacement value for something already stated (FR05).
- **Draft revision** — free-text edits to the pending preview (FR13).
- **Confirmation** — the one explicit action that triggers persistence (FR16), deliberately not reachable by a
  loosely-matched confirmation **phrase** for this kind of draft.
- **Cancellation** — explicit dismissal (FR21).

### Domain Expert HITL (design-time / knowledge-maintenance)

This BPM's **runtime** does not involve a live domain expert — no step in `03-to-be-bpm.md` pauses for expert
review of an individual user's plan. Domain-expert involvement is **offline**, maintaining the knowledge this BPM
reads at runtime:

- exercise metadata curation and catalog import review (the `STAGING → REVIEW_REQUIRED → APPROVED → PUBLISHED`
  pipeline referenced in `prisma/schema.prisma:117` and the newExerciseImporter/localization importer logs seen in
  this repository's own fitness-service seed output);
- domain labels/taxonomy maintenance (movement pattern, muscle mapping reference CSVs);
- business-rule definition (the deterministic validators themselves — equipment compatibility, session-volume
  rules — are written and reviewed by a developer/domain expert offline, not learned at runtime);
- evaluation-label creation for the Qwen3 4B evaluation dataset (`11-qwen3-4b-evaluation-plan.md`) — a human must
  author the gold labels; this is itself a Domain Expert HITL activity for the **research** phase, distinct from
  the product's runtime BPM.

**Explicit claim boundary**: this document does not claim the product has an online "a human expert reviews every
AI-generated plan before it reaches the user" step — it does not, and nothing here should be read to imply it does.
