# 11 — Test Coverage & Business Invariants

## 1. Test inventory (counts, not execution — this audit did not run any test suite)

| Scope | Count | Source |
|---|---|---|
| Total `*.test.*`/`*.spec.*`/`__tests__` files, whole repo | 393 | `docs/production-readiness/01-system-inventory.md` (independent prior audit) |
| Frontend test files | 61 | same |
| Playwright specs | 4 | same |
| ai-service Jest tests | 143 (123 in `__tests__/`, 18 in `llm/__tests__/`, plus datasets/services) | this audit's Phase 1 ai-service agent |
| ai-service offline evaluation harness (NOT Jest, separate from the above) | agentic, conversational-workflow v1/v2, program-recommendation scenario runners | same — do not conflate with the Jest count |

**Neither this audit nor the independent production-readiness audit executed these suites.** Both relied on code inspection of test files/counts, not green/red results. Any claim that "tests pass" for a given capability should be treated as `NOT_VERIFIED` by this audit unless a specific live test run is cited with a date and environment.

## 2. High-value business invariants — enforced vs. not

Per task §22's example list, cross-referenced against actual findings from this audit:

| Invariant | Status | Evidence |
|---|---|---|
| Moving a workout session must preserve unrelated sessions | **VIOLATED — confirmed live defect** | Case B / BDG-15: a move request triggers full regeneration at the new day count, discarding unrelated days |
| Changing workout frequency must result in the requested session count | **PARTIALLY ENFORCED** | True for the deterministic workflow and plain requests; bypassed when injury-mentioned or combined-plan (Case A / BDG-14) |
| Changing a meal must not silently change an unrelated nutrition goal | `NOT_VERIFIED_FROM_STATIC_READING` by this audit | Not one of the 7 traced cases; `NutritionGoal`/`NutritionProgram` separation is architecturally real (DOM-04), but a live revision-interaction test wasn't run |
| Changing one client's program must not affect another client | **CONFIRMED ENFORCED** | PT-copilot audit: ownership is correct by construction (`createAndAssignPlan` creates under `clientUserId`), and the authorization gate is re-verified per call with no cross-client leak path found |
| Unauthorized PT-client access must fail | **CONFIRMED ENFORCED** | Direct trace of all 10 `coach.controller.ts` handlers; fail-closed on any transport error |
| Confirming a stale proposal must not apply outdated changes | **PARTIALLY ENFORCED** | `AgentWorkflowSession` has a DB-level partial unique index limiting one active workflow per session; `FitnessAgentAction` does not — selection of "the most recent live action" is done in application code, not DB-enforced (external register G-26, P2) |
| Partially completed workflows must accurately report what succeeded | **CONFIRMED ENFORCED** | Case F: per-step ✅/❌ reporting, explicitly engineered, no silent full-success claim found |
| Safety restrictions must survive conversational revisions | **VIOLATED — confirmed live defect, the most important invariant failure in this audit** | Case C/D / BDG-16/BDG-17: a disclosed injury/limitation is never captured as a persistent exclusion in the first place |

**5 of 8 invariants in this standard list were actually traceable with this audit's evidence; 2 of those 5 are confirmed violated, 2 partially enforced, 1 confirmed enforced, 3 not independently traced.** This is a genuinely mixed, evidence-grounded result — not a blanket pass or fail.

## 3. Untested/unenforced invariants discovered independently by this audit (beyond the task's example list)

| Invariant | Status |
|---|---|
| A PT-dashboard query must never require N+1 calls across a client roster | **Enforced by omission** — the feature that would need this (cross-client aggregate) simply doesn't exist yet (BDG-08), so the invariant can't currently be violated because there's nothing to violate it |
| An AI-drafted plan must never be persisted without the owning service's own accept step | **CONFIRMED ENFORCED, 3 independent confirmations** — Phase 1 structural agent, PT-copilot agent's direct `generatePlanDraft` trace, and the independent production-readiness audit's own grep check all agree |
| A CycleAssessment's AI-authored decision (KEEP/PROGRESS/ADJUST/DELOAD/REBUILD) must never be settable by a human reviewer | **CONFIRMED ENFORCED** — both nutrition- and training-side PT review routes mutate only `userDecision`, never `decision`; the output schemas for CycleAssessment explanation and progression explanation are deliberately shaped with no decision field at all |
| An unresolvable AI-generated exercise reference must never be silently persisted | **CONFIRMED ENFORCED** (Case E) — dropped-with-disclosure, hard-repaired, or job-failed; no silent bad write found on any of the 3 generation surfaces |

## 4. Test-coverage gaps worth naming specifically

- No cross-user authorization test suite exists repo-wide (external register G-24) — this audit's own confirmation that PT-client authorization is currently *correct* makes this gap more about **regression protection going forward** than about a currently-live defect.
- No test was found (by either audit) that would catch BDG-14/15/16/17/18 — these are architectural gaps in the conversational layer, and the existing 143 ai-service Jest tests apparently don't cover the injury-mention+frequency-request combination, the move-vs-regenerate distinction, or the hardcoded-16-week roadmap path, despite extensive existing test infrastructure in this exact area. This suggests a **class** of gap: the test suite covers individual intents well but not intent *combinations* and hardcoded-default paths.
- Concurrency/idempotency tests for "double confirm" and "concurrent nutrition bootstrap" are both marked `NEEDS_RUNTIME_VERIFICATION` by the external production-readiness audit (P4-T03) — this audit did not independently re-check these.
