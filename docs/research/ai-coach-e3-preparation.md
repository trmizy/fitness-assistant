# E3 — real-model evaluation preparation

2026-11-02. **E3_PREPARATION_BLOCKED**. Protocol, collection brief and owner import proposals are prepared; the current code/data/authorization cannot yet execute a meaningful real-model evaluation of E2. Evidence: **CODE AUDIT / TEST FIXTURE**, plus read-only official AWS documentation. No model results or independent scientific approval.

Public proposal files (not executable session configurations):

- `data/eval/ai-coach-e3-prep/evaluation-protocol.json`.
- `data/eval/ai-coach-e3-prep/held-out-collection-plan.json`.
- `data/eval/ai-coach-e3-prep/review-dashboard-items.json`.

## Reuse and specific gaps

Paths below are relative to `backend/services/ai-service/src/`.

| Existing component | Ready evidence | Remaining prerequisite |
| --- | --- | --- |
| D1 `evaluation-kit/annotations.ts` | Strict units/references, personal applicability/causal axes, sealed case/release and annotation validation | Actual reviewer identity/independence and frozen labels; current schema recognizes legacy `AnalysisEnvelope`, not E2's extra `claimLinks` |
| D2 `bedrock-pilot/{design,runner,ledger}.ts` | Repeats, immutable schedule/attempt identity, reservation/resume/lock and failure accounting tested | Actual approved design, case release and owner-issued ledger; runner and CLI remain deliberately FAKE_ONLY |
| D3 `evaluation-kit/{offline-analysis,statistics}.ts` | Existing endpoint arithmetic, gate lifecycle, missingness, paired case-cluster comparison/bootstrap and Cohen κ tested | Real paired annotations/adjudication and endpoint qualification; no numeric independent result from one owner |
| Reviewer-safe exports/receipt/blinding | Existing sanitized R1/R2 files, opaque linkage, common case evidence pool and export receipts | Distribution/ACL/identity, actual reviewer blindness and E2 canonical projection; content can reveal treatment |
| Bedrock session | Count preflight, target/config pins, signed authorization, durable budget storage seams exist | Compatible target, current prices/permissions, installed trust, LIVE admission and E2 adapter |
| E1/E2 | Approved-map provenance and working seven-case FAKE slice | Private packet is not in Git; current pilot preparation and corpus hashing still use legacy DEV/V2 sources |

Do not call `runControlledPilot` as-is and report it as an E2 experiment. `prepareReleasedPilot` calls `prepareDevSlice`; `pins.ts` hashes V2 pack/map/supplement/registry. `session.ts` parses strict `AnalysisEnvelopeSchema`, and `annotationUnits` treats an envelope with E2 `claimLinks` as invalid. A **bounded compatibility adapter** is still required: select E2 preparation, pin claim/owner/prompt bytes, connect E2 verification, preserve the full raw response/link receipts, and expose an explicit shared analysis/sourceLinks view to D1/D3 without silently discarding fields after sealing. Reuse the runner/analyzer/dashboard; do not create replacements or change accepted statistical algorithms. This preparation did not implement that adapter or remove LIVE locks.

## Data inventory and collection

`case-protocol.json` contains **30 AI-authored draft sketches**: 27 generation, three routing-only. Their authors/labels are not independent gold. Existing held-out material consists of **10 quota placeholders with no content**, not ten completed cases. No independently sealed/released held-out content was found in the supplied material.

The ten local calibration cases have owner decisions: seven ACCEPT and three REVISE (CAL02/CAL04/CAL05). All ten have `ownerAssessment=null`. They remain owner-reviewed calibration, not independent held-out; CAL03 ACCEPT does not authorize an assessment taxonomy. This is an inventory observation, not a new decision or migration of proposed labels.

Collection allocation is by distinct **case clusters**, not calls, repetitions or counterfactual variants:

| Family | Minimum | Target |
| --- | ---: | ---: |
| Progressive overload | 3 | 5 |
| Strength/e1RM | 3 | 5 |
| Hypertrophy/volume | 3 | 5 |
| Tempo/RIR | 2 | 4 |
| Recovery | 2 | 3 |
| Missing/stale/conflicting data | 2 | 4 |
| Unsupported personal/causal conclusions | 2 | 4 |
| Evidence mismatch/wrong excerpt/absent or excluded source | 3 | 5 |
| **Total** | **20** | **35** |

The collection brief contains quotas/focus only; questions, facts, labels and author identities are null/not supplied. Independent authors must supply substantive content outside the assistant-accessible workspace, document provenance, freeze labels separately, and release inputs only after prompt/corpus freeze. Do not recycle the AI drafts, ten calibrations or E2 A–G into independent held-out. Distinct variants from one base case share a cluster. Twenty/35 cases are exploratory planning sizes, not a demonstrated power/precision guarantee. Recovery cases may correctly need abstention because the approved corpus does not cover their requested causal inference; do not manufacture knowledge for coverage.

## Proposed experiment

Two generation treatments using existing arm keys **after adapter approval**, not their current legacy implementations:

1. `LAYERED_CONTEXT`: E2 facts/history/product policies/common system and structured contract; approved scientific knowledge and scientific references empty.
2. `LAYERED_CONTEXT_RAG`: same inputs/policy/contract, with relevant admitted E1 claims and exact provenance.

Use one MINIMAL policy, one model/identifier, temperature 0.2, omit topP, max output 2048, retries 0. There is no provider-seed or determinism claim. Identical common policy avoids attributing coded domain instructions to retrieval. Prompt length/source presence are treatment consequences, not independently controlled mechanisms; this tests the package, not an isolated “reasoning skill.” Apply E2/V3 gating to the same raw RAG output offline with zero extra inference. Both arms retain raw answers and reviewer reference pools; no score benefit from silently dropping hard/failed cases.

| Stage | Cases × arms × repeats | Inference ceiling | Input/output token ceilings | Proposed USD cap |
| --- | --- | ---: | --- | ---: |
| Warmup, reviewed drafts/calibration only | 2 × 2 × 2 | 8 | 96,000 / 16,384 | 5 |
| Exploratory held-out | 20 × 2 × 3 | 120 | 1,440,000 / 245,760 | 20 |
| Target held-out, only after separate review | 35 × 2 × 3 | 210 | 2,520,000 / 430,080 | 35 |

The20/35 held-out sizes are alternative choices fixed before held-out release, not automatic sequential pooling. If20 results are inspected and the system tuned, a later35-case evaluation needs a fresh cohort; do not count inspected cases as unopened held-out or repeat completed calls to inflate N.

Input cap is a proposed 12,000 tokens/call; count actual complete prompts first. These are reservation ceilings and **unapproved caps**, not cost estimates. Rates and estimated USD remain null. Warmup is excluded from held-out scores. Expansion requires a new frozen config/signature and separately issued cumulative ledger, not a reset or automatic 5→20→35 allowance. Count preflight uses unique frozen prompts and caches counts across repeats; no preflight was invoked here.

### Endpoints and accounting

Primary proposed endpoint: **unsupported personal claim rate**, lower is better. The current D3 operational definition counts final explicit boolean judgements on OBSERVATION, PERSONAL_HYPOTHESIS, MEASUREMENT_LIMITATION and CONCLUSION. No evaluable personal units → null, not zero error. Within a case/arm, D3 pools labelled numerators/denominators across repeats; its existing paired comparison then compares case-level cells. Report global unit-weighted rates separately from the case-level paired effect.

Review **all** units, including GENERAL_PRINCIPLE/questions and free conclusions, for personal assertions and causal overreach. The current role-based denominator can omit a personal assertion mislabeled by the model as a general principle; reviewer evidence/reference labels do not automatically change unit type. Record/report these errors separately and resolve the estimand/rubric qualification at E17 before claiming a complete semantic personal-claim rate. This is a measurement scope limitation, not a change to the accepted D3 algorithm or a reopened hardening task.

Usefulness guard, **proposed for owner approval**: anchored 1–5 rating (1 incorrect/harmful or misses intent; 3 useful bounded answer with material gaps; 5 directly useful, supported and appropriately uncertain). Propose mean ≥3 and paired change no worse than −0.5 point; this is not a statistical noninferiority result. Unnecessary abstention loses usefulness. Always report release/abstention coverage rather than optimizing unsupported rate by blocking every difficult response. No fixed release floor has been approved. Severe unsafe advice triggers review regardless of mean scores.

Gate sensitivity TP/(TP+FN), specificity TN/(TN+FP), with truth `shouldBlock` adjudicated for the **actual response**, not assigned from the question alone. Only generated valid candidates with an actual BLOCKED/ELIGIBLE gate decision enter the confusion matrix. Generation/parse/provider/post-processing failures are separate failures, never TP/FN/TN/FP; no eligible positive/negative denominator → null. Review blocked raw outputs as well as released ones. Report the existing structured-invariant and narrow-text scopes separately.

Pair by frozen caseKey/arm/policy; keep repeat identity and all missingness. Report scheduled, routed, attempted, recorded/missing, generation/postprocessing failed, redacted-not-scored, valid blocked/released, unknown-support abstentions, null/NA/NE labels and unresolved disagreements. Raw and post-gate outcomes both appear; block is not correctness. Existing case-cluster bootstrap remains unchanged and suppresses intervals below 20 evaluable pairs. Repeats/fact flips do not create independent sample size. No imputation, optional stopping on apparent success, p-value, power or calibration claim is added.

### Review authority

Independent mode requires two actual raters, checked independence/authorship, per-axis rationales/references and a distinct adjudicator as needed. Keep opaque reviewer files disjoint from internal mapping/config/gate/schedule data. Same-case evidence pools and export receipts remain mandatory; reviewers may still infer treatment from answer content.

With one owner: label **EXPLORATORY_OWNER_REVIEWED**, store legitimate D1 R1 annotations and explicitly descriptive owner tallies. Current D3 does not compute qualified paired/independent metrics from R1 alone: these remain null/NOT_EVALUATED. Never duplicate the owner into R2, fake an independent attestation, switch LIVE answers to TEST_FIXTURE purpose or invent κ/CI. The protocol decision must reflect this limitation before collection; no new single-rater analyzer was built.

## Bedrock readiness (documentation/configuration, not account verification)

| Check | Observed status / prerequisite |
| --- | --- |
| Target | Existing schema locks `amazon.nova-pro-v1:0`; proposed region `ap-southeast-1`, owner confirmation PENDING |
| CountTokens | **INCOMPATIBLE_AS_PROPOSED**: current AWS Nova Pro card lists Count tokens unsupported; existing session requires exact CountTokens with no fallback |
| Profile | AWS regional card lists Singapore Geo support, not In-Region; runtime code rejects LIVE profiles; changing region alone does not resolve Nova CountTokens |
| Model/region in service | Code fallback is Nova Pro/Singapore; no authoritative deployed configuration was established. Allowlisted reads of two main-checkout `.env` files showed `LLM_PROVIDER=ollama`; this is file evidence, not a running-provider claim. Ollama was not started/unblocked or configuration changed |
| Pricing | Correct model/profile/region rates, version/expiry, source evidence and exact prompt preview PENDING; no numeric price filled from memory |
| IAM / model access / quotas | PENDING. No STS, Bedrock or AWS account request made |
| Privacy / residency | Synthetic-only proposal; account logging/retention, destination Regions, artifact ACL and reviewer distribution PENDING |
| Trust root | Fixed local `C:/ProgramData/Gymini/Evaluation/trust.json` does not exist; no key generated/installed |
| Approval and ledger | PENDING owner Ed25519 signature/configHash/expiry and durable OWNER_SIGNED ISSUED journal outside run/source directories; no approval created |
| LIVE | CLI/runner explicitly locked, not unlockable by an env flag or dashboard click; no live authorization |
| Clean inputs | Private/untracked data preserved; current worktree is not a clean LIVE source checkout |

Official documentation checked 2026-11-02: [Nova Pro capabilities and regional availability](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-pro.html), [CountTokens request target](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_CountTokens.html), [token counting and required permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/count-tokens.html), [pricing](https://aws.amazon.com/bedrock/pricing/). This establishes a documented incompatibility, not an account test. Owner must select/verify a compatible target or explicitly approve a revised compatible accounting/profile design before any runtime change; do not remove preflight to obtain a first answer.

For a compatible Converse/count target, scope IAM to the needed `bedrock:InvokeModel` and `bedrock:CountTokens` resources, and `sts:AssumeRole` only if the existing cross-account path is actually selected. Actual permissions/quota/endpoint/model access remain PENDING. [AWS data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) and [retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) require model/route/account-specific review; do not promise blanket zero retention or single-region processing. Existing pattern redaction is not comprehensive PII/DLP, so prevent real health/user data or credentials entering the pipeline in the first place.

Early stop before a new call: unavailable/incompatible counts or unknown usage/spend; any signed call/token/USD cap exceeded; proposed failure cap 2 warmup/3 main; pin/price/approval drift; crash/orphan reservation/lock or journal/persist failure; actual secret/PII or severe unsafe output; safety/out-of-domain route. No retries, automatic repair calls, expansion, stale-lock deletion or budget reset. Freeze stop rules before opening held-out.

## Dashboard and remaining decisions

Prepared **E13–E18**, all with ownerDecision=null: target/counting; cases/repeats; staged caps; independent held-out sourcing; reviewer/endpoint protocol; LIVE prerequisites. Compatible catalog fragment is in the public proposal directory and copied to existing review tooling's `review-ui/pending-imports/e3-preparation-2026-11-02.json`. A health-only read of `127.0.0.1:4787/api/health` returned 200/ok.

**PREPARED_NOT_IMPORTED, not visible as new dashboard cards yet.** Source inspection shows that the existing server reads one fixed `engineering-decisions.json` and has no import endpoint. That catalog is one of the protected 68 files and is an original checked by the immutable E1 loader; changing it would invalidate the current local E1 load. Therefore this task does not rewrite it, restart/change the server, overwrite historical receipts or approve records. Actual import/reconciliation remains a concrete dependency. E12's earlier fragment remains separate. No chat-by-chat approval requests were created, and C22/E12, A13, E07, CAL02 and CAL03 are unchanged.

## Opening checklist / handoff verdict

- [ ] Import/reconcile the prepared owner items while preserving historical decisions/receipts and keeping E1 scientific pins coherent.
- [ ] Owner chooses a compatible model/identifier/region/accounting path and verifies account access, quotas, CountTokens and residency without invoking unapproved inference.
- [ ] Accept the staged design, actual prices/expiry, usefulness/endpoint/rater protocol and maximum USD.
- [ ] Supply/freeze at least 20 distinct appropriate held-out clusters for independent exploration (or explicitly choose owner-only exploration with its limitations); target 35+ subject to precision planning.
- [ ] Approve and implement the narrow E2-to-existing-runner/parser/annotation compatibility adapter with FAKE regression, without a new runner/analyzer or statistical changes.
- [ ] Provision private inputs outside a clean evaluation source checkout, then compute actual code/corpus/case/prompt hashes; no placeholder pins or private-data commit.
- [ ] Owner provisions fixed trust root/permissions, signed expiring config and durable ledger/locks. A dashboard choice alone is not LIVE authorization.
- [ ] Independently approve bounded LIVE admission; inspect warmup counts/budget before any inference, then review all failures/blocks/usefulness before any held-out expansion.

E1/E2 closeout tests passed and implementation is eligible for the selective commit; details in [closeout](ai-coach-e1-e2-closeout.md). E3 preparation produces actionable files, but the target/adapter/data/reviewer/authorization/import conditions above remain unmet: **E3_PREPARATION_BLOCKED**. No efficacy or scientific improvement claim is made, and no production or LIVE state was changed.
