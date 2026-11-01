# Advisory baseline — phase 1

Read-only diagnostic runner for the existing interpretation component, router,
retriever and local JSONL metadata. Does not change rollout flags, business
records, source authority, prompts or corpus. This is not the A–D experiment yet.

From ai-service:

```sh
pnpm exec tsx src/evaluation/advisory-baseline/run.ts
pnpm exec tsx --test src/__tests__/advisory-baseline.test.ts
```

Default: CODE AUDIT + TEST FIXTURE only, no model/vector-store requests.
Artifacts go to ignored `artifacts/ai-advisory-baseline/baseline.json` at the
resolved data root. `--out=...` selects a different artifact.

Opt into read-only runtime retrieval (3 diagnostic queries) and/or one bounded
model generation using explicitly synthetic personal facts/reference:

```sh
pnpm exec tsx src/evaluation/advisory-baseline/run.ts --live-retrieval --live-generation
```

In Docker, run this same command inside the current AI container so its actual
provider/config is used. The generation probe calls the production helper
directly: it is NOT proof the route is enabled, a user journey, scientific
correctness, citation entailment, or model reasoning quality. The helper can
return null after provider/schema failure. Legacy retrieval can mask provider
errors as empty; the report preserves that ambiguity.

The corpus report inventories extraction/provenance fields without fact-checking
the paper or modifying its contents. Human review may exist outside chunks.
Question variants here are diagnostic/development inputs, not independent test.
Use the existing `src/scripts/evaluateRagGrounding.ts` and governed datasets for
runtime retrieval quality; this runner does not replace their gates.
