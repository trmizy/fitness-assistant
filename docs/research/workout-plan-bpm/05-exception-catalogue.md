# 05 — Exception Catalogue

Twenty exceptions, each grounded in a real code path (`02-as-is-process.md`) or a real architectural invariant.
Acceptance Criteria IDs AC23–AC42 (defined in `06-acceptance-criteria.md`) map one-to-one to EX01–EX20 in order;
FR references point back to `04-functional-requirements.md`.

---

### EX01 — Missing profile / onboarding incomplete
- **Trigger**: user has no `UserProfile` row, or `hasCompletedOnboarding` is false.
- **Detection**: Enterprise Data Agent's profile read returns an incomplete/guarded shape.
- **Expected behaviour**: the user is told plainly that onboarding/profile completion is needed before a plan can
  be generated — never a fabricated plan from empty data.
- **Recovery path**: user completes the missing profile fields; the BPM can then be re-entered from Start.
- **Process end/resume state**: terminates gracefully (End C) if the request is made anyway; no draft is created.
- **Related FR**: FR03, FR04. **Related AC**: AC23.

### EX02 — Missing training frequency
- **Trigger**: `daysPerWeek` is unknown both in the profile and in this conversation.
- **Detection**: `missingRequiredSlots` flags the `daysPerWeek` slot.
- **Expected behaviour**: the system asks exactly this one question and waits.
- **Recovery path**: user answers; slot resolves; flow continues.
- **Process end/resume state**: workflow stays `COLLECTING_SLOTS`, resumable indefinitely until its TTL.
- **Related FR**: FR04, FR06, FR07. **Related AC**: AC24.

### EX03 — Missing/unclear equipment information
- **Trigger**: the authoritative profile has no recorded equipment, and the BPM (by design, FR09) does not ask it
  as a conversational slot.
- **Detection**: none performed today at draft-generation time (named AS-IS gap, `02-as-is-process.md`).
- **Expected behaviour (TO-BE)**: the draft generation step should not silently assume unconstrained equipment;
  at minimum, equipment-dependent exercises must still pass deterministic validation before persistence (FR17),
  so an unusable plan can never be **saved**, even though it may be **previewed** without an equipment filter today.
- **Recovery path**: user states equipment in free text, which is applied at revision time via the real
  substitution service, or the deterministic validator rejects the confirm attempt with a clear reason.
- **Process end/resume state**: draft stays `PENDING`, revisable; confirm attempt may be rejected (loops to review).
- **Related FR**: FR09, FR17. **Related AC**: AC25 (documents the gap explicitly — see `12-gap-analysis...`).

### EX04 — Contradictory information mid-slot-filling
- **Trigger**: user states one frequency, then a different one, before either is confirmed.
- **Detection**: the `CORRECTION` route / slot-answer re-parsing sees a new value for an already-tracked slot.
- **Expected behaviour**: the later value wins; nothing is averaged or merged.
- **Recovery path**: none needed — this is itself the resolution.
- **Process end/resume state**: workflow continues with the corrected value as the only candidate.
- **Related FR**: FR05. **Related AC**: AC26.

### EX05 — Correction of a previously supplied value, after slots were already resolved
- **Trigger**: e.g. a goal/target change proposed mid-flow while a `CREATE_WORKOUT_PLAN` workflow is active.
- **Detection**: `CORRECTION`/`SWITCH_WORKFLOW` route classification.
- **Expected behaviour**: the change is **proposed**, never silently applied; the user is asked to confirm it
  explicitly, and the original workflow is not clobbered without that confirmation.
- **Recovery path**: user confirms or declines the proposed change.
- **Process end/resume state**: either the original workflow resumes untouched, or a proper profile-change
  confirmation sequence begins (a structurally separate HITL step, `AgentWorkflowSession`-based).
- **Related FR**: FR05, FR15. **Related AC**: AC27.

### EX06 — Unsupported/unavailable equipment referenced by the generated draft
- **Trigger**: the generator proposes exercises requiring equipment the user does not have.
- **Detection**: **not** performed at draft-preview time (AS-IS gap); **is** performed at confirm time
  (`validateAiPlanExerciseEquipment`, business service).
- **Expected behaviour**: a confirm attempt on such a draft must be rejected with a clear reason, never silently
  persisted with unusable exercises.
- **Recovery path**: user revises the draft (exclude/substitute) and confirms again.
- **Process end/resume state**: draft stays `PENDING` after a rejected confirm; persistence does not occur.
- **Related FR**: FR17. **Related AC**: AC28.

### EX07 — No eligible exercise found / generation returns nothing usable
- **Trigger**: `generateWorkoutDraft` produces an empty `weeklySchedule`.
- **Detection**: `proposeWorkoutPlan`'s own empty-result check (`02-as-is-process.md`).
- **Expected behaviour**: an honest message inviting the user to retry or clarify goal/frequency — never an empty
  or fabricated preview card.
- **Recovery path**: user rephrases or supplies more detail; BPM re-enters generation.
- **Process end/resume state**: End C (graceful termination without persistence) for this attempt; no
  `FitnessAgentAction` row is left behind in a misleading state.
- **Related FR**: FR11. **Related AC**: AC29.

### EX08 — Exercise catalog/search service unavailable or partially unresolvable
- **Trigger**: `searchExerciseByName` fails for one or more exercise names the generator proposed.
- **Detection**: the `.catch(() => null)` boundary around each per-name lookup; failures are counted, not thrown.
- **Expected behaviour**: the plan is still shown with whatever exercises DID resolve, and the user is told how
  many did not (`unmatchedCount` caveat) — partial success is disclosed, never hidden.
- **Recovery path**: user can proceed with the partial plan, ask for a different exercise, or retry.
- **Process end/resume state**: draft still reaches `PENDING`/preview if at least one day has exercises; otherwise
  falls through to EX07's empty-result path.
- **Related FR**: FR10, FR11, FR12. **Related AC**: AC30.

### EX09 — User interrupts the workflow with a knowledge question
- **Trigger**: a side question ("RIR là gì?") arrives while a slot is pending or a draft is under review.
- **Detection**: `global-turn.ts`'s interruption classification (`02-as-is-process.md`).
- **Expected behaviour**: answer the knowledge question from real data/RAG; append a reminder of the pending
  step; the workflow/draft row itself is never modified by this turn.
- **Recovery path**: none needed — the user simply continues afterward.
- **Process end/resume state**: workflow/draft state identical before and after the interrupting turn.
- **Related FR**: FR15. **Related AC**: AC31.

### EX10 — User resumes the pending slot/draft after an interruption
- **Trigger**: the next relevant turn answers the originally-pending slot or responds to the draft.
- **Detection**: expected-slot priority / pending-draft routing.
- **Expected behaviour**: the same workflow/draft row continues exactly where it left off — no restart, no
  re-asking of already-known values.
- **Recovery path**: n/a — this is the resolution of EX09.
- **Process end/resume state**: flow continues normally from step 4 or 12.
- **Related FR**: FR06, FR15. **Related AC**: AC32.

### EX11 — User cancels
- **Trigger**: a bare cancel utterance ("thôi") during slot-filling, or an explicit dismiss action on a draft.
- **Detection**: `CANCEL` route (slot-filling) / the dedicated dismiss endpoint (draft).
- **Expected behaviour**: workflow/action is marked `CANCELLED`; the user is told plainly nothing was saved.
- **Recovery path**: user may restart the BPM at any time from Start.
- **Process end/resume state**: End B.
- **Related FR**: FR21. **Related AC**: AC33.

### EX12 — User requests revision
- **Trigger**: any free-text message modifying the pending draft (exercise swap, duration, day count, exclusion).
- **Detection**: `tryReviseWorkoutPlanDraft`'s pattern matching against the real pending action.
- **Expected behaviour**: the draft (and only the draft) is updated; all prior exclusions remain applied; the TTL
  is extended; a fresh preview is shown.
- **Recovery path**: n/a — this is itself a normal, repeatable loop.
- **Process end/resume state**: remains `PENDING`, loops back to step 12/13.
- **Related FR**: FR13, FR14. **Related AC**: AC34.

### EX13 — Draft expiration
- **Trigger**: the 15-minute TTL on a `PENDING` `FitnessAgentAction` elapses without confirm/dismiss.
- **Detection**: `expiresAt` compared against current time at read time (never a persisted status flip merely from
  time passing — see `confirmation-boundary.ts`'s documented TTL semantics).
- **Expected behaviour**: a status question after expiry truthfully reports the draft as expired and unsavable;
  the row's own last real event was its creation, correctly reflected by `updatedAt`.
- **Recovery path**: user restates the request to start a fresh draft.
- **Process end/resume state**: effectively End C for that specific draft; a new BPM instance may start.
- **Related FR**: FR22. **Related AC**: AC35.

### EX14 — Repeated confirmation
- **Trigger**: the user (or a retried request) sends a second confirm for an already-`COMPLETED` action.
- **Detection**: the atomic `PENDING → EXECUTING` claim fails (status is no longer `PENDING`); the confirm handler
  reports the real current status instead of attempting a second write.
- **Expected behaviour**: truthful "already saved" response; **zero** additional `WorkoutProgram` rows, enforced
  both at the application level (status-claim race) and at the database level
  (`WorkoutProgram.agentActionId` unique constraint).
- **Recovery path**: none needed.
- **Process end/resume state**: remains at End A; no state change.
- **Related FR**: FR19, FR22. **Related AC**: AC36.

### EX15 — Confirmation question with no pending draft at all
- **Trigger**: "Đã lưu thành công chưa?" with nothing pending and no relevant completed history either.
- **Detection**: `deriveConfirmationState`/`mergeConfirmationState` resolve to `NONE`.
- **Expected behaviour**: an honest "nothing pending, nothing saved in this conversation" answer — never a
  fabricated "✅ Đã lưu thành công!" the way the original (now-fixed) X4 defect produced.
- **Recovery path**: user restates the request if they actually want a plan.
- **Process end/resume state**: no change; this is a pure read.
- **Related FR**: FR22. **Related AC**: AC37.

### EX16 — Downstream persistence service unavailable at confirm time
- **Trigger**: `importAiPlanToSchedule`'s HTTP call to fitness-service throws (network/5xx/etc.).
- **Detection**: the `catch` branch in the confirm dispatcher (`02-as-is-process.md`).
- **Expected behaviour**: a retryable, honest failure message; the action's claim is released back to `PENDING`
  rather than being stranded in `EXECUTING` or falsely marked `COMPLETED`.
- **Recovery path**: user retries confirmation once the service recovers.
- **Process end/resume state**: draft remains confirmable; no partial/corrupt persisted state.
- **Related FR**: FR18. **Related AC**: AC38.

### EX17 — Malformed/unmatched AI-generated exercise name
- **Trigger**: the recommendation engine proposes an exercise name with no canonical catalog match.
- **Detection**: `searchExerciseByName` returns null for that name.
- **Expected behaviour**: the exercise is dropped from the draft, counted, and disclosed (EX08's mechanism) —
  **never** auto-created as a new `Exercise` row (a hard product invariant, not specific to this BPM).
- **Recovery path**: n/a — covered by EX08's own recovery.
- **Process end/resume state**: same as EX08.
- **Related FR**: FR10, FR11. **Related AC**: AC39.

### EX18 — Unsafe or explicitly unsupported request pattern
- **Trigger**: a revision request for a feature the system does not support (e.g. "Thêm superset.").
- **Detection**: an explicit pattern check ahead of the generic revision matchers (`tryReviseWorkoutPlanDraft`).
- **Expected behaviour**: an honest "not supported via chat, here's how to do it elsewhere" answer — never
  silently accepted, never misread as some other edit.
- **Recovery path**: user asks for something supported, or uses the non-chat UI.
- **Process end/resume state**: draft unchanged, remains `PENDING`.
- **Related FR**: FR14. **Related AC**: AC40.

### EX19 — Foreign/cross-session access attempt
- **Trigger**: a request carries a `sessionId` the authenticated caller does not own.
- **Detection**: `ownSession(identity, sessionId)`, called before any domain logic in the turn.
- **Expected behaviour**: rejected (404 "Conversation not found") before any read of that session's drafts/workflow
  state — the caller learns nothing about whether the session even exists for someone else.
- **Recovery path**: none — this is a security boundary, not a retryable business exception.
- **Process end/resume state**: n/a; the BPM never begins for this request.
- **Related FR**: FR20. **Related AC**: AC41.

### EX20 — Cross-user confirm/dismiss attempt on another user's action
- **Trigger**: user B calls confirm/dismiss with user A's real `actionId`.
- **Detection**: the confirm/dismiss handlers scope their own `findFirst`/`updateMany` by the **authenticated**
  `identity.userId`, never a body-supplied user/client ID — the action is simply "not found" for user B regardless
  of its real status for user A.
- **Expected behaviour**: user B gets a not-found/rejected response; user A's own pending/terminal state is
  completely unaffected.
- **Recovery path**: none — security boundary.
- **Process end/resume state**: user A's BPM instance is untouched.
- **Related FR**: FR20. **Related AC**: AC42.
