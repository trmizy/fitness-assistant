# E3 Nova warmup — CLAIM_PROMPT_V4_1 (RAG reference contract)

Status: offline candidate. Owner decision `E3_NOVA_V4_1_REMEDIATION_APPROVED_FOR_OFFLINE_IMPLEMENTATION_ONLY`.

Not approved for any payload, signature, ledger or AWS call. Every model-facing payload differs from V4, so the owner must re-approve.

Evidence labels:
- CODE AUDIT and TEST FIXTURE for the code and tests;
- REAL HTTP/API only for the run-3 evidence it analyses.

## Why

Run-3 (V4, 4 measurements + 8 inferences):

| Outcome | Count | Detail |
| --- | --- | --- |
| ELIGIBLE | 3/8 | all Context |
| BLOCKED (RAG) | 3/4 | reference identity |
| FAILED | 2 | one RAG truncated at `max_tokens`; one Context missing `proposedAction` |

Replaying the preserved outputs under the same verifier and context reproduces all 8 verdicts.

### Classification of every reference in the run-3 RAG outputs

| Class | Meaning | Run-3 |
| --- | --- | --- |
| A | Real ID in the wrong namespace | `evidenceIds` held excerptIds (`source:hash16`) instead of sourceIds. 5 + 5 IDs in the two CAL06 outputs; also in both CAL01 outputs |
| B | ID absent from the input | none |
| C | Real source/excerpt that is not allowed in this attempt | `CODE_E1RM` (a `CODE_PRODUCT_DEFINITION` excerpt) cited in both CAL01 outputs |
| D | Context/instruction contradiction | the cause of C. `evidenceProvenance` lists every reference of a knowledge claim, so C21 shows `CODE_E1RM`. The V2 provenance line says sourceLinks must include every bound excerptId. `allowedReferences.scientificSources` and the verifier accept `PRIMARY_SCIENTIFIC` only |
| E | Fully fabricated reference | none (run-1/run-2 C20 hashes are not repeated) |

In the CAL06 outputs, `claimLinks` (C12/C01 id + hash) and `sourceLinks` were correct and complete; only the namespace was wrong.

`CODE_E1RM` is part of the owner-approved C21 record in the claim map (`readScope CODE_NOT_SCIENTIFIC_EVIDENCE`). It is not changed, not added to the scientific allowlist and not removed.

## What V4.1 changes (model-facing only)

- **`allowedReferences.citationManifest`:** one entry per approved knowledge claim, containing:
  - the claim id and hash;
  - `evidenceIds` (sourceIds);
  - `sourceLinks` (sourceId → excerptIds).

  It is derived from the same `PRIMARY_SCIENTIFIC` references and `excerptId` function that `verifyClaimAnalysis` checks.
- **`evidenceProvenance[].citable`:** `true` only for `PRIMARY_SCIENTIFIC`. The V2 provenance line is replaced so that non-citable excerpts are context only.
- **ID namespace line:** evidenceIds hold sourceIds only; excerptIds live only in `sourceLinks`.
- **Citation rules:**
  - copy the manifest entry exactly;
  - one citing claim per knowledge claim;
  - only `GENERAL_PRINCIPLE`/`PERSONAL_HYPOTHESIS` cite;
  - `OBSERVATION`/`MEASUREMENT_LIMITATION` keep `evidenceIds=[]`.
- **REQUIRED KEYS line:** all 7 `analysis` keys, `"proposedAction":null` never omitted, and no server fill.
- **FORMAT line:** compact single-line JSON, no repeated ID in a list.
- **e1RM wording template:** units after both numbers ("từ <baselineKg> kg lên <currentKg> kg, mỗi số chỉ kèm đơn vị một lần"). This follows run-3 "80 kg lên 80 kg kg".

### Unchanged

- private `ClaimContext`;
- `knowledgeClaims`/`scientificSources` allowlists;
- `ClaimAnalysisSchema`;
- `verifyClaimAnalysis`;
- the content gate;
- failure counting and stop rules (`maxFailures` 2, retries 0);
- the owner interleave (now applied to V4 and V4.1);
- the analysis-only envelope completion (`completeClaimEnvelopeV4`, empty allowlists only).

Nothing is repaired after generation: an excerptId in `evidenceIds` or a missing `proposedAction` still fails exactly as in run-3. V1–V4 prompts are byte-identical; the V4 synthetic digests are pinned in the new test.

## Output size

Estimates use chars/output-token from the 7 complete run-3 outputs (2.36–2.90). This is not a tokenizer and the figures are not measurements.

| Case | Answer shape | Size |
| --- | --- | --- |
| CAL01/RAG | ideal manifest copy (C21 = 5 sources/10 excerpts, C10 = 1/1) | about 1.0–1.3k tokens compact, 1.4–1.7k pretty-printed |
| CAL01/RAG | the run-3 #6 shape (C21 references repeated on the observation and the limitation) | about 2.3–2.8k tokens, above the 2048 cap, consistent with the truncation |
| CAL06/RAG | ideal | about 0.8–0.95k compact |

`maxTokens` stays 2048. No required excerpt is dropped.

### Input growth (model-facing characters)

| Payload | User chars | System chars |
| --- | --- | --- |
| CAL01/RAG | +7% (17,763 → 18,998) | +15% (7,845 → 9,027) |

Run-3 measured CAL01/RAG at 9,760 input tokens. The V4.1 estimate is about 10.7k, still below the 12,000 per-call cap but with a thinner margin. The billed measurement will decide.

## Failure semantics (current code, unchanged)

- **Counted as failures:** `session.ts` adds one failure for a provider error (including `max_tokens`, refusal and guardrail stops) or a parse error (`INVALID_JSON`, `SCHEMA_INVALID`). Measurement failures also count and stop.
- **When the run stops:** at `maxFailures` (2) the ledger state becomes stopped, and the runner breaks after the current row.
- **BLOCKED is not a failure:** reference, identity and content gate verdicts are computed in the runner after the session and never increment the counter.
- **Three distinct outcomes:**
  - FAILED: generation or parse failure, counted;
  - BLOCKED: generated, then gated;
  - ELIGIBLE: generated, not gated, `DEV_REVIEW_ONLY`.
- **Run-3 stop:** run-3 stopped after its 8th row because the second failure was that row.

## Tests

New file: `ai-coach-claim-prompt-v4-1.test.ts`, 13 tests. A synthetic fixture option reproduces the corpus shape: multi-excerpt C21, an excerpt shared with C06, and a `CODE_E1RM` reference. With no option, the fixture is byte-identical to the historical one.

The tests cover:
- V1–V4 bytes, and V4.1 = V4 + flags + manifest only;
- the system contract;
- the manifest against verifier expectations;
- a passing manifest copy, including a shared excerpt;
- run-3 shapes still BLOCKED:
  - excerptId in evidenceIds;
  - unknown sourceId;
  - product-code citation;
  - missing excerpt;
  - duplicates;
- duplicate expansion size;
- Context server derivation;
- missing `proposedAction` not repaired;
- over-abstention for CAL01/CAL06-like cases;
- e1RM wording as reviewer-only;
- session truncation and schema failures counted with raw kept;
- runner interleave with BLOCKED rows not counted;
- stop after two schema failures;
- Nova-only config.

Regression scope: `ai-coach-*`, `advisory-*`, `scientific-claim-map-v3`, with the real Frozen V2 artifact dir and `FITNESS_DISABLE_REDIS=true`, at `883946c3`: 427 tests, 425 pass, 0 fail, 2 skipped (trust root present on this machine).

## Open owner decisions

1. Approve or reject the 4 V4.1 payloads (new hashes) and the V4.1 contract, including the "one citing claim per knowledge claim" and "OBSERVATION/MEASUREMENT_LIMITATION do not cite" restrictions, which are prompt rules, not schema rules.
2. Accept the thinner input-token margin on CAL01/RAG, or decide separately on context size.
3. E01 is still pending; V4.1 does not touch it.
