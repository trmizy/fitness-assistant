# Gymini Semantic Fine-Tune — Dataset v1

`gymini-semantic-v1`, successor to the preserved starter/smoke set
`gymini-semantic-smoke-v0` (37 rows, unmodified — see
`training/semantic-qwen3-4b/datasets/raw/v0/smoke_v0.jsonl`, kept for
evaluator/training/pipeline smoke tests, not used for the real baseline).

## Honest scope vs. the target

The task's target range is 400-700 rows. **v1 is 143 rows** (52 template
families), proportionally scaled down (~30%) across every category from
the task's own §5 targets rather than padding any one category with
low-quality filler to reach a bigger number — the task's own instruction
("Do not degrade quality simply to hit exact counts") was treated as the
binding constraint over the count target. Each row is hand-written,
schema-valid against the REAL TypeScript Zod schema (§4 below), and most
categories include at least one genuine contrastive/confusable pair (§3).
Expanding toward the 400-700 target with more template families using the
same generator (`generate_dataset_v1.py`) is the natural next step and is
recorded as follow-up work (docs/ai-training/qwen4b-baseline-experiment-v1.md
§ remaining work), not hidden.

## 1. Design: what production actually supplies

Before writing a single example, `interpreter.ts`'s real `buildPrompt()`
was re-read (not assumed from memory): the ONLY context it ever injects
beyond the fixed instruction text is `ctx.expectedSlot` (one line, only
when a workflow is actively waiting on a specific slot). It does NOT
inject `persisted` profile data or a `proposal` object into this prompt,
even though the `InterpretContext` TypeScript interface declares those
fields — they exist for other, deterministic code paths, not for this LLM
call. Every dataset row's `messages` therefore contains: the fixed system
instruction, optionally one `expectedSlot` line (for `FOLLOWUP_SLOT` rows
only), and the user text — nothing invented beyond what the real call site
actually sends.

## 2. Category distribution (v1, 143 rows / 52 families)

| Category | Count | Task §5 target | Scaled-down target (~30%) |
|---|---|---|---|
| INTENT | 38 | 80 | 24 |
| ENTITY | 20 | 70 | 21 |
| CORRECTION | 13 | 60 | 18 |
| REFERENCE | 18 | 60 | 18 |
| FOLLOWUP_SLOT | 13 | 50 | 15 |
| REVISION | 9 | 60 | 18 |
| AMBIGUITY_UNKNOWN | 12 | 50 | 15 |
| MULTI_INTENT | 6 | 40 | 12 |
| FITNESS_SHORTHAND | 8 | 40 | 12 |
| SAFETY_NON_AUTHORITY | 6 | 30 | 9 |

INTENT and REFERENCE over-indexed relative to their scaled target (INTENT
especially, because every `WORKFLOW_INTENT` value plus several
confirm/dismiss/QA/cancel intents needed independent coverage); REVISION
and MULTI_INTENT under-indexed — both named as follow-up priorities.

## 3. Contrastive/confusable examples (task §7 — "more valuable than
hundreds of trivial paraphrases")

Real pairs included, each as two separate template families with
genuinely different gold targets for superficially similar language:

- `intent-read-current-pt` ("PT hiện tại của tôi là ai?" → `ANSWER_QUESTION`)
  vs. `intent-recommend-pt-confusable` ("PT nào hợp với tôi?" →
  `ASK_RECOMMENDATION`).
- `entity-target-weight` (role stated: "đang 82kg, muốn xuống 72kg") vs.
  `entity-weight-unlabeled-confusable` ("70kg được không?" — role
  unstated → `WEIGHT_UNLABELED` + forced ambiguity, never guessed).
- `followup-correction-confusable`: a slot-filling reply that is actually a
  correction of an earlier-stated fact, not an answer to the currently
  expected slot — tests that `expectedSlot` context doesn't blindly force
  every reply into that slot's entity type.
- `ambiguity-hypothetical-vs-change` ("1900 kcal thì sao?" → a question,
  `clarificationRequired` because it's ambiguous whether this is
  hypothetical) vs. `revision-vs-hypothetical-confusable` ("đổi xuống 1900
  kcal" → a real `REVISE_WORKFLOW`, same number, different speech act).

**Explicitly NOT reproduced:** the task's own literal example ("Buổi chân
hơi nặng." with vs. without a pending draft). Because production's real
prompt (§1) never includes a pending-draft signal, both variants would be
the exact same input text — giving identical text two different gold
targets is contradictory supervision, not a useful contrastive lesson (see
the comment left in `generate_dataset_v1.py` at that exact point). The
intended lesson (don't force a confident label on genuinely under-
determined text) is instead covered honestly by `ambiguity-vague-change`.

## 4. Gold-target validation (task §13)

Every target was validated against the REAL TypeScript schema, not a
Python re-implementation:

```
cd backend/services/ai-service
npx tsx src/scripts/validate-semantic-dataset-targets.ts \
  ../../../training/semantic-qwen3-4b/datasets/raw/v1/generated_v1.jsonl
→ 143/143 targets pass SemanticInterpretationSchema.safeParse()
```

Enums themselves are exported from `schema.ts` directly (never hand-copied)
via `backend/services/ai-service/src/scripts/export-semantic-schema-enums.ts`
→ `training/semantic-qwen3-4b/datasets/semantic_schema_enums.json`, loaded
by every Python script (`semantic_schema_enums.py`) that needs an enum
list. Re-run the export script after any `schema.ts` enum change.

## 5. Split strategy (task §10-12)

By `templateFamily` (never splitting one family's paraphrase variants
across sets), target ~70/15/15: realized **99 train / 21 validation / 23
heldout** (143 total, seed 42) — see
`training/semantic-qwen3-4b/datasets/processed/v1/manifest.json` for exact
SHA-256 hashes. `validate_dataset.py --require-full-coverage` confirms zero
leakage and full 10-category coverage across the three files combined.
**Heldout remains sealed** for this experiment — only TRAIN+VALIDATION were
used for the baseline/QLoRA comparison in
`qwen4b-baseline-experiment-v1.md`.

## 6. Token length analysis (task §21)

Tokenized the REAL rendered chat-template sequence (system+user+assistant,
via `unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit`'s tokenizer) across
all 143 v1 rows:

| | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|
| input only (prompt) | 183 | 190 | 192 | 194 | 206 |
| full sequence (prompt+completion) | 276 | 331 | 339 | 362 | 363 |

Truncation count at candidate `max_seq_length`: **256 → 126/143 rows (88%)
truncated**; 384 → 0; 512 → 0. The Phase D smoke run's `max_seq_length=256`
(copied from the unrelated 1.5B config) would have silently truncated the
assistant completion off the majority of real v1 rows — **chosen
`max_seq_length=384`** instead, based on this real distribution, not the
smoke default (task's own explicit instruction).

## 7. Assistant-only loss masking proof (task §18-20)

See `docs/ai-training/qwen4b-baseline-experiment-v1.md` §masking for the
full investigation (Unsloth's compiled `SFTTrainer` does not support a
`"messages"` column's native completion-only-loss path under this
installed version; fixed by pre-tokenizing input_ids/labels directly).
`masking_diagnostic.py`'s real output against one v1 train row:

```
prompt token count: 182, full token count: 274
think-scaffold (4 tokens) is stripped (Ollama's real serving template has no <think> handling)
labels: 182 masked (-100) + 92 real token ids = 274 total
PASS - prompt tokens fully masked, completion tokens fully real, no leakage either direction
```
