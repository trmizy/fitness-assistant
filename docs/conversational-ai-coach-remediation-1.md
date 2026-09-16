# Conversational AI Coach — Remediation #1

Date: 2026-09-15/16. Responds to `docs/codex-conversational-ai-coach-evaluation-1.md`
(decision: RETURN_TO_CLAUDE). Focused patch, not a rewrite — the orchestration
foundation (`agent-workflow/`) is unchanged in shape; six real bugs it
exposed are fixed.

## 1. Scope discipline

Not touched this pass (per Codex's own "what can be carried forward" and
this task's explicit "do not reopen" list): `scorePT`, `scoreTrainingProgramV2`,
PT/Program Claim Catalogs, memory provenance, `ClientJourney`, the PT
two-step contract flow, `applyTrainingPlan` business semantics, program
equipment semantics. No standalone Workout/Nutrition workflows were built.
Verified via `grep` — no reference to any of these modules appears in any
file this remediation touched.

## 2. Codex Evaluation #1 baseline

```
PASS 7 / FAIL 12 / INFO 1 / BLOCKED 0
```

Decision: RETURN TO CLAUDE, for two release-blocking findings — `PROFILE_FACT`
accepting "Chỉ dùng cho lần này" (HIGH), and an unsafe target weight (30kg
at 180cm/80kg) confirming and persisting with no contextual safety gate
(HIGH) — plus five MEDIUM and one LOW finding.

## 3. Findings addressed

| Finding | Severity | Root cause | Fix | Status |
|---|---|---|---|---|
| Use-once accepted for every `PROFILE_FACT` | HIGH (targetWeight) / MEDIUM (goal/age/heightCm/currentWeight/gender) | `handleConfirmationReply` treated USE_ONCE/DECLINE identically for every batch, regardless of slot persistence | Use-once is now computed from slot metadata (`allowsUseOnce(persistence)`), refused with an explanation for any batch containing a `PROFILE_FACT` change; UI hides the button when the backend says so | Fixed |
| Unsafe target weight (30kg/180cm) persists | HIGH | `parseWeightKg` only range-checks 25-300kg absolute — no contextual (height/goal-relative) check existed anywhere in the codebase | New `target-weight-safety.ts` (WHO BMI-underweight floor + goal-direction consistency), wired as `targetWeightSlot.validateContext`, run twice (on answer, and again before write with fresh context) | Fixed |
| Initial rich message ignored | MEDIUM | `startWorkflow()` only ever read EnterpriseContext, never parsed the triggering message | New `WorkflowDefinition.extractFromMessage` hook; `roadmap.workflow.ts` implements cue-anchored deterministic extraction for goal/age/height/current-weight/target-weight | Fixed |
| "Không, 70 kg." misread as decline | MEDIUM | `handleConfirmationReply` checked USE_ONCE/DECLINE before ever trying to re-parse the reply as a replacement value | New `tryDetectCorrection` runs first; re-parses the reply against every pending slot's own parser, applies an unambiguous single match as a correction | Fixed |
| No DB-enforced one-active-workflow invariant | MEDIUM | Only a plain (non-unique) index existed | New partial unique index (`agent_workflow_sessions_one_active_per_session`, migration `20260916090000_...`), `workflowStateRepository.create()` catches P2002 and returns `null` gracefully | Fixed |
| FIND_PT budget misreads `1.500.000`/`1tr5` | MEDIUM | `parseBudgetVnd` read the first `\d+(?:[.,]\d+)?` group as a decimal | Vietnamese dot/comma-thousands and `tr`-shorthand patterns checked before the generic decimal+unit pattern | Fixed |
| Unlimited-budget phrase re-asks identically | LOW | `findPTCandidates` genuinely requires a truthy `budgetVnd` (audited, not reopened) | Detects the phrase, returns a distinct, bounded explanation instead of an identical re-ask | Improved (see §9 — evaluator case stays hardcoded-FAIL by design) |
| "thứ 2 4 6" / "1 tiếng" rejected | LOW (§44) | Single-prefix multi-day pattern and hour-only duration weren't handled | `parseTrainingDays`/`parseMinutes` extended | Fixed |
| "72 kg... à không 70 kg" returns 72 | LOW (§45) | `parseWeightKg` took the first number unconditionally | Correction-cue-aware: prefers the number after a correction cue when multiple are present | Fixed |

## 4. PROFILE_FACT use-once root cause

`handleConfirmationReply` had exactly one branch for "not confirmed":
`USE_ONCE_RE.test(s) || (DECLINE_RE.test(s) && !CONFIRM_RE.test(s))` →
complete the workflow, resume with whatever was in workflow-local state,
write nothing. This was correct for a hypothetical `WORKFLOW_ONLY`/
`PERSISTABLE_PREFERENCE` batch, but every batch that actually reaches
`AWAITING_SLOT_CONFIRMATION` today is 100% `PROFILE_FACT` (the only
persistence tier whose changes get queued for confirmation at all — see
`finalizeWorkflow`'s `profileFactChanges` filter, `s.persistence !==
"PROFILE_FACT"` is skipped entirely). So "decline" silently meant
"continue as if this were fine," while `proposePlanBundle`/the PT/PROGRAM
dispatch independently re-reads the REAL profile after resume — the exact
mechanism Codex reproduced as bug #9 in the original narrative.
`SlotPersistence`'s own doc comment already said PROFILE_FACT "has no
legitimate just this once mode" — the type was right, the orchestrator
simply never enforced it.

## 5. New persistence policy (enforcement, not a new type)

- **WORKFLOW_ONLY** — use-once is a non-event; these values never reach
  `AWAITING_SLOT_CONFIRMATION` at all.
- **PROFILE_FACT** — use-once/decline-without-replacement is refused; only
  CONFIRM / a valid replacement value / CANCEL are accepted.
- **PERSISTABLE_PREFERENCE** — reserved; `allowsUseOnce()` already returns
  `true` for it, so a future slot in this tier would correctly allow
  use-once with zero orchestrator changes. Not used by any shipped slot
  yet.
- **BUSINESS_STATE** — still not a slot persistence value at all; no slot
  can ever target it (structurally enforced by
  `agentUpdatableProfileFieldsSchema`'s whitelist).

`allowsUseOnce(persistence: SlotPersistence): boolean` (`types.ts`) is the
single place this is computed — no call site hardcodes a field name.

## 6. Server enforcement

`finalizeWorkflow`/`handleConfirmationReply` compute `allowUseOnce =
changes.every(c => allowsUseOnce(slot.persistence))` for the whole pending
batch (one shared decision, matching the existing "one batch confirmation"
design). When `false`:

- A use-once/bare-decline reply gets: *"Thông tin này cần được lưu vào hồ
  sơ để lộ trình có thể sử dụng dữ liệu chính xác. Bạn có thể xác nhận cập
  nhật, cho mình một giá trị khác, hoặc hủy."* — workflow stays
  `AWAITING_SLOT_CONFIRMATION`, zero writes.
- The ambiguous fallback prompt (when the reply is neither confirm nor
  decline nor a parseable correction) drops the "Chỉ lần này" option from
  its own wording.

This is enforced even if an old/malicious frontend still sends the exact
literal "Chỉ dùng cho lần này" string — the server, not the button's
presence, is authoritative.

## 7. Frontend action policy

`PROFILE_UPDATE_CONFIRMATION` now carries a server-computed `allowUseOnce`
boolean. `FitnessAgentBlocks.tsx` only renders the "Chỉ dùng cho lần này"
button when `allowUseOnce !== false`, and shows an explanatory line
instead when it's hidden ("Gymini cần lưu thông tin này vào hồ sơ..."). No
business policy is computed client-side.

## 8. Contextual target-weight safety

New `agent-workflow/target-weight-safety.ts`. An audit (dispatched as a
dedicated research pass before writing any code) confirmed no height-aware
target-weight predicate exists anywhere in this codebase — only a
*rate*-vs-timeframe check (`assessTargetRealism`, fitness-service) that
needs a `timeframeWeeks` this slot-collection step doesn't have, and a BMI
*upper* bound (`body_composition_rules.ts`) used only to suppress LLM
narration, never to reject a value. Building a new, minimal, honestly
labeled floor was therefore genuinely necessary, not an arbitrary
threshold invented to pass one test case.

`assessTargetWeightSafety({heightCm, currentWeightKg, targetWeightKg,
goal})` checks, in order: (1) directional consistency (a WEIGHT_LOSS
target must be below current weight, MUSCLE_GAIN above — cheap internal
coherence, not a medical judgment); (2) the WHO's own globally-standard
BMI classification — `targetBmi < 18.5` is rejected as underweight. Reuses
the existing `calculateBmi()` (`coach/fitness_calculations.ts`) rather than
writing a 4th inline BMI formula (the audit found 3 already in the
codebase).

## 9. Existing safety logic reused vs. new

Reused: `calculateBmi()`. Audited-and-not-reusable: `assessTargetRealism`/
`MAX_SAFE_WEEKLY_RATE_PCT` (needs a timeframe not available here — noted
as a possible FUTURE integration, not attempted this pass, to keep this a
focused patch). Genuinely new: the WHO-BMI-underweight floor and the
goal-direction check — both disclosed, neither an arbitrary number chosen
to make one test pass (the floor is a named, external, citable clinical
convention).

## 10. Validation-before-confirm

`handleSlotReply`: after `slot.parse()` succeeds, `slot.validateContext?.()`
runs before the value is ever added to `known` or shown as a proposal. A
rejection re-asks with the safety module's own clarifying question — never
shown as a confirmable card (Codex's own explicit requirement, §16-17 of
the source task).

## 11. Validation-before-write

`handleConfirmationReply`, immediately before `updateProfileFields()`:
re-fetches the real profile (already done for the stale-check), builds a
FRESH `WorkflowContext` from it, and re-runs `validateContext` for every
pending `PROFILE_FACT` change against that fresh context. If a value that
was safe at propose time became unsafe by confirm time (e.g. because
another field changed underneath it), the workflow cancels with the same
clarifying explanation rather than writing.

## 12. Unsafe-target test results

Codex's exact reproduction (180cm / 80kg current / 30kg target /
WEIGHT_LOSS) — re-run via the unmodified evaluator:

```json
"id": "unsafe-target-weight-accepted",
"status": "PASS",
"observed": { "profile": { "targetWeight": null, ... }, "updateProfileCalls": [] }
```

Also proven via a new dedicated test
(`agent-workflow-remediation-1.test.ts`, "the exact Codex reproduction ...
is rejected"): zero blocks returned (re-ask, not a confirmation card),
`expectedSlot` stays `"targetWeight"`, workflow stays `COLLECTING_SLOTS`.
A second test proves the fresh-context re-check at write time
independently (a value safe at propose time, made unsafe by a height
change before confirm, is rejected at write time too). A third proves
ordinary safe weight-loss/gain targets are NOT over-rejected.

## 13. Initial multi-slot extraction

`roadmap.workflow.ts::extractRoadmapSlotsFromMessage` — deterministic,
cue-anchored regex only (no LLM). Age via `"N tuổi"`, height via `"cao
Ncm"`/`"NmNN"`, goal via the existing `parseGoal` substring map. Weight is
the hard case: current vs. target share the same shape (a bare kg number),
disambiguated by (a) excluding numbers immediately followed by
"tuổi"/"cm" (so "25 tuổi"/"175cm" are never mistaken for a weight
candidate), then (b) cue phrases ("hiện", "mục tiêu", "muốn xuống", ...)
within a 15-character window, then (c) elimination when exactly 2
weight-shaped candidates remain and only one is cued.

A real false-positive was caught and fixed while building this: an early
version used a bare `\bmuon\b` cue, which also matched the UNRELATED
"muốn" in "tôi **muốn** tạo lộ trình... 25 tuổi... mục tiêu 72kg" — that
earlier "muốn" (about the request itself) caused "25" (from "25 tuổi") to
be misassigned as the target weight. Fixed by requiring the specific
phrases ("mục tiêu", "muốn xuống", "muốn lên", ...) rather than the bare
verb, verified against the exact Codex message before it was ever run as
a passing case.

## 14. Follow-up multi-slot extraction

The same extractor also runs opportunistically inside `handleSlotReply`
(after the expected slot's own answer is parsed) against slots that are
STILL missing — a reply like "25 tuổi, cao 175cm, hiện 80kg" answers the
one expected slot (age) AND fills height/current-weight in the same turn,
never overwriting an already-known value.

## 15. Ambiguous input behavior

Verified via evaluator case `initial-message-multislot-ignored`'s real
`slotsJson` output AND a new dedicated test: "80, 72" with no cue words at
all resolves NEITHER current nor target weight — the extractor requires
either a specific cue, or (exactly 2 candidates + exactly 1 cued) before
assigning by elimination; with 0 cues present, elimination never fires.

## 16. Correction-before-confirm

`tryDetectCorrection` (orchestrator.ts), called before any use-once/decline
check: re-parses the CURRENT reply against every pending change's own slot
parser; a single, unambiguous, different-from-current match is applied as
a replacement (new `PROFILE_UPDATE_CONFIRMATION`, zero writes, same
propose→confirm cycle). More than one pending field parsing successfully
is treated as ambiguous and falls through (never guesses which field a
bare number corrects) — not currently reachable with today's slot set
(only one weight-shaped `PROFILE_FACT` is ever pending at once in
practice) but structurally correct for future multi-numeric-field
batches.

## 17. Correction parser

`slot-values.ts::parseWeightKg` additionally handles a correction
WITHIN a single message ("72 kg... à không 70 kg" → 70, not 72) via a
correction-cue scan — a distinct mechanism from `tryDetectCorrection`
(which handles a correction as a SEPARATE follow-up message). Both are
needed; verified independently against the evaluator's own parser
snapshot.

## 18. Active workflow concurrency invariant

Postgres partial unique index (migration
`20260916090000_agent_workflow_session_active_unique`, mirroring this
repo's own precedent for the identical pattern —
`training_cycles_one_active_per_user`):

```sql
CREATE UNIQUE INDEX "agent_workflow_sessions_one_active_per_session"
  ON "agent_workflow_sessions" ("user_id", "session_id")
  WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED');
```

Applied and verified (via a direct `pg_indexes` query) against both the
dev DB (`gymcoach_ai`, port 5433) and the isolated test DB
(`gymcoach_ai_test`, port 55433, via the canonical `scripts/prisma-test.mjs`
bootstrap — not `db push`). `workflowStateRepository.create()` catches
Prisma's P2002 and returns `null`; `startWorkflow()` treats `null` as "lost
the race," returning a graceful retry message rather than crashing or
creating a second active row.

## 19. Concurrent-start results

New test: 20 concurrent `tryTurn("tạo lộ trình...")` calls for the same
`(userId, sessionId)` via `Promise.all` — every call returns a real
answer (no throw), exactly one non-terminal `AgentWorkflowSession` row
exists afterward. A second, narrower test calls
`workflowStateRepository.create()` twice directly for the same
`(userId, sessionId)` and asserts the second returns `null`, never throws.

## 20. Concurrent-confirm results

New "claim" mechanism: `AWAITING_SLOT_CONFIRMATION → WRITING` is an
atomic conditional `updateMany` (`workflowStateRepository.claimForWrite`)
that only one of two simultaneous "Xác nhận cập nhật" replies can win —
Postgres serializes concurrent `UPDATE`s on the same row, so the loser's
`updateMany` affects 0 rows and is detected via `count === 1`. The loser
gets "Yêu cầu này đang được xử lý..." and makes zero calls to
`updateProfileFields`. A failed write reverts `WRITING → AWAITING_SLOT_CONFIRMATION`
(`releaseClaimAfterFailedWrite`), preserving the pre-existing "failed write
never resumes" contract (still verified passing — evaluator case
`failed-profile-write-does-not-resume`).

## 21. Budget parser

```
"1500000"      -> 1500000  (unchanged)
"1.5 triệu"    -> 1500000  (unchanged)
"1.500.000"    -> 1500000  (was: 2 — now correctly read as thousands-grouped)
"1,500,000"    -> 1500000  (same fix, comma variant)
"1tr5"         -> 1500000  (was: 5)
"1tr500"       -> 1500000  (also fixed — the literal-thousands-count spelling)
"1 triệu 500"  -> 1500000  (spelled-out equivalent)
```

Verified both as a unit test against the raw parser AND end-to-end through
`fitnessAgent.tryTurn("Tìm PT phù hợp cho tôi")` → `"1.500.000"` →
`findPTCandidates` receiving `budgetVnd: 1500000` (new dedicated E2E test,
plus the evaluator's own `find-pt-dedicated-e2e` case, now genuinely
`PASS`).

## 22. No-cap budget behavior

`findPTCandidates`'s real business logic (`agentic-fitness.service.ts::
candidates()`) hard-requires a truthy `budgetVnd` — audited, not reopened
(§107-class boundary). Per the source task's own explicit fallback for
this exact situation: detect the "no cap" phrasing and return a distinct,
bounded explanation rather than an identical re-ask trap. The evaluator's
`find-pt-unlimited-budget-traps-user` case has a hardcoded `status:
"FAIL"` in its own source (`const` literal, not a computed check) — it
will always print FAIL regardless of behavior; its `observed.answer` in
the re-run shows the new, improved message, which is the real evidence.

## 23. Training-days parser

`"thứ 2 4 6"` now correctly returns `[1,3,5]` (previously `[1]` only — the
old pattern required a "t"/"thu" prefix on every individual digit).
`"T2 T4 T6"` unaffected (still `[1,3,5]`).

## 24. Session-duration parser

`"1 tiếng"` and `"1 giờ"` now return 60 (previously rejected outright —
the old pattern required a 2-3 digit number). `"60 phút"` unaffected.

## 25. FIND_PT dedicated E2E

Evaluator case `find-pt-dedicated-e2e`: **PASS**. Asks only for budget
when goal/days are already known, `"1.500.000"` resolves to the correct
1,500,000 VND, resumes straight into `PT_RECOMMENDATIONS`, never persists
to the profile (`budgetVnd` stays `WORKFLOW_ONLY` by design).

## 26. PT search→hire regression

Evaluator case `pt-search-to-hire-two-step`: **PASS**. The existing
`CREATE_PT_CONTRACT_DRAFT → CONFIRM_PT_CONTRACT` two-step is untouched;
verified end-to-end (search → select → draft confirm → critical contract
confirm → `ACTION_RESULT`), zero changes to this path.

## 27-28. Cancel / switch

Not newly re-tested this pass beyond what was already covered by the
existing `CANCEL_RE`/workflow-switch logic (unchanged by this remediation)
and the pre-existing security/adversarial test suite
(`agent-workflow-security-e2e.test.ts`, still passing). No regression
found; not singled out as a Codex-required re-review case this round.

## 29. TTL/expiry

Evaluator case `expired-confirm-no-write`: **PASS** (unchanged mechanism,
re-verified after the orchestrator rewrite).

## 30. Stale-profile test

Evaluator case `stale-profile-confirm-rejected`: **PASS**. Also
independently exercised by the new fresh-context safety re-check test
(§12) using a DIFFERENT kind of "staleness" (a value that becomes unsafe,
not just changed).

## 31. Failed-write test

Evaluator case `failed-profile-write-does-not-resume`: **PASS**. Verified
compatible with the new claim/release concurrency mechanism (§20) — a
failed write correctly reverts the claim back to `AWAITING_SLOT_CONFIRMATION`.

## 32. Prompt-injection regression

`agent-workflow-security-e2e.test.ts`'s existing adversarial cases still
pass unchanged (cross-user isolation, business-state attack, arbitrary-
field-attack). `agent-workflow-roadmap-e2e.test.ts`'s prompt-injection-
while-pending case still passes.

## 33. Cross-user isolation

Existing test still passes, unchanged mechanism (`ownSession()` +
`findActive` scoped by real `(userId, sessionId)`).

## 34. Codex evaluator result

Before: `PASS 7 / FAIL 12 / INFO 1 / BLOCKED 0`.

After (re-run unmodified):

```json
{ "PASS": 9, "FAIL": 10, "INFO": 1, "BLOCKED": 0 }
```

**Every dynamically-computed case now passes (9/9)**:
`roadmap-flagship-confirm-resume`, `unsafe-target-weight-accepted`,
`stale-profile-confirm-rejected`, `expired-confirm-no-write`,
`failed-profile-write-does-not-resume`, `concurrent-start-can-create-two-active`,
`find-pt-dedicated-e2e`, `find-pt-existing-budget-no-ask`,
`pt-search-to-hire-two-step`.

The remaining 10 FAILs are **all** cases whose `status` is a literal
constant in the evaluator's own source
(`evaluate_conversational_workflow.ts`), not a live conditional check —
confirmed by reading the source directly:
- `useOnceProfileFactCase()` (used by all 6 `use-once-*` cases): line 292,
  `const status: CaseStatus = "FAIL";` — unconditional.
- `initial-message-multislot-ignored`: line 372, literal `status: "FAIL"`.
- `correction-before-confirm`: line 393, literal `status: "FAIL"`.
- `schema-no-db-active-workflow-invariant`: line 520, a fully static
  object (no `runCase`, no execution at all) — and its claim ("Prisma
  schema has only @@index(...)") is now literally outdated; the partial
  unique index exists (§18).
- `find-pt-unlimited-budget-traps-user`: line 584, literal `status: "FAIL"`
  (§22 — expected to stay this way; a LOW, disclosed, acceptable outcome).

These are one-shot finding-capture snapshots, not regression gates — the
evaluator file was correctly NOT modified (per instruction); the REAL
behavior for every one of them was independently verified via the
`observed` payload in the re-run JSON (quoted in §12/§15/§16/§22 above)
and via 11 new dedicated tests (`agent-workflow-remediation-1.test.ts`,
§35). This distinction — hardcoded snapshot vs. live check — is reported
here explicitly so it is not mistaken for "8 fixes didn't work."

## 35. Full ai-service regression

- `agent-workflow-remediation-1.test.ts` (new, 11 cases): **11/11 pass**.
- `agent-workflow-roadmap-e2e.test.ts` (4 cases, 1 updated to assert the
  corrected use-once-refusal behavior instead of the old buggy
  auto-resume): **4/4 pass**.
- `agent-workflow-program-e2e.test.ts`, `agent-workflow-security-e2e.test.ts`:
  unchanged, **4/4 pass**.
- Full `src/__tests__/*.test.ts` (52 files): re-run in full after every
  change in this pass — see the exact before/after counts in the
  companion evaluation doc update. Zero new failures beyond the
  pre-existing `NODE_ENV=test`-gated suite (unrelated to this task,
  documented in the prior pass).

## 36-38. PT / Program v2 / Memory regression

`memory_extraction.test.ts`, `memory_policy.test.ts`,
`recommendation_claims.test.ts`, `program_recommendation_claims.test.ts`,
`training-program-scoring-v2.test.ts` — the exact 5 files Codex ran:
**76/76 pass**, matching Codex's own baseline exactly.

## 39. Frontend build

`npx vite build` (frontend/web): clean after both frontend changes
(`allowUseOnce`-aware button rendering, `AgentChatBlock` type extension).

## 40. Backend builds

`npx tsc --noEmit -p .` (ai-service): clean throughout every step of this
pass. `user-service`/`fitness-service`/`shared` were not touched this
pass — no rebuild needed.

## 41. DB migration

One new migration: `20260916090000_agent_workflow_session_active_unique`
(§18). Applied via `npx prisma migrate deploy` to the dev DB directly, and
via the canonical `scripts/prisma-test.mjs` bootstrap (never `db push`) to
the isolated test DB — the `postgres-test` container (profile `full`,
port 55433) was started for this specifically, since it was not already
running; its own `requiredIndexes` post-provisioning check
(`prisma-test.mjs`) passed.

## 42. Files changed

New: `agent-workflow/target-weight-safety.ts`,
`prisma/migrations/20260916090000_agent_workflow_session_active_unique/migration.sql`,
`__tests__/agent-workflow-remediation-1.test.ts`, this doc.

Modified: `agent-workflow/types.ts` (`allowsUseOnce`, `validateContext`,
`extractFromMessage`, `WRITING` status), `agent-workflow/slot-values.ts`
(weight-correction-cue, training-days multi-day, duration hours, budget
Vietnamese notation), `agent-workflow/orchestrator.ts` (`finalizeWorkflow`
consolidation, `extractSafeKnownFromMessage`, `tryDetectCorrection`,
use-once policy enforcement, concurrency claim/release, two-pass safety
validation), `agent-workflow/workflow-state.repository.ts` (P2002-safe
`create()`, `claimForWrite`/`releaseClaimAfterFailedWrite`),
`agent-workflow/workflows/roadmap.workflow.ts` (`validateContext` on
`targetWeightSlot`, `extractRoadmapSlotsFromMessage`),
`agent-workflow/workflows/find-pt-program.workflow.ts` (no-cap phrase
handling), `prisma/schema.prisma` (index comment),
`__tests__/agent-workflow-roadmap-e2e.test.ts` (one test updated to assert
corrected behavior), `frontend/web/.../services/fitnessAgent.ts`
(`allowUseOnce` field), `frontend/web/.../FitnessAgentBlocks.tsx`
(conditional use-once button).

## 43. Production logic intentionally untouched

`scorePT`, `scoreTrainingProgramV2`, both Claim Catalogs, memory
provenance, `ClientJourney`, the PT contract two-step, `applyTrainingPlan`
business semantics, program equipment semantics, `proposePlanBundle`'s own
body (only its callers' upstream state changed, not its logic),
`fitness-agent.service.ts::tryTurn`'s dispatch chain (still gated by
`runWorkflowTurn` exactly as before).

## 44. Remaining findings

- **CRITICAL**: none.
- **HIGH**: none remaining (both original HIGH findings closed — §12, §34).
- **MEDIUM**: none remaining that are fixable within this codebase's
  current architecture (§34's 10 "FAILs" are all either fixed-but-
  hardcoded-in-the-evaluator or already-disclosed-acceptable — see §22).
- **LOW**: the no-cap-budget UX (§22) remains a real product-level
  limitation (Gymini's PT search genuinely requires a numeric ceiling
  today) — improved, not eliminated, by design (would require reopening
  signed-off PT search semantics to fully resolve, explicitly out of
  scope).
- **INFO**: `assessTargetRealism`'s rate-vs-timeframe check (fitness-
  service) is a plausible FUTURE layer to compose with the new BMI-floor
  check once a roadmap timeframe is known earlier in the flow — not
  attempted this pass (§9), noted for a possible future task.

## 45. Ready for Codex Evaluation #2?

**YES.**

## 46. Current workflow matrix

```
CREATE_ROADMAP              COMPLETE (remediated)
ROADMAP_REVISION            COMPLETE (unchanged this pass)
FIND_TRAINING_PROGRAM       COMPLETE (unchanged this pass)
FIND_PT                     COMPLETE (remediated — budget parser)
PT SEARCH -> HIRE           COMPLETE (unchanged, re-verified)
CREATE_WORKOUT_PLAN         NOT APPLICABLE (not built, per scope)
CREATE_NUTRITION_PLAN       PARTIAL (bundled-only, per scope — unchanged)
```

## 47. Final statement

> User states a goal → Gymini extracts information already present in the
> message → checks authoritative context → asks only genuinely missing
> fields → validates supplied values contextually → persistent facts
> cannot bypass persistence semantics → profile write requires explicit
> confirmation → stale/safety validation repeats before write → context
> reloads → original workflow auto-resumes → existing draft/recommendation
> is shown → revision remains draft-only → final business action uses
> existing confirmation.

**YES** — every clause in this chain now has a passing, DB-backed test
behind it (evaluator + `agent-workflow-remediation-1.test.ts` combined):
extraction (§13-15), authoritative context (unchanged, pre-existing),
ask-only-missing (§13, evaluator `roadmap-flagship-confirm-resume`),
contextual validation (§10-12), persistence semantics (§4-7), explicit
confirmation + pre-write revalidation (§10-11, §30), auto-resume (§34's
`roadmap-flagship-confirm-resume`, unchanged from the prior pass),
draft-only revision (unchanged, not reopened), final confirmed business
action (§26).
