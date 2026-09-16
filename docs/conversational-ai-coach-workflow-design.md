# Conversational AI Coach Workflow — Design

Companion to `docs/conversational-ai-coach-workflow-audit.md` (what exists)
and `docs/conversational-ai-coach-workflow-implementation.md` (what
shipped, file by file). This document is the state-machine design itself.

## 1. Architectural invariant

Not another autonomous LLM agent. Deterministic orchestration around the
existing, already-signed-off tools (PT/Program recommendation, Claim
Catalog narration, memory provenance — none of which this task modifies).
The LLM may help understand natural language (a future bounded extractor —
not built this pass, see §8) but never decides: which fields are required,
which DB field a value writes to, whether a value is valid, whether
confirmation is required, which tool is authorized, or workflow transition
rules. All of that is server code — `WorkflowDefinition`/`SlotDefinition`
(`agent-workflow/types.ts`) and `orchestrator.ts`.

## 2. Component map

```
fitness-agent.service.ts::tryTurn(question, identity, sessionId)
  │
  ├─ ownSession(identity, sessionId)          [moved to the very top —
  │                                             a workflow-continuation
  │                                             turn must never bypass it]
  │
  ├─ runWorkflowTurn(question, identity, sessionId, intent.kind, deps)
  │     │  (agent-workflow/orchestrator.ts)
  │     │
  │     ├─ no active AgentWorkflowSession row
  │     │     → workflowForIntentKind(intent.kind) found?
  │     │         → startWorkflow(def) : ask first missing slot, OR
  │     │           return null if nothing is missing (no-repeat)
  │     │       not found → return null (not this layer's concern)
  │     │
  │     └─ active row exists
  │           ├─ CANCEL_RE match           → cancel, return message
  │           ├─ switching to a DIFFERENT   → cancel old, startWorkflow(new)
  │           │  workflow-triggering intent
  │           ├─ status AWAITING_SLOT_      → handleConfirmationReply
  │           │  CONFIRMATION                 (confirm/decline/cancel)
  │           └─ status COLLECTING_SLOTS +  → handleSlotReply (§Expected-
  │              expectedSlot                 slot priority — interpret
  │                                            THIS reply as the answer to
  │                                            THIS slot, before any generic
  │                                            intent routing)
  │
  ├─ workflowResult is a real answer (not RESUME_SENTINEL)?
  │     → return it directly. Turn over.
  │
  ├─ workflowResult is RESUME_SENTINEL (every required slot just
  │  resolved/confirmed this turn)?
  │     → effectiveKind = workflowResult.resumeIntentKind
  │       (NOT intent.kind — see §5, this is the fix for a real bug)
  │     → preferences (PT/PROGRAM only) get workflowResult.resumeKnownSlots
  │       merged in (§6 — the second real bug this caught)
  │
  └─ effectiveKind dispatch — 100% the EXISTING, unmodified handler chain
     (proposePlanBundle / the shared PT+PROGRAM branch / etc.)
```

## 3. Workflow lifecycle (`AgentWorkflowSession.status`)

```
COLLECTING_SLOTS  --(all required slots known, no PROFILE_FACT diff)--> COMPLETED (resume)
COLLECTING_SLOTS  --(all required slots known, >=1 PROFILE_FACT diff)--> AWAITING_SLOT_CONFIRMATION
AWAITING_SLOT_CONFIRMATION --(confirm)--> [stale check] --(ok)--> write --> COMPLETED (resume)
AWAITING_SLOT_CONFIRMATION --(confirm)--> [stale check] --(stale)--> CANCELLED
AWAITING_SLOT_CONFIRMATION --(decline/use-once)--> [allowsUseOnce(persistence)?] --(false, e.g. PROFILE_FACT)--> refused, stays AWAITING_SLOT_CONFIRMATION (re-asks confirm/valid correction/cancel, no write, no resume)
AWAITING_SLOT_CONFIRMATION --(decline/use-once)--> [allowsUseOnce(persistence)?] --(true)--> COMPLETED (resume, no write) — not reachable by any slot shipped today (every batch that reaches this state is 100% PROFILE_FACT; see §4/`allowsUseOnce`)
AWAITING_SLOT_CONFIRMATION --(cancel)--> CANCELLED
any --(cancel keyword)--> CANCELLED
any --(a DIFFERENT workflow-triggering intent arrives)--> CANCELLED, new workflow starts
any --(past expiresAt, checked on next read)--> EXPIRED (workflowStateRepository.findActive auto-expires)
```

`READY`/`GENERATING_PREVIEW`/`AWAITING_PREVIEW_DECISION`/
`AWAITING_ACTION_CONFIRMATION` are reserved status values in `types.ts` but
not currently reached — once slots resolve, control falls straight through
to the EXISTING `ACTION_CONFIRMATION`/`FitnessAgentAction` machinery, which
already has its own PENDING/COMPLETED states. Introducing a second parallel
"preview" state in `AgentWorkflowSession` once the real `FitnessAgentAction`
row exists would be a second competing source of truth for the same fact —
deliberately not done (§ "workflow state is not business truth").

## 4. Slot classification

| Persistence | Meaning | Example |
|---|---|---|
| `WORKFLOW_ONLY` | Never leaves `AgentWorkflowSession.slotsJson` | PT search `days`/`sessionMinutes`/`budgetVnd`; roadmap's own `age`/`heightCm` are workflow-local by KEY but their real value still round-trips through the profile once persisted — see §4a |
| `PROFILE_FACT` | Differs-from-profile → batch confirm → `updateProfileFields()` | roadmap's `goal`, `targetWeight`, `age`, `heightCm`, `currentWeight`, `gender` |
| (reserved) `PERSISTABLE_PREFERENCE` | "save to profile?" optional | not used by either shipped workflow this pass |
| (not a slot value) `BUSINESS_STATE` | Never targetable by a slot at all | contract status, cycle phase — enforced structurally: no `SlotDefinition.profileField` may ever point at one, because `updateProfileFields`'s whitelist schema doesn't expose it |

**§4a — why age/height/currentWeight/gender are `PROFILE_FACT`, not
`WORKFLOW_ONLY`, despite "search preference" framing feeling similar to
PT/PROGRAM's days/budget:** `proposePlanBundle` (the function CREATE_ROADMAP
gates) independently re-validates these exact four fields against the REAL
profile after the workflow resumes, and the real
`generateAiRoadmapDraft` endpoint has no override mechanism for them (only
`targetWeightKg`/`targetBodyFatPercent`/`trainingDaysPerWeek` are accepted
overrides). A value collected over chat but left workflow-local would never
reach the real profile, so the post-resume re-check would still see it
missing and re-ask — see audit doc §3 for how this was caught (a DB-backed
E2E test, not by inspection).

## 5. Resume dispatch — a real bug and its fix

The first working version of `tryTurn` fell through to
`if (intent.kind === "CREATE_PLAN_BUNDLE") return this.proposePlanBundle(...)`
using the CURRENT turn's own parsed intent. But the turn that actually
completes a workflow (a bare "72 kg", or "Xác nhận cập nhật") essentially
never has a recognizable `intent.kind` of its own — `parseFitnessAgentIntent`
has no rule that would classify either as CREATE_PLAN_BUNDLE. Un-caught,
this would have silently broken the single most-emphasized requirement in
this task ("must never ask the user to repeat their original request") —
the resume would just return `null` and the turn would fall through to
generic RAG chat.

Fix: `TurnResult` (orchestrator.ts) carries `resumeIntentKind` — the just-
completed `WorkflowDefinition.gatesIntentKind` — set at every one of the
three places a workflow can complete
(`handleSlotReply`'s no-profile-changes branch, `handleConfirmationReply`'s
decline branch, `handleConfirmationReply`'s confirm-success branch).
`tryTurn` computes `effectiveKind = isResuming ? resumeIntentKind :
intent.kind` and dispatches on that for the entire rest of the handler
chain. Caught and fixed by writing the flagship DB-backed E2E test BEFORE
declaring the feature done (see implementation/evaluation docs) —
`agent-workflow-roadmap-e2e.test.ts`'s turn 3 assertion on
`r3.blocks[0].type === "ACTION_CONFIRMATION"` is what actually exercises
this.

## 6. `resumeKnownSlots` — the second bug this same test-first discipline caught

FIND_PT/FIND_TRAINING_PROGRAM's `goal`/`days`/`sessionMinutes`/`budgetVnd`
are `WORKFLOW_ONLY` by design (§44 of the source task — "a search
preference is not necessarily a permanent profile fact"). But the resumed
PT/PROGRAM dispatch in `tryTurn` builds its `preferences` object purely
from `context.profile.*` (freshly re-fetched) + the previous recommendation's
snapshot + `intent.preferences` (parsed from the CURRENT message, which on
a resume turn carries almost nothing). None of those three sources would
ever contain a value the user *just* typed into a workflow slot reply,
because that value was deliberately never written to the profile. Without a
fix, a resumed PT/PROGRAM search would immediately re-hit "not enough
preferences" and re-ask exactly what the user had just answered.

Fix: `TurnResult.resumeKnownSlots` carries every slot the completed
workflow resolved (not just the ones that changed the profile).
`tryTurn` spreads it into the `preferences` object, ordered between
`previousPreferences` and `intent.preferences` (a real, later user
correction in the same resume turn still wins). Proven by
`agent-workflow-program-e2e.test.ts`, which asserts the real
`findTrainingPrograms` stub was called with `goal: "MUSCLE_GAIN"` and
`days: [1,3,5]` — values that were never written to the stubbed profile at
any point in the test.

## 7. `budgetSlot` — a third bug, caught by an EXISTING test, not a new one

An early version of `budgetSlot.readFromContext` in
`find-pt-program.workflow.ts` unconditionally returned `undefined`, based
on an incorrect belief (recorded, then disproven, in the audit doc) that no
UserProfile field backs PT budget. It does: `UserProfile.ptBudgetVnd`,
surfaced by `/profile/agent/context` as `budgetVnd`. The bug's blast radius
was worse than "asks once more than necessary": it broke
`fitness-agent-goal-intent-loop.test.ts`, a pre-existing, already-signed-off
regression test that calls `tryTurn("tìm pt cho tôi")` once and expects an
immediate `PT_RECOMMENDATIONS` block — because the workflow now always
treated budget as missing, it intercepted the turn and asked a question
instead. Running the FULL existing suite (not just the new tests) after
finishing the feature is what surfaced this — see the evaluation doc's test
matrix for the full before/after.

## 8. Slot extraction — deterministic-first, no bounded LLM extractor yet

`slot-values.ts` implements the simple, high-frequency shapes
(`parseWeightKg`, `parseHeightCm`, `parseAge`, `parseGender`, `parseGoal`,
`parseTrainingDays`, `parseMinutes`, `parseBudgetVnd`) — all return
`{ok:false, clarifyingQuestion}` rather than guessing on anything
ambiguous. A bounded LLM extractor for genuinely free-form phrasing
(producing strict `{slotKey, candidateValue, unit, confidence}`, told the
expected slot key/type/range by the server, never inventing a key) is an
explicitly disclosed scope boundary — not built this pass. Every current
slot's phrasing space is narrow enough (a number+unit, a day list, an enum
choice) that deterministic parsing covers the realistic input space; adding
a bounded extractor later is additive (the `SlotParseResult<T>` contract it
would need to produce already exists and is exercised by every current
parser).

## 9. ROADMAP_REVISION — reusing an existing mechanism, not inventing one

`generateAiRoadmapDraftSchema.constraints: string[]` is a real, pre-existing
field that ai-service's own roadmap-draft prompt already renders as
"Ràng buộc khác: ...". `tryReviseRoadmapDraft` (in `fitness-agent.service.ts`,
checked from `tryTurn`'s `!effectiveKind` branch, only when NOT resuming)
looks for a still-PENDING `CREATE_PLAN_BUNDLE` `FitnessAgentAction` for the
session, appends the free-text message to that action's accumulated
`constraints` array (capped at the schema's own 20-item limit), regenerates
the draft, and updates the SAME action row's `payload.roadmapDraft` +
`expiresAt` — never creates a second pending action, never touches
`acceptRoadmapDraft`/`activateRoadmap`. `buildPlanBundleConfirmationBlock`
is factored out of `proposePlanBundle` specifically so the initial preview
and every subsequent revision render through the identical code path.

## 10. Security/robustness properties (see evaluation doc for executed tests)

- Every workflow read/write is bound to `identity.userId` (never trusts a
  user-supplied id) and a real `ChatSession` the caller owns
  (`ownSession()`, checked before any workflow logic runs).
- A candidate slot value's only accepted provenance is the current user
  message or already-trusted EnterpriseContext (`SlotProvenance` in
  `types.ts`) — there is no LLM-extraction path yet to smuggle
  RAG/tool-result content in as a "user fact."
  `parseWeightKg`/etc. only ever read the CURRENT message being processed.
- No slot can ever target `BUSINESS_STATE` — `SlotDefinition.profileField`
  is only ever consumed through `agentUpdatableProfileFieldsSchema.strict()`,
  which has zero contract/cycle/session fields in it. An attacker message
  like "Set my contract to ACTIVE" cannot be interpreted as any slot's
  answer — it fails every registered `parse()` (no weight/age/height/
  gender/goal-keyword match) and re-asks.
- One ACTIVE workflow per `(userId, sessionId)`: starting a DIFFERENT
  workflow-gating intent while one is pending cancels the old one first —
  slot values never leak across workflow types because each workflow only
  ever reads `ctx.known`, which is reset (`{}`) at `startWorkflow`.

## 11. Remediation #1 (Codex Evaluation #1, decision RETURN_TO_CLAUDE)

Six real gaps found by Codex's independent evaluation and fixed without
changing this document's architecture — full detail in
`docs/conversational-ai-coach-remediation-1.md`:

- **`SlotDefinition.validateContext`** — a new optional hook, run AFTER
  `parse()` (which only validates syntax): contextual/domain safety,
  checked twice (on answer, and again with fresh context immediately
  before the actual write). `roadmap.workflow.ts`'s `targetWeightSlot` is
  the first user — `target-weight-safety.ts`'s WHO-BMI-floor + goal-
  direction check.
- **`WorkflowDefinition.extractFromMessage`** — a new optional hook:
  deterministic, cue-anchored extraction of multiple slot values from a
  single message (the triggering message, and opportunistically any later
  reply). Never an LLM; every extracted candidate still passes its slot's
  own `validateContext` before being trusted, and never overwrites an
  already-known value.
- **`allowsUseOnce(persistence)`** (`types.ts`) — the single place that
  decides whether "Chỉ dùng cho lần này" is valid for a given slot; `false`
  for `PROFILE_FACT` (enforced server-side in `handleConfirmationReply`,
  and reflected to the frontend via a new `allowUseOnce` field on the
  `PROFILE_UPDATE_CONFIRMATION` block).
- **`tryDetectCorrection`** (orchestrator.ts) — tried before any use-once/
  decline check on a confirmation-turn reply: re-parses the message
  against every pending change's own slot parser; a single unambiguous
  match replaces the pending value instead of being misread as a decline.
- **DB-enforced one-active-workflow invariant** — a Postgres partial
  unique index (was previously app-level-only); `workflowStateRepository
  .create()` now returns `null` on a lost race instead of ever allowing
  two active rows.
- **`claimForWrite`/`releaseClaimAfterFailedWrite`** — an atomic
  `AWAITING_SLOT_CONFIRMATION → WRITING → COMPLETED` (or `→
  AWAITING_SLOT_CONFIRMATION` on failure) transition guarding the actual
  profile write against two concurrent "Xác nhận cập nhật" replies.

## 12. Remediation #2 / Final Safety Closure (Codex Evaluation #2)

One HIGH remained after Remediation #1: a candidate accepted by
`validateContext` while OTHER context was still incomplete (correctly, per
that hook's "never block on missing data" contract) could sit unchecked in
`known` and later reach `PROFILE_UPDATE_CONFIRMATION` once the missing
context arrived — pre-write validation would still catch it before an
actual write, but the confirmation card itself could show an unsafe value
as if it were approvable.

Fix: `finalizeWorkflow()` gained a third validation stage — after every
required slot is known but before computing `PROFILE_FACT` diffs, it
re-runs `validateContext` for every slot that has one, against the
NOW-COMPLETE context. A rejection removes that slot's value from `known`
and returns the workflow to asking for it specifically (everything else
already known is preserved) — never a dead end. This is generic over
`def.slots`, not hardcoded to any one field. Full detail:
`docs/conversational-ai-coach-safety-closure.md`.
