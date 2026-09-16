# Agentic Evaluation Workspace

Independent Codex evaluation layer for the Gymini hybrid AI-agent architecture.

This workspace is intentionally separate from the production implementation files currently owned by Claude. It does not write business data, call live LLMs, or require Qdrant/Postgres for the default run.

## Files

- `fixtures.ts` - deterministic synthetic evaluation datasets:
  - 100 PT recommendation scenarios.
  - 50 recommendation-narrator adversarial outputs.
  - RAG retrieval/citation cases.
  - tool-selection and prompt-injection cases.
  - memory classification cases.
  - HITL confirmation utterances.
  - vision safety cases.
- `run_agentic_evaluation.ts` - machine-runnable evaluator.
- `results/agentic-evaluation-results.json` - generated result artifact.

## Run

From `backend/services/ai-service`:

```bash
pnpm exec tsx src/evaluation/agentic/run_agentic_evaluation.ts
```

The runner reports categories separately. It exits non-zero when real findings are present. That is expected while the evaluator is exposing gaps.

## Data Classification

All PT, narrator, RAG, tool, memory, HITL, and vision cases in this workspace are `SYNTHETIC_TEST_CASE` fixtures unless a future runner explicitly marks a result as `REAL_DATABASE_INTEGRATION_TEST` or `LIVE_MODEL_EVALUATION`.

Skipped/blocked results are not counted as failures:

- `SKIPPED` means the dataset is ready but local infrastructure was not invoked.
- `BLOCKED` means a live implementation or integration harness is needed.
- `FAIL` means the current deterministic code or validator did not satisfy an assertion in the offline harness.
