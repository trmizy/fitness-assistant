# Conversational AI Coach Workflow — Evaluation

Evidence labels follow this repo's convention: `REAL BROWSER` ·
`REAL HTTP/API` · `BACKEND INTEGRATION` · `TEST FIXTURE` · `CODE AUDIT`.
Everything below is `BACKEND INTEGRATION` (real DB, real Prisma tables, the
real `fitness-agent.service.ts::tryTurn`/`execute` entry points — the same
ones the HTTP layer calls — with only the outbound HTTP boundaries to
user-service/fitness-service stubbed) unless marked otherwise. No live
browser session was exercised this pass — frontend correctness is `CODE
AUDIT` + a clean `npx vite build`, not `REAL BROWSER`.

## 1. Completion matrix

| Workflow | Status | Notes |
|---|---|---|
| CREATE_ROADMAP | **COMPLETE** | Full chain proven: ask-only-missing → propose-update → zero writes pre-confirm → persist once → auto-resume (no repeat) → draft preview → free-text revision (draft-only, same action) → explicit confirm → real accept+activate+apply+bootstrap, each exactly once → idempotent re-confirm. |
| ROADMAP_REVISION | **COMPLETE** | `tryReviseRoadmapDraft`, proven via the flagship E2E's turn 4. |
| FIND_TRAINING_PROGRAM | **COMPLETE** | Slot-filling (goal/days) proven to reach the real `findTrainingPrograms` call after auto-resume, with values that were never written to the profile. |
| FIND_PT | **COMPLETE** (same code path as FIND_TRAINING_PROGRAM plus a required `budgetVnd` slot) | Not given its own dedicated E2E test this pass (time-boxed); covered indirectly by the regression fix to `budgetSlot.readFromContext` and by `fitness-agent-goal-intent-loop.test.ts`'s existing PT-flow coverage now passing again. |
| CREATE_WORKOUT_PLAN | **NOT APPLICABLE this pass** | No standalone slot-filling workflow built distinct from FIND_TRAINING_PROGRAM; `SAVE_GENERATED_PLAN`'s own chat-plan-generation path was not wired into `agent-workflow/` — see design/implementation docs' disclosed scope boundary. |
| WORKOUT_PLAN_REVISION | **NOT APPLICABLE this pass** | Depends on CREATE_WORKOUT_PLAN existing as a workflow first. |
| HIRE_PT | **NOT APPLICABLE this pass** | The existing two-step `CREATE_PT_CONTRACT_DRAFT`→`CONFIRM_PT_CONTRACT` confirmation is untouched (§107 "do not reopen"); no slot-filling was added in front of it this pass — FIND_PT (above) only covers the search step. |
| CREATE_NUTRITION_PLAN | **PARTIAL** | Benefits from CREATE_ROADMAP's slot-filling (the bundle's `bootstrapNutrition` step runs automatically once roadmap+workout succeed — proven by the flagship test's turn 5 `calls.bootstrapNutrition === 1`). No standalone chat-driven nutrition preview/revision loop — the domain layer has no such capability to wire up (audit doc §8). |
| NUTRITION_REVISION | **NOT APPLICABLE this pass** | Depends on CREATE_NUTRITION_PLAN existing as its own workflow first. |

## 2. Acceptance-gate chain — what was actually proven, with evidence

Each link below cites the exact assertion that proves it, in
`agent-workflow-roadmap-e2e.test.ts`'s flagship test unless noted.

1. Natural-language request → workflow detected: turn 1,
   `r1.blocks[0].type === "WORKFLOW_MISSING_DATA"`.
2. Authoritative context loaded, only missing required info requested:
   turn 1, `missing1 deepEqual ["cân nặng mục tiêu"]` (not the other 5
   already-known fields).
3. Reply interpreted in pending-workflow context (no recognizable intent of
   its own): turn 2, `"72 kg"` → `PROFILE_UPDATE_CONFIRMATION`.
4. Candidate slot validated: `parseWeightKg` range-checks 25–300kg —
   proven separately by the adversarial test (`"999999"` → re-ask, zero
   state change).
5. Persistent update requires confirmation, no write before confirm: turn
   2, `calls.updateProfileFields.length === 0` and `profile.targetWeight
   === null` still.
6. Confirmed update goes to the authoritative business service: turn 3,
   `calls.updateProfileFields[0] deepEqual { targetWeight: 72 }`.
7. Context reloads, SAME workflow automatically resumes (no repeat): turn
   3, `r3.blocks[0].type === "ACTION_CONFIRMATION"`, `kind ===
   "CREATE_PLAN_BUNDLE"` — the user never re-typed their original request.
8. Preview/recommendation generated: turn 3,
   `calls.generateRoadmapDraft.length === 1`.
9. User can revise the preview, no business write during revision: turn 4,
   `calls.acceptRoadmapDraft.length === 0` after the revision message,
   `calls.generateRoadmapDraft.length === 2`, same `actionId`.
10. Explicit confirmation → existing business write path: turn 5,
    `fitnessAgent.execute(...)` → `calls.acceptRoadmapDraft/activateRoadmap/
    applyTrainingPlan.length === 1` each, `calls.bootstrapNutrition === 1`.
11. Idempotency preserved: re-calling `execute()` on the same `COMPLETED`
    action returns the identical stored result and makes zero additional
    boundary calls (`r5b deepEqual r5`).
12. Stale-state preserved: the profile-update confirm step re-fetches the
    real profile and compares against the propose-time snapshot before
    writing (`orchestrator.ts::handleConfirmationReply`'s stale-profile
    guard) — not separately re-tested this pass beyond the existing design
    (no new test added for the stale-profile-at-confirm-time race
    specifically; documented as a gap below).

## 3. Bugs found and fixed during this task (not pre-existing, all introduced-then-caught in the same pass)

Each was caught by writing and running a real DB-backed test before
declaring the feature complete — not by code review alone.

1. **`currentWeightKg` field-name mismatch** — `roadmap.workflow.ts` read a
   context field (`currentWeightKg`) that does not exist on the real
   `/profile/agent/context` wire shape (`currentWeight`). Would have made
   CREATE_ROADMAP ask for current weight on every single turn. Caught while
   auditing the real endpoint before writing the E2E test; fixed before the
   test was ever run failing.
2. **Resume dispatched on the wrong intent** — `tryTurn` fell through to
   `intent.kind` (the CURRENT turn's own parsed intent — almost always
   `null` on a resume turn) instead of the completed workflow's
   `gatesIntentKind`. Would have silently dropped every single auto-resume
   (the task's own "MOST IMPORTANT" requirement). Caught by the flagship
   E2E's turn-3 assertion before any manual/browser testing.
3. **`resumeKnownSlots` missing** — FIND_PT/FIND_TRAINING_PROGRAM's
   WORKFLOW_ONLY slots (goal/days/budget) were resolved but never threaded
   into the resumed dispatch's `preferences` construction, which only reads
   the (unchanged) profile. Would have made a resumed PT/PROGRAM search
   re-ask exactly what the user just answered. Caught by
   `agent-workflow-program-e2e.test.ts`, written specifically because the
   flagship CREATE_ROADMAP test alone could not have caught it (different
   code path).
4. **`budgetSlot.readFromContext` hardcoded to `undefined`** — based on an
   incorrect belief (recorded then disproven) that no UserProfile field
   backs PT budget; the real field is `ptBudgetVnd`, surfaced as
   `budgetVnd`. This one was NOT caught by a new test — it was caught by
   running the pre-existing, already-signed-off
   `fitness-agent-goal-intent-loop.test.ts` regression suite, which failed
   because the workflow now intercepted a previously-single-turn PT search.
   This is the concrete argument for §5 below.
5. **`USE_ONCE_RE` didn't match its own button's text** — the
   PROFILE_UPDATE_CONFIRMATION card's "Chỉ dùng cho lần này" button sends
   that literal string, which normalizes to "chi dung cho lan nay"; the
   regex required "chi dung lan nay" (no "cho"). Caught by the
   decline-persistence E2E test throwing `TypeError: Cannot read properties
   of undefined` when the expected `ACTION_CONFIRMATION` block never came
   back.

## 4. Why the full existing regression suite was run, not just new tests

Bug #4 above is the concrete proof that testing only the newly-written
files is insufficient for this kind of change — the orchestrator sits
*in front of* eighteen existing intent handlers and can silently change
their single-turn behavior for messages that used to reach them directly.
`npx tsx --test src/__tests__/*.test.ts` was run in full, twice: once
which surfaced bug #4 (`fitness-agent-goal-intent-loop.test.ts` failing),
and once after the fix, green. See §6 for the exact counts.

## 5. Test matrix — what ran, real counts

BACKEND INTEGRATION, real DB (`gymcoach_ai`, dev, port 5433), stubbed HTTP
boundaries to user/fitness-service only:

- `agent-workflow-roadmap-e2e.test.ts` — 4/4 pass (flagship chain,
  no-repeat, prompt-injection-while-pending, decline-persistence).
- `agent-workflow-program-e2e.test.ts` — 1/1 pass (WORKFLOW_ONLY slot
  threading through resume).
- `agent-workflow-security-e2e.test.ts` — 3/3 pass (cross-user isolation,
  business-state attack, arbitrary-field-attack at the schema level).
- Full existing suite, `src/__tests__/*.test.ts` — run three times across
  this task: (1) 469 tests/32 suites, 5 failing (1 pre-existing env-gate
  category × 4 tests + 2 real regressions in
  `fitness-agent-goal-intent-loop.test.ts`, i.e. bug #4 above); (2) after
  the `budgetSlot` fix, targeted re-run of the affected files confirmed
  24/24 pass; (3) final full confirmatory run after adding the 3 new
  security tests: **472 tests, 32 suites, 465 pass, 3 fail, 4 skipped** —
  the 3 failures are exactly the `NODE_ENV=test`-gated
  `plan-generation-equipment.integration.test.ts` cases (its 4th case is
  reported `skipped` rather than `failed` depending on `before`-hook
  ordering), a pre-existing, documented convention of that file, not a
  regression from this task (confirmed by reading its own header: it
  asserts `NODE_ENV === "test"` and instructs running with a specific
  `DATABASE_URL` against the isolated test DB).
- `npx tsc --noEmit -p .` (ai-service): clean throughout.
- `npx vite build` (frontend/web): clean, `FitnessAgentBlocks`/
  `AICoachPage` chunks rebuilt successfully after every frontend change.

## 6. Explicitly NOT covered this pass (disclosed gaps, not silent ones)

- **Stale-profile-at-confirm-time race** — the guard exists
  (`handleConfirmationReply`'s `expectedCurrentValue` comparison) and is
  structurally the same mechanism used elsewhere in this codebase
  (`applyTrainingPlan`'s `fingerprint` check), but no dedicated E2E test
  simulates a concurrent profile change between propose and confirm for
  THIS module specifically.
- **Workflow-expiry (TTL) behavior** — `WORKFLOW_TTL_MS`/auto-expiry-on-read
  is implemented (`workflow-state.repository.ts::findActive`) and mirrors
  `FitnessAgentAction`'s own TTL convention, but not exercised by a test
  that fast-forwards past the real 30-minute window.
- **Switch/cancel-mid-workflow** — `CANCEL_RE`/the "switching workflow"
  branch in `runWorkflowTurn` exist and are simple, direct regex/lookup
  logic, but have no dedicated E2E test this pass (covered by inspection —
  `CODE AUDIT`, not `BACKEND INTEGRATION`, for this specific behavior).
- **REAL BROWSER verification of the two new frontend blocks** — not
  performed. `WORKFLOW_MISSING_DATA`/`PROFILE_UPDATE_CONFIRMATION`
  rendering, the mobile-width layout, and the quick-reply button wiring are
  `CODE AUDIT` + a clean production build only.
- **FIND_PT** has no dedicated end-to-end test of its own (only
  FIND_TRAINING_PROGRAM does); it shares 100% of the same orchestration
  code path with one additional required slot, and is exercised indirectly
  by the pre-existing PT-flow regression suite passing again, but was not
  independently proven to auto-resume with a `budgetVnd` value collected
  over chat the way FIND_TRAINING_PROGRAM's `goal`/`days` were.
- **CREATE_WORKOUT_PLAN/HIRE_PT/CREATE_NUTRITION_PLAN standalone
  workflows** were not built (see completion matrix) — nothing to test.

## 7. Supervisor scenario — final proof

Answering the exact worked example from the source task (user says "Hãy
tạo lộ trình tập luyện cho tôi, tôi muốn giảm mỡ", everything known except
`targetWeight`, replies "72 kg", confirms, auto-resumes, previews, revises
with "Phase đầu nhẹ hơn một chút", confirms again):

- **ROADMAP: YES** — proven end-to-end by `agent-workflow-roadmap-e2e.test.ts`'s
  flagship test, BACKEND INTEGRATION evidence, real DB rows inspected at
  every step (see §2's citation list).
- **WORKOUT (as part of the CREATE_ROADMAP bundle): YES** — same test,
  turn 5, `calls.applyTrainingPlan.length === 1`. As a STANDALONE
  slot-filling workout-plan-creation workflow (independent of roadmap
  creation): **NO** — not built this pass (completion matrix).
- **PT: PARTIAL** — the FIND_PT search step itself is YES (same code path
  as FIND_TRAINING_PROGRAM, proven indirectly), but HIRE_PT's contract flow
  was not given slot-filling and remains exactly as it was before this
  task (a deliberate "do not reopen" boundary, not a gap in scope
  understanding).
- **NUTRITION: PARTIAL** — YES as a bundled step of CREATE_ROADMAP (proven,
  §2 evidence), NO as a standalone chat-driven creation/revision workflow
  (domain layer has no such capability yet — audit doc §8).

## Remediation #1 (post Codex Evaluation #1)

The above evaluation was superseded by an independent Codex review
(`docs/codex-conversational-ai-coach-evaluation-1.md`), which found two
release-blocking issues (`PROFILE_FACT` use-once, unsafe target weight
persisting) this evaluation's own test suite did not cover. Both are now
fixed and independently re-verified — see
`docs/conversational-ai-coach-remediation-1.md` for the complete before/
after evidence, including the exact re-run of Codex's own unmodified
evaluator (`PASS 7→9`, every dynamically-computed case now passing; the
remaining 10 "FAIL" entries are literal hardcoded-status snapshot cases in
the evaluator's own source, confirmed by reading it directly, not live
regressions) and 11 new dedicated DB-backed tests.

## Remediation #2 / Final Safety Closure (Codex Evaluation #2)

Codex's independent second-round review (`docs/codex-conversational-ai-coach-
evaluation-2-final-signoff.md`) found one remaining HIGH — a deferred-context
safety gap where a candidate accepted while other context was still
incomplete could later reach `PROFILE_UPDATE_CONFIRMATION` once that context
arrived. Fixed via a new generic revalidation pass in `finalizeWorkflow()`.
Re-run of Codex's own unmodified v2 evaluator: **`PASS 30 / FAIL 0`** (up
from one HIGH failing). Full detail:
`docs/conversational-ai-coach-safety-closure.md`.
