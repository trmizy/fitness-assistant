# Conversational AI Coach — Final Safety Closure

Date: 2026-09-16. Responds to
`docs/codex-conversational-ai-coach-evaluation-2-final-signoff.md`
(decision: RETURN TO CLAUDE — one HIGH remained: deferred-context unsafe
target weight could still be shown as a confirmable profile update).

## 1. What this pass covers

One HIGH fix (the deferred-context revalidation gap), plus documenting the
"Remediation #2" parser/no-cap-budget work that was already applied to the
tree in response to the earlier `docs/codex-conversational-ai-coach-
evaluation-2.md` round but never got its own write-up. No architecture
change, no new migration, no LLM, no standalone Workout/Nutrition
workflows.

## 2. Codex Evaluation #2 (final signoff) baseline

Every dynamically-computed case passed except one:

> `unsafe-target-weight-confirmation-before-write` — FAIL / HIGH: an
> unsafe `targetWeight` can be extracted while context is incomplete,
> stored in workflow-local state, and later shown inside
> `PROFILE_UPDATE_CONFIRMATION` after the missing context arrives. The
> actual write is blocked by pre-write safety, but the required "validate
> before confirmation" invariant is not fully satisfied.

Plus one LOW (carried over, already fixed by the time this pass started —
see §4): `parseTrainingDays("thứ 2, thứ 4, thứ 6")` returning `[1]`.

## 3. The deferred-context bug and its fix

### Root cause

`extractSafeKnownFromMessage()` (orchestrator.ts) validates each extracted
candidate against the context available AT THAT MOMENT. A slot's own
`validateContext` (by its documented contract, `types.ts`) returns
`ok: true` when it cannot yet judge a value — e.g.
`target-weight-safety.ts`'s `assessTargetWeightSafety` needs
`heightCm`/`currentWeightKg`/`goal`, and correctly declines to block when
any of those is still unknown ("never block on missing data"). That
candidate then sits in `known`/`AgentWorkflowSession.slotsJson`,
unre-checked. Once the LAST missing slot (e.g. `currentWeight`) arrives,
`finalizeWorkflow()` went straight from "all required slots known" to
building `PROFILE_UPDATE_CONFIRMATION` — it never re-ran `validateContext`
for slots that were accepted earlier under incomplete context.

### Fix — generic, not hardcoded to `targetWeight`

`finalizeWorkflow()` (orchestrator.ts) gained a new pass, inserted between
"all required slots known" and "compute `PROFILE_FACT` diffs":

```ts
for (const s of def.slots) {
  if (!s.validateContext) continue;
  const value = known[s.key];
  if (value === undefined) continue;
  const safety = s.validateContext(value, ctx);   // ctx built from the
  if (safety.ok) continue;                        // NOW-COMPLETE known set
  // remove the invalid candidate, re-ask specifically for that slot,
  // preserve every other already-known value, return to COLLECTING_SLOTS
}
```

This iterates every slot definition with a `validateContext` — currently
only `targetWeightSlot` — using `def.slots`/`SlotDefinition` generically,
exactly as the source task required ("use the existing
`SlotDefinition.validateContext` abstraction... do not special-case
`slot.key === 'targetWeight'` in `finalizeWorkflow()`"). A future
contextual slot on any workflow is covered by the same loop with zero
orchestrator changes.

### Recovery, not a dead end

On rejection, the invalid candidate is deleted from `known` (via object
destructuring), the DB row's `slotsJson`/`expectedSlot` are updated to
point at that slot again, and a `WORKFLOW_MISSING_DATA` block is returned
with the safety module's own `clarifyingQuestion` as the answer — every
OTHER already-known value (age, height, currentWeight, goal) is preserved
untouched. The next valid reply resumes the exact same collection flow.

## 4. Three validation stages (defense-in-depth, all three kept)

| Stage | Where | Catches |
|---|---|---|
| **Candidate** | `extractSafeKnownFromMessage()` (multi-slot extraction) and `handleSlotReply()` (single-slot answer) | The common case — context already sufficient when the value arrives |
| **Finalize** *(new this pass)* | `finalizeWorkflow()`, right after all required slots become known | Deferred-context dependencies — another slot was unavailable when THIS candidate first arrived |
| **Pre-write** *(unchanged)* | `handleConfirmationReply()`, immediately before `updateProfileFields()`, using freshly reloaded `EnterpriseContext` | External/stale context changes between propose and confirm |

None of the three was removed or weakened; each answers a different
question, as the source task's own reasoning (§7) requires.

## 5. Slots using `validateContext` today

Audited `def.slots` across both shipped workflows: only
`roadmap.workflow.ts`'s `targetWeightSlot` defines `validateContext`
(`target-weight-safety.ts`'s `assessTargetWeightSafety`). FIND_PT/
FIND_TRAINING_PROGRAM's slots (`goal`/`days`/`sessionMinutes`/`budgetVnd`)
have none. The new finalize-stage loop is therefore currently a no-op for
FIND_PT/FIND_TRAINING_PROGRAM (nothing to iterate) and fully exercised for
CREATE_ROADMAP.

## 6-9. Test evidence

New `agent-workflow-remediation-2.test.ts` (11 cases, all DB-backed against
the real `fitnessAgent.tryTurn`/real Postgres):

- **§8 golden deferred-context case** — exact reproduction: initial
  message has goal/age/height/targetWeight=30, no currentWeight;
  `currentWeightKg` is asked; replying "80kg" must NOT produce
  `PROFILE_UPDATE_CONFIRMATION`, must make zero writes, must return to
  `COLLECTING_SLOTS` with `expectedSlot: "targetWeight"`, and must
  preserve age/height/currentWeight already known. **PASS.**
- **§9 recovery** — a subsequent "72kg" produces a real confirmation,
  confirms, writes once, and auto-resumes into the real roadmap preview.
  **PASS.**
- **§12 reverse-order regression** — currentWeight known FIRST still
  rejects an unsafe target at the earlier, candidate stage (the original,
  faster net). **PASS.**
- **§14 batch-unsafe** — all five values (including the unsafe target) in
  ONE message still never reaches a confirmation. **PASS.**
- **§15 safe-batch regression** — the same rich-message flow with a SAFE
  target (72kg) still produces exactly one batch confirmation, no
  multi-slot UX regression from the new pass. **PASS.**
- **§16 pre-write regression** — a value safe at propose time, made
  unsafe by a context change before confirm, is still rejected at write.
  **PASS.**
- **§17 use-once regression** — still refused for `targetWeight`. **PASS.**
- **§18 unsafe-correction** — "Không, 30kg" (an unsafe replacement) is
  NOT accepted as a correction; the original safe 72kg proposal remains
  pending untouched. **PASS.**
- Parser variant tests (training-days, duration) and a no-cap-budget
  end-to-end test — see §10-13 below.

All 11 pass. Combined with the existing `agent-workflow-remediation-1.test.ts`
(11), `agent-workflow-roadmap-e2e.test.ts` (4), `agent-workflow-program-e2e.test.ts`
(1), `agent-workflow-security-e2e.test.ts` (3): **30/30 pass** run together.

## 10. Training-days parser (already fixed on this tree before this pass)

```
T2 T4 T6                -> [1,3,5]
thứ 2 4 6                -> [1,3,5]
thứ 2, 4, 6               -> [1,3,5]
thứ 2, thứ 4, thứ 6       -> [1,3,5]   (the Evaluation #2 LOW — now fixed)
thứ 2 - thứ 4 - thứ 6     -> [1,3,5]   (the Evaluation #2 P0 case — now fixed)
```

Fixed by iterating every `"thu ..."` occurrence with `matchAll` (the old
code only ever found the FIRST one via `.match()`, so a message repeating
the cue before each day — "thứ 2, thứ 4, thứ 6" — never got past the
first) and widening the digit-run's character class to include `-`.
Verified via a new unit test (`agent-workflow-remediation-2.test.ts`).

## 11. Duration parser (already fixed before this pass)

```
60 phút        -> 60
90 phút        -> 90
1 giờ          -> 60
1 tiếng        -> 60
1 giờ 30 phút  -> 90
1.5 giờ        -> 90   (the Evaluation #2 P0 case — now fixed)
1,5 giờ        -> 90
```

Fixed by accepting a decimal hour count (`(\d{1,2}(?:[.,]\d{1,2})?)`)
before the `giờ`/`tiếng` cue, with negative-lookahead/lookbehind guards so
a malformed run (`"1.2.3 giờ"`) or a negative sign (`"-1 giờ"`) is never
silently sliced into a plausible-looking partial match.

## 12. Concurrency regression

`agent_workflow_sessions_one_active_per_session` and `claimForWrite()` are
unchanged this pass (no genuine bug found in them). Re-verified passing:
20-concurrent-start test and the `create()`-returns-`null`-on-lost-race
test, both in `agent-workflow-remediation-1.test.ts`, still pass unchanged.

## 13. FIND_PT / PT search→hire / Program v2 / Memory / Security regression

- FIND_PT dedicated E2E, existing-budget-no-repeat: unchanged, still
  passing (`agent-workflow-remediation-1.test.ts`).
- No-cap PT budget: new end-to-end test confirms "Không giới hạn" resumes
  straight to `PT_RECOMMENDATIONS`, `findPTCandidates` receives
  `budgetVnd: undefined` (never `0`, never `Number.MAX_VALUE`), and the
  real profile's `budgetVnd` stays `null` — the `NO_BUDGET_CAP` sentinel
  (`find-pt-program.workflow.ts`) is resolved to real `undefined` at
  exactly one boundary (`resolveBudgetPreference`, called from
  `fitness-agent.service.ts`) and never leaks past it.
- PT search→hire two-step: untouched, not re-tested this pass beyond the
  existing `pt-search-to-hire-two-step` evaluator case (still passing).
- Program v2 / memory: the exact 5 files Codex tracks —
  **76/76 pass**, matching the established baseline exactly.
- Security (cross-user isolation, business-state attack, arbitrary-field
  attack, prompt-injection-while-pending): unchanged, all still passing.
- Full `src/__tests__/*.test.ts` (55 files, 32 suites): **537 tests, 530
  pass, 3 fail** — the 3 failures are the same pre-existing
  `NODE_ENV=test`-gated `plan-generation-equipment.integration.test.ts`
  cases documented in Remediation #1 (its own header requires a dedicated
  test-env invocation; unrelated to this task). **Zero new regressions**
  from this pass's change.

## 14. Builds/typechecks

`npx tsc --noEmit -p .` (ai-service): clean. `npx vite build`
(frontend/web): clean (no frontend files touched this pass — the fix is
entirely `orchestrator.ts`). `user-service`/`fitness-service`/`shared`:
not touched this pass, no rebuild required.

## 15. Database changes

**NONE.** This is a pure application-logic fix (`finalizeWorkflow()`'s new
revalidation loop) — no schema, no migration, no `db push`. The one
migration from Remediation #1
(`20260916090000_agent_workflow_session_active_unique`) is unchanged.

## 16. Production files changed

- `backend/services/ai-service/src/agent-workflow/orchestrator.ts` —
  `finalizeWorkflow()` gained the generic revalidation pass.

That is the only production file this pass touched. (The training-days/
duration/no-cap-budget fixes in `slot-values.ts` and
`find-pt-program.workflow.ts` were already present on the tree before this
pass started — see §10-11/§13 — this pass only added their missing test
coverage and this documentation.)

## 17. Tests added

`backend/services/ai-service/src/__tests__/agent-workflow-remediation-2.test.ts`
(new, 11 cases).

## 18. Docs updated

This file (new); `docs/conversational-ai-coach-workflow-design.md`,
`docs/conversational-ai-coach-workflow-implementation.md`,
`docs/conversational-ai-coach-workflow-evaluation.md`,
`docs/ai-agent-system-target-architecture.md`,
`docs/ai-agent-system-meeting-summary.md` — each given a short addendum
pointing here. `docs/codex-conversational-ai-coach-evaluation-1.md`,
`docs/codex-conversational-ai-coach-evaluation-2.md`,
`docs/codex-conversational-ai-coach-evaluation-2-final-signoff.md` —
untouched (Codex-owned).

## 19. Remaining findings

- **CRITICAL**: none.
- **HIGH**: none remaining — the deferred-context gap is closed (§3, §8,
  independently confirmed by Codex's own unmodified v2 evaluator, §20).
- **MEDIUM**: none.
- **LOW**: none currently known (the training-days comma-repeated-cue
  variant, the last open LOW from Evaluation #2's final signoff, is now
  fixed — §10).
- **INFO**: the isolated test DB's `postgres-test` hostname is only
  reachable when its container is actually running — Remediation #1
  already established the fix (start it explicitly with `docker compose
  -f docker-compose.test.yml --profile full up -d postgres-test`, then
  point `POSTGRES_HOST=localhost POSTGRES_PORT=55433` at the canonical
  bootstrap scripts); not re-run this pass since no schema changed.
  Workflow DB tests remain not wired into the CI DB-integration gate
  (carried-over INFO from Evaluation #2, explicitly out of scope for this
  focused pass per the source task's own §27).

## 20. Codex v2 evaluator re-run (unmodified)

```bash
npx tsx backend/services/ai-service/src/evaluation/conversational-workflow-v2/evaluate_conversational_workflow_v2.ts
```

Before (Evaluation #2 final signoff): one HIGH failing
(`unsafe-target-deferred-context-before-confirm`), everything else
passing.

After (this pass, unmodified evaluator, re-run from repo root per its own
documented cwd requirement):

```json
{ "PASS": 30, "FAIL": 0, "INFO": 0, "BLOCKED": 0 }
```

**30/30, zero failures.** Specifically confirmed by name:
`unsafe-target-known-context`: PASS. `unsafe-target-deferred-context-before-confirm`:
PASS. `unsafe-correction`: PASS.

## 21. Ready for Codex final re-check?

**YES.**

## 22. Final invariant

> No contextual slot may become confirmable until it has been validated
> against the FULLY RESOLVED context available at the moment the workflow
> is finalized. After confirmation, safety is checked again against fresh
> authoritative context before write.

**YES** — three independent validation stages now enforce this
end-to-end: candidate-time (existing), finalize-time (this pass, new,
generic over every `SlotDefinition.validateContext`), and pre-write
(existing, unchanged). Verified by 11 new DB-backed tests and Codex's own
unmodified v2 evaluator (30/30).
