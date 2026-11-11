# 04 — Functional Requirements

Refined from the brief's suggested FR01–FR20 against the actual BPM (`02-as-is-process.md`, `03-to-be-bpm.md`).
Two requirements were added (FR21 dismissal, FR22 truthful post-confirmation status) because the real process
includes them as first-class outcomes, not afterthoughts. Each FR lists its BPM step(s), evidence status is in
`10-traceability-matrix.md`.

| ID | Requirement | BPM step(s) |
|---|---|---|
| FR01 | Receive and recognize a natural-language workout-plan creation request. | 1–2 |
| FR02 | Extract structured conversational context (intent + candidate entities: goal, frequency, equipment, location) from the request, distinguishing LLM-inferred candidates from authoritative facts. | 2 |
| FR03 | Retrieve the user's authoritative profile and relevant business state (existing program, goal, equipment, workflow/draft state) before deciding what, if anything, to ask. | 3 |
| FR04 | Detect which required slots (training frequency, session length) are missing from both the conversational context and the authoritative profile. | 4 |
| FR05 | Detect when a later user turn corrects or contradicts a previously supplied value, and resolve to the corrected value — never silently averaging or keeping the stale one. | 6 |
| FR06 | Ask only the slots that are genuinely still missing, one question at a time — never re-ask a value already known from the profile or already supplied this conversation. | 5 |
| FR07 | Resolve training frequency (`daysPerWeek`) from profile or user answer. | 4–6 |
| FR08 | Resolve session duration (`sessionMinutes`) from profile or user answer. | 4–6 |
| FR09 | Resolve equipment/training-environment context from the authoritative profile — never asked as a redundant slot when already on file. | 3 |
| FR10 | Retrieve eligible, canonical exercise candidates for the resolved goal/constraints from the real exercise catalog. | 8 |
| FR11 | Generate a personalized multi-day workout-plan draft (never directly persisted) with a human-readable rationale/summary. | 9 |
| FR12 | Present the generated draft as a structured preview, including any relevant safety/equipment/unmatched-exercise caveats. | 12 |
| FR13 | Accept free-text user revision of the pending draft (exercise swap, session length, day count/weekdays, exclusions) without losing already-valid context. | 13a |
| FR14 | Detect and honestly decline an explicitly unsupported revision request, rather than silently accepting it or misinterpreting it as something else. | 13a |
| FR15 | Preserve the pending draft/workflow state across an interrupting knowledge question, and resume the original flow afterward without restarting or losing context. | 7, 13b |
| FR16 | Require one explicit, unambiguous Human-in-the-Loop confirmation action before any persistence — a bare confirmation **text** message must never itself execute the write for a draft of this kind. | 16 |
| FR17 | Validate the draft against deterministic domain rules (every exercise ID canonical and owned/published; every exercise's equipment requirement satisfiable by the user's own equipment) immediately before persistence. | 17 |
| FR18 | Persist exactly what was last previewed/revised and confirmed — no silent regeneration between preview and persistence. | 20 |
| FR19 | Guarantee idempotent confirmation: confirming the same action twice (retry, double submission, repeated question) must never create a second program or duplicate write. | 20 |
| FR20 | Preserve user/session isolation throughout the process — no step may read or mutate another user's profile, draft, workflow, or program state. | all |
| FR21 | Support explicit draft dismissal/cancellation at any point before confirmation, with no persistence and a truthful acknowledgement. | 14 |
| FR22 | Answer any later question about whether the plan was saved truthfully, from authoritative database state only — never inferred from the assistant's own prior chat text, and never hidden behind unrelated historical rows. | post-process, any time |

## Design notes

- FR06/FR09 together express the project's "use authoritative context wherever already known" principle
  (`02-as-is-process.md`, `create-workout-plan.workflow.ts` lines 25–30) — a slot is only a **conversational**
  question when the authoritative profile genuinely has no answer.
- FR16 is deliberately narrower than "any confirmation phrase confirms": the BPM has exactly one Human-in-the-Loop
  gate per draft, reached through one real endpoint, specifically so that a loosely-matched natural-language
  confirmation phrase can never become an unintended write (see `confirmation-boundary.ts`'s own stated design
  intent, `02-as-is-process.md`).
- FR19/FR22 are where this BPM's requirements overlap with the independently-audited Conversational Intelligence
  X4 confirmation-truthfulness work (see `17` cross-reference in `10-traceability-matrix.md`) — reused as evidence,
  not re-derived.
