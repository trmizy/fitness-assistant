# Advisory progress — development corpus and scenario protocol

Created 2026-10-27. This is **assistant-authored DEV/diagnostic material**, not
human-labelled independent test data and not a production knowledge index.
It does not alter the independent query-routing annotation workstream.

## Source review

[evidence-pack.json](evidence-pack.json) keeps two brief original excerpts,
URLs/DOIs, locators, applicability, limitations and bounded Vietnamese summaries.
Review authority is `ASSISTANT_SOURCE_CHECKED_NOT_INDEPENDENT_HUMAN_REVIEW`;
`humanReviewed` is false. No full article or PDF extraction is claimed.

| Source | Checked primary material | Permitted use | Boundary |
| --- | --- | --- | --- |
| ACSM 2009, DOI `10.1249/MSS.0b013e3181915670` | [PubMed abstract](https://pubmed.ncbi.nlm.nih.gov/19204579/?dopt=Abstract), opening and final sentences | Goal-specific progression and contextual interpretation | Does not diagnose why this individual is not progressing or authorize load changes |
| Schoenfeld et al. 2017, DOI `10.1519/JSC.0000000000002200` | [PubMed abstract](https://pubmed.ncbi.nlm.nih.gov/28834797/), inclusion criteria and results | Distinguish strength and hypertrophy outcomes | Trials used failure training, minimum duration and eligibility criteria; app-estimated 1RM is not a direct muscle-size measurement |

The final application statements in `supportedSummaryVi` (attendance alone
cannot identify an individual cause; estimated strength does not establish
individual muscle growth) are **assistant application inferences**. They are
not verbatim statements of the authors. Source excerpts remain separate so
these inferences can be reviewed. These sources are historical research,
not an assertion of the latest universal guideline.

No blanket source approval is applied to the other 83 local evidence chunks.
No fields are added to business schemas and this pack is never ingested into
Qdrant/OpenSearch. A human/expert source check remains required before using
this pack as independently validated scientific gold or adopting a workflow.

## Input and output contract

The experiment reads synthetic fixtures shaped like the existing
`ProgressReviewV0.EvidenceItem` projection. The owning fitness-service remains
responsible for training analytics and estimated 1RM calculations. The LLM
does not compute a second progression engine or set CycleAssessment decisions.

The question supplies the outcome being asked about. Output separates:

- `observations`: references to supplied facts, with estimated strength labelled.
- `hypotheses`: unconfirmed and linked to supplied sources, with applicability limits.
- `missingInformation`: only information affecting the answer.
- `assessment`: a descriptive diagnostic classification, not a persisted plateau diagnosis.
- `rationaleSummary`: a concise basis, not hidden chain-of-thought.
- `proposedAction`: always null; there are no tool/mutation capabilities.

## Frozen v1 development design

Six cases in `src/evaluation/advisory-progress/scenarios.ts`: attendance-only,
increasing estimated strength, unchanged estimated strength (same question,
counterfactual facts), hypertrophy not measured, absent external evidence,
and an indirect injection canary. All personal data are synthetic; no real
conversations, profiles or DB rows are used.

Two hand-authored few-shot examples use different facts/IDs. Examples are
method demonstrations, not independent training data. No expected labels are
sent to the model. All cases and labels are known to the implementer; reported
metrics must not be called held-out accuracy or proof of general reasoning.

A = zero-shot, B = few-shot, C = A + one model verification, D = B + one
model verification. Fixed A/B/C/D order, no randomization/repeats in this
small first diagnostic. Same source pack and facts for every variant per case.
No retrieval quality is measured. Additional calls/tokens are treatment costs.

Checks: schema, no mutation, IDs exist, numeric values are present in input,
expected assessment, required fact coverage and missing-data question keys.
These checks cannot establish sentence entailment, correct attribution,
scientific accuracy or clinical safety. Model verifier is not ground truth.
Model-generated hypotheses/rationales require independent content review.
Numeric matching checks occurrence in input, not unit-aware attribution to
the correct fact; passing it does not prove a number was used appropriately.

Freeze manifests capture corpus/scenario/request/code hashes before model
calls. Failures remain in the denominator, partial outputs are saved after
each case. Do not overwrite a run or tune prompts mid-run. If a result is
used for tuning, it remains diagnostic and never becomes independent test.

Rubric correction after the first completed run: v1 incorrectly required all
supplied facts in observations; v1.1 requires `F_PROGRESS` for outcome questions
and `F_ADHERENCE` for attendance-only. This keeps relevant-fact coverage while
allowing concise answers. Frozen prompts, source pack and model outputs were
not changed; re-scored results are separate from the original summary.

## Guarded V2 continuation

The guarded treatment reuses this same source pack, six cases and corrected
v1.1 rubric. It adds context-dependent fact/source ID validation and one
error-aware repair for C/D. This is deliberate tuning on observed DEV errors;
it does not create a new held-out set. Both old outputs and the new run stay
separate. Neither the model nor repair prompt receives expected scenario labels.

## Content review and traceability supplement

- [Readable review of all 24 V2 answers](reviews/guarded-v2-content-review.md)
- [Full review JSON with text paths, judgments, support IDs and hashes](reviews/guarded-v2-content-review.json)
- [Authored assistant annotations](reviews/guarded-v2-annotations.json)
- [User-supplied review, unchanged](reviews/user-review-2026-10-27.txt)
- [Excerpt-to-claim mapping supplement](evidence-claim-map-v2.json)
- [Source ablation / controlled synthesis protocol — design only](source-ablation-review-protocol.json)

The supplement preserves v1 and adds the applicability phrase from ACSM and
the hypertrophy result from the load meta-analysis, with distinct excerpt IDs
and source-finding IDs. Personal application inferences remain separately
labelled; a population finding does not establish an individual cause or
authorize keeping/changing a plan. The 2026 ACSM update was confirmed from its
official announcement; a full update comparison and production-source review
are pending. Historical DEV evidence is not silently replaced.

The content review is an assistant audit informed by the user-supplied review,
not an independent human/expert annotation set. It covers every output text
unit and documents mixed-claim problems in notes; it is not a fully atomized
scientific gold set. Missing-information relevance/key correctness are judged
separately from numeric facts. Contract pass and model KEEP are not content
approval. No new Bedrock requests or original artifact edits were performed.

## Content-aware V3 (offline)

[V3 semantic design and limitations](reviews/content-aware-v3-design.md) defines
the separate five-role claim contract, contentGate and one-shot repair seam.
[Frozen V2 integrity metadata](reviews/frozen-v2-integrity.json) pins raw local
artifact bytes, candidate hashes and historical scores without committing the
runtime artifacts. V3 prepares excerpt ablations and synthetic document tasks;
no inference, independent scientific validation or production adoption occurs.
Commands and explicit missing-artifact behavior are documented in
[`CONTENT_AWARE_V3.md`](../../../backend/services/ai-service/src/evaluation/advisory-progress/CONTENT_AWARE_V3.md).
