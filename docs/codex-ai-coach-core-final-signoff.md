# CODEX - AI COACH CORE FINAL SIGN-OFF

Date: 2026-09-19. Scope: final product remediation A-C, requested confirm/dismiss concurrency case D, and focused regressions only. Reviewed HEAD `96c1040f` plus the current uncommitted worktree. No architecture review performed.

## Decision

**RETURN TO CLAUDE**

**CRITICAL 0 / HIGH 0 / MEDIUM 1 / LOW 0.**

The previous three sequential defects are closed. The specifically requested concurrent confirm/dismiss case produces contradictory successful replies for both workout and nutrition. This is the sole reason for returning; environment limitations do not affect the decision.

Production files modified by Codex: **NONE**. Added this report and `test/codex-ai-coach-core-final-signoff/` evidence. The unchanged foundation evaluator refreshed its existing generated result JSON. Prior reports and unrelated worktree changes were preserved.

## Previous remaining findings

Baseline: `codex-ai-coach-product-final-recheck.md`: 0 critical, 0 high, 3 medium, 0 low.

| Previous finding | Current result |
|---|---|
| Intermediate nutrition restriction lost | CLOSED |
| Unsupported non-first compound exclusion dropped | CLOSED for requested cases |
| Already-CANCELLED action executes | CLOSED for sequential stale confirmation |

Read the final remediation report and reviewed the previous recheck/remediation, standalone nutrition/workout designs and evaluation addenda. Current executed behavior wins over their claims.

## M1 accumulation

**PASS.** Executed the exact three-turn test with real workflow/action DB rows and controlled external context/queue boundaries:

1. `Tạo thực đơn, tôi không ăn cá.` stores fish and waits for mealsPerDay.
2. `À tôi cũng không ăn thịt bò.` stores fish+beef, remains COLLECTING_SLOTS, expectedSlot=mealsPerDay, and leaves mealsPerDay unset. Nothing queued.
3. `4 bữa` queues one generation with mealsPerDay=4 and both canonical keys.

Same-turn `4 bữa, và tôi cũng không ăn thịt bò.` also preserves both restrictions and proceeds. Repeated fish statements deduplicate to one canonical exclusion.

The fix is `fitness-agent.service.ts:1760` (`accumulateNutritionWorkflowConstraints`), called before generic workflow processing. `orchestrator.ts`, workflow types and Prisma schema have no diff against HEAD. The existing scalar-slot no-overwrite rule remains intact. The already-present slot-values modification is not a foundation redesign.

Unsupported middle-turn spicy-food exclusion explicitly refuses, cancels the workflow, queues nothing, and does not resume generation on a subsequent bare meals answer. This truthful restate-required policy is accepted; no redesign requested.

## M2 compound exclusions

**PASS for requested matrix.** Executed parser and real-action tests covering supported+unsupported in both orders, three-item lists, multiple supported exclusions, repeated exclusions, and unsupported compound revision.

Fish+spicy and spicy+fish both classify spicy as unsupported and queue no job. Fish+spicy+beef preserves both supported keys while refusing the unsupported clause. Fish+beef alone has no unsupported result.

Non-food follow-on clauses (`4 bữa`, `ưu tiên món Việt Nam`, `đổi giúp tôi`, `giảm ngân sách`, plus the suite's additional preference clauses) do not create false unsupported-hard-exclusion errors. Supported fish remains recognized. Hints remain hints.

`nutrition-food-constraints.ts:141` now processes each clause independently rather than retaining unsupported items only at index zero. No additional parser adversarial scope was added beyond the requested matrix.

## CANCELLED terminal semantics

**PASS sequentially.** Workout preview -> dismiss -> stale confirm is rejected with zero imports and status remains CANCELLED. Nutrition PREVIEW -> dismiss -> stale confirm likewise rejects with zero saves. Nutrition FAILED-job auto-cancellation also rejects confirmation.

Common `execute()` guard (`fitness-agent.service.ts:711`): owner/session check, COMPLETED returns stored result, non-PENDING rejects, then expiry and business branches. This occurs before any business tool. Double dismissal is coherent and does not resurrect an action. Dismiss after completion reports already saved and leaves COMPLETED unchanged. Cancelled drafts remain excluded from later routing.

These passing sequential cases do not establish concurrency safety.

## Confirm-vs-dismiss concurrency

**FAIL / MEDIUM.** Independently reproduced for both CREATE_WORKOUT_PLAN and CREATE_NUTRITION_PLAN in `test/codex-ai-coach-core-final-signoff/race.ts`.

Method: create a preview through the real product dispatcher and real AI-service action/session persistence; run confirm and dismiss in `Promise.all`. A controllable barrier delays only the external import/save response after execution passes its guard. Dismiss is allowed to finish during that normal in-flight interval, then the successful import response is released. No production guard, action query or status write is mocked. Catalog, nutrition plan source and business HTTP boundaries are declared fixtures; this is not a live HTTP/BullMQ/browser race or a real fitness DB write.

Observed for BOTH kinds:

```text
confirm passes PENDING guard and enters import/save
dismiss updates PENDING -> CANCELLED
dismiss returns success: "Đã bỏ qua bản nháp này — chưa lưu gì vào hệ thống."
import/save succeeds once
execute updates action -> COMPLETED
confirm returns success: saved
final action status: COMPLETED
```

The business success count is one, not a duplicate. Final status is COMPLETED, not CANCELLED. The demonstrated failure is **two contradictory successful user replies and a supposedly dismissed draft proceeding to save**. This is expressly an unacceptable outcome under the request's concurrency criteria, even though final DB status eventually matches the successful import.

Reachability: overlapping requests from two tabs or separate preview cards for the same action, with normal cross-service latency. A single card's busy state does not serialize requests at the server. The barrier selects a valid interleaving; it does not manufacture a mutation endpoint or bypass ownership/confirmation.

Cause: `execute()` reads eligibility once (`fitness-agent.service.ts:721`), then performs the business call and unconditionally writes COMPLETED (`:962`). `dismissDraft()` conditionally cancels any still-PENDING action (`:1785`) but does not distinguish one with a confirmation already in flight. Its subsequent read can still see CANCELLED, so it reports successful dismissal before that confirmation completes. The documented absence of serialization is therefore a reproduced product defect, not merely an informational limitation.

Required outcome: one operation wins coherently. An in-flight confirmed action must not receive a successful "dismissed / nothing saved" response, or dismissal must prevent its business write. Implementation choice remains with the owner; this review does not prescribe a row-lock or foundation redesign.

## Completed idempotency

**PASS sequentially.** Successful confirmation writes once, records COMPLETED, and repeated confirmation returns the stored result without a second business call. The concurrency probe also observed only one business success per action. Concurrent double-confirm was not added as another adversarial case.

## Expired action

**PASS.** Expired PENDING confirmation rejects before business execution. Completed-result replay retains its pre-existing idempotence semantics.

## M3 sanity

**PASS.** ACTIVE NutritionGoal retains priority. The exact deterministic fixture remains **1992 kcal / P128 / C246 / F55** and matches bootstrap persistence. Missing-data refusal, model target-override resistance, target-change rejection and content-hash protections pass in the current suites. No target architecture reevaluation performed.

## M4 sanity

**PASS.** Nutrition GENERATING -> PT search -> certificate follow-up is not hijacked by nutrition. Explicit nutrition poll and multi-preview domain edits pass. Action routing architecture remains unchanged by this final remediation.

## M5/M6 sanity

**PASS.** `profile.training.injuries` warning survives revision. No-deadlift removes relevant variants and remains enforced on regeneration/day-count revision. Cable substitute retry/drop and beginner disclosure also pass in the existing remediation suite. Generated workouts remain warning-only; no new safety engine requested.

## M7 sanity

**PASS.** Existing chat tests preserve preview weekday labels/selectedWeekdays. Re-ran the existing real fitness DB verification with isolated synthetic user rows and cleanup: selected `[1,3,5]` yields Monday/Wednesday/Friday; Sunday `[1,0]` is preserved. The no-selectedWeekdays control still demonstrates consecutive-date behavior, confirming why passing the selected pattern matters. Output: `weekdays.txt`.

## Foundation evaluator

Unchanged Codex conversational-workflow-v2 evaluator: **30 PASS / 0 FAIL / 0 BLOCKED**. Output: `foundation.txt` and the evaluator's existing generated JSON. Foundation remains **SIGNED OFF**.

## Workflow regression

All current `agent-workflow-*.test.ts` plus exclusion and slot-parser suites: **103/103 PASS**, zero skips/failures. Breakdown: 76 workflow, 7 processor exclusion, 20 slot-parser tests. This includes the final remediation suite's 13 tests and prior M3-M7 checks. Output: `workflows.txt`.

## Nutrition processor regression

**7/7 PASS**, included in the 103 total. Fish and peanut exclusions, meaningful fish-present control, egg/eggplant distinction, unknown canonical-key failure, explicit target protection against model override, and constraint extraction/merge remain intact.

## Nutrition target regression

Isolated `gymcoach_fitness_test`: target resolution **4/4**, onboarding bootstrap integration **6/6**, bootstrap engine **10/10**. Total **20/20**, zero skips/failures. Connection derived from local configuration without exposing credentials. Output: `targets.txt`.

## PT regression

Focused existing fitness-agent tests and foundation PT search/hire path pass. No PT ranking redesign or real paid contract transaction was attempted.

## Program v2 regression

Existing training-program scoring v1/v2, program workflow, recommendation claims/narrator and fitness-agent program tests pass. Combined focused PT/Program/memory/nutrition-workout-invariant invocation: **172/172**, zero skips/failures. This invocation's count is 172, not the report's 175; exact claimed command membership was not supplied, and no 175-test run is claimed. Output: `regressions.txt`.

## Memory regression

Existing memory extraction/policy and foundation provenance cases pass. Nutrition accumulation updates workflow-local `slotsJson`; no durable dietary preference write is added. Memory provenance architecture was not reopened.

## Builds

- ai-service `npm run build` (`tsc`): PASS.
- fitness-service `npm run build` (`tsc`): PASS.
- frontend/web `npm run build` (`vite build`): PASS, 6122 modules transformed. Non-blocking large-chunk warning remains.
- `git diff --check`: PASS before report creation.

No production edits were needed. All started build/test sessions completed.

## Environment limitations

Live provider/BullMQ generation and authenticated browser E2E were not rerun in this targeted code-level pass. Previous configured-provider unavailability and equipment-harness DB/Redis limitations remain unverified deployment/demo work, not passing results and not additional defects. No production provider configuration was changed. The unavailable equipment harness was not run again merely to reproduce its environment errors.

Accepted product limits remain: cross-session dietary preferences are not durable, generated workouts are warning-only, targeted single-meal regeneration/superset revision are unsupported, and the historical REST notes-drop issue is outside this sign-off scope. None causes the return decision.

## Remaining findings

CRITICAL: **0**

HIGH: **0**

MEDIUM: **1 - confirm/dismiss produces contradictory successful terminal responses**, reproduced independently for workout and nutrition. References: `fitness-agent.service.ts:721`, `:962`, `:1785`. Evidence: `race.ts`, `race-results.txt`.

LOW: **0**

INFO: environment and accepted scope limits above. The three previous sequential defects are closed; no additional architecture, parser, ranking or memory hardening cycle was opened.

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
| NUTRITION REVISION | SIGNED OFF |

Partial refers only to concurrent confirm/dismiss finalization for the standalone draft kinds. Existing signed-off capability scope is retained, not recertified as a production deployment.

## Original supervisor scenario

| Scenario | Verdict |
|---|---|
| Tạo lộ trình | YES |
| Tạo lịch tập | PARTIAL |
| Tìm PT | YES |
| Thuê PT | YES |
| Tạo kế hoạch dinh dưỡng | PARTIAL |

## Is Gymini now an end-to-end conversational AI Coach for the target scenario?

**PARTIAL.** The requested sequential product flows and restriction fixes now pass. Concurrent dismissal still cannot truthfully guarantee the draft was dismissed while confirmation is in flight.

## Final next step

Close only the reproduced confirm/dismiss race, with a regression for both draft kinds preserving sequential idempotence and cancellation. Do not reopen signed-off foundations or expand product scope. Once this medium is closed, stop core feature development and move to real BullMQ/provider E2E, authenticated browser/mobile E2E, CI/deployment verification, and demo/documentation cleanup.
