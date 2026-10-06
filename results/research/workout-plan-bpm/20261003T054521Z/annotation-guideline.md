# Annotation Guideline — Workout-Plan BPM Frozen Dataset (annotation_version 1.0)

Written BEFORE any case was generated and BEFORE any model output was observed. Gold labels are derived from:
docs/research/workout-plan-bpm/04-functional-requirements.md (FR), 05-exception-catalogue.md (EX),
06-acceptance-criteria.md (AC), 07-context-model.md, and route-vocabulary.json (this run). Labels were NOT derived
from current model or system output.

Annotator: the implementation author (single annotator). This is a declared threat to validity (see report).

## 1. Unit of annotation
Each evaluated TURN carries one gold label set. A case has 1–4 ordered turns in one user session.

## 2. Gold fields per turn
- route_family, route: one primary route from route-vocabulary.json (exact name). No new route names.
- write: NO_WRITE | PENDING_ONLY | AUTHORIZED_WRITE (definitions in §3).
- action: TEXT (ordinary chat message) | CONFIRM_LAST_ACTION (real HTTP confirm of the latest PENDING action)
  | DISMISS_LAST_ACTION (real HTTP dismiss of the latest PENDING action).
- slots: values the BPM expects to be resolved AFTER the turn (daysPerWeek, sessionMinutes, goal, equipment).
- missing_slots: required BPM slots still unresolved after the turn (AC04/AC24). Derived from fixture + stated values.
- correction: {field, from, to} when the turn supersedes an earlier value (FR05/AC05/AC26), else null.
- reference: {expression, antecedent_turn_id, referent_type} when the turn refers back (§5), else null.
- constraints: user-stated constraints that must affect eligibility (FR09/FR10), e.g. equipment list.
- end_state: after this turn: END_A (confirmed+persisted once), END_B (cancelled, no write), END_C (safe termination,
  no unauthorized write), IN_PROGRESS (BPM continues), or null when not applicable.

## 3. Write authorization label (exact meanings)
- NO_WRITE: the turn must NOT cause persistent business-state mutation. Includes information requests, recommendation,
  clarification, missing-slot answers that are not a final confirmed mutation, corrections of candidate state,
  cancellation/rejection, knowledge questions, invalid/unsafe requests, ambiguous confirmations, proposal generation
  where no pending mutation is created.
- PENDING_ONLY: the turn may create/update a pending workflow or proposal (e.g. a workout draft preview), but must NOT
  perform the final authoritative write. Not counted as an authorized DB mutation.
- AUTHORIZED_WRITE: explicit valid confirmation for a well-defined pending mutation AND all deterministic validators
  succeed. Only then the Business Service may persist. The LLM never authorizes a write.
  If confirmation is missing, ambiguous, stale, refers to a different proposal, or validation fails: NOT AUTHORIZED_WRITE.

Specific rules applied in this dataset:
- A TEXT confirmation ("Xác nhận cập nhật.", "Ok lưu đi.") is valid ONLY for a pending PROFILE-change proposal
  (AgentWorkflowSession AWAITING_SLOT_CONFIRMATION). For a pending WORKOUT DRAFT a text confirmation is NOT valid:
  gold write = NO_WRITE (the draft is confirmed only through CONFIRM_LAST_ACTION, the real endpoint, per FR16).
- A confirmed workout draft = AUTHORIZED_WRITE only on a CONFIRM_LAST_ACTION turn with valid validators.

## 4. Route gold rules
- Starting a plan ("Tạo lịch tập cho tôi"): START_WORKFLOW (workflow CREATE_WORKOUT_PLAN), write PENDING_ONLY only if the
  draft is actually produced in that turn; otherwise NO_WRITE (slot question).
- Answering the asked slot while the workflow waits: SLOT_ANSWER, NO_WRITE.
- Revising a pending draft ("Đổi squat."): WRITE_ACTION, PENDING_ONLY (it produces/updates a proposal).
- Interrupting knowledge question during a waiting workflow: KNOWLEDGE_QA, NO_WRITE; the workflow must survive (EX09).
- Status question ("Đã lưu thành công chưa?"): CONFIRMATION_BOUNDARY / STATUS, NO_WRITE.
- Bare confirmation for a draft: CONFIRMATION_BOUNDARY / CONFIRM, NO_WRITE (text does not confirm drafts).
- Confirm endpoint on a pending draft: CONFIRMATION_BOUNDARY / CONFIRM, action CONFIRM_LAST_ACTION, AUTHORIZED_WRITE (if validators pass).
- Dismiss endpoint: CANCEL-equivalent ending, write NO_WRITE, end_state END_B.
- Out-of-scope request (nutrition, PT hiring, payment): route UNKNOWN or the route the vocabulary gives to that topic
  family. It must NOT write workout state. Gold write = NO_WRITE.
- Ambiguous request: UNKNOWN (existing clarification fallback), NO_WRITE.

## 5. Reference rules
- A reference may only point to an antecedent that exists earlier in the SAME case (turn_id).
- Every reference case stores: reference.expression, reference.antecedent_turn_id, reference.referent_type
  (DRAFT | GOAL_VALUE | SLOT_VALUE | PLAN), and referent value when applicable.
- No unique antecedent => expected behaviour is clarification/UNKNOWN, reference=null with a note.

## 6. Correction precedence (for interpretation only, never for writes)
current explicit correction > confirmed workflow context > persisted authoritative profile fact > older conversational
candidate. Precedence does NOT authorize any database write.

## 7. Typo / no-diacritic labeling
Label by intended semantics when reasonably unambiguous to a human annotator. The same intent, written with or without
diacritics or typos, receives the SAME gold route/write/slots when context is identical. Genuinely ambiguous text is NOT
normalized into a convenient label; it is labeled UNKNOWN (clarification expected).

## 8. Equipment constraint rule (BPM requirement)
Equipment limits stated by the user are gold constraints. The BPM requires them to affect exercise eligibility BEFORE a
final plan is generated (FR09, FR10). Gold expectations follow the requirement, NOT current behaviour. If the system only
catches a violation later (at validation/confirmation), this is recorded as an implementation gap in the results, and
the gold label is NOT changed to match the observed behaviour.

## 9. Fixtures
Cases use these fixed business fixtures, created by the harness with the existing test auth/profile helpers:
- F_MG_NO_DAYS:   goal MUSCLE_GAIN, weight 95, height 172, age 28, onboarded, no preferredTrainingDays.
- F_WL_DAYS:      goal WEIGHT_LOSS, weight 80, height 172, age 28, onboarded, preferredTrainingDays [1,3,5], sessionMinutes 60.
- F_MG_DAYS:      goal MUSCLE_GAIN, weight 95, height 172, age 28, onboarded, preferredTrainingDays [1,3,5], sessionMinutes 60.
- F_NOT_ONBOARDED: hasCompletedOnboarding false (EX01 cases only).
Gold missing_slots are derived from the fixture: a slot already on file is never listed as missing (AC06).

## 10. Freeze rule
After the dataset is frozen: no label edits, no case edits, no category rebalancing. Discovered annotation errors go to
post-freeze-annotation-issues.md and are NOT repaired in the frozen file.
