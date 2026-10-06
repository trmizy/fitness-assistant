# 01 — Business Scenario

## Core scenario

An authenticated Gymini user asks, in natural language, for a personalized workout program:

> "Tôi muốn giảm mỡ, tập khoảng 4 buổi mỗi tuần. Tôi chỉ có dumbbell và thường tập ở nhà."
> ("I want to lose fat, train about 4 sessions a week. I only have dumbbells and usually train at home.")

The system must:

1. understand the request (intent + entities: goal, frequency, equipment, location);
2. combine it with the user's own authoritative profile/business data (goal already on file, known equipment,
   existing program, injuries, experience level);
3. identify missing or conflicting information (e.g. frequency stated but session length unknown; a later message
   contradicts an earlier one);
4. ask follow-up questions only when genuinely required — never re-ask something already known from the profile;
5. retrieve suitable exercise knowledge (a real, canonical exercise catalog, filtered/ranked by the user's goal and
   available data — see `09-domain-knowledge-hitl.md`);
6. generate a workout-plan **draft** (never directly persisted);
7. validate the draft against deterministic domain/business rules before it can ever be saved;
8. let the user revise the plan in further natural-language turns, preserving everything already valid;
9. require one explicit, unambiguous confirmation step (Human-in-the-Loop) before any write;
10. persist the program only after that confirmation, and only exactly what was last shown to the user.

## Concrete walkthrough (grounded in the current implementation — see `02-as-is-process.md` for file references)

1. User: *"Tạo lịch tập cho tôi."* ("Create a workout schedule for me.")
2. System resolves `daysPerWeek`/`sessionMinutes` from the authoritative profile if already known; otherwise asks
   exactly one missing slot at a time (e.g. *"Mỗi buổi bạn có khoảng bao nhiêu phút?"*).
3. User answers; the system generates a weekly schedule from real, canonical exercises and shows it as a structured
   preview card with a save/dismiss affordance, plus any relevant safety/equipment caveats.
4. User: *"Đổi bài squat."* / *"Buổi tập ngắn xuống 45 phút."* / *"Tôi tập được thứ 3, 5, 7."* — any of these revise
   the **draft only**; nothing is written to the database yet.
5. User bấm **Xác nhận** (confirm) on the card (not a free-text message — see `04-functional-requirements.md`
   FR16). The system validates the draft's exercises and equipment one more time, then persists exactly the
   previewed plan.
6. A later "Đã lưu thành công chưa?" ("Was it saved successfully?") must answer truthfully from the real database
   state — never from the assistant's own earlier text, and never hidden by unrelated history (see
   `docs/conversational-intelligence-x4-t10-final-fix.md`, reused as evidence in `10-traceability-matrix.md`).

## End states

- **End Event A — Confirmed and persisted**: the user explicitly confirms the draft (via the real `/confirm`
  endpoint behind the preview card); exactly one real `WorkoutProgram` (with its days/exercises) and the matching
  `WorkoutSchedule` rows are created or idempotently updated.
- **End Event B — Cancelled**: the user dismisses the draft (via the real `/dismiss` endpoint) or sends a bare
  cancel utterance while the workflow is still collecting slots; nothing is persisted.
- **End Event C — Graceful termination without persistence**: required information or a required service cannot be
  obtained — the exercise generator returns nothing usable, the exercise-search/catalog lookup fails, or the
  downstream persistence call itself fails — and the user is told honestly, with the draft left in a state they can
  retry or abandon (never silently marked as if it succeeded).

## Actors

- **The user** — the only actor who can supply the original request, corrections, revisions, and the confirmation
  or cancellation decision.
- **The system**, internally composed of (see `03-to-be-bpm.md`, `11-agent-input-output.md` — numbering carried
  from `08` in the brief, file named `08-agent-input-output.md` in this package):
  - Conversational Intelligence (context/intent understanding),
  - the Workflow/HITL layer (slot state, draft state, confirmation gating),
  - the Enterprise Data Agent (authoritative reads),
  - the Fitness Recommendation Agent (draft generation),
  - Deterministic Validation (exercise/equipment rules),
  - the Business Service (the only component that ever writes `WorkoutProgram`/`WorkoutSchedule`).
