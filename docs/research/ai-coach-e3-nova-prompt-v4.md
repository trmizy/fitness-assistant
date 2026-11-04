# E3 Nova: CLAIM_PROMPT_V4 structural candidate

2026-11-04 · branch `feat/e3-nova-prompt-v4` from `c49e0991`. Evidence: **CODE AUDIT / TEST FIXTURE**, plus public AWS documentation read on 2026-11-04. No AWS request, measurement or inference. V4 is unapproved; model behaviour under V4 is **NOT_MEASURED**.

## Run-2 root causes (REAL HTTP/API outputs, CAL01/Context r0 and r1)

| Finding | Evidence |
| --- | --- |
| `assessment: "SUFFICIENT_DATA"` (not in the canonical enum) | The V3 system no longer names `OBSERVED_PROGRESS` or `NO_OBSERVED_CHANGE` anywhere; its only worked example used `INSUFFICIENT_DATA`. |
| `claimLinks` to product policy C20 with an invented 32-hex hash | r0 hash `5f4dcc3b5aa765d61d8327deb882cf99` equals MD5("password"); r1 `5b7528e3…`. This is the 4th and 5th consecutive C20 link across V2 and V3, despite explicit V3 rules. |
| `missingInformation` copied verbatim from the V3 example | `{key: "other", question: "Có phép đo trực tiếp theo cùng protocol để đối chiếu không?"}` in both outputs. |
| e1RM wording improved but incomplete | "Sức mạnh squat ước tính … tăng 10%", with a correct `ESTIMATED_1RM` `metricAssertion`. |

## Structured output on Nova Pro (docs, not probed)

- `toolChoice.tool` is supported for Amazon Nova (Bedrock `ToolChoice` API; Nova user guide "Choosing a tool").
- Nova v1 supports only a JSON-Schema subset: the top level must be `type: object` with only `properties` and `required` (Nova "Defining a tool", "Troubleshooting tool calls"). No constrained-decoding or schema-conformance guarantee is documented, and the docs warn that a tool call can be hallucinated and must be validated.
- The docs state that a tool output larger than `maxTokens` triggers an exception. The measured preflight depends on a `maxTokens=1` call returning `usage.inputTokens`, so under a forced tool the measurement may fail with `ModelErrorException` instead of reporting usage. Verifying this needs a real probe, which is not authorized.
- Tool calling also recommends `temperature 0` and may emit `<thinking>` text, which is a protocol change versus V2/V3.

**Decision:** V4 keeps the existing text Converse protocol (same transport, measurement and request identity scheme). It does not rely on tool-schema enforcement.

## V4 changes

- `buildClaimPromptV4` reuses the V2 lines, plus the user payload, which is byte-identical to V2/V3.
  - The worked JSON instance is replaced by a **type description**. Its enum values are read from the canonical schemas (`CLAIM_V4_ENUMS` ← `AnswerV3Schema`, `ClaimTypeSchema`, `MissingInformationV3Schema`, `ClaimV3Schema`). `PERSONAL_RECOMMENDATION` is withheld because the content gate forbids it.
  - Rules are added for:
    - assessment use (increase / unchanged / insufficient, decrease, unmeasured outcome);
    - reference provenance;
    - product policies;
    - measurement levels (log, estimate, physiological, causal) with the exact "e1RM ước tính" wording;
    - the CAL06 caveat (unchanged estimate is not "no progress");
    - usefulness, and not copying wording.
- **Top-level shape depends on the model-facing allowlists.**
  - When `allowedReferences.knowledgeClaims` and `scientificSources` are both empty (Context arm), the model writes only `analysis`.
  - `completeClaimEnvelopeV4` then adds `sourceLinks: []` and `claimLinks: []`, and returns an explicit `structuralDerivation` record (`SERVER_DERIVED_EMPTY_ALLOWLIST`). The session stores it in `ATTEMPT_FINISHED`, next to the untouched `rawText`.
  - Any other shape is judged exactly as produced: extra or missing keys, links written anyway, non-object output, or non-empty allowlists (RAG). Nothing is repaired.
- `config.ts`: `CLAIM_PROMPT_V4` is explicit and Nova-only (`NOVA_V4_PROMPT_ONLY`). V2/V3 stay selectable for historical replay.
- Unchanged:
  - canonical E2 schema, identity, grounding and content gates;
  - transport, measured preflight, budget, retries and stop-after-2-failures;
  - retrieval and ranking, cases, claim map;
  - the V1/V2/V3 prompt bytes.

## Comparability with V3

- Same user payload, model, Region, parameters and arms.
- Both arms share one system message.
- The analysis schema is identical across arms. Only the link fields of the Context arm are server-derived, because there is nothing to cite there.
- Prompt text differs from V3, so V3 and V4 outputs are not pooled.

## Tests

`ai-coach-claim-prompt-v4.test.ts` (10 tests) covers:
- V1/V2/V3 synthetic prompt digests unchanged (V3 captured from `c49e0991` before V4);
- the V4 user payload and private context equal V3;
- every canonical enum value is listed;
- no invented `SUFFICIENT_DATA`, placeholder, hash-like string or worked instance;
- derivation only for the exact analysis-only shape with empty allowlists, input not mutated;
- RAG is never completed;
- run-2-shaped outputs (enum + C20 short hash) keep exactly two schema errors, and a well-formed fake hash is identity-blocked;
- valid CAL01-like OBSERVED_PROGRESS and CAL06-like NO_OBSERVED_CHANGE pass, and over-abstention is blocked;
- correct and incorrect e1RM wording both remain reviewer questions;
- a valid RAG answer with exact bindings passes;
- the FAKE-IO session keeps raw text and records the derivation;
- V4 is Nova-only.

Scoped regression and the offline run-1/run-2 replay are recorded in the private review package; this is not full repository regression.

## V4 inference interleave (owner engineering decision `E3_NOVA_V4_SCHEDULE_INTERLEAVE_APPROVED_FOR_IMPLEMENTATION_ONLY`)

Run-1 and run-2 both stopped after the two CAL01/Context repeats, which ran first, so RAG and CAL06 were never exercised.

For Nova + `CLAIM_PROMPT_V4` only, `interleaveNovaWarmupRows` (`design.ts`) reorders the 8 prepared rows. With A and B being the two released cases in prepared order:

| Position | Repeat 0 | Repeat 1 |
| --- | --- | --- |
| 1 | A/Context | B/Context |
| 2 | B/RAG | A/RAG |
| 3 | A/RAG | B/RAG |
| 4 | B/Context | A/Context |

Repeat 1 is repeat 0 in reverse. For the warmup this is CAL01/Ctx r0, CAL06/RAG r0, CAL01/RAG r0, CAL06/Ctx r0, CAL06/Ctx r1, CAL01/RAG r1, CAL06/RAG r1, CAL01/Ctx r1.

What the reordering changes and keeps:
- It changes only the inference loop and `schedule.json`.
- Preparation order, `pins.promptHashes` and measurement order are unchanged; the 4 measurements still run first.
- Unchanged: attempt identities, payloads, budget, ledger, resume, 0 retries and stop-after-2-failures.
- Any other design shape throws `NOVA_INTERLEAVE_SHAPE`.
- V1–V3 keep the prepared order.

`ai-coach-nova-v4-interleave.test.ts` (5 tests) covers:
- the exact order, with each pair appearing once per repeat;
- refusal of other shapes;
- a FAKE-IO runner whose schedule and actual inference request order both follow the interleave, with all measurements first;
- two failures in different case/arm pairs stopping the run after 2 inferences, with resume adding nothing;
- V3 keeping the historical order.

## Not changed / open
- F1 (quality-unaware `FACTS_NOT_ADDRESSED`) remains Codex's separate task.
- V4 needs owner payload approval, a new pinned checkout, config, signature and ledger.
- Whether Nova follows the V4 analysis-only shape, the enums and the e1RM wording can only be measured with real inference.
