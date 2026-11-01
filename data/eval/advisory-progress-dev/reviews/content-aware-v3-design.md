# Content-aware V3 — semantic contract and implementation handoff

Date: 2026-11-01. Scope: isolated offline evaluation experiment. Evidence levels:
**CODE AUDIT** and **TEST FIXTURE**. No production imports, model calls, business
writes, source ingestion or framework migration. No independent scientific validation.

Baseline V2: `ea98576d48ed97a1964bfae1f48b1a9af9197288`, branch
`baseline/advisory-progress-v2`. V3 work starts from that commit in
`feat/advisory-content-v3`, in a separate worktree. The original `aws-deploy`
worktree and its unrelated changes remain outside these commits.

## Semantic contract

V3 uses a separate strict Zod schema; V2 AnswerSchema, prompts, validators,
results and historical contractPass remain unchanged. Required output:
`version`, `assessment`, `assessmentBasis`, `claims[]`, `missingInformation`,
`rationaleSummary`, `proposedAction:null`. Each claim declares `claimType`,
`text`, `factIds`, `evidenceIds`; confirmation fields apply to hypotheses.
Claim type is a model assertion, never an authoritative semantic label.

| Claim type | Structured invariant | Text boundary |
| --- | --- | --- |
| OBSERVATION | At least one personal fact reference | Describe observations, no causal explanation; app e1RM remains estimated |
| GENERAL_PRINCIPLE | At least one supplied source reference, no personal fact references | Population finding is not a personal cause |
| MEASUREMENT_LIMITATION | May refer to facts and/or sources; no compulsory confirmation flag | Missing measurement is unknown, not unchanged |
| PERSONAL_HYPOTHESIS | Personal fact(s), source(s), needsConfirmation=true, nonempty missingToConfirm | Explicit uncertainty and missing causal information; citation alone does not establish relevance or causality |
| PERSONAL_RECOMMENDATION | Representable for diagnostics but always blocked by treatment policy | No keep/change-plan or load prescription in this experiment |

`assessmentBasis` identifies the claimed outcome and supplied fact references.
Optional `metricAssertion` on observations copies the existing service projection
(factId, estimated measurement type, baseline/current/changePct). It does not
recalculate e1RM or become a second business source of truth. Exact mismatches
against that referenced projection are deterministic contradictions. Unsupported
fact kinds cannot be checked this way; do not claim general numeric entailment.

## Rule severity and content gate

`BLOCKED` wins over `FLAGGED_FOR_REVIEW`, which wins over
`NO_RULE_MATCH_NOT_CONTENT_PASS`. No boolean contentPass exists. Findings carry
severity, code, field path and rule scope. Every text field, including rationale,
questions and confirmation text, is screened independently of proposedAction.

Hard blockers: invalid JSON contract/claim invariants, declared recommendation,
non-null action, wrong or absent fact/source references, duplicate/colliding
input identities, deterministic structured contradictions, injection canary,
and narrow explicit directive patterns. Reuse the V2 advice screen through an
adapter without changing its rules; supplement it in V3 for tested paraphrases.
Broad/ambiguous advice, quotations and linguistic inference remain review risks.

Soft flags: possible personal causal attribution, e1RM-to-muscle-size inference,
unknown-as-unchanged wording, measured-vs-estimated wording, declared-type/text
mismatch, non-question questions and a narrow missing-key mismatch heuristic.
These rules identify symptoms, not scientific entailment or complete semantic
classification. They do not automatically repair or rewrite an answer.

## Repair rules

Pure injectable callback, no provider import. At most one repair invocation,
only for hard findings. Feedback includes schemaIssues and hard contentIssues
(codes/paths), original input and untrusted candidate. No case ID, gold label,
expected answer or rubric is sent. Soft flags alone do not invoke repair.
KEEP cannot override hard findings. A REVISE response is parsed and gated again;
bad repairs remain blocked, UNCERTAIN and callback errors remain unresolved.
No silent stripping, inserted defaults, retry loop or fabricated success.

## Frozen V2 compatibility

Read-only legacy screening uses the original V2 shape without inventing V3
claim labels. It records originalContractPass separately from contentGate.
Pinned integrity metadata covers raw artifact bytes, source pack, frozen code,
requests/scenario hashes, candidate hashes and historical scores. Missing local
runtime artifacts yield ARTIFACT_UNAVAILABLE, never a successful integrity claim.
Runtime artifacts stay ignored; tests accept an explicit external artifact dir.

## Source ablation

Parse the existing design protocol strictly. Resolve excerpt pointers from the
unchanged evidence pack, retaining separate excerpts and source findings.
Remove selected excerpts and their dependent findings; no summary/applicability
field can leak the removed material back into the transformed model input.
Question/facts stay fixed except the explicitly named mixed-question case.
Unrelated replacement is explicitly synthetic, without a real DOI or source ID.
Synthetic multi-document inputs omit expectedFull/counterfactual gold and keep
rule/event documents separate. Transformations are deterministic and pure.
Only preparation/schema checks run; model grounding under ablation is NOT_RUN.

## Test protocol and acceptance limits

Run the four baseline files (28 tests), all V3 files, and ai-service
`pnpm exec tsc --noEmit` in the isolated worktree. Test hard/soft precedence,
all text surfaces, uncertainty/negation counterexamples, five declared roles,
reference namespaces, structured contradictions, no-source behavior, repair
budget/server authority, ablation input isolation and frozen integrity/missing
artifacts. Exact executed counts and reproducible commands belong in the final
handoff; they must not be inferred from this design.

No model performance claim, scientific signoff, production E2E/regression claim
or automatic proof of claim-to-excerpt entailment follows from these tests.
Known false negatives include unseen paraphrases, implicit prescriptions,
cross-sentence causality and misattributed numbers in free text. Known false
positives include quoted directives, conditional examples and questions that
contain recommendation wording. High-precision patterns are still heuristic;
manual independent content review remains necessary.
