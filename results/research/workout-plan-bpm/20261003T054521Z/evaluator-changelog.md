# Evaluator changelog — workout-plan BPM frozen-150 run 20261003T054521Z

Every evaluator freeze is listed here, with the reason it was superseded. No benchmark case was executed under any
superseded version (the only executions so far are the smoke runs, which are not benchmark evidence).

| Version | evaluatorSha256 (first 16) | Status | Reason |
|---|---|---|---|
| v1-pre-smoke | 7f74fa5568ee6b9a | SUPERSEDED | Frozen before the first real smoke. Smoke exposed a CLI defect: `--recreate` was parsed as a value-taking flag, so the container was not recreated. Fixed. |
| v2 | 2056c2a1ab8b39ef | SUPERSEDED | Smoke exposed a query defect: `user_profiles.userId` is camelCase in the live schema (no `@map`), not `user_id`. Fixed in `lib/db-snapshot.mjs`. |
| v3 | (see evaluator-manifest.json) | CURRENT until the benchmark starts | Current code. Re-frozen after the query fix. |

Rule: once Config A starts, the evaluator is immutable. Any change requires a new run ID, not an edit to this run.

Prior evaluator-side defects found by the unit harness (before any stack run) and fixed:
- A single authorization was counted as two persisted writes (program row + action COMPLETED). Now `max()`, one write unit.
  Found by `smoke/harness.test.mjs`; fixed before freeze v1, so it is not part of any frozen version's history.

## Versions after the first stack run (authoritative table; supersedes the table above)

| Version | evaluatorSha256 (first 16) | Status | Reason / evidence |
|---|---|---|---|
| v1-pre-smoke | 7f74fa5568ee6b9a | SUPERSEDED | `--recreate` parsed as value-taking flag (container not recreated). Smoke found it. |
| v2 | 2056c2a1ab8b39ef | SUPERSEDED | `user_profiles.userId` is camelCase (no `@map`); query used `user_id`. Smoke found it. |
| v3 | 5739f5cdaafa1f0f | SUPERSEDED — DEFECTIVE | Used for the smoke runs and for the ABORTED Config A run. Two defects found during Config A: (1) `parseOllamaGin` matched only single-unit durations, so Go-style `2m50s` lines (every call that hit the 170 s LLM timeout) were silently dropped, leaving `qwenChatCalls = 0` for them; (2) the Config A contamination guard checked only typed CI events (`ci_global_llm_route`, `ci_v2_llm_interpretation`) and could not see Qwen generation calls made by the orchestrator's non-CI paths. |
| v4 | 45712c437f1c99b2 | CURRENT | Fixes both v3 defects. Adds regression tests (`smoke/harness.test.mjs`: "2m50s", "/api/embeddings", and a guard test that stops on a Qwen call with no CI event). 18/18 pass. |

Data produced under v3 is archived, not deleted, in `ABORTED-config-A-evaluator-v3/` (including the warmup output) and must not be
cited as benchmark evidence. Its Qwen attribution is wrong because of defect (1); the raw Ollama log is the authoritative count.

Decision record: Config A is NOT LLM-free on this stack. See `STOP-REPORT.md`.
