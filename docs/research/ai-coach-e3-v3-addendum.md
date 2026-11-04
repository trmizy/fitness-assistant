# Nova CLAIM_PROMPT_V3 — implementation addendum

2026-11-04 · baseline `db3ecc39` · branch `feat/e3-nova-live-gating`. Evidence: **CODE AUDIT / TEST FIXTURE / CPU replay of preserved REAL outputs**. No new AWS, measurement, inference, credential resolution or production change. V3 remains unapproved; this is preparation for independent review, not proof of model improvement.

## JSON example: actual parser, not top-level key checking

Direct `ClaimAnalysisSchema.safeParse(CLAIM_OUTPUT_CONTRACT)` gives five errors for the historical V2 example: `analysis.assessment`, `analysis.assessmentBasis.outcome`, `analysis.claims.0.claimType`, `analysis.missingInformation.0.key`, `claimLinks.0.knowledgeClaimHash`. V1/V2 bytes remain unchanged.

The V3 example is already constructed with the canonical E2 parser and a regression parses the exact JSON extracted from its system prompt: **zero errors**, no fake ID/hash, empty `claimLinks`/`sourceLinks`/`evidenceIds` for the unsourced measurement-limitation example. Existing reference regressions enforce empty scientific allowlists and exact allowed bindings.

## Narrow duration false positive

`checkTextInvariants` delegates to frozen `checkAnswer`, whose numeric membership pool contains facts/sources but not the question or equivalent time units. Thus `8 tuần` was HARD `NUMBER_NOT_IN_INPUT` although the question says 8 weeks and the training window is 56 days.

The V3 facts checker now exempts **only the matched integer-week text span** when that duration is explicit in the question and the scoped/cited TRAINING_LOGS evidence has SUFFICIENT/PARTIAL quality with exactly `window.days = weeks × 7`. Conclusion text without claim references requires matching eligible training windows. No number is added to a global allowlist; no date, arbitrary unit or calendar conversion is introduced.

Positive regression: Vietnamese `8 tuần` and English `8 weeks`, cited 56-day training evidence. Negative controls keep HARD numeric rejection for absent/mismatched question or window, missing/stale/ineligible evidence, untrusted-only time, wrong domain/provenance, wrong cited fact, fractional/negative duration, and unrelated 8 kg/8% in the same text. Other fabricated values and delta/reference rules stay active.

A before/after CPU differential compares complete reports: **6 existing public scenarios and all 24 frozen retrospective rows unchanged**. Frozen V2 source/answers/scores/pins are not edited. This is bounded regression evidence, not exhaustive language coverage or proof of temporal attribution/entailment.

## Pipeline reporting correction

On envelope failure, `verifyClaimAnalysis` previously passed the full `{analysis, sourceLinks, claimLinks}` envelope to `AnswerV3Schema`. That schema expects `analysis` alone and reported eight additional errors from the wrong shape. Those were reporting artifacts, not eight violations produced by Nova.

The content gate now receives only the actual analysis object, even if an envelope field is invalid. If generation/JSON fails or no analysis object is available, grounding is explicitly `NOT_EVALUATED` with no fabricated schema issues. Runner forwards its existing parse/provider diagnostics through the claim adapter; this is a one-line compatibility change, not a runner rewrite.

`validationStages` separates JSON, canonical envelope schema, reference identity, deterministic grounding and semantic review. Known invalid JSON/provider failures leave schema/grounding not evaluated. Unknown parse-error states fail closed instead of claiming JSON validity. Direct object callers do not invent proof of JSON parsing.

| Preserved run-1 output | JSON | Actual envelope errors | Analysis schema errors after fix |
| --- | --- | --- | --- |
| CAL01 Context repeat 0 | valid | 1: malformed C20 hash | 0 |
| CAL01 Context repeat 1 | valid | 1: malformed C20 hash | 0 |

Both original outputs remain BLOCKED. A separate, explicitly derived control removing invalid links has a valid contract and can be DEV_REVIEW_ONLY; that **does not establish C1 semantic correctness**. Root and analysis schema diagnostics describe layers and must not be summed as independent model violations. Raw/provider/journal bytes and original historical reports remain unchanged; corrected reanalysis is a new private file.

JSON parse failure, schema failure and reference/grounding failure are covered separately by synthetic tests. Semantic/scientific failure remains a reviewer judgement. Generation lifecycle, failure accounting, gate confusion denominators, retries and no-repair behavior remain unchanged.

## C1: preserve usefulness without certifying prose

V3 adds one general USEFULNESS instruction, conditional on an e1RM/ESTIMATED_1RM fact with suitable supplied values/quality: describe the quantitative estimate change, distinguish uncertainty about actual strength from missing estimate data, and do not abstain from available observations. It does not convert direct measurements into estimates or insert CAL01-specific answers.

Private reviewer fixtures at `C:/D_Backup/project_personal/gymini-review-local/e3-owner-prep/nova-prompt-v3-addendum-2026-11-04/` include:

- `C1_OVERCLAIM`: “Sức mạnh squat tăng 10%.”
- `C1_BOUNDED`: “e1RM ước tính tăng 10%.”, with supplied endpoints and explicit limitations.
- `C1_OVER_ABSTENTION`: refuses to describe the estimate despite available baseline/current/changePct.

They are implementer-authored counterexamples, not raw model outputs, independent gold or owner decisions. Source facts/provenance are retained; proposed reviewer expectations are separate from candidates, human semantic/usefulness judgements are null. All-text review covers observation, assessment, rationale and questions. Offline checks confirm schema/identity and preserve UNKNOWN semantic support; they do not prove that Nova will be useful or scientifically correct. These fixtures never enter generation.

## New r3 payloads and review

CAL01/CAL06 × Context/RAG, MINIMAL, two repeats: four unique payloads/eight prepared rows. Cases, facts, history, ranking, scientific excerpts, allowlists and user payload bytes match V2/V3 r2. Only the V3 system USEFULNESS line changes model-facing bytes. Model/region/caps/retries/budget are unchanged. AWS token size and V3 model quality remain NOT_MEASURED.

| Payload | New tokenPayloadHash |
| --- | --- |
| CAL01 Context | `2e0e396b3a6d1b36f6ebc818f9b301b3ee62d0e950f55471b9fc5a8d1b588262` |
| CAL01 RAG | `5612058198a94dbcc6748d71d2f383d480c1506cdfe2d034398a98fdca7aed36` |
| CAL06 Context | `37f24785374c62c46983969b798c90d6ed39c191bf2077f9d87c733706689a7b` |
| CAL06 RAG | `1d111b4119866a51490fc1c2e2d2ad18d8448cbf9adf67af4712f03c1092cedc` |

Create-only private final review package: `C:/D_Backup/project_personal/gymini-review-local/e3-owner-prep/nova-warmup-payload-preview-2026-11-04-v3-r3/`. It contains full prompts, exact measurement/inference bodies, prompt/request hashes and fresh pins in `manifest.json`, plus `nova-prompts-v2-to-v3-diff.md`. Measurement/inference still differ only in maxTokens (1/2048). Structural no-local-path/no-label checks do not prove absence of all semantic privacy leaks; existing source/policy approval metadata remains disclosed provenance, not case gold.

## Verification and boundary

Before patch: addendum tests **3 pass / 4 fail**, reproducing the duration and eight-spurious-schema bugs plus missing separated diagnostics. After patch: targeted **7/7 pass**; AI-service TypeScript exit 0 before final clean-checkout regression. The exact V3 example parses with zero errors. Private replay confirms two original responses each have one envelope hash error and zero analysis-schema/duration false-positive errors; raw remains unchanged.

Final clean committed regression covers all advisory suites, E2/V2/V3 prompts, Nova transports/gates, claim pilot, D1/D2/D3 and runner resume/failure behavior. Actual final counts and command log are recorded separately in the private verification handoff, not predicted here. This is scoped regression, not full repository regression.

All 133 protected pre-existing files are hash-checked. Prior r2/r1 previews, owner decisions, run-1 and its CLAIMED ledger remain historical. No approval/signature/trust root/issued ledger is created, no CLAIMED ledger reused, no LIVE execution requested. New payloads require new review; no old approval extends to r3. Stop after independent-review handoff.
