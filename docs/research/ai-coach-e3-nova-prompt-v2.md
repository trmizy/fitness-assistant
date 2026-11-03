# E3 Nova warmup prompts: CLAIM_PROMPT_V2 model-facing projection

2026-11-04 · branch `feat/e3-nova-prompt-v2` from `7c79fe01` · **E3_NOVA_PROMPTS_READY_FOR_OWNER_APPROVAL** (not approved). Evidence: **TEST FIXTURE / CODE AUDIT**; prompt preview generated file-only. No AWS, CountTokens, inference, trust root, approval or ledger. LIVE locks unchanged.

## Why

The owner review of the four V1 warmup prompts found three problems:
- two absolute local filesystem paths (`evidenceProvenance[].url` of the `CODE_E1RM` code source in CAL01/RAG);
- an output-contract example without `claimLinks`, although the schema and instructions require it;
- heavy traceability metadata in the RAG prompts (85 SHA-256 strings in CAL01/RAG).

## Change (versioned, historical prompts unchanged)

- `SessionConfig.promptVersion` (`CLAIM_PROMPT_V1` | `CLAIM_PROMPT_V2`, optional).
  - Absent means V1, so E2/E3 prompts, pins and closed suites stay byte-identical.
  - V2 requires the claim contract.
  - `NOVA_CONVERSE_MEASURED` requires V2 (`NOVA_PROMPT_VERSION_REQUIRED`).
  - The version flows through `calculatePilotPins` → `prepareReleasedPilot` → `prepareClaimPilot` → `buildClaimPrompt`, so promptHashes and the approved config hash pin it.
- `buildClaimPrompt(context, "CLAIM_PROMPT_V2")`:
  - The system message replaces only the output-contract line with `CLAIM_OUTPUT_CONTRACT`. That example keeps exactly the `ClaimAnalysisSchema` top level (`analysis`, `sourceLinks`, `claimLinks`) and adds no field.
  - Two rule lines are added:
    - excerpt bindings via `knowledgeClaimIds`, and URLs only for public web sources;
    - `role SUPPORTING_CONTEXT` is context, not a result or efficacy evidence; `readScope CODE_NOT_SCIENTIFIC_EVIDENCE` is a product definition; insufficient excerpts mean stating limits, never new claims.
- `modelFacingClaimPayload` keeps:
  - question, facts, uncertainty, untrusted content and allowed references unchanged;
  - approved text and display text, `claimHash`, owner approval status, population, applicability, evidence limitations and unsupported inferences;
  - an applicability-review status, personal support and limitation;
  - product-policy text and scope;
  - per excerpt: `excerptId`, bound `knowledgeClaimIds`, source identity (`sourceId`, `kind`, `title`, `readScope`, `locator`, `role`, `semanticSupport`), the exact bound quote (`capturedQuote`) and the source wording when normalization changed it; `url` only for `https://` sources.
- `modelFacingClaimPayload` drops:
  - file/body/source hashes, owner-record pointers and parent text copies;
  - the representation offsets;
  - per-excerpt `knowledgeClaimHash`, `textMatch` and byte-identical `capturedQuote`;
  - scope lists that repeat population + applicability.

  Duplicate excerpts are merged with their claim bindings preserved. Any drive-letter, UNC or home-directory path in the model-facing payload throws `MODEL_FACING_LOCAL_PATH`.
- Unchanged: `ClaimContext`, which keeps the full private provenance, hashes and receipts, plus verification, the E2 gate, claimLinks/sourceLinks checks, retrieval/ranking (2 claims), claim map and owner decisions.
- `OUTPUT_CONTRACT` is now exported (no value change).

## Resulting warmup prompts (owner review pending)

| Case / arm | Bytes V1 → V2 | promptHash V2 |
| --- | --- | --- |
| CAL01 / LAYERED_CONTEXT | 11,126 → 9,808 | `9d9718e4c64a7691531dd0c4e9c540f529221068c5c66aab68ba5fbd1901a7de` |
| CAL01 / LAYERED_CONTEXT_RAG | 37,942 → 25,505 | `75f9317d742c6ca2f5e5cbffaaf83c8fb92a9564d484dbb3ecb3080208fdfc86` |
| CAL06 / LAYERED_CONTEXT | 11,104 → 9,786 | `c1237f05b9e68164b0c60d00ced583eac56d0b75ed425e230c5e4603c207df59` |
| CAL06 / LAYERED_CONTEXT_RAG | 26,419 → 17,332 | `3b32d0d666d8fa975ea2f94d82a235b2ba556fb31e77e2c1628e55fb43accbe4` |

The V2 prompts contain no local paths, no label keys, no label-hash values and no private sidecar. Measurement and inference requests still differ only in `inferenceConfig.maxTokens`. Token parity on AWS is NOT_VERIFIED. The owner-readable full prompts, the V1→V2 diff and the removed-field list are kept outside Git.

## Verification

- `ai-coach-claim-prompt-v2.test.ts`: **6 pass / 0 fail**. Covers:
  - V1 default byte-identical and private context identical;
  - contract keys equal the schema, with valid/missing/malformed/extra-field parsing;
  - grounding fields and every claim↔excerpt binding preserved;
  - private provenance kept;
  - local-path fail-closed with allowed relative/web/locator strings;
  - a candidate built only from V2 input passing E2 identity checks, with a wrong `claimHash` blocked;
  - Nova requiring V2 and V1/V2 pins differing.
- Nova suites updated to pin V2.
- Related regression (24 files): **235 tests, 232 pass, 0 fail, 3 skipped**. The skips are the Frozen V2 artifact checks, whose ignored artifacts are absent in this worktree. Not full repository regression.
- `pnpm exec tsc --noEmit` (ai-service): exit 0.

## Remaining limitations

- CAL01/RAG is still about 25.5 KB and may exceed 12,000 input tokens. If so, the measured preflight stops it before inference; that measurement is billed.
- Purpose and population excerpts remain because they are owner-approved claim-map bindings; they are flagged as `SUPPORTING_CONTEXT`.
- The `CODE_E1RM` quote keeps a stray comment `*`, because it is the bound text.
- The inherited claim example lists all claim types with `factIds: []`; the instruction and parser enforce the OBSERVATION rule.
- Pins must be recomputed on a clean checkout before LIVE.
