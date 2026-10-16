# Gymini Semantic Fine-Tune — V2.3A.6 Semantic Contract Freeze + AWS Runtime Verification + Implementation Plan

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. `HELDOUT_UNOPENED`. `TRAINING_NOT_RUN`.
`OPTUNA_NOT_RUN`. `NO_GGUF_EXPORT`. `PRODUCTION_CHANGED=NO` — confirmed via
`git diff --stat` on every production file read in this task. No AWS
state was mutated — only explicitly read-only calls (`sts
get-caller-identity`, `lambda list-functions`, `lambda
get-function-configuration` for non-sensitive keys, `ec2
describe-instances`) were made, using credentials already present and
authorized in this environment. This task freezes a decision and
produces a plan; it implements nothing.

## 1. Starting state (from V2.3A.5)

`PRODUCTION_SEMANTIC_CONTRACT_MISALIGNED`, `FINE_TUNED_MODEL_NOT_WIRED`,
`HELDOUT_CURRENTLY_NOT_PRODUCTION_VALID`, `NO_NEW_FINE_TUNE_BEFORE_ALIGNMENT`.
Three CRITICAL field mismatches (`references`, `ambiguities`,
`clarificationRequired`) and a suspected chat-template role-split defect
in `buildOllamaMessages()`, not yet confirmed against live AWS.

## 2. Product/architecture decision: FROZEN

**`SEMANTIC_RUNTIME_CONTRACT_V1` = HYBRID / Strategy C.** No repository or
runtime evidence found in this task contradicts it — if anything, the
AWS runtime finding below (§4) makes Strategy B (expand the model to own
all 13 fields) even less attractive, since the live model (Nova Pro) was
never fine-tuned by this project at all. Full frozen contract:
`runtime_contract_v1.json`; full field-by-field ownership matrix (15
fields): `model_ownership_matrix.json`.

## 3. AWS deployment architecture (repo + live evidence)

`AWS_RUNTIME_PLATFORM = LAMBDA`. ai-service deploys as
`ai-lambda.zip`/`ai-worker-lambda.zip` (`package-lambda.ts`), handlers
`dist/lambda.handler`/`dist/worker-lambda.handler`, `nodejs22.x` runtime.
No ECS/EKS/App Runner/EC2 compute was found for ai-service; `infra/`'s
`dev-on-demand.yaml` (NAT/ALB for a *separate* chat-service ECS task) is
explicitly marked "NOT YET DEPLOYED — Phase 1 design artifact only" and
is unrelated to ai-service's own Lambda deployment.

## 4. Live, read-only-verified AWS evidence — the capstone finding of this audit

```
aws lambda get-function-configuration --function-name fitness-assistant-dev-ai
  LLM_PROVIDER      = bedrock
  LLM_MODEL         = (unset — correctly irrelevant under bedrock)
  BEDROCK_CHAT_MODEL = apac.amazon.nova-pro-v1:0
  EMBEDDING_PROVIDER = bedrock
  LastModified      = 2026-10-07T12:18:24Z
  Runtime           = nodejs22.x
```

`aws ec2 describe-instances` returned **zero running instances** in this
account/region — there is no persistent GPU/Ollama host anywhere in AWS
for this project. Full evidence: `aws_runtime_evidence.json`.

**The live, deployed AWS semantic-interpretation path does not use Qwen
at all — base or fine-tuned.** It uses Amazon Nova Pro via Bedrock. The
Ollama/Qwen path (`LLM_PROVIDER=ollama`, `qwen3:4b-instruct-2507-q4_K_M`)
exists only as the **local-development default**
(`docker-compose.dev.yml`, `.env`). This is corroborated by a prior
session's own read-only audit (`docs/deployment/AWS_DEV_BEDROCK_ACCESS_ROOT_CAUSE_2026-09-30.md`,
dated 2026-09-30), which recorded the identical values 2 weeks ago — this
task's live re-check confirms nothing has changed.

**This is a deeper misalignment than V2.3A.5 found.** It is not only
that production requests the wrong *fields* from the model — it is that
production's deployed AWS model is not the fine-tuned model's base
checkpoint, or even the same model family, at all.

## 5. Semantic interpreter provider path (verified)

`interpretTurn() → interpretWithLlm() → callLlmJson(buildPrompt()) →
llmService.callLLM() → callLLMCore()`'s `LLM_PROVIDER==="bedrock"` branch
(line 565) → `buildAnthropicRequest()` → AWS Bedrock `InvokeModel` on
`apac.amazon.nova-pro-v1:0`. The `LLM_PROVIDER==="ollama"` branch (line
590) is reachable in code but **dead in the live AWS configuration**.
Full trace: `semantic_provider_path.json`.

## 6. Chat-template bug — reproduced, and found to affect the LIVE Bedrock path too

Re-reading `buildAnthropicRequest()` (line 68-87) in full for this task
(V2.3A.5 only inspected the Ollama branch): it calls `buildOllamaMessages(prompt)`
**internally** before building the Bedrock/Anthropic request. Confirmed
by executing the real, unmodified, exported `buildOllamaMessages()`
against a faithfully reconstructed `buildPrompt()` output (`training/semantic-qwen3-4b/scripts/audit_ollama_message_split.ts`
— read-only, imports one real exported function, does not touch
production):

```
message count: 1
roles: [ 'user' ]
system role present: false
user role present: true
```

Because `buildAnthropicRequest()` finds no `{role:system}` entry in that
result, its own `system` variable stays `undefined`, and (for JSON-mode
calls) is set to **only** the generic reminder *"Respond with valid JSON
only..."* — **`buildPrompt()`'s real instructions never reach Bedrock's
system slot at all**; they are relegated into the single Bedrock user
message instead. `OLLAMA_SEMANTIC_ROLE_SPLIT_BUG_CONFIRMED`, and —
because `LLM_PROVIDER=bedrock` is what's actually live — this executes
on **every real semantic-interpretation request in production today**,
independent of anything Qwen-related. Full detail: `ollama_message_audit.json`.

Separately: this defect does **not** represent a Qwen-training/production
mismatch per se (Nova Pro was never fine-tuned or prompt-aligned by this
project), but it **is** a real, live, active defect degrading the actual
production model's prompt structure right now — a distinct, more
general robustness bug this audit surfaced as a side effect.

## 7. Model/deterministic ownership — frozen

See `model_ownership_matrix.json` for the full 15-row table. Ownership
modes, using the task's own precise vocabulary:

| Field | Mode |
|---|---|
| `primaryIntent` | `DETERMINISTIC_PRIMARY_MODEL_FALLBACK` |
| `entities` | `DETERMINISTIC_PRIMARY_MODEL_GAP_FILL_VALIDATED` |
| `goalSignals` | `DETERMINISTIC_PRIMARY_MODEL_FALLBACK` |
| `asksRecommendation` | `MODEL_PRIMARY` |
| `isCorrection` | `MODEL_PRIMARY` |
| `references` | `DETERMINISTIC_DETECTION_PLUS_GROUNDING_VALIDATION` |
| `ambiguities` | `DETERMINISTIC_DETECTION_PLUS_GROUNDING_VALIDATION` |
| `clarificationRequired` | `DETERMINISTIC_WITH_NARROW_MODEL_OVERRIDE` |
| `requestedAction` | `DETERMINISTIC_PRIMARY_MODEL_FALLBACK` (narrow — model ever only contributes `SUGGEST`) |
| `workflowIntent`, `corrections`, `negations`, `asksWhy`, `confidence` | `DETERMINISTIC` |
| `source` | `PROVENANCE` (not model-ownable at all) |

A found gap, worth noting but not fixed here: `validateLlmEntities()`'s
`RANGE` cross-check table doesn't cover `WEIGHT_UNLABELED`/`GENDER` —
consistent with `buildPrompt()`'s own entity-type enum text also omitting
them (§8).

## 8. Guard placement — frozen

**`REFERENCE_GUARD_INSERTION_POINT_V1`**: inside `interpretDeterministic()`,
between the existing `const references = detectReferences(s);` and the
construction of `ambiguities`/`clarificationRequired`/the return object
— verified against the actual current line numbers, compatible with the
existing flow. **Not implemented here.** One concrete prerequisite this
plan surfaces: `reference_grounding_guard.py` is Python; A.7 must **port**
its logic to TypeScript (candidate extraction, domain detection, the
bare-deictic/explicit-target check, the disambiguator rule, and its 29
tests) — this is real implementation work, not a trivial import. Full
plan: `guard_integration_plan.json`.

## 9. `SEMANTIC_TRAINING_CONTRACT_V3` spec (not a dataset)

5 fields, exactly matching the real, live `LlmOutputSchema`:
`primaryIntent, entities(4-field subset), goalSignals, asksRecommendation,
isCorrection`. Also flags a real, minor, previously-unflagged
`buildPrompt()` text gap: its entity-type enum lists only 8 of the real 10
`ENTITY_TYPES` (missing `WEIGHT_UNLABELED`, `GENDER`). Full spec:
`training_contract_v3_spec.json`.

### Data reusability (planning only — no dataset built)

| V3 field | Classification |
|---|---|
| `primaryIntent` | `EXISTING_GOLD_DIRECT` |
| `entities` | `EXISTING_GOLD_DERIVABLE` (drop 2 sub-fields) |
| `goalSignals` | `EXISTING_GOLD_DIRECT` |
| `asksRecommendation` | `EXISTING_GOLD_DERIVABLE` (heuristic: `primaryIntent==="ASK_RECOMMENDATION"`, not spot-checked here) |
| `isCorrection` | `EXISTING_GOLD_DERIVABLE` (heuristic: `corrections.length>0`, not spot-checked here) |

**0 fields need brand-new labeling; 0 are unavailable.** Up to ~489
non-heldout rows across the V2/V2.1/V2.2 lineage are mechanically
transformable in principle. Overall: **`PARTIAL`** (the 2 heuristic
fields need a spot-check pass before being trusted, not a from-scratch
labeling effort). Full detail: `training_data_reusability.json`.

## 10. Metric ownership boundary — frozen

`MODEL_EVAL ≠ SYSTEM_EVAL`. `referenceAccuracy` and
`ambiguityAccuracy`/`OVERCONFIDENT_AMBIGUITY` are reclassified
**SYSTEM-only** metrics (meaningful only once the guard is actually
integrated into the runtime path) — not model metrics, confirming and
operationalizing V2.3A.5's finding. `entityF1Mean`/`primaryIntentAccuracy`
remain genuine MODEL metrics. Full detail: `metric_boundary.json`.

## 11. A.7 implementation plan (not started)

7 phases — fix the live message-role contract (P0, independent of Qwen),
formalize the 5-field contract/fix the entity-enum text gap, pin down
existing merge behavior with tests before touching it, port+integrate
the grounding guard, full regression coverage, a real
`PRODUCTION_PATH_SEMANTIC_BASELINE_V1` evaluation using the actual live
path (Bedrock/Nova Pro, not a hypothetical Qwen call), then a
shadow/offline comparison against historical numbers. Full detail:
`a7_implementation_plan.json`, expected file changes: `a7_expected_file_changes.json`,
runtime-equivalent evaluation plan: `runtime_eval_plan.json`.

**Minimized change surface**: the deterministic interpreter's overall
shape, router, policy, bounded workflows, confirmation architecture, and
business-service boundaries are all explicitly preserved — only the
prompt/message-role boundary and the reference-grounding insertion point
change.

## 12. Why V2.1 must not be deployed

`DO_NOT_DEPLOY_V2_1_ADAPTER` — frozen. V2.1 was trained against the old
13-field contract, which §9's V3 spec explicitly supersedes; deploying it
would lock in exactly the misalignment this whole audit chain exists to
resolve, merely because it was the best-scoring historical adapter under
the wrong contract. Also moot in the immediate term: the live AWS model
isn't even Qwen-based right now (§4), so there is no GGUF/Ollama bridge
for V2.1 to plug into regardless.

## 13. Why heldout remains sealed

`DO_NOT_OPEN_EXISTING_66_ROW_HELDOUT_YET` — frozen, unchanged from
V2.3A.5, now reinforced: the heldout set's value depends on a model/system
metric boundary (§10) that doesn't exist yet in any implemented form, and
on a runtime contract that isn't implemented either. Its future-reuse
status without opening it: **`HELDOUT_REUSE_UNDETERMINED_UNTIL_CONTRACT_ALIGNMENT`**
— its manifest/schema (metadata-only, never inspected beyond that) is
consistent with it eventually supporting either a MODEL-V3 eval or a
SYSTEM eval, but which one (or both) can't be determined without opening
it, which this task does not do.

## 14. Verdicts

- **AWS provider verdict: `AWS_RUNTIME_PROVIDER_VERIFIED`** (live,
  read-only evidence obtained in this task, corroborated by a prior
  independent audit).
- **Chat-template verdict: `OLLAMA_SEMANTIC_ROLE_SPLIT_BUG_PRODUCTION_ACTIVE`**
  (the defect demonstrably executes on the real live Bedrock call path,
  confirmed by code trace + reproduction script — not merely present in
  unreachable Ollama-only code).
- **Contract freeze verdict: `SEMANTIC_RUNTIME_CONTRACT_V1_FROZEN`** — no
  repository or runtime evidence in this task exposed a genuine
  unresolved semantic question strong enough to block freezing the
  already-strongly-supported HYBRID direction.
- **Implementation readiness: `NOT_READY_FOR_ALIGNMENT_IMPLEMENTATION`**
  — the contract and guard-placement decisions are frozen, but the active
  provider is Bedrock, not Ollama, and this task's §6 chat-template fix
  plan and §8 guard port are both still only *plans*; §44/§46's own
  readiness bar ("implementation surface mapped" is met; "no unresolved
  product semantics" is met) is close, but the structured-message-input
  change (§6) touches 3 files across a shared, multi-provider utility
  (`llm.service.ts`) that other callers (prompt_builder.ts's RAG/narration
  flows) also depend on — verifying that change's blast radius belongs to
  the implementation task itself (A.7), not this freeze-and-plan task.

## 15. Explicitly not done in this task

No production file modified (`interpreter.ts`, `llmService`,
`buildOllamaMessages()`, router, policy, signals, schemas, the guard,
provider configuration — all confirmed read-only via `git diff --stat`),
no AWS state mutated (only explicitly read-only calls made, no secret
values printed), no training run, no V3 dataset created, no heldout
access, no Optuna, no GGUF export, no `ollama create`, no A.7
implementation started automatically.
