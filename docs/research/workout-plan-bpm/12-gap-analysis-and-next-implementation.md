# 12 — Gap Analysis and Next Implementation

Classification only. No implementation performed in this phase. Priority is relative ordering, not a calendar
estimate.

## ALREADY VERIFIED

(Reused from the just-closed X4 work, directly applicable to this BPM's own confirmation/HITL/isolation
requirements — `10-traceability-matrix.md` FR16/FR19/FR20/FR21/FR22.)

- Draft confirmation requires a real, explicit action, never a text phrase (FR16).
- Idempotent confirmation-boundary status reporting, including under adversarial multi-row history (FR19, FR22,
  the X4-T10 fix).
- Cross-user/cross-session isolation at the confirmation boundary (FR20).
- Honest, truthful draft dismissal (FR21).

## MUST IMPLEMENT FOR BPM (production code gaps)

Priority 1 — directly affects whether a persisted plan can ever be unusable for the user:

1. **Equipment-aware draft generation** (closes FR09/EX03/AC25). Today, `generateWorkoutDraft` does not filter or
   re-rank candidate exercises by the user's own `UserEquipment`/profile equipment before showing the preview —
   only the **confirm-time** validator (`validateAiPlanExerciseEquipment`) can catch an unusable plan, and only at
   the last possible moment (a rejected confirm, not a better first draft). Proposed fix: thread the user's
   equipment into the existing deterministic `recommendationEngine`/exercise-selection step, reusing the equipment
   model already read for the confirm-time check — not inventing a second equipment representation.
2. **Structured context contract as an actual type** (closes the design/implementation gap noted in
   `07-context-model.md`). Currently the same information is split across `EnterpriseContext.profile` and
   `AgentWorkflowSession.slotsJson`; unifying it (even just as an internal, non-persisted TypeScript type used for
   logging/evaluation) would make the Qwen3 4B evaluation (`11`) directly comparable turn-by-turn against a single
   shape, rather than reconstructed post hoc from two sources.

Priority 2:

3. A `trainingLocation` field, if the equipment-at-draft-time fix above needs it as a distinct signal (home vs.
   gym availability sometimes implies different equipment sets even with the same `UserEquipment` rows) — assess
   necessity after item 1 is scoped in detail; do not build speculatively.

## MUST TEST FOR BPM (no production-code change; new/extended tests only)

Priority 1 (closes the weakest rows in `10-traceability-matrix.md`):

1. Equipment-rejection integration test for `validateAiPlanExerciseEquipment` specifically (AC17/AC28/EX06) — the
   existing `ai-workout-grounding.integration.test.ts` only covers the exercise-ID half, not the equipment half.
2. Empty-generation honesty test (AC29/EX07) — assert no `WORKOUT_PLAN_PREVIEW` block and no misleading
   `FitnessAgentAction` row when the generator yields nothing.
3. Downstream-persistence-failure-at-confirm test (AC38/EX16) — simulate `importAiPlanToSchedule` throwing, assert
   the action's status returns to `PENDING`, not stuck `EXECUTING`.
4. Double-confirm-HTTP-call test asserting exactly one `WorkoutProgram` row at the ai-service↔fitness-service
   boundary specifically for `CREATE_WORKOUT_PLAN` (AC19/AC36/FR19) — the current strong evidence for idempotency
   is at the confirmation-boundary **answer** level; a direct row-count assertion across the real HTTP boundary
   for this specific action kind has not been found.
5. A `daysPerWeek`-specific correction test (AC05/AC26) — the correction mechanism is proven for goal/target
   (`live-golden.mjs`), not yet for this workflow's own slots.
6. A CREATE_WORKOUT_PLAN-specific interruption/resume test (AC31/AC32/FR15) — the mechanism is proven generically,
   not against this workflow by name.
7. Qwen3 4B evaluation execution itself (`11-qwen3-4b-evaluation-plan.md`) — dataset construction, labeling,
   Baseline A/B runs, metrics report. This is the single largest remaining item and should be scheduled as its own
   phase, after supervisor approval of the dataset design.

## OPTIONAL PRODUCT FEATURE (valuable, but not required to close this BPM's research scope)

- Hard (not just soft-warning) injury/experience-level filtering for AI-generated drafts, matching what template
  selection already does (`fitness-agent.service.ts:183-188`'s own documented asymmetry). Real, worth fixing
  eventually; not blocking this BPM's thesis-level claims, which already disclose it as advisory-only.
- A unified `trainingLocation` concept beyond raw equipment (see Priority 2 above).
- Expanding the revision loop's vocabulary (e.g. actual superset support) — explicitly declined by the BPM's own
  honest-rejection requirement (FR14/EX18); building it is a product decision, not a research-scope requirement.

## OUT OF RESEARCH SCOPE (per `00-scope-and-research-question.md`)

Nutrition plan generation, food substitution, PT search/hiring, payment, subscription, VLM/image goal analysis,
generic health diagnosis, Qwen3 30B evaluation, fine-tuning, reopening X1–X3 remediation, broad "autonomous fitness
agent" claims.
