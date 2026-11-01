# Evidence-based progress advisory — A–D development experiment

This component is isolated from production imports and routes. It does not
change `prompt_builder.ts`, the existing interpretation validator, deployment
flags, the active dirty agent workstream, or any business writes.

From ai-service, prepare frozen requests without external calls:

```sh
pnpm exec tsx src/evaluation/advisory-progress/run.ts
pnpm exec tsx --test src/__tests__/advisory-progress.test.ts src/__tests__/advisory-baseline.test.ts
```

The live runner **requires `LLM_PROVIDER=bedrock`**, so accidentally using a
local Ollama stack fails before any call or output creation. Use the existing
local Bedrock script to configure only this PowerShell process:

```powershell
& ../../../scripts/dev/local-bedrock.ps1 -Env | ForEach-Object {
  $setting = $_ -split '=', 2
  if ($setting.Count -eq 2) {
    [Environment]::SetEnvironmentVariable($setting[0], $setting[1], 'Process')
  }
}
pnpm exec tsx src/evaluation/advisory-progress/run.ts --live
```

Optional `--out-dir=artifacts/ai-advisory-progress/<new-run>` is resolved from
repository root. A non-empty output directory is refused. Defaults use a
timestamp; artifacts are ignored by Git.

## Guarded V2 treatment

The default `--treatment=original` preserves the original prompt and model
verification path. Opt into the namespace/error-aware treatment explicitly:

```sh
pnpm exec tsx src/evaluation/advisory-progress/run.ts --treatment=guarded
pnpm exec tsx src/evaluation/advisory-progress/run.ts --live --treatment=guarded --out-dir=artifacts/ai-advisory-progress/bedrock-guarded-v2
```

Run live with the Bedrock process environment shown above. V2 adds the actual
allowed fact/source IDs to the prompt and validates them against the input
after generation. Absent sources require `hypotheses=[]` while observations
remain valid. Duplicate/colliding input identities are rejected before calls.
These are application-side Zod checks, not provider-enforced constrained decoding.

A/B still have one call. C/D get at most one verification/repair call, including
when initial JSON/schema is invalid but a model response exists. Server error
paths and linkage/numeric issues accompany the untrusted candidate. The model
may revise or report uncertainty; KEEP cannot override a server-detected error.
Every revision must pass schema, reference and numeric checks again. No
mechanical stripping of bad hypotheses or forced successful fallback occurs.
Provider failures without a response do not trigger an extra repair call.

Rejected structured candidates or a bounded 8,000-character unparsed response
are retained for this synthetic-only diagnostic. Provider exception bodies are
not stored. Do not reuse this artifact policy for real private health data.
Expected scenario labels and required-fact scoring rules are never sent in
repair feedback. Input/evidence and rubric are unchanged from corrected v1.1.

All live results remain DEV after these observed-case fixes. Compare against
the preserved v1 run as a paired diagnostic, not an independent or randomized
experiment. The model verifier still cannot establish scientific entailment.

Six DEV scenarios × four variants = 24 answers, up to 36 model calls including
verification, no application retries. Each call requests JSON, temperature
0.2, maximum 2048 output tokens and timeout 20 s; transport retries may follow
the existing provider SDK policy. This is generation-only with frozen evidence;
the runner does not need to call embeddings or modify the vector store.

`manifest.json` freezes source/scenario/request/code hashes, budgets and scope.
`requests.json` holds the prompts using synthetic personal facts. Partial
`results.jsonl` stores initial/final candidates, checks, verifier treatment,
tokens and latency. `summary.json` reports DEV contract results including
errors, not scientific entailment or a production signoff. Exit 0 means the
diagnostic ran, not that every candidate passed or that a variant won.

Source review, limitations and outcome definitions live in
[`data/eval/advisory-progress-dev`](../../../../../../data/eval/advisory-progress-dev/README.md).
No model verification verdict substitutes for independent human/source review.

## First run and rubric correction

The first v1 run required every supplied fact to appear in observations, even
when attendance was irrelevant to a strength-outcome question. This was a
rubric defect, not a model failure. v1.1 requires the outcome-relevant fact.
Original results/manifests remain unchanged. Re-score without model calls:

```sh
pnpm exec tsx src/evaluation/advisory-progress/rescore.ts --run-dir=artifacts/ai-advisory-progress/bedrock-dev-v1
```

This writes `rescored-v1-1.json` once, checks the corpus hash, retains failures
from unresolved verification, and records original/corrected results together.
It refuses to overwrite a prior re-score. The corrected figures do not show
model improvement; no outputs or prompts were changed. New runs record a
rubric version and schema issue paths. The first run discarded invalid JSON
candidate bodies and only retained `ZodError`, so exact field errors for that
run cannot be reconstructed.

## Offline content review after the supplied review

```sh
pnpm exec tsx src/evaluation/advisory-progress/review-frozen-v2.ts
pnpm exec tsx --test src/__tests__/advisory-content-review.test.ts
```

This command has no provider arguments or model calls. It binds authored
assistant annotations to all 24 frozen V2 final candidates and checks the
results hash, frozen requests, source pack, annotation field coverage and
excerpt/claim references. It writes a readable table and full JSON under
`data/eval/advisory-progress-dev/reviews/`. The old answers/scores are untouched.
The original user-supplied review is preserved with a hash; receipt of that
review does not establish independent human/expert review credentials.

`content-review.ts` screens all answer text fields for a narrow family of
read-only plan/load recommendations, including the observed “không cần đổi
lịch”. It distinguishes some insufficient-basis statements, but remains a
heuristic with false-negative/false-positive risk. Its no-match status is
explicitly **not a content pass**. It is not wired into the frozen V2 live
treatment; future content-aware evaluation must opt into a new version rather
than silently redefine the old 6/6 contract result.

Review categories separate facts, general principles, measurement/evidence
limitations, personal causal hypotheses and personal recommendations. This
phase does not change the model AnswerSchema; it records semantic findings
before deciding whether to add a limitations field. No universal entailment
or scientific-correctness score is inferred from the hand-authored annotations.
