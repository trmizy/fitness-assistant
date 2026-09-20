# AI Coach Product Capability Expansion — Completion Summary

Date: 2026-09-18. Summarizes the "GYMINI — AI COACH PRODUCT CAPABILITY
EXPANSION" task: standalone `CREATE_WORKOUT_PLAN` and
`CREATE_NUTRITION_PLAN` chat capabilities, built on the Conversational
Workflow Foundation (signed off CRITICAL 0/HIGH 0/MEDIUM 0 in
`docs/conversational-ai-coach-safety-closure.md`). Detailed audits/
designs/evaluations live in the four `standalone-{workout,nutrition}-
workflow-{audit,design,evaluation}.md` docs — this file is the
cross-cutting summary plus the roadmap-integration/PT decisions.

## 1. What was built

- `CREATE_WORKOUT_PLAN` — generates a fresh, structured workout draft
  (reusing `recommendation_engine.ts` + real exercise-catalog resolution,
  never persisting a raw exercise name), previews it as
  `WORKOUT_PLAN_PREVIEW`, supports 6 distinct conversational revision
  types, and persists via the existing `importAiPlanToSchedule` boundary
  on explicit confirm.
- `CREATE_NUTRITION_PLAN` — queues the SAME real async nutrition
  generation job the REST wizard uses, tracks its GENERATING/PREVIEW/
  FAILED lifecycle across chat turns via the `FitnessAgentAction` payload
  (no orchestrator change), previews it as `NUTRITION_PLAN_PREVIEW`,
  supports 5 distinct conversational revision types (routed through the
  real `restrictions` field, working around a disclosed pre-existing bug
  in the REST wizard's own `notes`-based adjust path), and persists via
  the existing `/nutrition/from-ai-plan` boundary.

Both are strictly ADDITIVE: 3 new files, 6 modified files in ai-service,
2 modified files in frontend/web. Zero lines changed in
`agent-workflow/orchestrator.ts`, `types.ts`, or any previously
signed-off workflow file (`roadmap.workflow.ts`,
`find-pt-program.workflow.ts`).

## 2. Roadmap-integration — confirmed non-breaking

`CREATE_PLAN_BUNDLE`'s existing roadmap→workout→nutrition bundled flow
(`proposePlanBundle`/`execute()`'s `CREATE_PLAN_BUNDLE` branch) is
untouched — it still calls `applyTrainingPlan`/`bootstrapNutrition`
directly, with no dependency on either new workflow. `CREATE_WORKOUT_PLAN`
and `CREATE_NUTRITION_PLAN` never create a `TrainingCycle`/`NutritionGoal`/
`RoadmapPhase` themselves — `importAiPlanToSchedule` (`allowCreate:
false` internally) and `/nutrition/from-ai-plan` are the SAME real
authoritative-write functions the bundled flow already trusts. Verified
via the cross-workflow test (`agent-workflow-cross-domain.test.ts`) that
triggering either standalone capability reuses the same
`EnterpriseContext` the roadmap flow populates, without re-deriving or
duplicating any roadmap-owned state.

## 3. PT — no production changes made

Per the explicit constraint, PT search→hire was NOT reopened, and no new
`HIRE_PT` `WorkflowDefinition` was created. The only PT-adjacent finding
from running the full cross-domain scenario was confirming (not fixing —
nothing needed fixing) that `FIND_PT`'s existing `sessionMinutes`
(`required: false`) and `budgetVnd` slots continue to resolve correctly
from shared `EnterpriseContext` when reached via a workflow-switch from a
pending `CREATE_WORKOUT_PLAN` (see `agent-workflow-cross-domain.test.ts`'s
switch test). No real missing-data gap was found in the PT flow while
running this scenario, so — per the explicit instruction — no PT
production changes were made.

## 4. Test evidence (aggregate)

| Suite | Result |
|---|---|
| `agent-workflow-create-workout-plan.test.ts` (new) | 5/5 |
| `agent-workflow-create-nutrition-plan.test.ts` (new) | 3/3 |
| `agent-workflow-cross-domain.test.ts` (new) | 2/2 |
| `agent-workflow-roadmap-e2e.test.ts` | 6/6 (unchanged) |
| `agent-workflow-remediation-1.test.ts` | 11/11 (unchanged) |
| `agent-workflow-remediation-2.test.ts` | 11/11 (unchanged) |
| `agent-workflow-program-e2e.test.ts` | 1/1 (unchanged) |
| `agent-workflow-security-e2e.test.ts` | 3/3 (unchanged) |
| **Total (run together)** | **40/40** |

`npx tsc --noEmit -p .` (ai-service): clean. `npm run build`
(frontend/web): clean, `FitnessAgentBlocks` chunk includes both new block
renderers.

Per the task's explicit §50 instruction, no new Codex hardening-cycle
evaluator was generated in this pass — this document and the per-domain
evaluation docs are the evidence for the ONE independent product E2E
evaluation to follow separately.

## 5. Real, disclosed gaps (not fixed — documented per scope-control)

1. **REST nutrition wizard's `adjust` endpoint silently drops the user's
   adjustment text** (`notes` param has no field in
   `NutritionPlanJobDataSchema`) — see
   `standalone-nutrition-workflow-audit.md` §3. Pre-existing, unrelated to
   chat, not touched.
2. **No reusable injury/experience-level safety validator for
   AI-GENERATED workout plans** (only exists for template SELECTION) —
   see `standalone-workout-workflow-audit.md` §3. Handled with an honest
   visible warning, not a fabricated hard gate.
3. **No durable home for dietary restrictions/preferences** in Gymini's
   product schema — see `standalone-nutrition-workflow-audit.md` §5.
   Kept workflow-local by design; a real schema decision is needed to make
   this durable across sessions.
4. **`intentRouter.ts`'s `inferMuscleGroup` is not diacritic-aware**
   (unlike its own routing regex) — worked around locally in the workout
   revision loop by normalizing input before that one call; the
   underlying module itself was not modified (owned by a concurrent
   Codex workstream per `gymini-ai-workout-grounding`).

## 6. Mobile/UI verification status

Both new preview blocks reuse the SAME primitives (`<details>`, the
shared `button`/`RiskBadge` styles) already used by `PT_RECOMMENDATIONS`/
`ACTION_CONFIRMATION` elsewhere in `FitnessAgentBlocks.tsx`. `npm run
build` confirms compilation; no live REAL BROWSER check at
360/375/390/412px was performed in this pass — flagged honestly rather
than claimed.

## 7. Supervisor scenario verdict

See the final Vietnamese report ("GYMINI — AI COACH PRODUCT CAPABILITY
EXPANSION REPORT") for the itemized YES/PARTIAL/NO verdict per domain
(ROADMAP/STANDALONE WORKOUT/PT SEARCH/PT HIRE/STANDALONE NUTRITION) with
executed evidence.

## 8. Addendum 2026-09-19 — Product remediation #1 supersedes parts of this summary

Codex's independent product E2E (`codex-ai-coach-product-e2e-evaluation-1.md`, RETURN TO CLAUDE: M7/L1) found defects this summary's "YES" verdicts and "40/40" did not reveal. All are closed in `ai-coach-product-remediation-1.md`. Corrections to statements above:

- §1/§4 "40/40 + aggregate evidence": those tests stubbed the boundary where the defects lived. Current evidence: agent-workflow suites 63/63, `nutrition-food-exclusion.test.ts` 7/7 (real processor), fitness-service target resolution 4/4 + bootstrap 6/6 (isolated test DB), M7 real-DB domain verify PASS, unchanged Codex v2 foundation evaluator 30/30.
- §1 nutrition: the meal plan now uses the AUTHORITATIVE target (ACTIVE NutritionGoal, else the deterministic bootstrap prescription via read-only `GET /nutrition/target-preview`); food exclusions are ENFORCED in the processor's food pool, not prompt-only; opening-message constraints survive slot collection.
- §1 workout: preview weekdays == persisted `WorkoutSchedule` weekdays (`selectedWeekdays`), exclusion phrases work, the injury warning reads the real field. Generated workouts still only WARN — they do NOT have FIND_TRAINING_PROGRAM's hard eligibility gate.
- §5 gap 1 (REST adjust drops `notes`) is unchanged and still out of scope. §5 gap 3 (no durable dietary preference home) is unchanged; enforced exclusions live only in the draft action's payload.
- Pending drafts are now routed deterministically (`routePendingDraftTurn`); "Để sau" was replaced by a truthful server-side "Bỏ qua bản này" on the two previews.
- Still open / unverified: live BullMQ + Ollama nutrition run (configured provider refused connections — ENVIRONMENT LIMITATION), authenticated real-browser journey, the L1 click flow in a real browser.

## 9. Addendum 2026-09-19 (final remediation)

After Codex's final recheck three MEDIUM defects were closed (accumulating nutrition constraints, compound unsupported exclusions, CANCELLED terminal). Evidence: 103/103 workflow+exclusion+parser tests, foundation evaluator 30/30, fitness-service target/bootstrap 20/20, focused PT/Program v2/memory/claims 175/175, builds clean. The "265/269" figure quoted in the remediation-1 report is withdrawn (not reproduced; the equipment integration suite is environment-blocked). Still open: live BullMQ/Ollama nutrition run, authenticated browser journey; generated workouts remain warning-only vs template eligibility. See `ai-coach-product-final-remediation.md`.

## Addendum 2026-09-19 (finalization race closure)

Codex's core sign-off found one race: concurrent confirm and dismiss of the same action could both report success. Fixed at the `FitnessAgentAction` lifecycle: confirm claims `PENDING -> EXECUTING` and dismiss claims `PENDING -> CANCELLED`, each one conditional UPDATE, so exactly one wins and the loser answers truthfully; a business failure after the claim returns the action to `PENDING` (no fake COMPLETED); a stale claim (>2 min) is reclaimable, safe through downstream idempotency. No schema migration (`status` is a free string). See `ai-coach-finalization-race-closure.md`.
