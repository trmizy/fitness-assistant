# 06 — Acceptance Criteria

AC01–AC22 map one-to-one to FR01–FR22 (`04-functional-requirements.md`). AC23–AC42 map one-to-one to EX01–EX20
(`05-exception-catalogue.md`). Every criterion is measurable against real DB state and/or real response text —
never "the AI works correctly." Evidence status (does a real test already prove this, for THIS BPM) is in
`10-traceability-matrix.md`, not repeated here.

## FR-derived (AC01–AC22)

- **AC01**: Given a message matching the recognized creation-intent patterns (e.g. containing "lịch tập"/"workout
  plan"), the system routes to the workout-plan creation flow, not a read/search/unrelated intent.
- **AC02**: Given a sentence containing goal, frequency, and equipment in one turn, the structured context produced
  contains all three as distinguishable fields (candidate entities), not a single opaque string.
- **AC03**: Given an authenticated request, the context assembled for generation includes the real profile's
  `goal`/`experienceLevel`/`availableEquipment`/`injuries` as retrieved from the authoritative service — not
  values invented by the LLM.
- **AC04**: If `daysPerWeek` is absent from both the profile and the conversation, the system's next turn is a
  question for that value, not a generated plan using a guessed default.
- **AC05**: Given "3 buổi" then "À không, 5 buổi" in the same unconfirmed context, the final candidate value for
  `sessionsPerWeek`/`daysPerWeek` is 5, not 3 and not an average.
- **AC06**: If `daysPerWeek` is already on file, the system never asks for it again in this flow, and no
  `AgentWorkflowSession` row is created at all when nothing needs asking.
- **AC07**: The persisted/previewed plan's day count equals the resolved `daysPerWeek` value.
- **AC08**: Each day's exercise prescription fits within the resolved `sessionMinutes` (deterministic trim applied).
- **AC09**: The generation step is never asked "what equipment do you have" as a chat question when
  `UserProfile`/`UserEquipment` already has an answer on file.
- **AC10**: Every exercise appearing in the generated draft resolves to a real `Exercise.id` that is
  `PUBLISHED` (or the caller's own `USER_CUSTOM`) — never a bare text name with no catalog identity.
- **AC11**: A generation call for a resolved goal/frequency/duration returns at least one day with at least one
  exercise whenever the catalog has any matching candidate; the draft is not persisted anywhere at this point
  (zero `WorkoutProgram` rows).
- **AC12**: The structured preview returned to the user contains day count, session length, per-day exercises
  (name/sets/reps/rest), and — when applicable — unmatched-exercise and safety/equipment caveats.
- **AC13**: A free-text revision (e.g. "Đổi squat.", "Buổi tập ngắn xuống 45 phút.") changes only the draft's
  `payload` (verified by DB read); no `WorkoutProgram` row exists before or after.
- **AC14**: A revision request for an explicitly unsupported feature (e.g. "Thêm superset.") returns a message
  stating it is unsupported, and the draft's payload is unchanged (byte-identical `weeklySchedule`).
- **AC15**: A knowledge question sent while a draft is `PENDING` does not change the draft's `status`, `payload`,
  or `expiresAt`, verified by a DB read before and after.
- **AC16**: Without an explicit confirm action (dedicated endpoint call), zero `WorkoutProgram` rows exist for this
  action, no matter how many confirmation-sounding **text** messages were sent.
- **AC17**: A confirm attempt on a draft referencing an exercise whose required equipment the user does not have is
  rejected (non-2xx or explicit rejection message) before any `WorkoutProgram` write.
- **AC18**: The persisted `WorkoutProgram`'s day count, session structure, and exercise list exactly match the
  draft payload at the moment of confirmation (not a freshly regenerated plan).
- **AC19**: Confirming the same action twice (two real HTTP calls) results in exactly one `WorkoutProgram` row for
  that `agentActionId`/`sourcePlanId`, verified by a DB count.
- **AC20**: A request using user B's token against user A's session ID, draft `actionId`, or workflow never
  returns A's data and never mutates A's state, verified by a DB read of A's state before and after.
- **AC21**: An explicit dismiss call sets the draft's status to `CANCELLED`; zero `WorkoutProgram` rows exist for
  that action afterward, and a subsequent status question states it was dismissed, not saved.
- **AC22**: A status question after a real confirmed write returns a positive, non-denial answer; a status
  question with no relevant history returns an honest "nothing pending/saved" answer; neither is derived from the
  assistant's own earlier chat text (verified by constructing DB state directly, bypassing prior chat turns).

## Exception-derived (AC23–AC42)

- **AC23**: A generation request from a user with `hasCompletedOnboarding = false` (or no profile row) yields a
  guidance message, not a generated draft, and creates zero `FitnessAgentAction` rows.
- **AC24**: `missingRequiredSlots` for `CREATE_WORKOUT_PLAN` returns exactly `["daysPerWeek"]` (or
  `["sessionMinutes"]`) when only that one value is unknown, never both when one is already known.
- **AC25**: (Documents a known gap — see `12-gap-analysis-and-next-implementation.md`.) No automated test is
  claimed for an equipment-based **draft-time** filter; the only currently-enforced equipment check is at confirm
  time (AC17). This criterion is satisfied by accurate documentation, not by a passing test.
- **AC26**: Given two different `daysPerWeek` values stated in sequence before confirmation, the slot-resolution
  result after both turns equals the second value only.
- **AC27**: A goal-change utterance sent while a `CREATE_WORKOUT_PLAN` workflow is active produces a
  `PROFILE_UPDATE_CONFIRMATION`-style proposal, not an immediate profile write, and the original workflow's row
  (`id`, `status`, `expectedSlot`) is unchanged immediately after that turn.
- **AC28**: A confirm call on a draft whose exercises require equipment absent from the user's `UserEquipment` is
  rejected, verified by a 0-row `WorkoutProgram` count for that action after the call.
- **AC29**: When the generator yields zero valid days, the response text does not contain a
  `WORKOUT_PLAN_PREVIEW`-shaped block, and zero `FitnessAgentAction` rows are left in a state implying one exists.
- **AC30**: When one or more exercise names fail catalog resolution but at least one succeeds, the response states
  a non-zero unmatched count and still returns a preview with the successfully-resolved exercises only.
- **AC31**: A knowledge question asked while a slot is pending returns a real answer **and** a reminder of the
  pending slot in the same response; the workflow row's `updatedAt`/`expectedSlot` are unchanged by that turn
  (compare a DB read immediately before and after).
- **AC32**: After an interrupting turn, supplying the originally-requested slot value resumes the **same**
  workflow `id` (not a new row) to completion.
- **AC33**: A bare cancel utterance during slot-filling, or a dismiss call on a pending draft, results in a
  terminal (`CANCELLED`) status and zero `WorkoutProgram` rows.
- **AC34**: A sequence of two different revision requests on the same draft results in exactly one
  `FitnessAgentAction` row throughout (no new row created per revision), with the payload reflecting the latest
  revision.
- **AC35**: A status question sent after a draft's `expiresAt` has passed (and no confirm/dismiss occurred)
  returns an "expired" answer, not a "pending" or fabricated "saved" answer.
- **AC36**: Two sequential real confirm HTTP calls on the same `actionId` result in exactly one `WorkoutProgram`
  row and the second call's response states the action was already completed, not a new success.
- **AC37**: A status question in a session with no draft/workflow history at all returns the "nothing pending,
  nothing saved" answer verbatim (matching the deterministic template), not a model-generated guess.
- **AC38**: Simulating a downstream persistence failure on confirm leaves the action's status back at `PENDING`
  (not stuck `EXECUTING`, not falsely `COMPLETED`), and zero `WorkoutProgram` rows exist afterward.
- **AC39**: No `Exercise` row is ever created as a side effect of a name that failed catalog resolution, verified
  by an `Exercise` row-count comparison before/after a generation call that includes at least one unmatched name.
- **AC40**: A revision request naming an explicitly unsupported feature leaves the draft's `payload` byte-identical
  before and after the request.
- **AC41**: An HTTP call using a valid token but a `sessionId` belonging to a different user returns 404 and
  leaves that other user's `ChatSession`/`FitnessAgentAction` rows completely unread and unmodified.
- **AC42**: An HTTP confirm/dismiss call using a valid token but another user's real `actionId` leaves that
  action's `status` unchanged, verified by a DB read immediately after the rejected call.
