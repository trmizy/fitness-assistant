# CODEX - AI COACH PRODUCT FINAL RECHECK

Date: 2026-09-19. Reviewed HEAD `96c1040f` plus the uncommitted Product Remediation #1 worktree. Code and executed observations take precedence over remediation claims. No foundation redesign was evaluated or requested.

## Decision

**RETURN TO CLAUDE**

Current findings: **CRITICAL 0 / HIGH 0 / MEDIUM 3 / LOW 0**.

M3-M7 close in this focused check. M1 and M2 retain reachable restriction-loss cases. L1's original misleading label is fixed, but the new cancellation is not enforced at confirmation.

Production files modified by Codex: **NONE**. Added this report and isolated probes/results under `test/codex-ai-coach-product-final-recheck/`. The unchanged foundation evaluator refreshed its existing generated JSON result. Existing production changes, unrelated work, and the previous report were preserved.

## Previous baseline

CRITICAL: 0

HIGH: 0

MEDIUM: 7

LOW: 1

Baseline: `codex-ai-coach-product-e2e-evaluation-1.md`. Read the remediation report, standalone workout/nutrition designs and evaluations, capability completion report, and target architecture/meeting-summary updates. Inspected status, diffs, and the latest 20 commits. This report supersedes claims that all findings are closed, not the signed-off architecture.

## M1

**PARTIAL / MEDIUM REMAINS.** The ordinary two-turn opening restriction -> meals answer is fixed. The existing suite proves fish survives and supported additions merge rather than replace. Revision merging also passes.

Independent real-action/workflow-DB reproduction:

1. `Tạo thực đơn, tôi không ăn cá.` -> asks only meals per day; known constraints contain fish.
2. `À tôi cũng không ăn thịt bò.` -> the action dispatcher returns no handled response; the pending workflow still lacks meals per day.
3. `4 bữa` -> queues a plan with `mealsPerDay=4`, `excludedFoodKeys=["fish"]`. Beef is absent.

This is reachable with the current single required slot: a user can supply an additional restriction before answering the question. It does not require inventing another required field. General-chat fallback on turn 2 does not repair the subsequently observed queue payload.

Cause: the product models an accumulating set as an already-known optional slot (`create-nutrition-plan.workflow.ts:40`); the existing orchestrator ignores extracted keys already in `known` (`orchestrator.ts:146`). `proposeNutritionPlan` merges only saved constraints and the FINAL message (`fitness-agent.service.ts:1559`). Correct the product's constraint accumulation without reopening foundation architecture.

## M2

**PARTIAL / MEDIUM REMAINS.** The deterministic food-pool defect is fixed for recognized constraints: real processor tests pass fish exclusion, a meaningful fish-present control, peanut/egg exclusions, eggplant token distinction, unknown canonical-key failure, and model target override resistance.

However, `Tạo thực đơn 4 bữa, tôi không ăn cá và không ăn cay.` queues successfully, says fish was excluded, and sends only `restrictions=["không ăn cá"]`. The unsupported spicy-food constraint is silently discarded. A standalone unsupported spicy-food request correctly refuses; combining it with a supported first item bypasses that behavior.

Cause: `nutrition-food-constraints.ts:151` records unsupported items only when `idx === 0`. The subsequent item is neither enforced nor retained for an honest unsupported response. This is a current product parser defect, not a request to expand the supported ontology.

Additional independent chain: actual `processNutritionPlanJob` -> real action polling/preview -> confirmation captured the SAME weekly schedule, 1800 kcal target and zero fish. Controlled food/model/plan-repository boundaries are explicit in `probes.ts`; this was not a live BullMQ run. The captured payload was then imported through real fitness-service persistence on the isolated test database after creating its synthetic catalog foods. Initial import without those fixtures correctly rejected unknown IDs. The successful retry preserved target/goal linkage.

## M3

**CLOSED within tested scope.** ACTIVE goal priority, deterministic no-goal prescription, missing-data refusal, explicit target forwarding, model override resistance, stale numeric target rejection, and content hash protection pass.

The exact 75 kg / 170 cm / 28 / female / moderately active / beginner / weight-loss fixture yields **1992 kcal, P128/C246/F55**, matching bootstrap. Missing profile data creates no plan and tells the user to update their profile and retry; it does not pretend to enter a new slot-collection flow.

Real isolated nutrition import of the reviewed 1800 kcal payload produced an 1800 kcal NutritionProgram with `sourceGoalId` equal to the existing goal, with one unchanged goal. All 84 reviewed food items retained their day, meal type, food ID, quantity and unit; zero fish items persisted. Content mutation rejection uses the existing repository test seam, not an invented public endpoint.

## M4

**CLOSED.** Current action routing passes nutrition-generating -> PT -> certificate follow-up without nutrition interception; explicit nutrition polling returns to the pending nutrition action. Breakfast/20-minute cooking edits select nutrition rather than workout duration; legs-lighter selects workout; ambiguous edits with multiple previews ask which draft. Later recommendations/non-draft actions displace an old draft for implicit routing.

`routePendingDraftTurn` operates on pending `FitnessAgentAction` rows, separate from the signed-off `AgentWorkflowSession` invariant. No architecture change is required.

## M5

**CLOSED.** The real extracted `profile.training.injuries` shape produces a warning and retains it after revision. Beginner generated-workout disclosure passes. This verifies honest warnings, not clinical suitability or template-style contraindication filtering.

## M6

**CLOSED.** Current tests remove/substitute all cable matches, both Deadlift and Romanian Deadlift, persist draft exclusions through regeneration/day-count changes, and retry or drop substitutes that remain excluded. Revision remains draft-only. Real catalog identity enforcement is retained at the authoritative import boundary; fixture IDs in chat tests are explicitly stubs, not evidence of real catalog membership.

## M7

**CLOSED.** Chat tests prove context Monday/Wednesday/Friday selection, explicit Tuesday/Thursday/Saturday revision, Sunday conversion, selectedWeekdays forwarding and confirmation idempotence.

Re-ran `test/ai-coach-product-remediation-1/domain-verify.ts` against real fitness DB rows under a unique synthetic user, cleaned afterward. With a Friday start, the no-weekday control produced Friday/Saturday/Sunday. Passing `[1,3,5]` produced only Monday/Wednesday/Friday, beginning Friday under next-date semantics. `[1,0]` preserved Sunday as zero. Tuesday/Thursday/Saturday was checked at the chat/import-argument boundary, not repeated as a separate real-DB journey.

Explicit context days are preferred only when appropriate to the requested count. A count alone is not represented as user-selected weekdays: engine/default spread remains a proposed schedule displayed for review.

## L1

**Original LOW label defect closed; new MEDIUM cancellation defect remains.** Preview dismissal is owner-scoped, writes CANCELLED, displays `Đã bỏ qua`, and excludes the action from later routing. Generic confirmation defer truthfully says `Đã để sau — chưa thực hiện gì`; local-only deferral is accepted scope.

Independent reproduction: create workout preview -> `dismissDraft` -> DB status CANCELLED -> `execute(identity, sameActionId, true)` -> import invoked once -> DB status COMPLETED, reply claims saved.

`fitness-agent.service.ts:703` checks owner, completed and expiry, but does not reject CANCELLED before execution. A previous preview card remains a valid confirmation source in another tab or an earlier revision card; dismissal state is local per component (`FitnessAgentBlocks.tsx:54`). The same authenticated confirm route remains reachable until expiry. This is not cross-user access or an unconfirmed write, but it defeats terminal dismissal of the draft. The common execute guard also applies to nutrition.

## Nutrition target source-of-truth

`CREATE_NUTRITION_PLAN` -> `getNutritionTargetPreview` -> fitness `resolveNutritionTargetForUser` -> ACTIVE NutritionGoal, else shared `assembleBootstrapInput` + `computeInitialNutritionPrescription`. Bootstrap itself calls the same assembly/engine (`nutrition-onboarding-bootstrap.service.ts:206`, `:233`). No second target formula was introduced in ai-service.

The chat snapshots rounded numeric targets and supplies explicit calories/macros to generation and revisions. Confirmation re-resolves numeric targets; `sameTarget` compares numbers, not goal identity. Real import links the goal active at import time. An equal-valued replacement goal is therefore not rejected merely for having a different ID. The tested unchanged ACTIVE goal retains its identity and values.

No-goal resolution is read-only. Standalone import intentionally need not create a NutritionGoal/cycle: the existing import writes a NutritionProgram with null `sourceGoalId` when none is active. That persistence behavior was proven in the previous evaluation and the relevant import code remains unchanged; this pass re-executed computed-target resolution, not a second complete no-goal provider journey.

## Nutrition constraint enforcement

Recognized exclusions are canonical keys, filtered before model selection/deterministic expansion and checked after generation, before preview and before save. Failed constraints do not produce an accepted preview. Revised exclusions merge and reach replacement jobs. Preview/confirm do not regenerate content.

End-to-end restriction semantics are nevertheless not signed off because extraction/carry can drop constraints before this enforcement boundary (M1/M2). Passing downstream checks cannot recover a key never forwarded.

## Pending action routing

Explicit domain cues take precedence; multiple matching domains clarify; absent cues use recency subject to displacement. GENERATING nutrition only consumes relevant poll/revision messages. CANCELLED actions are excluded from routing. Routing is correct in the focused cases; cancelled-action EXECUTION is the separate L1 finding.

## Workout preview/save fidelity

The draft's canonical exercise schedule, session structure and selectedWeekdays are passed to the established import. Real DB weekday verification passes. Replacement disclosure remains visible in preview and is not reopened as a finding. The authoritative import still supports no-cycle schedules with null `trainingCycleId`; no new cycle feature is required. Previous real no-cycle/replacement evidence remains applicable because that fitness import implementation was not changed.

## Workout safety scope

Generated workouts are warning-only for injuries/experience; template recommendations retain their hard eligibility filtering. Neither passing catalog IDs nor warning text establishes medical suitability. This accepted limitation is not counted as a defect.

## Nutrition safety scope

Existing deterministic invariants remain active. The independent chain initially failed `fat_target_mismatch` with an inadequate fixture catalog; adding a declared non-fish fat source allowed completion, without relaxing the invariant. Model output attempting 200 kcal did not override the authoritative target. Supported exclusions are lexical catalog constraints, not a clinical allergy certification. Soft preferences remain best-effort and full-plan regeneration is not targeted single-meal editing.

## Live provider

**ENVIRONMENT LIMITATION.** Fresh `llmService.getHealthStatus(2000)` reported configured Ollama unavailable: `ECONNREFUSED 127.0.0.1:11435`. No production model configuration changed. No live provider/BullMQ completion claimed. This is not a medium finding.

## Browser E2E

**INFO / NOT EXECUTED.** No active frontend listener on the checked local frontend ports and no established authenticated browser session for this pass. Current component/route behavior was audited and production build passed. No authenticated click-through or screenshot claim is made. Previous fixture component QA is not substituted for an authenticated journey.

## Foundation regression

Unchanged Codex conversational-workflow-v2 evaluator: **30/30 PASS**. Includes roadmap workflow/provenance/revalidation and PT search-to-contract confirmation seams. Foundation remains SIGNED OFF. Output: `foundation.txt` and the evaluator's existing result JSON.

## Workflow regression

All current `agent-workflow-*.test.ts`: **63/63 PASS**, run twice in this pass. Combined with processor suite: **70/70**, zero skips/failures. These use real AI action/workflow rows with declared external stubs. Output: `workflow-processor.txt`.

## Processor regression

`nutrition-food-exclusion.test.ts`: **7/7 PASS**. Additional independent real-processor -> preview -> confirm schedule equality passes. This does not negate upstream M1/M2 failures.

## Fitness target regression

On `gymcoach_fitness_test` (derived from local fitness connection without printing credentials): target-resolution integration **4/4**, onboarding-bootstrap integration **6/6**, bootstrap engine **10/10**. **20/20**, zero skips. Random users cleaned by tests. Output: `fitness-target.txt`. Separate actual NutritionProgram persistence passes in `nutrition-domain.txt`.

## PT regression

Focused PT search/hire confirmation path in unchanged v2 evaluator passes. Cross-workflow PT switching and certificate-follow-up routing pass. No PT ranking redesign or live paid contract transaction was attempted.

## Program v2 regression

Focused training-program scoring v1/v2 and recommendation/program claim suites pass as part of the **87/87** scoring/claims/memory run. Existing program workflow test also passes. Output: `focused-regressions.txt`.

## Memory regression

Memory extraction/policy and provenance cases pass in the 87-test run and unchanged foundation evaluator. Both nutrition slots have `WORKFLOW_ONLY` persistence; product constraints stay in workflow/action payloads and generation parameters. No new UserMemory/UserProfile write was added for dietary restrictions. Cross-session dietary persistence remains explicitly unsupported.

## Builds

- ai-service `npm run build`: PASS.
- fitness-service `npm run build`: PASS.
- frontend/web Vite production build: PASS (6122 modules; completed).
- The frontend command resolved the root recursive build, so the remaining workspace builds also ran and finished successfully. No production source edits were made for builds.
- `git diff --check`: PASS.

Equipment integration suite: attempted, but not a passing regression. Its live harness requires NODE_ENV=test and isolated DBs at localhost:55433 (`plan-generation-equipment.integration.test.ts:69`). This environment did not provide that listener; the run also repeatedly failed Redis localhost:6379 and was interrupted after failed cases rather than left running. Focused offline regressions were rerun separately and passed. **Environment uncertainty**, not a proven pre-existing failure: no runnable pre-remediation baseline was established, and the reported 265/269 claim was not independently reproduced as a complete run. Do not count this as an additional product defect or silently call it pre-existing.

## Remaining findings

CRITICAL: **0**

HIGH: **0**

MEDIUM: **3**

1. **M1: intermediate dietary restriction is lost.** Repro and queue evidence above. Product accumulation must retain fish AND beef while meals remains pending. References: `create-nutrition-plan.workflow.ts:40`, `fitness-agent.service.ts:1559`, existing `agent-workflow/orchestrator.ts:146` contract.
2. **M2: unsupported later list item silently disappears.** Supported fish + unsupported spicy-food clause queues fish-only without refusal. Reference: `nutrition-food-constraints.ts:151`. Every declared exclusion needs either canonical enforcement or explicit unsupported handling.
3. **L1 follow-on: cancelled drafts remain executable.** CANCELLED -> confirm -> real import boundary called -> COMPLETED. Reference: `fitness-agent.service.ts:703` and `:1738`. Reject terminal cancellation before any business tool, including stale cards and repeated requests; preserve completed-action idempotence.

LOW: **0** independently counted.

INFO: configured provider unavailable; authenticated browser journey not run; equipment harness environment uncertainty; warning-only generated workout safety; local-only dietary preferences; full-plan rather than targeted meal regeneration. None determines the return decision.

## Capability matrix

| Capability | Status |
|---|---|
| ROADMAP | SIGNED OFF |
| ROADMAP REVISION | SIGNED OFF |
| STANDALONE WORKOUT | PARTIAL |
| WORKOUT REVISION | SIGNED OFF |
| FIND_TRAINING_PROGRAM | SIGNED OFF |
| PT SEARCH | SIGNED OFF |
| PT HIRE | SIGNED OFF |
| STANDALONE NUTRITION | PARTIAL |
| NUTRITION REVISION | PARTIAL |

Workout partial refers to terminal dismissal, not preview/weekdays/exclusion fixes. Nutrition partial refers to constraint continuity/parsing plus the shared cancellation guard. Signed-off entries retain their previously accepted scope; they are not fresh deployment certifications.

## Original supervisor scenario

| Scenario | Verdict |
|---|---|
| Tạo lộ trình | YES |
| Tạo lịch tập | PARTIAL |
| Tìm PT | YES |
| Thuê PT | YES |
| Tạo kế hoạch dinh dưỡng | PARTIAL |

## Is Gymini now an end-to-end conversational AI Coach for the target scenario?

**PARTIAL.** Most requested product paths now have working deterministic boundaries, but a stated dietary constraint can still disappear and a dismissed draft can still execute.

## Next step

Return only the three reachable defects above for targeted remediation and regression tests. Preserve the signed-off foundation and current M3-M7 fixes. Add regression cases for three-turn accumulation, unsupported non-first exclusions, and confirmation after cancellation (workout and nutrition). Recheck those cases before product sign-off. Provider, authenticated browser, deployment/CI/demo verification follow; their current absence is not the reason for RETURN TO CLAUDE.
