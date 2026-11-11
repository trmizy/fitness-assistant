# Research BPM: AI-Assisted Personalized Workout Plan Generation, Revision & Confirmation

*Quy trình tạo, điều chỉnh và xác nhận kế hoạch tập luyện cá nhân hóa bằng AI Agent*

This package narrows the Gymini graduation/research project's **automation and evaluation scope** to one Business
Process Model, grounded in the current codebase. The product itself keeps all of its other capabilities (nutrition,
PT marketplace, payment, etc.); only the research evaluation is scoped down.

## What's in this folder

| File | Contents |
|---|---|
| `00-scope-and-research-question.md` | Why one BPM; selected BPM; in/out of scope; research questions; contribution |
| `01-business-scenario.md` | The concrete end-to-end scenario and end states |
| `02-as-is-process.md` | What the current code actually does, with file/line citations |
| `03-to-be-bpm.md` | BPMN-style spec, Mermaid flow diagram, swimlane diagram |
| `04-functional-requirements.md` | FR01–FR22 |
| `05-exception-catalogue.md` | EX01–EX20 (trigger/detection/behaviour/recovery/end-state/FR/AC for each) |
| `06-acceptance-criteria.md` | AC01–AC42, measurable, tied to FR/EX |
| `07-context-model.md` | Intent/Entities/Constraints/User State/Conversation Context + structured context contract |
| `08-agent-input-output.md` | Enterprise Data Agent & Fitness Recommendation Agent design; Conversational Intelligence's role; formal component I/O table |
| `09-domain-knowledge-hitl.md` | Where each piece of domain knowledge lives; User HITL vs. Domain Expert HITL |
| `10-traceability-matrix.md` | BPM step → FR → EX → AC → component → code → test → missing test → evidence status |
| `11-qwen3-4b-evaluation-plan.md` | Frozen-dataset design, metrics, Baseline A/B protocol — **not yet executed** |
| `12-gap-analysis-and-next-implementation.md` | What must be implemented, tested, is optional, or is out of scope |

## Summary for review

- **Selected BPM**: AI-Assisted Personalized Workout Plan Generation, Revision & Confirmation.
- **Start**: authenticated user sends a natural-language workout-plan request.
- **End A**: plan confirmed and persisted (`WorkoutProgram`/`WorkoutSchedule`, exactly once).
- **End B**: user cancels/dismisses — nothing persisted.
- **End C**: graceful termination — required info/service unavailable, nothing persisted.
- **22 Functional Requirements**, **20 Exceptions**, **42 Acceptance Criteria**, all cross-referenced in the
  traceability matrix.
- **Minimum agent architecture**: Conversational Intelligence (context/intent understanding only) → Orchestrator/
  Workflow-HITL (state machine) → Enterprise Data Agent (authoritative reads) → Fitness Recommendation Agent
  (draft proposal, never persists) → Deterministic Validation (exercise/equipment rules) → Business Service (the
  only component that writes `WorkoutProgram`/`WorkoutSchedule`). No agent was added beyond what the BPM actually
  needs.
- **Existing implementation coverage** (full detail in `10`): of 22 FRs, 6 are independently re-verified this
  session as `IMPLEMENTED_AND_VERIFIED` (all on the confirmation/HITL/isolation side, inherited from the
  just-closed Conversational Intelligence X4 work — see `docs/conversational-intelligence-x4-t10-final-fix.md`),
  9 have a matching named test not re-run in this phase, 6 are partially covered, and **1 is a real, named
  implementation gap** (FR09 — no equipment filter at draft-generation time, only at confirm time).
- **Major remaining gaps**: equipment-aware draft generation (production code); five specific missing tests
  (equipment-rejection at confirm, empty-generation honesty, downstream-failure-at-confirm, double-confirm row
  count, slot-specific correction/interruption) — all listed with priority in `12`.
- **Proposed Qwen3 4B experiment**: a new, frozen, ~150-case, BPM-specific dataset (15 categories), Baseline A
  (deterministic only) vs. Baseline B (deterministic + constrained Qwen3 4B fallback), full metric set defined in
  `11` — **design only, not yet run**. Qwen3 30B and fine-tuning are explicitly excluded from this phase.
- **Files created**: the 13 numbered files above plus this `README.md`, all under `docs/research/workout-plan-bpm/`.
- **No production code was modified** to produce this package.

## Readiness

**READY FOR SUPERVISOR REVIEW.**

Rationale: the BPM is grounded in real, inspected code (not invented); start/end events and in/out-of-scope
boundaries are explicit; FR/EX/AC are numbered, measurable, and traceable to either real evidence or a named,
honestly-disclosed gap; the agent architecture follows from the BPM rather than the reverse; the evaluation plan is
fully specified without any fabricated results; and nothing from the already-signed-off X1–X4 remediation phase was
reopened — it was only reused where it genuinely supports this BPM's own requirements.

What the supervisor is being asked to approve: the BPM boundary itself (01/00), the FR/EX/AC set (04/05/06), and
the proposed Qwen3 4B evaluation protocol (11) — before any of `12`'s implementation/testing items are started.
