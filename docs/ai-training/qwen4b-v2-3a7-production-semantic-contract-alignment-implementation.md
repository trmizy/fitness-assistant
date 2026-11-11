# Gymini Semantic Fine-Tune — V2.3A.7 Production Semantic Contract Alignment Implementation

`SOURCE_HEAD=END_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, unchanged
throughout. Branch `aws-deploy`. `HELDOUT_UNOPENED`. `TRAINING_NOT_RUN`.
`OPTUNA_NOT_RUN`. `NO_GGUF_EXPORT`. `PRODUCTION_DEPLOYED=NO`. 3 production
files modified (`llm.service.ts`, `json_llm_call.util.ts`,
`interpreter.ts`, 101 insertions/18 deletions total) + 1 new production
file (`reference-grounding-guard.ts`) + 4 new test files. No AWS state
mutated — only read-only config inspection and one genuine, inference-only
Bedrock call attempt (explicitly pre-authorized by this task).

## 1. Starting state

V2.3A.6 froze `SEMANTIC_RUNTIME_CONTRACT_V1` (HYBRID/Strategy C) and
confirmed, live: AWS Lambda, `LLM_PROVIDER=bedrock`,
`apac.amazon.nova-pro-v1:0`, and the chat-template role-split bug
(`buildOllamaMessages()`'s brittle `"Câu hỏi của user:"` marker-sniffing)
active on the real Bedrock path via `buildAnthropicRequest()`.

## 2. Phase 1 — root cause and fix

**Root cause, confirmed before patching** (task's own requirement):
`buildOllamaMessages(prompt)` infers roles from a substring marker that
only `llm/prompt_builder.ts`'s callers (`cycle-assessment.service.ts`/
`cycle-analysis.service.ts`'s RAG/narration flow) happen to include.
`interpreter.ts`'s `buildPrompt()` never contained it, so the semantic
prompt collapsed to one `{role:"user"}` message on **both** the Ollama
branch and — found freshly in this task — the live Bedrock branch, since
`buildAnthropicRequest()` calls `buildOllamaMessages()` internally too.

**Fix principle applied**: fixed the API boundary, not the prose. Added
`LlmCallOpts.systemPrompt?: string` (new, optional). When a caller
supplies it, every provider branch (`bedrock`/`anthropic` via
`buildAnthropicRequest()`, `ollama` directly) builds a real `{system,
user}` split from it directly, bypassing `buildOllamaMessages()`'s
string-sniffing entirely for that call. Callers that omit it (every
pre-existing caller) get **byte-for-byte the exact same behavior as
before this task** — no magic marker was added to `interpreter.ts`, and
no broad rewrite of the 32 callers found for `callLlmJson`/`callLLM` was
needed.

`interpreter.ts`'s `buildPrompt()` is now `buildSystemInstructions()` +
`buildUserTurn(text, ctx)`, passed as `callUserTurn` + `systemPrompt`
at both of its 2 call sites (`interpretWithLlm`, `llmOnlyReading`).

**Nova/Bedrock request correctness**: `bedrock.client.ts`'s
`buildConverseTextInput()` already used the Converse API's real,
native top-level `system: [{text}]` field (not an Anthropic-specific
convention) — no change needed there; the defect was entirely upstream,
in how `llm.service.ts` computed `system`/`userContent` before calling it.

**Prompt text/schema alignment** (V2.3A.6's own finding): `buildPrompt()`'s
entity-type enum text listed only 8 of the real 10 `ENTITY_TYPES` —
fixed to list all 10 (`WEIGHT_UNLABELED`, `GENDER` added to the prompt
text; the Zod schema already accepted both, it just never told the model).

## 3. Phase 1 regression (5 tests, `llm-service-structured-message-contract.test.ts`)

Proves, against the real Bedrock Converse request-building code (mocked
transport only): a `systemPrompt` call produces a real system block with
user content holding ONLY the user turn; a legacy call with no
`systemPrompt` keeps the exact prior behavior (including the real
`"Câu hỏi của user:"` marker still splitting correctly); `callLlmJson`
forwards it correctly; the real `ConverseCommand` type is used (not a
reimplemented request shape).

## 4. Phase 2/3 — 5-field contract pinned, a real merge-logic defect found and fixed

`LlmOutputSchema` was already correct (5 fields, matches `asksRecommendation`/
`isCorrection`'s real narrow production roles) — unchanged.

**A real integration defect found during this task, not anticipated in
the plan**: `interpretWithLlm()`'s merge unconditionally reset
`clarificationRequired` to `false` and floored `confidence` at
`Math.max(det.confidence, 0.6)` on every LLM-fallback call — which would
have **silently erased the newly-integrated guard's grounding-failure
signal** exactly in the `primaryIntent===UNKNOWN` cases that trigger this
fallback path in the first place. Fixed: both resets are now skipped
specifically when `det.ambiguities` already carries the guard's own
`{field:"reference"}` marker; every other ambiguity source keeps the
exact pre-existing reset behavior. Proven by `interpreter-llm-merge.test.ts`'s
3 tests (grounding failure survives the merge; a control case with no
grounding failure keeps the unchanged legacy behavior) — run against the
real `interpretWithLlm()` through a mocked Bedrock transport.

## 5. Phase 4/5 — TypeScript guard port + integration

`reference-grounding-guard.ts` ports `reference_grounding_guard.py`'s
logic (candidate extraction, domain detection, bare-deictic/explicit-
target check, disambiguator rule) — same invariant, cleaner TS structure
(split into a primitive `groundReferences(references, messageText)` core
+ a `validateReferenceGrounding(interpretation, messageText)` wrapper;
reuses the real `normalizeAgentText` instead of reimplementing
normalization). **Frozen insertion point, verified against actual code**:
inside `interpretDeterministic()`, called immediately after
`detectReferences(s)` — necessarily the primitive form, since
`primaryIntent`/`confidence` are computed later in the SAME function from
`references.length`, and must see only grounded references, not raw
surface matches the guard is about to invalidate anyway. Bounded
correction unchanged from the offline design: only `references`,
`ambiguities`, `clarificationRequired`, `confidence` are ever touched.

18/18 unit+property tests pass (`reference-grounding-guard.test.ts`,
covering all 8 of the task's matrix conditions A-H). 8/8 integration
tests pass (`interpreter-reference-grounding.test.ts`), including the
critical regression: an ungrounded `"PT đó"` no longer lets the stray
reference silently promote a would-be `UNKNOWN` `primaryIntent` to
`PROVIDE_INFORMATION` (the exact mechanism `interpreter.ts`'s own "a pure
reference... answering a proposal is information, not unknown" comment
describes).

## 6. Focused + regression tests — exact counts, nothing inflated

| Suite | Tests | Result |
|---|---|---|
| `bedrock-provider.test.ts` (pre-existing, unmodified) | 25 | pass |
| `llm-provider-anthropic-regression.test.ts` (pre-existing, unmodified) | 3 | pass |
| `llm-provider-ollama-regression.test.ts` (pre-existing, owned by a concurrent agent session, not modified) | 4 | pass |
| `llm-service-structured-message-contract.test.ts` (new) | 5 | pass |
| `reference-grounding-guard.test.ts` (new) | 18 | pass |
| `interpreter-reference-grounding.test.ts` (new) | 8 | pass |
| `interpreter-llm-merge.test.ts` (new) | 3 | pass |
| **Total** | **66** | **66 pass, 0 fail** |

`tsc --noEmit` for the ai-service package: **PASS**, re-run after every phase.

**Not run, disclosed honestly** (`semantic_regression_results.json`):
`conversational-intelligence-v2.test.ts`, `conversational-intelligence-remediation.test.ts`,
`conversational-intelligence-global.test.ts` all require a live Postgres
connection; Docker Desktop was not running in this environment and was
not started for this task (a separate, heavier action, not taken).
Evidence label for this task's testing: **CODE AUDIT + mocked/unit-level
BACKEND INTEGRATION** (real AWS SDK types and request-builders, mocked
transport) — explicitly **not** "full repository regression."

## 7. Phase 7 — PRODUCTION_PATH_SEMANTIC_BASELINE_V1

A small (10-row), new, explicit, unsealed smoke corpus (never the sealed
heldout) run through the REAL `interpretTurn()` path with
`LLM_PROVIDER=bedrock` and credentials already authorized in this
environment (`arn:aws:iam::191798898985:user/vmimport-admin`).

**A second real bug found and fixed while building this**: the baseline
script's first version used a static `import` of `interpreter.ts` at the
top of the file — which, per ES module hoisting rules, executes *before*
the script's own `process.env.LLM_PROVIDER = "bedrock"` assignment,
silently defeating it and routing calls to the (unavailable) Ollama
branch instead. Fixed by switching to the same dynamic `await import()`
pattern every existing provider-regression test already uses specifically
for this reason.

**Live Bedrock inference result**: `ValidationException: Operation not
allowed` (HTTP 400) — a genuine AWS/Bedrock-side invocation restriction
under this specific (admin, but not the deployed Lambda's own scoped)
caller identity, **not a code defect**: the request correctly resolved
`LLM_PROVIDER=bedrock` and reached the real endpoint (a specific AWS
error came back, not a network/credential error), and the existing
fallback-to-deterministic behavior activated cleanly with no crash. Per
task §47's own explicit instruction, not retried further (no IAM/Bedrock-
access change attempted — out of scope) and not substituted with an
Ollama/Qwen result. Full evidence: `bedrock_runtime_evidence.json`.

**MODEL metrics** (label `PRODUCTION_PATH_HYBRID_V1`, not comparable to
`HISTORICAL_OFFLINE_13_FIELD` numbers): primaryIntent 2/3 (1 miss is a
corpus-authoring regex-anchor issue, not a regression), entities 1/1,
goalSignals 1/1, asksRecommendation 1/1.

**SYSTEM metrics**: reference grounding 2/3, clarification 2/3 (the one
miss: a message whose deictic surface-matched `ACCEPT_PROPOSAL`, not
`THIS_ITEM`, per `signals.ts`'s own pre-existing, unmodified
classification — outside the guard's declared scope by design, not a
guard defect; see `runtime_system_metrics.json` for the exact trace).
The 2 cases genuinely inside the guard's scope (a PT-deictic with zero
antecedent, and a grounded same-message backreference) both scored
correctly.

**Verdict: `PRODUCTION_PATH_BASELINE_LOCAL_CONTRACT_ONLY`**, live-provider
portion **BLOCKED** (AWS-side, not code).

## 8. Remaining blockers (not touched, per explicit instruction)

`DISMISS_IDIOM_HANDLING_REMAINS`, `NON_PT_REFERENCE_POLICY_REMAINS` — both
unchanged from V2.3A.4-A.6's own findings, confirmed still present and
explicitly not grown into new scope. Full detail: `remaining_blockers.json`.

## 9. No-deploy statement

`PRODUCTION_DEPLOYED = NO`. This task implemented repository code only.
No `git push` for deployment, no CI trigger, no `aws lambda
update-function-code`/`update-function-configuration`, no environment
variable change, no model/provider switch. Modifying repository code
does **not** mean AWS production changed.

## 10. Heldout statement

`HELDOUT_UNOPENED`. Even with Phase 1-6 fully succeeding, heldout strategy
must be reconsidered separately (the 66-row set was designed around the
old 13-field model contract) — not decided or acted on in this task.

## 11. Next decision

**`NO_FINE_TUNE_NEEDED_YET`** — current production is Nova Pro via
Bedrock, not Qwen, and remains so after this task (no provider/model
change was made or proposed). The HYBRID architecture's deterministic-
first design plus the now-integrated grounding guard are demonstrated
correct at the unit/mocked-integration level for exactly the fields that
matter. No evidence gathered in this task shows a model-owned-field
deficit specific to Qwen, because Qwen is not the deployed model this
task measured against. A future Qwen fine-tune remains possible but
requires its own, separate, explicit product decision that Qwen is
intended to become a runtime target — not inferred from V2.1's prior
existence.
