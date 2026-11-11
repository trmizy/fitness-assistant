# Gymini Semantic Fine-Tune — Training Diagnostic D1

`START_HEAD=187745350ab147003d030d4826c430e84dfe3e59`, re-checked stable at
every checkpoint of this diagnostic (`git rev-parse HEAD` unchanged every
time it was checked). `END_HEAD` is the same value — nothing in this
diagnostic touched a tracked file outside `training/semantic-qwen3-4b/` and
this `docs/` directory. Branch `aws-deploy`.

## 0. Why this diagnostic exists

`qwen4b-baseline-experiment-v1.md` compared **OLLAMA_BASE** (GGUF Q4_K_M,
Ollama's real serving runtime) against **HF_QLORA** (bitsandbytes 4-bit +
PEFT adapter, plain `transformers.generate()`) and concluded QLoRA
regressed on most metrics except invented-enum rate. That comparison
changes two variables at once — the adapter AND the backend/runtime/
quantization — so it cannot isolate which one caused the regression. This
diagnostic builds the missing **HF_BASE** run (same backend as HF_QLORA,
no adapter) so the causally meaningful comparison is **HF_BASE → HF_QLORA**
(backend held constant, adapter is the only variable).

## 1. A real bug found and fixed in the diagnostic tooling (not training)

`masking_utils._ids()` checked `isinstance(result, dict)` to detect whether
`tokenizer.apply_chat_template(..., tokenize=True)` returned a `BatchEncoding`
(pull out `["input_ids"]`) or a plain list (use as-is). `BatchEncoding`
subclasses `collections.UserDict`, **not** `dict` — so the check silently
failed, and `_ids()` returned the raw `BatchEncoding` object unchanged
whenever called with a plain `AutoTokenizer`. This broke
`masking_diagnostic.py`'s and `diagnose_termination.py`'s ability to run at
all (`RuntimeError: Chat template is not prefix-stable...`, firing on every
row).

**This did not affect the real training run.** `train_qlora_semantic.py`
calls `build_input_ids_and_labels` with the tokenizer returned by
`FastLanguageModel.from_pretrained` (Unsloth's own patched tokenizer),
which returns a plain list from the same call — confirmed by file mtimes
(`masking_utils.py` last modified 2026-10-09 22:18:39, training ran
2026-10-09 23:11:16, same unchanged code) and by the fact that training
completed successfully (26 steps, adapter saved) rather than crashing on
this exact exception, which it would have if the bug applied to its code
path.

**Fix applied**: `_ids()` now checks `hasattr(result, "keys")` instead of
`isinstance(result, dict)` — matches the function's own pre-existing
docstring, which already (incorrectly) claimed this was handled. One-line
change, `training/semantic-qwen3-4b/scripts/masking_utils.py`. Re-running
`masking_diagnostic.py` and `diagnose_termination.py` after the fix
produces clean, consistent results (below) — no further changes were made
until this was proven correct, per task instruction.

## 2. §6/§7 — Training label termination (CRITICAL question, now answered)

With the fix applied, `diagnose_termination.py` was run against the first
3 real v1 training rows (`reference-ordinal-pt-1/2/3`):

```
last 10 supervised label token ids: [330, 67105, 2512, 788, 330, 38634, 32432, 9207, 151645, 198]
decoded: [' "', 'requested', 'Action', '":', ' "', 'CONF', 'IRM', '"}', '<|im_end|>', '\n']
last REAL (non-masked) supervised token id: 198 -> '\n'
does supervised completion include <|im_end|> (151645)? True
```

Identical for all 3 rows. **The supervised assistant completion correctly
includes `<|im_end|>` as its second-to-last token** (the trailing `\n` after
it is also real/supervised — harmless, Qwen3's own template always emits
it after `<|im_end|>`). The completion was built from
`prompt_ids + completion_ids` where `completion_ids` is the literal
tokenization of `prompt_messages + completion_messages` minus the prompt
prefix (§7's prompt/completion boundary, verified via `masking_diagnostic.py`:
182 prompt tokens masked `-100`, 92 completion tokens real, no leakage
either direction) — not hand-built from plain JSON text without the chat
template's end marker.

**Verdict: `TRAINING_TERMINATION_LABEL_BUG` is ruled out.** The model was
correctly taught where its answer ends.

## 3. §5 — EOS/stop-token identity

```
tokenizer.eos_token = '<|im_end|>'          tokenizer.eos_token_id = 151645
tokenizer.pad_token = '<|vision_pad|>'      tokenizer.pad_token_id = 151654
generation_config.eos_token_id = [151645, 151643]
generation_config.pad_token_id = 151654
eos_token_id == <|im_end|> id? True
```

`evaluate_semantics.py`'s `call_hf()` passes `pad_token_id=tokenizer.eos_token_id`
to `generate()` (not the real `151654`) and does not pass `eos_token_id`
explicitly, so `generate()` falls back to `generation_config.eos_token_id =
[151645, 151643]` — which correctly includes `<|im_end|>`. Since every call
generates exactly one sequence (no batching across cases), `pad_token_id`
has no effect on correctness here — it only matters for masking padding in
a batch. **Verdict: no generation-config bug causes non-termination.**
This setting is identical for HF_BASE and HF_QLORA by construction (same
function, same hardcoded args) — §4/§9's generation-config-parity
requirement is satisfied trivially, not by re-verification of two separate
code paths.

## 4. §8 — Think-scaffold parity

```
TRAINING completion (raw, before strip): <|im_start|>assistant
<think>

</think>

{"primaryIntent": "CONFIRM"}<|im_end|>

HF INFERENCE prompt (add_generation_prompt=True): <|im_start|>assistant
(nothing else)

Is the think-scaffold present at the end of the HF_INFERENCE prompt? False
```

Training strips the 4-token `<think>\n\n</think>\n\n` scaffold from the
supervised completion (so the model is taught to go straight to `{`).
HF inference's prompt (`add_generation_prompt=True`) **does not insert the
scaffold at all** for this tokenizer/template — it stops right after
`<|im_start|>assistant\n`. Both sides agree generation should start
directly at `{`. **No template mismatch between training and inference.**

## 5. HF_BASE — the missing apples-to-apples baseline

Built via `evaluate_semantics.py --backend hf --model unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit`
against the full v1 validation split (21 rows), identical settings to
HF_QLORA (`max_new_tokens=160, do_sample=False`, same tokenizer/chat
template/parser). Output: `training/semantic-qwen3-4b/outputs/hf-base-v1/`.

```
transportSuccessRate: 1.0       jsonValidityRate: 0.5714
schemaValidityRate:   0.0       primaryIntentAccuracy: 0.0
entityF1Mean:         0.4286    correctionAccuracy: 0.5
referenceAccuracy:    0.0       ambiguityAccuracy: 0.5714
unsafeOutputRate:     0.0       inventedEnumRate: 0.5714 (12/21)
meanLatencySeconds:   63.911
outputTokenCountStats: p50=125  p90=160  max=160  ceilingHits160=4/21 (19%)
errorBucketCounts: {INVALID_JSON:9, SCHEMA_INVALID:12, INVENTED_ENUM:12,
  ENTITY_MISSING:3, CORRECTION_WRONG:1, REFERENCE_WRONG:5}
```

## 6. HF_QLORA (re-confirmed, same evaluator, no retraining)

Output: `training/semantic-qwen3-4b/outputs/train/qlora-baseline-v1/eval-d1-fixed/`
(historical pre-fix numbers at `.../eval/` are left untouched for
comparison — numbers are identical, confirming determinism of greedy
decoding across runs).

```
transportSuccessRate: 1.0       jsonValidityRate: 0.3333
schemaValidityRate:   0.0476    primaryIntentAccuracy: 0.0476
entityF1Mean:         0.3333    correctionAccuracy: 0.0
referenceAccuracy:    0.0       ambiguityAccuracy: 0.2857
unsafeOutputRate:     0.0       inventedEnumRate: 0.2381 (5/21)
meanLatencySeconds:   113.07
outputTokenCountStats: p50=160  p90=160  max=160  ceilingHits160=15/21 (71%)
errorBucketCounts: {INVALID_JSON:14, SCHEMA_INVALID:6, INVENTED_ENUM:5,
  WRONG_INTENT:1, CORRECTION_WRONG:1, REFERENCE_WRONG:3, OVERCONFIDENT_AMBIGUITY:1}
```

**The single largest, cleanest signal in this entire diagnostic:**
`ceilingHits160` jumps from **4/21 (19%)** on HF_BASE to **15/21 (71%)** on
HF_QLORA, under byte-identical generation settings. The adapter made the
model dramatically more likely to run out of its 160-token budget without
producing a parseable answer.

## 7. §6/§11 — Invalid-JSON taxonomy (raw text now captured)

Classified programmatically from `rawText` (balanced-brace parse +
repeated-content detection; script and full per-case detail saved at
`training/semantic-qwen3-4b/outputs/d1-invalid-json-taxonomy.json`):

| Taxonomy | HF_BASE (9 invalid) | HF_QLORA (14 invalid) |
|---|---|---|
| TRUNCATED_AT_TOKEN_LIMIT (cut off mid-structure, no closing brace) | 4 | 0 |
| MALFORMED_JSON_SYNTAX (complete, closing brace present, syntax error) | 5 | 0 |
| NON_JSON_FORMAT (free-form prose, never attempts `{`) | 0 | 12 |
| REPEATED_JSON_OR_CONTENT (verbatim repetition loop) | 0 | 2 |

**All 9 of HF_BASE's invalid cases at least attempt JSON** — 4 are cut off
mid-structure by the token ceiling, 5 are complete but contain a real
syntax bug (the base model writes unquoted Vietnamese explanatory prose
inside the `ambiguities` array instead of a JSON string, e.g.
`"ambiguities": ["giúp tôi" - không rõ ai hoặc gì cần được giúp]` — a
real, consistent base-model habit, not random noise).

**All 14 of HF_QLORA's invalid cases hit the 160-token ceiling, and none
of them are "almost-valid JSON that ran out of room."** 12/14 abandon the
JSON-only instruction entirely and produce free-flowing Vietnamese analysis
prose (several visibly echoing role-tag-like text, e.g. one output begins
`"ystem\n\nChỉ trả về JSON object..."` — a corrupted/truncated `system`
tag followed by text that reads like the system prompt's own instructions,
suggesting the adapter partially learned to *echo* instruction-shaped text
rather than silently follow it). 2/14 are outright degenerate repetition
loops — one repeats `"user\nquay lại cái trước đi\n\n"` (the user's own
input) sixteen times verbatim; another repeats `"user\ntôi muốn giảm
cân\n\n"` seventeen times. These are classic small-model/undertrained-LoRA
degeneration signatures (§12's required check), not a parsing or
stop-token-configuration defect — the stop-token path was independently
verified correct in §2-4 above.

## 8. §7/§16 — The invented-enum finding, reframed

`qwen4b-baseline-experiment-v1.md` reported `inventedEnumCount` 17→5
(OLLAMA_BASE→HF_QLORA) as "the one clearly positive signal." With the
apples-to-apples HF_BASE→HF_QLORA comparison, the headline number is a
smaller 12→5 — but the real question (§16) is whether that remaining
improvement reflects **learned ontology** or is itself an artifact of
`is_invented_enum()` defaulting to `False` whenever JSON fails to parse
(it can only flag an invented enum value it can actually read).

Cross-referencing HF_BASE's 12 invented-enum cases against HF_QLORA's
outcome for the same `caseId`s (full detail in
`training/semantic-qwen3-4b/outputs/d1-per-case-matrix.json`):

| Classification | Count | Cases |
|---|---|---|
| A. ENUM_FIXED_SEMANTICS_PRESERVED (valid schema, correct intent) | **1** | `reference-this-item-1` |
| C. ENUM_FIXED_BUT_JSON_BROKEN (fixed only because output became unparseable) | **8** | `followup-correction-confusable-1`, `reference-previous-state-1`, `reference-previous-state-2`, `entity-sessions-duration-1`, `entity-sessions-duration-2`, `intent-confirm-1`, `intent-confirm-2`, `intent-confirm-3` |
| Still invented in both | 3 | `ambiguity-vague-change-2`, `reference-this-item-2`, `reference-this-item-3` |
| **New** invented-enum case introduced by QLoRA (BASE was false) | 2 | `ambiguity-vague-change-3`, `intent-recommend-pt-confusable-2` |

Net 12→5 = 9 fixed − 2 newly broken. But **8 of the 9 "fixes" are not
fixes at all** — they are cases where the model's output degenerated into
unparseable prose (category C above, all 8 are in the NON_JSON_FORMAT
taxonomy bucket from §7) before it ever got far enough to write a wrong
`primaryIntent` value. Only 1 case (`reference-this-item-1`, which
produces a complete, valid, correctly-intentted JSON object) is genuine
evidence the adapter learned Gymini's enum vocabulary.

**Verdict on §16: the 12→5 invented-enum improvement is mostly a
JSON-validity-rate side effect, not primarily learned ontology.** This
directly revises `qwen4b-baseline-experiment-v1.md §5`'s claim that "the
training signal for 'use these exact enum tokens' clearly transferred" —
see the addendum to that document.

## 9. §9/§13 — Three-way backend comparison

OLLAMA_BASE (GGUF Q4_K_M, historical, `qwen4b-baseline-experiment-v1.md §1`)
vs HF_BASE (bitsandbytes 4-bit, this diagnostic), same 21-row validation
split, same model weights, different serving runtime/quantization:

| Metric | OLLAMA_BASE | HF_BASE | Note |
|---|---|---|---|
| jsonValidityRate | 0.8095 | 0.5714 | Ollama's GGUF path parses more often |
| inventedEnumCount | 17 | 12 | Same confound as §8: more valid JSON → more chances to be flagged invented |
| primaryIntentAccuracy | 0.0 | 0.0 | Agree |
| meanLatencySeconds | 34.664 | 63.911 | Ollama's serving stack is faster per case on this hardware |

Case-level disagreement (computed directly, `/tmp/ollama_vs_hf.py` →
21 cases compared): **jsonValid disagrees on 5/21 cases (24%)** — in every
one of the 5, Ollama produced valid JSON and the HF bnb-4bit path did not
(`ambiguity-vague-change-1`, `entity-sessions-duration-3`,
`intent-recommend-pt-confusable-2`, `multi-correction-and-question-2`,
`reference-previous-state-3`). `invented_enum` disagrees on the same 5
cases (mechanically, since it can only be `true` when JSON parses).
`intentCorrect` never disagrees (both backends are at 0% regardless).

**This confirms `HF_OLLAMA_BACKEND_MISMATCH` is real and quantified**: the
bnb-4bit/`transformers.generate()` path is measurably less reliable at
producing parseable JSON than Ollama's GGUF Q4_K_M serving path, on the
same weights. The causal rule from the task stands: **OLLAMA_BASE→HF_BASE
is a backend/quantization effect; HF_BASE→HF_QLORA is the adapter effect.
They are not interchangeable evidence.**

## 10. §10 — Final causal table (HF_BASE → HF_QLORA, backend held constant)

| Metric | HF_BASE | HF_QLORA | Delta |
|---|---|---|---|
| transportSuccessRate | 1.0 | 1.0 | 0.0 |
| jsonValidityRate | 0.5714 | 0.3333 | **-0.2381** |
| schemaValidityRate | 0.0 | 0.0476 | +0.0476 |
| primaryIntentAccuracy | 0.0 | 0.0476 | +0.0476 |
| entityF1Mean | 0.4286 | 0.3333 | **-0.0953** |
| correctionAccuracy | 0.5 | 0.0 | **-0.5** |
| referenceAccuracy | 0.0 | 0.0 | 0.0 (already at floor) |
| ambiguityAccuracy | 0.5714 | 0.2857 | **-0.2857** |
| requestedActionAccuracy | 0.0 | 0.1667 | +0.1667 |
| unsafeOutputRate | 0.0 | 0.0 | 0.0 |
| inventedEnumCount / Rate | 12 / 0.5714 | 5 / 0.2381 | -7 / -0.3333 (mostly JSON-validity artifact — §8) |
| meanLatencySeconds | 63.911 | 113.07 | **+49.159** |
| ceilingHits160 (count/rate) | 4 / 19% | 15 / 71% | **+11 / +52pp** |

This table **supersedes** `qwen4b-baseline-experiment-v1.md §4`'s
OLLAMA_BASE-vs-HF_QLORA table as the causally meaningful comparison (see
addendum below).

## 11. §11 — Root-cause classification

- **TRAINING_TERMINATION_LABEL_BUG — ruled out.** §2/§6/§7 directly proved
  the supervised completion includes `<|im_end|>` correctly.
- **HF_GENERATION_STOP_CONFIG_BUG — ruled out.** §3 showed the
  `pad_token_id` quirk has no effect on single-sequence greedy decoding,
  and `eos_token_id` correctly includes `<|im_end|>` via
  `generation_config` fallback. Settings are identical for HF_BASE and
  HF_QLORA by construction.
- **HF_OLLAMA_BACKEND_MISMATCH — confirmed, real, but orthogonal.** §9
  quantifies a genuine ~24% case-level JSON-validity disagreement between
  Ollama's GGUF path and the HF bnb-4bit path on the SAME base weights.
  This explains why the original OLLAMA_BASE-vs-HF_QLORA comparison was
  invalid, but does not by itself explain the HF_BASE→HF_QLORA regression.
- **TRUE_QLORA_SEMANTIC_REGRESSION — not supported as the primary
  explanation.** This would require the model to still produce
  well-formed, on-task output but choose worse semantic content. That is
  not what's observed: QLoRA's failures are not "confidently wrong," they
  are **format abandonment and degeneration** (§7).
- **GENERATION_DEGENERATION_AFTER_QLORA — confirmed, primary finding.**
  §7's taxonomy is unambiguous: 12/14 of QLoRA's invalid outputs abandon
  JSON entirely for free-form prose (something HF_BASE essentially never
  does — 0/9 of its invalid cases are pure prose), and 2/14 are verbatim
  repetition loops of the user's own input, a textbook degeneration
  signature. 71% of QLoRA's outputs hit the 160-token ceiling vs 19% for
  HF_BASE under byte-identical settings.
- **TRAINING_DATA_TOO_SMALL — supported as the underlying cause of the
  degeneration, not merely asserted from the row count.** 99 training
  rows / 26 optimizer steps is tied directly to an observed failure mode
  (output-format instability under a 4B-parameter rewrite of the model's
  response policy) rather than cited on its own. A LoRA adapter trained
  on this little supervision destabilizing the base model's instruction-
  following is a known, well-documented small-data QLoRA failure pattern,
  not a labeling or generation-config defect.

**Classification: `MULTIPLE_FACTORS` — specifically
`GENERATION_DEGENERATION_AFTER_QLORA` (primary, directly observed) caused
by `TRAINING_DATA_TOO_SMALL` (underlying driver), with
`HF_OLLAMA_BACKEND_MISMATCH` confirmed as a separate, real, but orthogonal
confound that invalidated the *original* comparison methodology without
itself explaining the adapter's regression.**

## 12. §12/§20 — Dataset expansion decision

- Training termination is correct (§2/§6/§7).
- The evaluator is now trustworthy for this purpose — raw text and token
  counts are captured, the taxonomy is reproducible from code, and the
  BatchEncoding bug that blocked the diagnostic was found and fixed.
- HF_BASE vs HF_QLORA confirms genuine degeneration, not a leftover
  generation-path bug — stop-token config, think-scaffold parity, and
  prompt/completion boundary were all independently verified correct.
- The failure mode (format abandonment, repetition loops, token-ceiling
  hugging) is a classic small-data QLoRA symptom with a well-understood
  fix: more supervision.

**`DATASET_EXPANSION_DECISION: DATASET_EXPANSION_GO`** — but explicitly
**not executed in this task** (forbidden by scope). The next concrete step
for a future task is scaling `generate_dataset_v1.py` toward the
originally-targeted 400-700 rows before re-running training, not
hyperparameter search on the current 99-row set.

## 13. What was NOT done in this diagnostic

No dataset expansion, no new training run, no Optuna, no GGUF export, no
production config change, no merge/reset/rebase of unrelated work. One
tiny, targeted bug fix (`masking_utils._ids()`) and two evaluator
additions (raw-text/token-count capture, incremental progress writes) were
made to the diagnostic tooling itself — necessary to produce this
evidence, never touching the trained adapter or the dataset.
