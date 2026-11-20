# 07 — Conversational State & Revision Audit

Investigates the task's 7 documented known-failure cases plus the operation-vocabulary question, by direct static reading of `backend/services/ai-service` (no code modified). Verdicts use the required taxonomy: `CONFIRMED_LIVE_DEFECT` / `APPEARS_FIXED` / `ARCHITECTURAL_RISK_NOT_CONFIRMED` / `NOT_VERIFIED_FROM_STATIC_READING`.

**Headline finding**: three genuinely distinct plan-generation surfaces exist in ai-service (the deterministic `CREATE_WORKOUT_PLAN` agent-workflow, the general RAG+LLM `/ai/ask` chat path, and the hard-gated "Pipeline B" `ai.worker.ts` job queue), and they have **different, independently-evolved levels of rigor**. Several of the cases below are already fixed on the deterministic/Pipeline-B paths but remain live specifically on the general-chat LLM path, or in one specific exception branch. This nuance matters more than a single pass/fail verdict per case.

## Case A — Workout frequency mismatch (5 requested, 6 proposed)

**Verdict: split — APPEARS_FIXED for the common case, CONFIRMED_LIVE_DEFECT for a real, named exception set.**

The deterministic `CREATE_WORKOUT_PLAN` workflow (`fitness-agent.service.ts`, `selectDaysByCount` in `recommendation_engine.ts:434-460`) makes count-inflation architecturally impossible — it's a hardcoded switch returning exactly N day templates, days can only be dropped (if all exercises fail to resolve), never added. The general chat path deliberately excludes plain workout/frequency requests from the LLM entirely (`orchestrator.service.ts:882-898`, comment: *"Workout plan + frequency change remain deterministic to enforce hard constraints"*) — a direct, deliberate guarantee.

**But**: `needsLlm` is force-set `true` whenever the message also mentions an injury (`orchestrator.service.ts:897-898`, "so the model can adapt the plan narrative"), and `combined_plan_request`/`body_recomposition_request` are *always* LLM-routed regardless of phrasing. In those branches the day-count constraint becomes a **soft prompt instruction only** (`prompt_builder.ts:577-580`), and `answer_validator.ts` has **no day-count check anywhere** — it only checks for the *presence* of day/week keywords, never counts them. So "5 buổi/tuần, tôi hơi đau lưng" (frequency + injury mention) or any combined workout+nutrition ask bypasses the hard guarantee with nothing to catch a miscounted LLM output.

## Case B — Session move interpreted as plan replacement

**Verdict: CONFIRMED_LIVE_DEFECT.**

No MOVE concept exists anywhere in `revision/target-resolution.ts` or `workout-guards.ts`. A "move Friday to Saturday" utterance is parsed by `parseTrainingDays` (`agent-workflow/slot-values.ts:163-208`) as **every weekday mentioned in the raw text**, with no from→to semantics — "chuyển thứ 6 sang thứ 7" yields `{Fri, Sat}`, indistinguishable from the user saying "I can train Friday and Saturday." `fitness-agent.service.ts:1961-1971`: if that set's size happens to equal the existing plan's day count, it's a safe relabel; for any real plan (4/5/6 days) the sizes differ, so line 1968 calls `regenerate(2, [Fri,Sat])` — **a full fresh 2-day plan, discarding every other day.** This is the exact reported symptom. There is also no reschedule/move tool for an already-saved active program at all.

**Root cause matches the operation-vocabulary finding below: MOVE collapses into CREATE/REPLACE under the hood.**

## Case C — Physical limitation (leg pain) ignored

**Verdict: CONFIRMED_LIVE_DEFECT.** Health/safety-relevant — see cross-reference to `09-health-safety-and-constraint-audit.md`.

Three independent, compounding gaps:
1. `safety-signals.ts`'s pain/injury classification is explicitly documented as affecting only the *current turn's* RAG gate (abstain/titled-evidence-only) — nothing in that file or its callers writes a persistent exclusion anywhere.
2. **There is no chat-writable `injuries` field at all**: `agentUpdatableProfileFieldsSchema` (`fitness-agent-tools.ts:67-76`, `.strict()`) whitelists only goal/weight/age/gender/height/experience — a disclosed leg injury can never be persisted via any ai-service path.
3. Even if `profile.training.injuries` is already populated from onboarding, `workoutSafetyWarnings()` only appends a warning **string** to the preview — its own comment admits it: *"Lịch tập này CHỈ có cảnh báo, chưa tự động loại bỏ bài tập theo từng chấn thương cụ thể"* (this schedule only warns, it does not auto-remove exercises per injury). `proposeWorkoutPlan` always initializes `exclusions: []`, never seeding from known injuries.
4. Even the one real exclusion mechanism that does exist (named-exercise exclusion from explicit chat phrasing) only whole-token-matches **English catalog exercise names** — a Vietnamese phrase like "tránh bài chân" can never match tokens like "Leg Press"/"Squat", so it wouldn't work even if the user tried to use it directly.

## Case D — Correction loses previous constraint (4 sessions no-legs → correct to 5 → exclusion dropped)

**Verdict: CONFIRMED_LIVE_DEFECT — but the root cause is "never captured," not "merge logic overwrites it."**

The generic slot-merge logic (`agent-workflow/orchestrator.ts:392-444`, `handleSlotReply`) is actually implemented correctly — it's a true merge (`{...storedKnown, [slot.key]: result.value}`), previously-known slots survive a correction to a different slot. The real defect: `CREATE_WORKOUT_PLAN`'s `SlotDefinition[]` only defines `daysPerWeekSlot`/`sessionMinutesSlot` — **there is no exclusion/constraint slot and no `extractFromMessage` for one**, so "không tập chân" stated at any point during slot-filling is never captured into `known` to begin with; it isn't lost on correction, it never existed. `proposeWorkoutPlan` hardcodes `exclusions: []` regardless.

**Confirmed the team already fixed this exact bug class — for nutrition only**: `accumulateNutritionWorkflowConstraints` (`fitness-agent.service.ts:2372-2386`) has an explicit comment, *"Final remediation M1: nutritionConstraints is an ACCUMULATING set... a constraint stated in a middle turn would be lost"* — a real, named, dated fix for the nutrition workflow. **No equivalent fix was ever ported to the workout workflow.** This is the single most actionable, well-evidenced finding in this audit: the remediation pattern already exists in the codebase, it just needs to be applied to a second workflow.

## Case E — Exercise catalog mismatch

**Verdict: APPEARS_FIXED**, with one minor cosmetic residual gap.

All three generation surfaces are robustly grounded. Chat workflow: unresolvable exercise names are dropped with a disclosed count (not silently persisted with fake ids). Pipeline B (`ai.worker.ts` + `plan.schemas.ts`): hard `idsValid()` check against the real catalog, LLM retry-with-correction, deterministic repair, and a fully catalog-sourced fallback generator if the LLM keeps failing — never a silent bad write, and an empty catalog cleanly fails the job rather than producing garbage. The confirm-time save path reuses exactly what was already resolved at preview time (no re-matching that could drift). **Residual P3 gap**: dropped exercise names aren't individually listed in the chat workflow's disclosure, only a count.

## Case F — Roadmap partial application

**Verdict: APPEARS_FIXED for honest reporting; ARCHITECTURAL_RISK_NOT_CONFIRMED (by design) for rollback.**

`CREATE_PLAN_BUNDLE`'s 3 steps (roadmap activate, workout apply, nutrition bootstrap) each run in their own try/catch and are reported individually with a ✅/❌ per-step message — the code comment states the intent outright: *"Never claim full success on partial failure — report exactly which step failed."* This is a deliberately engineered honest-partial-success report, not the "silently claims success" failure mode the task worried about.

What genuinely doesn't exist: no shared transaction/saga across the 3 independent HTTP calls, and the `FitnessAgentAction` is marked `COMPLETED` regardless of partial failure (its `retryable` flag is never set `true` for this action kind) — re-confirming replays the cached result rather than retrying only the failed step. Recovery of a failed sub-step is left entirely to the user noticing the ❌ line and manually redoing it. This is a real, named architectural trade-off (acceptable for a "mostly idempotent, user re-initiates" model) rather than a latent bug — flagged as a gap to consider, not asserted as broken.

## Case G — Unlimited timeline request still yields a fixed 6-week roadmap

**Verdict: CONFIRMED_LIVE_DEFECT — the cleanest, most precisely reproducible finding of all 7 cases.**

`GenerateRoadmapDraftRequestSchema.timeframeWeeks` and the output schema's `plannedDurationWeeks` have **no way to represent "no end date"** at all — bounded numeric fields only, no sentinel/flag for explicit open-endedness. But the chat caller doesn't even reach that ambiguity: `timeframeWeeks` is a **hardcoded literal `16`** at both call sites in `fitness-agent.service.ts` (lines 1577-1580 and 1650) — there is no slot, no free-text parse, nothing that ever reads what the user said about duration into this field. "No deadline" has zero code path to influence it. The deterministic fallback used whenever the LLM call fails computes `Math.min(req.timeframeWeeks ?? 6, 6)` = `Math.min(16, 6)` = **exactly 6, every single time**, regardless of anything the user said — this is the literal, exact mechanism producing the reported symptom.

**Caveat**: the non-chat `/ai/generate-roadmap-draft` route is a thin passthrough; whatever `timeframeWeeks` fitness-service's own roadmap wizard sends is outside ai-service and is `NOT_VERIFIED_FROM_STATIC_READING` — this verdict applies specifically to the conversational/chat surface.

## Operation vocabulary — which operations have a real distinct code path

| Operation | Status | Evidence |
|---|---|---|
| CREATE | Distinct dedicated handler per plan type | `CREATE_WORKOUT_PLAN`/`CREATE_NUTRITION_PLAN`/`CREATE_PLAN_BUNDLE`/`CREATE_PT_CONTRACT_DRAFT` |
| UPDATE (profile field) | Distinct | `UPDATE_GOAL` workflow → `updateProfileFields` |
| REVISE | Distinct family, per domain | `tryReviseWorkoutPlanDraft`/`tryReviseRoadmapDraft`/`tryReviseNutritionTarget`/`tryReviseRecommendation`, `revision/nutrition-revision.ts`, `pt-program-revision.ts` |
| CHANGE_DURATION (session length) | **Distinct, genuinely targeted** | `trimDayForSessionMinutes` edits the existing schedule in place — the one clean example of a non-full-regen edit in the whole workout path |
| CHANGE_TARGET (goal/weight correction) | Distinct | `tryDetectCorrection` + `target-weight-safety.ts` |
| ADD_CONSTRAINT | Distinct, additive, in 2 independent implementations | nutrition's `mergeNutritionConstraints` (union-by-key); workout's named-exercise exclusion push |
| EXPLAIN | Distinct, deterministic (never the LLM) | `tryExplainRecommendation` |
| CONFIRM | Distinct, full PENDING→EXECUTING→COMPLETED claim machinery | `tryConfirmationBoundary` |
| CANCEL | Distinct | `CANCEL_RE` workflow cancel + `dismissDraft` |
| **MOVE** | **Collapses into CREATE/REPLACE** | No distinct operation anywhere; see Case B |
| **CHANGE_FREQUENCY** | **Recognized as a pattern, but always executes via full regeneration** | `regenerate(daysResult.value)` — same primitive as CREATE |
| **ADD** (incremental session/exercise) | **No incremental primitive; "add superset" explicitly refused as unsupported** | increasing day-count goes through the same `regenerate()` path as decreasing it |
| **REMOVE_CONSTRAINT** | **No code path found anywhere** | nutrition constraints are a pure union (can only grow); no "un-exclude" mechanism for workout exclusions either — the only way to drop a constraint is to cancel the whole draft and start over |
| **REPLACE** | The implicit default everything falls back to | `regenerate()` / full resubstitution is what every non-targeted edit actually does |
| **COMPARE** | **Not implemented at all** | zero matches for "so sánh"/"compare" anywhere in `fitness-agent.service.ts` |

## Cross-cutting takeaway for the roadmap phase

Cases B, D, and the CHANGE_FREQUENCY/MOVE/ADD vocabulary findings all share one root architectural cause: **the workout-plan workflow has exactly one real edit primitive, full regeneration (`regenerate()`), plus one genuine exception (`trimDayForSessionMinutes` for duration)**. Every other "edit" request — move a day, change frequency, add a session — is a disguised CREATE. The nutrition workflow is measurably more mature (it has real constraint-accumulation, fixed after a named incident) and should be treated as the template to port forward into the workout workflow, rather than building new general infrastructure from scratch.
