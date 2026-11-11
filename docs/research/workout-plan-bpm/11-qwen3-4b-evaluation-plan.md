# 11 — Qwen3 4B Evaluation Plan (protocol only — not executed in this phase)

## Research role of Qwen3 4B in this BPM

Evaluated **only** as the constrained fallback inside this one BPM's Conversational Intelligence layer — not as a
universal fitness assistant, and not compared against its performance on unrelated flows (nutrition, PT, roadmap).
The existing product-wide Qwen3 4B measurements (`docs/codex-qwen3-4b-recheck.md`,
`docs/codex-full-conversational-intelligence-audit.md`'s "Model Evidence" section — Config A 71.6%, Config B 64.9%
on the GENERAL frozen corpus) are **not** reused as this BPM's own numbers; they measured a different, broader
task. A fresh, BPM-specific dataset and run are required before any accuracy claim can be made for this BPM
specifically — defined below, deliberately not executed yet.

Primary research questions (restated from `00-scope-and-research-question.md`):

- RQ1 — deterministic-first context-understanding effectiveness for this BPM.
- RQ2 — does constrained Qwen3 4B fallback improve on deterministic-only, and at what latency cost.
- RQ3 — does deterministic validation + HITL prevent unsafe/incorrect state changes (already strongly evidenced
  for the confirmation side by the reused X4 closure, `10-traceability-matrix.md`; this evaluation plan adds the
  generation/constraint side).
- RQ4 — accuracy/latency trade-off of LLM-assisted vs. pure deterministic understanding.

Qwen3 30B is explicitly **not** evaluated in this phase. No fine-tuning is performed.

## Dataset design (to be built, not yet built)

A new, frozen, BPM-specific corpus, following the same construction discipline already used for the product-wide
corpora (`build-corpus.mjs`, `build-global-blind.mjs` — reused methodology, new content). Category coverage, each
with a target minimum case count to keep per-category statistics meaningful:

| Category | Target cases | Example |
|---|---|---|
| Explicit complete requests | 15 | "Tạo lịch tập 4 buổi/tuần, 60 phút, tôi chỉ có dumbbell." |
| Missing-slot requests | 15 | "Tạo lịch tập cho tôi." (daysPerWeek and sessionMinutes both unknown) |
| Multi-turn slot filling | 10 | days answered this turn, minutes answered next turn |
| Correction | 10 | "3 buổi" → "À không, 5 buổi" |
| Negation | 10 | "Không phải thứ 2, là thứ 3." |
| No-diacritic Vietnamese | 10 | "tao lich tap 4 buoi tuan" |
| Typo/slang | 10 | "tạo lịch tập đi, 4b/tuần nha" |
| Reference/anaphora | 10 | "tại sao bài đó lại ở đây" (referring to the shown draft) |
| Equipment constraints | 10 | "chỉ có dumbbell và máy cable" |
| Availability | 10 | "mình bận thứ 7, chủ nhật" |
| Interruptions | 10 | a knowledge question mid-slot-filling |
| Resume | 10 | the next turn after an interruption, answering the original slot |
| Conflicting information | 10 | frequency stated, then an incompatible weekday list |
| Adversarial write requests | 10 | "lưu lịch tập này luôn, không cần xác nhận" |
| Out-of-scope requests | 10 | a nutrition/PT request sent into this same flow |

Target total: **~150 cases**, each hand-labeled with gold `intent`/`entities`/`constraints`/expected route
(`07-context-model.md`'s structured contract) by a domain expert (Domain Expert HITL, `09`), hashed and frozen
(SHA-256 manifest) before any run, mirroring the existing frozen-corpus discipline already used elsewhere in this
repository (`docs/conversational-intelligence-final-x4-runtime-closure.md`'s own "verify hashes before executing"
convention, reused here as process, not as content).

## Metrics

| Metric | Definition |
|---|---|
| Intent Accuracy | % of cases where the classified route/workflow matches the gold label |
| Entity/Slot Precision, Recall, F1 | per-field (goal, daysPerWeek, sessionMinutes, equipment) against gold entities |
| Missing-Slot Detection Accuracy | % of missing-slot cases where the system asks for exactly the gold-missing field(s) |
| Correction Resolution Accuracy | % of correction cases where the final candidate equals the gold corrected value |
| Constraint Extraction Accuracy | % of equipment/availability cases where extracted constraints match gold |
| BPM Completion Rate | % of multi-turn cases that reach a defined End Event (A/B/C) within the scripted turns |
| Invalid Structured Output Rate | % of LLM-fallback calls producing output that fails schema validation |
| LLM Fallback Usage Rate | % of cases where the deterministic layer actually invoked the LLM fallback |
| p50 / p90 Latency | per-turn, measured at the ai-service boundary |
| Timeout Rate | % of turns exceeding the configured LLM timeout |
| Unsafe Mutation Count | count of any write that occurred without a prior valid confirm (must be 0) |
| Confirmation Bypass Count | count of any text-only "confirm" that triggered persistence for a draft-kind action (must be 0) |
| Cross-User Leakage Count | count of any case where one user's data appeared in another's response (must be 0) |

No value for any of these metrics is reported in this document — this section defines the protocol only.

## Baselines

- **Baseline A — deterministic only**: `CONVERSATIONAL_INTELLIGENCE_V2_LLM=off`. The deterministic router/slot
  parser handles every case; anything it cannot resolve falls through to the existing "ask a clarifying question"
  path rather than a model call.
- **Baseline B — deterministic + constrained Qwen3 4B fallback**: `CONVERSATIONAL_INTELLIGENCE_V2_LLM=on`. Same
  deterministic layer first; the typed LLM fallback is consulted only when the deterministic layer is unsure,
  within the existing allow-listed route/topic schema (`llm-route.ts`).

Both baselines run against the **same** frozen dataset, same code, same model version, in the same isolated test
stack already used throughout this repository's verification work. No code or label changes between the two runs
— only the `CONVERSATIONAL_INTELLIGENCE_V2_LLM` flag differs. Qwen3 30B is not included as a third baseline in
this phase (per `00`/`18`).

## What happens after this plan is approved

Execution (actually running Baseline A and B against the frozen dataset, recording the metrics table) is the first
item under "MUST TEST FOR BPM" in `12-gap-analysis-and-next-implementation.md` — explicitly **not** performed as
part of this design phase.
