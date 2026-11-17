# 00 — Scope and Research Question

Date: 2026-10-03. Author: Claude Code (design assistant), for supervisor scope review.

## Why one BPM, not the whole platform

Gymini (the product) contains many subsystems: profile, exercises, workout programs, nutrition, PT marketplace,
conversational AI, recommendation, workflow/HITL, payment, and enterprise/business data. Evaluating "the AI" against
all of that at once produces unfalsifiable claims — accuracy numbers that mix unrelated domains, and a thesis that
cannot state precisely what was tested. This research phase narrows the **evaluation and automation scope** to one
Business Process Model (BPM); the product itself keeps every other capability.

## Selected BPM

**AI-Assisted Personalized Workout Plan Generation, Revision & Confirmation**
*(Quy trình tạo, điều chỉnh và xác nhận kế hoạch tập luyện cá nhân hóa bằng AI Agent)*

Chosen because it is the one creation/mutation flow in the current codebase that already exercises every layer the
research architecture cares about end-to-end: natural-language intake, authoritative context retrieval, draft
generation grounded in a real exercise catalog, a genuine multi-turn revision loop, deterministic domain validation,
and Human-in-the-Loop (HITL) confirmation before persistence — all on a single, already-partially-implemented
workflow (`CREATE_WORKOUT_PLAN`, see `02-as-is-process.md`).

## Start / End (summary — full detail in `04` and the BPM files)

- **Start**: an authenticated user expresses, in natural language, a request to create a personalized workout plan.
- **End A**: the plan is confirmed and persisted (`WorkoutProgram` + schedule rows created or updated, exactly once).
- **End B**: the user cancels the workflow or dismisses the draft.
- **End C**: the process terminates gracefully because required information or a required service cannot be
  obtained (empty generation result, catalog/search unavailable, downstream persistence failure).

## Explicitly out of scope for this research's evaluation

Nutrition plan generation, food substitution, PT search/hiring, payment, subscription, VLM/image goal analysis,
generic health diagnosis, and any claim of broad autonomous fitness-agent behavior. These remain real, working
product features (see `02-as-is-process.md` for how they relate to this BPM at the architecture level, e.g. shared
confirmation-boundary code) but are not part of this phase's Functional Requirements, Exceptions, Acceptance
Criteria, traceability matrix, or Qwen3 4B evaluation plan.

## Research questions (final wording — see `11-qwen3-4b-evaluation-plan.md` for the protocol)

- **RQ1**: How effectively can a deterministic-first, context-aware conversational layer interpret natural-language
  requirements (goal, frequency, equipment, corrections) for personalized workout-plan generation, within this one
  BPM?
- **RQ2**: Does a constrained Qwen3 4B fallback improve context understanding over deterministic parsing alone,
  within this BPM's frozen evaluation set, and at what latency cost?
- **RQ3**: Does deterministic domain validation plus Human-in-the-Loop confirmation prevent unsafe or incorrect
  AI-driven state changes to `WorkoutProgram`/`WorkoutSchedule`, under adversarial and multi-row-history conditions?
- **RQ4**: What is the accuracy/latency trade-off of LLM-assisted context understanding versus pure deterministic
  parsing for this specific BPM, measured on a frozen, labeled dataset?

## Research contribution (conservative framing)

A designed and evaluated context-aware automation architecture for **one** personalized workout-planning BPM,
combining LLM-assisted context understanding, authoritative enterprise business data, domain knowledge (exercise
catalog, equipment, movement taxonomy), deterministic validation, explicit workflow state, and Human-in-the-Loop
confirmation. Not a claim of a general AI agent, a fully autonomous coach, or complete gym automation.

## What this document package is, and is not

It **is**: a BPM specification, functional-requirement/exception/acceptance-criteria catalogue, context model, agent
I/O contract, traceability matrix against the real repository, and an evaluation **protocol** (not yet executed) for
Qwen3 4B inside this one BPM.

It is **not**: new production code, a benchmark execution, a Qwen3 30B evaluation, or a reopening of the already
independently-signed-off Conversational Intelligence X1–X4 defect remediation (see `docs/codex-conversational-
intelligence-final-signoff.md`, `docs/conversational-intelligence-x4-t10-final-fix.md`) — that work is reused as
evidence where it genuinely applies to this BPM (see `10-traceability-matrix.md`) and is not re-litigated.

## Files in this package

See `README.md` for the full index and the supervisor-facing summary.
