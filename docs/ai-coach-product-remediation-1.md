# AI Coach Product Remediation #1

Date: 2026-09-19. Responds to `docs/codex-ai-coach-product-e2e-evaluation-1.md`
(decision RETURN TO CLAUDE: CRITICAL 0 / HIGH 0 / MEDIUM 7 / LOW 1). Scope is
product-capability correctness only — the signed-off foundation
(`orchestrator.ts`, `WorkflowDefinition`/`SlotDefinition`,
`AgentWorkflowSession`, contextual revalidation, PT/Program v2, Claim
Catalogs, memory provenance) is untouched. The Codex report is left as the
independent baseline and was not edited.

## 1. Baseline and what "40/40" hid

The previous pass's 40/40 only proved what Claude had implemented. Codex
found seven product-semantic defects that those tests could not see because
they stubbed the exact boundary where the defect lived (the processor's food
pools, the authoritative target, the import's weekday handling, action
selection across domains). Every finding below was reproduced first, fixed at
the smallest correct layer, and given a regression test that exercises the
real code on that layer.

## 2. M1 — opening dietary restriction lost during slot collection

Root cause: `create-nutrition-plan.workflow.ts` only extracted `mealsPerDay`.
`proposeNutritionPlan` re-derived constraints from the *final* turn's text
(`"4 bữa"`), so a restriction stated in the initiating message never reached
the queue (`restrictions = []`).

Fix: a second, NON-required, `WORKFLOW_ONLY` slot `nutritionConstraints`
(never asked, never persisted to `UserProfile`/`UserMemory`/`NutritionGoal`)
carries a typed `NutritionConstraintSet` (`{exclusions, unsupported, hints}`)
extracted from the initiating message by `extractFromMessage`. On resume,
`proposeNutritionPlan` MERGES `resumeKnownSlots.nutritionConstraints` with the
current turn's extraction (`mergeNutritionConstraints` dedupes; never
replaces). Enforced exclusions dedupe by canonical key and never roll off;
only soft hints are capped (10, newest kept) — the old blanket 20-entry
rolling limit no longer applies to exclusions.

Known limitation (documented in the workflow file): the orchestrator never
overwrites an already-known slot, so with THREE-plus turns a second
constraint stated in a middle turn is dropped if the opening message already
set one; the final turn's text is still merged.

Tests: `agent-workflow-product-remediation-1.test.ts` M1 (two-turn, plus
duplicate restatement -> one exclusion).

## 3. M2 — deterministic expansion reintroduced excluded foods

Root cause: restrictions reached only the LLM prompt. The processor's
protein/carb/fat pools and name lookup never saw them.

Fix (`nutrition-food-constraints.ts`, `nutrition.processor.ts`,
`conversation.service.ts`, `nutrition-plan.schemas.ts`):

- A small, bounded ontology maps a user phrase to a canonical key
  (`fish`, `shellfish`, `seafood`, `peanut`, `treenut`, `beef`, `pork`,
  `chicken`, `egg`, `dairy`, `soy`, `gluten`) and each key to food-NAME
  tokens. The `Food` catalog has no category column (USDA-derived), so the
  name is the only real signal; matching is whole-token (`egg` never matches
  `eggplant`).
- The job carries `excludedFoodKeys`. The processor filters `allowedFoods` at
  the SOURCE, before the LLM prompt list, the deterministic pools, the name
  lookup, and the invariant's `allowedFoodIds` are built — so no later step
  can re-add an excluded food. An unknown key FAILS the job rather than
  silently not enforcing it. A final gate (`findExclusionViolations`) runs
  before the invariant, and `tryPollOrRevise…` re-checks before any preview.
- A phrase that cannot be resolved (e.g. "không ăn cay") is reported as
  UNSUPPORTED and refused with the list of enforceable groups; it is never
  downgraded to a prompt hint. Soft preferences (budget, cuisine, "đổi bữa")
  remain prompt-only hints and the UI says so ("không đảm bảo").
- This is user-declared exclusion enforcement, not a diagnosis or an
  allergy-safety guarantee; the ontology is name-based and intentionally
  small.

Tests: `nutrition-food-exclusion.test.ts` (real `processNutritionPlanJob` +
real invariant; control run proves fish IS pulled in without the exclusion;
fish/peanut/egg; `eggplant`; unknown key fails; prompt-injection cannot
change the supplied target) and M2-chat tests.

## 4. M3 — authoritative nutrition target

Facts established by audit: `computeInitialNutritionPrescription`
(fitness-service `nutrition-bootstrap.engine.ts`) is the deterministic
prescription; `NutritionGoal` is the versioned authority; the processor's
2200 kcal / 30-45-25 values are only defaults when a caller supplies nothing
(the onboarding bootstrap always supplies explicit targets); the chat caller
supplied none. `nutrition-plan-invariant.service.ts` validates
structure/consistency — it is not a TDEE calculator or a profile clamp.

Final source of truth: the user's ACTIVE `NutritionGoal` if one exists, else
the same initial prescription bootstrap computes. New read-only
`GET /nutrition/target-preview` (fitness-service,
`resolveNutritionTargetForUser`) — bootstrap's input assembly was extracted
into `assembleBootstrapInput` and is shared, so the two cannot diverge (no
new formula anywhere). The chat layer:

- resolves the target before every generation AND every revision (fresh) and
  sends `dailyCaloriesTarget/proteinTargetG/carbTargetG/fatTargetG`;
- on `insufficient_data` names the missing profile fields and does NOT
  generate (never a generic prescription);
- shows the target and its source in the preview;
- re-resolves at confirm and fails closed (409) if the target changed since
  the preview (e.g. an accepted cycle adjustment), and refuses to save if the
  plan row's content hash differs from what the user reviewed;
- the LLM proposes food/meal composition only; a model-supplied
  `dailyCaloriesTarget` is ignored (test: 200 -> supplied 1992 kept).

Existing-goal behaviour: the plan is generated against the ACTIVE goal's
numbers, so the saved `NutritionProgram` and the goal agree (the import still
links `sourceGoalId` and does not create/supersede a goal — unchanged
business semantics). The REST wizard (`POST /plans/nutrition/generate` with no
targets) is untouched and still uses the processor defaults; that is a
separate pre-existing surface.

Tests: fitness-service `nutrition-target-resolution.integration.test.ts`
(real DB; the Codex fixture returns 1992/128/246/55; read-only; equals what
bootstrap then persists; active goal wins; insufficient data), plus the
ai-service M3 tests.

## 5. M4 — pending action routing

Root cause: `tryTurn` consulted three "revise" handlers in a fixed order, each
finding "some pending action of my kind", and the nutrition handler consumed
every message while GENERATING.

Fix (`routePendingDraftTurn`, deterministic, no schema change): pending
FitnessAgentActions of kinds `CREATE_PLAN_BUNDLE`/`CREATE_WORKOUT_PLAN`/
`CREATE_NUTRITION_PLAN` are selected as follows (this is separate from the
signed-off one-active-workflow invariant, which is unchanged):

1. Explicit domain cues in the message (accent-insensitive: meals/food words,
   exercise words, roadmap words) pick that domain's newest draft. Strong cues
   for two domains that both have a draft -> ask which; never guess. A weak
   word alone ("20 phút") does not count, so "Đổi bữa sáng, tôi có 20 phút nấu
   ăn" goes to nutrition.
2. No cue: only the most recently touched draft (`payload.lastTouchedAt`, else
   `createdAt` — the table has no `updatedAt`, adding one was unnecessary) is
   eligible, and only if no other task (a PT/program `FitnessRecommendation`
   or a non-draft action) happened after it. So a stale GENERATING action no
   longer swallows an unrelated turn; a deliberate "Thực đơn của tôi xong
   chưa?" still routes back to it.
3. A bare "đổi lại"-style message with >1 domain drafts asks which plan.

Additionally, a GENERATING nutrition action now polls only on poll-shaped
messages, and a real revision during GENERATING re-queues (constraints are no
longer lost while waiting). The roadmap bundle keeps its signed-off "free text
revises the draft" behaviour but now only when it is the current, non-displaced
draft or explicitly cued.

Tests: M4-A..D + rapid-poll + roadmap-displacement (7).

## 6. M5 — injury warning

Root cause: `workoutSafetyWarnings` read `profile.injuries`; the extractor
emits `profile.training.injuries`. Fixed; the warning now says plainly that it
is warning-only ("khác với việc chọn chương trình có sẵn, vốn có bộ lọc chống
chỉ định") and a BEGINNER also gets an honest note that generated plans are not
level-filtered. No medical exclusion engine was invented. CREATE_WORKOUT_PLAN
therefore does NOT have FIND_TRAINING_PROGRAM's eligibility safety: template
selection hard-excludes injured/flagged profiles, contraindicated exercises and
above-level difficulty; generated plans only warn. This remains a documented,
deliberate limitation.

Test: M5 (initial preview and after a revision).

## 7. M6 — exercise/equipment exclusion phrases

Root cause: the carrier-phrase regex listed `khong` before `khong co/muon`, so
`co`/`muon` survived as the keyword; matching was substring in both
directions.

Fix: longest carrier phrases first; whole-token match (every keyword token
must be a token of the exercise name — `deadlift` matches both `Deadlift` and
`Romanian Deadlift`, `cable` every cable exercise); the keyword becomes a
durable exclusion on the draft (`payload.exclusions`) that later substitutions
(a substitute that itself matches is retried up to 4 times, else the exercise
is dropped) and regenerations re-apply. An unrelated phrase that matches
nothing still returns `null` (no fake edit). Equipment ownership is enforced by
the equipment-aware substitution service and, on confirm, by
`importAiPlanToSchedule`'s existing `validateAiPlanExerciseEquipment` (not
re-implemented in ai-service).

Tests: no-cable (with a substitute that first returns another cable move),
no-deadlift, avoid/replace squat, no-match -> null, exclusion survives
regeneration.

## 8. M7 — preview weekdays vs persisted dates

Root cause: the new caller omitted `selectedWeekdays`; the import then lays
program days on consecutive dates from the start date.

Fix: the draft carries `selectedWeekdays` (JS numbering 0=Sunday..6, paired by
index with the program days — exactly what the import expects). Priority: the
user's stated weekdays > their real availability (`context.days`, agent
numbering 1=Mon..7=Sun converted, when its length equals the day count) > the
engine's own "Thứ N" labels > a default spread. Day labels are rewritten to the
chosen weekdays, the preview shows each day's first real date (same
`nextDateForWeekday` rule), a "Tôi tập được thứ 3, 5, 7" revision updates
labels + weekdays (regenerating when the count changes), and `execute()` sends
`selectedWeekdays`. Replacement semantics are unchanged (still disclosed:
"thay lịch chưa hoàn thành hiện tại").

Real-DB proof (`test/ai-coach-product-remediation-1/domain-verify.ts`, real
fitness-service import, start Friday 2026-09-18): WITHOUT `selectedWeekdays` the
first three saved weekdays are Fri/Sat/Sun (the reproduced defect); WITH it
every saved date is Mon/Wed/Fri, each program day's first date equals the
preview's first date, and Sunday (0) works.

## 9. L1 — "Để sau" no longer says "Đã lưu"

Workout/nutrition previews now offer "Bỏ qua bản này", which calls a new
`POST /ai/agent/actions/:id/dismiss` (owner-scoped, only for the two draft
kinds) that really sets the action CANCELLED — the label "Đã bỏ qua" is true and
the draft stops receiving later turns. On generic confirmation cards "Để sau"
stays local-only and now says "Đã để sau — chưa thực hiện gì" without touching
the confirm button. "Đã lưu"/"Đã xác nhận" are only shown after a successful
confirm.

## 10. Verification status (honest)

- BACKEND INTEGRATION (real AI-service DB rows, stubbed HTTP/queue boundaries):
  `agent-workflow-product-remediation-1.test.ts` 23/23; all agent-workflow
  suites 63/63 together.
- Real processor: `nutrition-food-exclusion.test.ts` 7/7.
- Real fitness-service DB (isolated `gymcoach_fitness_test`, migrations
  re-applied): target resolution 4/4 + existing bootstrap 6/6; M7 domain
  verify PASS.
- Regression: unchanged Codex v2 foundation evaluator 30/30; broader relevant
  ai-service set 265/269 — the 4 failures are all in
  `plan-generation-equipment.integration.test.ts` (needs a live fitness-service/
  catalog; environment, not touched by this pass; not proven pre-existing by a
  baseline run).
- Builds: ai-service and fitness-service `tsc --noEmit` clean; frontend build
  clean.
- NOT done: live BullMQ/Ollama nutrition run (configured provider port refused),
  real-browser check of the L1 click flow (no Playwright in this environment),
  authenticated end-to-end supervisor journey.

## 11. Addendum (final remediation)

Codex's final recheck confirmed M3–M7 closed but kept M1, M2 and a new cancelled-action defect open: (1) §2's "known limitation" was actually reachable and is now fixed — nutrition constraints accumulate across every collecting turn (`accumulateNutritionWorkflowConstraints`); (2) §3's "unsupported phrases are refused" only applied to the first clause of a list — every clause is now classified; (3) `execute()` now rejects any non-PENDING action (CANCELLED is terminal). The "265/269" figure in §10 is withdrawn as not independently reproduced (the equipment integration suite needs isolated DBs/Redis and is environment-blocked). Details: `ai-coach-product-final-remediation.md`.
