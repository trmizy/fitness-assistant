# Gymini Semantic Fine-Tune — V2.3A.5 Production Semantic Contract Alignment Audit

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. `HELDOUT_UNOPENED`. `TRAINING_NOT_RUN`.
`OPTUNA_NOT_RUN`. `NO_GGUF_EXPORT`. `PRODUCTION_CHANGED=NO` — confirmed:
`interpreter.ts`, `signals.ts`, `policy.ts`, `router.ts`, `llm.service.ts`,
model tags, and Ollama config were all read, never edited. This is an
architecture/contract audit only.

## 1. Why this audit was required

V2.3A.3 noticed, in passing, that `interpreter.ts`'s live prompt doesn't
request `references`. That observation was never fully chased down. This
task does so exhaustively: training contract, offline evaluator
contract, production prompt contract, deterministic post-processing,
downstream consumers, model wiring, decoding config, and chat-template
transmission — across the entire V1→V2.3A.4 history, before any further
training or heldout decision.

## 2. Training contract (what Qwen is fine-tuned to produce)

Every V1–V2.2 training/eval row uses the **identical** 13-field system
prompt, requesting the full `SemanticInterpretationSchema`: `primaryIntent,
workflowIntent?, entities[], corrections[], references[], goalSignals[],
negations[], ambiguities[], requestedAction?, asksWhy?,
clarificationRequired, confidence, source`. Rendered as exactly 2 chat
messages (`system`, `user`) via `tokenizer.apply_chat_template()`, no
conversation history, assistant-completion masking with `<|im_end|>`
supervised. `source` is **always** the literal string `"LLM"` in every
gold row. Full field table: `outputs/v2.3a5-production-semantic-contract-audit/training_contract.json`.

## 3. Offline evaluator contract

`evaluate_semantics.py` scores purely from the model's raw JSON against
this full 13-field gold, independent of any production-consumption
question. Two backends exist (`ollama`, matching production's
temperature/JSON-mode; `hf`, greedy/0-temperature) — **every reported
V2.1/V2.1I/V2.2/V2.3A metric in this project's history used `--backend
hf`**, not the Ollama-matching one. Metric→field mapping:
`outputs/v2.3a5-production-semantic-contract-audit/offline_eval_contract.json`.

## 4. Production model prompt contract — verified from code, not trusted from any prior report

`interpreter.ts: buildPrompt()` (called only from `interpretWithLlm()`,
itself called only from `interpretTurn()` when
`needsSemanticLlm()` returns true) requests exactly **5 fields** via
`LlmOutputSchema`: `primaryIntent, entities{type,value,sourceText,negated?},
goalSignals, asksRecommendation (boolean), isCorrection (boolean)`.
`asksRecommendation` and `isCorrection` don't exist anywhere in
`SemanticInterpretationSchema` — they are narrower, LLM-call-local
booleans. **`workflowIntent`, `corrections`, `references`, `negations`,
`ambiguities`, `requestedAction` (as a direct field), `asksWhy`,
`clarificationRequired`, `confidence`, `source` are never requested from
the model at all**, confirmed by reading the prompt text and
`LlmOutputSchema`'s Zod shape directly (`production_model_contract.json`).

### A second, previously-unflagged finding: the chat-template transmission is also mismatched

`llm.service.ts: buildOllamaMessages()` only splits a prompt into
`{system}`/`{user}` roles if it contains the literal substring
`"Câu hỏi của user:"` — a marker belonging to a **different** prompt
builder (`llm/prompt_builder.ts`, used by the RAG/narration flows in
`cycle-assessment.service.ts`/`cycle-analysis.service.ts`).
`interpreter.ts`'s `buildPrompt()` never contains that string. **The
semantic-interpretation call is therefore transmitted to Ollama as ONE
undivided `user`-role message, with no `system` role at all** —
structurally different from every training example, which was always
tokenized as a proper `{system},{user}` pair. This was not visible from
reading `buildPrompt()`'s text alone (V2.3A.3's level of inspection); it
required tracing the actual transport function.

## 5. Decoding configuration — three independent mismatches, not one

| | Production | Offline (hf backend, used for every reported result) |
|---|---|---|
| Temperature | 0.2 (real sampling) | 0 (`do_sample=False`, fully greedy) |
| Max tokens | 400 | 160 |
| Chat structure | single collapsed `user` message | proper `{system},{user}` pair |
| Retry | 1 attempt, falls back to deterministic on failure | 1 attempt, scored as failure, no fallback |

Full detail: `generation_config_diff.json`. **Classification: MISMATCH.**

## 6. Deterministic post-processing — the real runtime object

Tracing `interpretDeterministic()` + `interpretWithLlm()`'s merge
(`{...det, ...}`) line by line:

| Field | Real production producer |
|---|---|
| `primaryIntent` | HYBRID — deterministic wins unless `UNKNOWN`, then LLM's value |
| `entities` | HYBRID — deterministic first; LLM only fills missing *types*, each independently range/text-validated by `validateLlmEntities()` |
| `goalSignals` | HYBRID — deterministic wins if non-empty, else LLM's |
| `requestedAction` | HYBRID (narrow) — deterministic wins; LLM only ever contributes the single value `SUGGEST`, via `asksRecommendation` |
| `clarificationRequired` | DETERMINISTIC formula, hard-reset `false` on the LLM-merge path, flipped back to `true` only in one narrow `isCorrection`-mismatch case |
| `confidence` | DETERMINISTIC formula; LLM path only applies a floor (`max(det, 0.6)`) |
| `workflowIntent`, `corrections`, `references`, `negations`, `ambiguities`, `asksWhy`, `source` | **100% DETERMINISTIC, always** — confirmed by reading every assignment site; the LLM merge never touches them |

**`references` is never overwritten by the LLM merge — confirmed directly
in code, not inferred.** `source` is always `"DETERMINISTIC"` or
`"MERGED"` — **the value `"LLM"`, used in every single training/eval gold
row, never occurs in real production output.** Full table:
`runtime_semantic_contract.json`.

## 7. Downstream consumers (re-confirmed, extending V2.3A.3)

- `policy.ts:155` consumes `references` only for
  `ACCEPT_PROPOSAL/LOWER_OPTION/HIGHER_OPTION/MIDDLE_OPTION`, always
  gated behind a separate `ctx.proposal` grounding check.
- `global/router.ts:248` uses `interp.references.length > 0` as one
  mention-presence signal among several for a `SLOT_ANSWER` heuristic —
  operating on `interpretDeterministic()`'s output, never an LLM-merged one.
- `global/progress-review.ts`, `training-coach.ts`,
  `personalized-interpretation.ts` — all explicitly comment *"nothing is
  added to `SemanticInterpretationSchema`"* and call `callLlmJson` with
  their own separate `NarrationSchema` (narration/explanation generation
  only, not semantic interpretation).
- `global/llm-route.ts` — a separate, new LLM call using its own
  `LlmRouteSchema`, for routing, not semantic interpretation.
- `UnifiedTurnUnderstanding` (`turn-understanding/types.ts`) — explicitly
  documented as *"NOT a router... constructed AFTER the existing,
  hardened dispatch chain has already decided"* — a pure, synchronous,
  deterministic **observability projection** (`adapters.ts`'s own
  comment: *"Pure, synchronous, deterministic functions only"*) built
  from whichever real mechanism governed the turn. It reuses
  `schema.ts`'s types verbatim but is not a second canonical contract,
  and is never itself an LLM call.

None of the actively-developing `conversational-intelligence/global/`
workstream touches `SemanticInterpretationSchema`'s `references`/
`ambiguities`/`clarificationRequired` fields at all — it is building a
parallel routing+narration layer with its own, smaller schemas.

## 8. Model wiring — is any fine-tuned artifact used in production?

**`FINE_TUNED_MODEL_NOT_WIRED`.** Searching `backend/` for
`qlora|unsloth|adapter_model|LoraConfig|semantic-qwen3-4b` returns exactly
**1 match**: `export-semantic-schema-enums.ts`, a one-directional
schema→training-dataset enum export, never a model-loading path. `infra/`
has zero `ollama create`/GGUF/adapter references. `LLM_MODEL` resolves
(`llm.service.ts:39-54`) to the **plain base**
`qwen3:4b-instruct-2507-q4_K_M` GGUF tag — the exact checkpoint every
V1–V2.3A adapter was fine-tuned *from*, without any of the fine-tuning
applied. Full evidence: `model_wiring_status.json` (including an
explicitly-flagged, not-independently-verified open question: whether
the live AWS deployment currently runs `LLM_PROVIDER=ollama` or the
documented `anthropic` opt-in for no-GPU instances — a running-infra
fact this code audit did not check).

## 9. Field alignment matrix (the core output of this task)

Full machine-readable version: `field_alignment_matrix.json` (15 rows: 13
`SemanticInterpretationSchema` fields + 2 production-only booleans).
Summary:

| Status | Count | Fields |
|---|---|---|
| `SEMANTICALLY_EQUIVALENT_BUT_DIFFERENT_ENCODING` | 3 | `primaryIntent`, `entities`, `goalSignals` |
| `TRAINED_BUT_NOT_REQUESTED_IN_PRODUCTION` | 7 | `workflowIntent`, `corrections`, `references`, `negations`, `ambiguities`, `asksWhy`, `confidence` |
| `PRODUCTION_ONLY_PARTIALLY_REQUESTS` | 1 | `requestedAction` |
| `SEMANTIC_ENCODING_MISMATCH` | 1 | `source` |
| `REQUESTED_IN_PRODUCTION_BUT_NOT_TRAINED` (as its own target) | 2 | `asksRecommendation`, `isCorrection` |
| `ALIGNED` | 0 | — |

**Zero fields are cleanly `ALIGNED`.**

## 10. Risk classification

| Risk | Count | Fields |
|---|---|---|
| **CRITICAL** | 3 | `references`, `ambiguities`, `clarificationRequired` |
| HIGH | 2 | `corrections`, `requestedAction` |
| MEDIUM | 6 | `primaryIntent`, `workflowIntent`, `entities`, `negations`, `asksRecommendation`, `isCorrection` |
| LOW | 4 | `goalSignals`, `asksWhy`, `confidence`, `source` |

The 3 CRITICAL fields are **exactly** the fields this entire V2.1→V2.3A.4
line of work focused on hardest (`referenceAccuracy`,
`ambiguityAccuracy`/`OVERCONFIDENT_AMBIGUITY`).

## 11. Metric relevance — reinterpreting, not rewriting, V2.1–V2.3A.4

| Metric | Relevance |
|---|---|
| `referenceAccuracy` | **`NOT_PRODUCTION_RELEVANT_UNDER_CURRENT_CONTRACT`** |
| `ambiguityAccuracy` / `OVERCONFIDENT_AMBIGUITY` | **`NOT_PRODUCTION_RELEVANT_UNDER_CURRENT_CONTRACT`** |
| `entityF1Mean` | `PRODUCTION_RELEVANT_INDIRECTLY` |
| `primaryIntentAccuracy` | `PRODUCTION_RELEVANT_INDIRECTLY` (the single most relevant of the group) |
| `correctionAccuracy` | `NOT_PRODUCTION_RELEVANT_UNDER_CURRENT_CONTRACT` |
| `requestedActionAccuracy` | `PRODUCTION_RELEVANT_INDIRECTLY` |
| `jsonValidityRate`/`schemaValidityRate`/`inventedEnumRate` | `TRAINING_DIAGNOSTIC_ONLY` |

**No prior conclusion is deleted.** V2.1's referenceAccuracy win
(0→0.267/0.429), V2.2's regression, and V2.3A/A.1–A.4's entire guard
investigation remain exactly what they were: genuine findings about
**the fine-tuned model's and the deterministic guard's own offline
behavior**. What changes is the *production-performance* interpretation
layered on top of them: those results describe a capability the
production system does not currently obtain from the model in this
form, under the architecture read in this audit. The guard's underlying
logic (grounding against visible-message candidates) remains directly
relevant regardless — see §13.

## 12. V2.3 guard placement, if ever integrated

The guard's own invariant (a reference is valid only if the visible
message provides a unique grounded candidate) has **nothing to do with
whether the reference came from the model or from `detectReferences()`**
— it is equally applicable to either. The narrowest, most
architecture-consistent placement (task §28/§35): applied to
`interpretDeterministic()`'s `references` output directly, inside
`interpreter.ts`, immediately after `detectReferences(s)` computes it
(before it reaches `ambiguities`/`clarificationRequired`/the return
object) — not inside the LLM-merge path at all, since `references` never
flows through that path in the first place. This is the same
non-authoritative, post-processing role the guard was always designed
for (task-level architecture, §7 of V2.3A's own design) — it does not
make the model authoritative, and it does not require expanding the
model's requested fields.

## 13. Proposed contracts (not implemented)

**`SEMANTIC_RUNTIME_CONTRACT_V1_PROPOSAL`** (HYBRID, Strategy C):
model owns `primaryIntent`, `entities` (gap-fill, cross-validated),
`goalSignals` (fallback), `asksRecommendation`, `isCorrection`.
Deterministic layers own `workflowIntent`, the full `corrections[]`
array, `negations`, `asksWhy`, `confidence`, `source`. The guard
validates `references` and `clarificationRequired`/`ambiguities` against
the deterministic (or, if ever added, model-assisted) candidate set.
Full shape + worked example: `runtime_contract_v1_proposal.json`.

**`SEMANTIC_TRAINING_CONTRACT_V3_PROPOSAL`** (not a new dataset, not
trained): shrink future training targets to exactly
`{primaryIntent, entities, goalSignals, asksRecommendation, isCorrection}`
— i.e., literally `LlmOutputSchema`. This would make offline metrics
production-relevant for the first time in this project's history. Also
flags the chat-template question (§4) as something any future training
contract must explicitly decide, not silently inherit. Full detail:
`training_contract_v3_proposal.json`.

Strategy B (expand production to request the full trained object) was
considered and rejected: it would re-introduce exactly the
hallucination risk (confident resolution with zero visible antecedent)
the entire V2.3A line of work exists to prevent, for no architectural
gain over the HYBRID design the grounding guard already proves works.

## 14. Heldout validity

**`HELDOUT_CURRENTLY_NOT_PRODUCTION_VALID`.** The two metrics the
66-row heldout set would most informatively test, given this project's
own history (`referenceAccuracy`, `ambiguityAccuracy`), measure fields
production does not obtain from the model at all under the current
contract. Opening it now would produce a number that is internally
valid (a real measurement of the fine-tuned model's offline behavior)
but not a valid estimate of production semantic performance. **Heldout
remains sealed in this task regardless** — `HELDOUT_UNOPENED`.

## 15. Verdicts

**`PRODUCTION_SEMANTIC_CONTRACT_MISALIGNED`** — zero fields are cleanly
aligned; 3 are CRITICAL mismatches, concentrated exactly on the fields
this project invested the most effort in (`references`, `ambiguities`,
`clarificationRequired`).

**`FINE_TUNED_MODEL_NOT_WIRED`**.

**`NEEDS_CONTRACT_PRODUCT_DECISION`** — the mismatch is fully mapped and
a recommended ownership (HYBRID) is drafted, but real product/architecture
decisions remain genuinely open (should `isCorrection` fully replace the
trained `corrections[]` target? is the Strategy-B alternative truly
rejected by the business, not just by this audit's own architectural
read? what does the live AWS deployment's `LLM_PROVIDER` actually
resolve to right now?) — these are decisions for a human to confirm, not
something this audit should impose by proceeding straight to
implementation. Not `READY_FOR_SEMANTIC_CONTRACT_ALIGNMENT_IMPLEMENTATION`
(would overclaim certainty on open product questions) and not
`BLOCKED_BY_RUNTIME_UNKNOWN` (the mapping itself is not blocked — it's
complete).

**`NO_NEW_FINE_TUNE_BEFORE_ALIGNMENT`** — no V2.4/V2.5/Optuna/larger
dataset should be proposed until the contract question above is
explicitly decided.

## 16. Next minimal action

A product/architecture decision on `SEMANTIC_RUNTIME_CONTRACT_V1_PROPOSAL`
(§13): confirm or revise the HYBRID field-ownership split, decide whether
to fix `buildOllamaMessages()`'s chat-template collapse (§4) as part of
any future production change, and confirm the live AWS `LLM_PROVIDER`
value. Only after that decision should any of: (a) production's
`buildPrompt()`/`LlmOutputSchema` be expanded to the agreed model-owned
set, (b) the V2.3A grounding guard be wired into `interpreter.ts` at the
location named in §12, or (c) a `SEMANTIC_TRAINING_CONTRACT_V3` dataset
be planned — be started, and none of those three should be started
automatically from this audit.

## 17. Explicitly not done in this task

No production file edited (`interpreter.ts`, `signals.ts`, `policy.ts`,
`router.ts`, `llm.service.ts`, model tags, Ollama config all confirmed
read-only), no historical gold/canonical-view file touched, no guard or
evaluator edited, no training run, no new dataset, no heldout access, no
Optuna, no GGUF export, no adapter merge/deploy, no automatic start of
any implementation task.
