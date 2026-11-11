# Experimental setup — frozen-150 workout-plan BPM benchmark (run 20261003T054521Z)

Written before warmup. Values below are read from the Gate 1 artifacts in `source-state/`, not typed from memory.

## 1. Question
What measurable effect does enabling the constrained Qwen3 4B semantic fallback have on the frozen workout-plan BPM benchmark, relative to the deterministic baseline?

## 2. Two configurations, one variable
| | Config A (deterministic baseline) | Config B (hybrid) |
|---|---|---|
| `CONVERSATIONAL_INTELLIGENCE_V2` | `on` | `on` |
| `CONVERSATIONAL_INTELLIGENCE_V2_LLM` | `off` | `on` |
| Model | none invoked | `qwen3:4b-instruct-2507-q4_K_M` (Ollama 0.30.5, Q4_K_M, 4.0B) |
| Mechanism | `docker compose ... up -d --no-deps --force-recreate ai-service` with `CI_V2_LLM_FOR_VERIFICATION=off` | same, `=on` |

The only intended difference is the LLM flag. Production source is checked to be identical across A and B (see §4).

## 3. Frozen inputs
- Dataset: `test/research/workout-plan-bpm/dataset/frozen-150.v1.jsonl`, SHA-256 `eedb1adb16bd3a1284371118b5a03c05a883294a815aa0fb3d79cd76ef8cc849`. 150 cases, 244 turns, 15 categories × 10 cases. Not edited after freeze.
- Annotation: single annotator (the implementation author). Provenance in `annotation-guideline.md` and `annotation-provenance.md`.
- Fixtures: `annotation-guideline.md` §9, seeded through `PUT /profile/me` (`lib/fixtures.mjs`).
- Git HEAD `81d9f432fa856c4e4f06d6b412071f4dbd6c15be`, branch `aws-deploy`. Working tree dirty: 171 entries at Gate 1 (pre-existing, other agents' and earlier work; see `source-state/git-status.txt`).
- Production source aggregate (1076 files under the production roots, excluding tests and build output): `bd9269003a03883e6b68a46c0cd14fbdf37c3a3d566e4723c7543e2b20de23ef`. Rechecked before every config (`config-X/preflight.json`).
- Qwen: tag `qwen3:4b-instruct-2507-q4_K_M`, Ollama manifest SHA-256 `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0`, rechecked before every config.
- Evaluator: `evaluator-manifest.json` / `evaluator.sha256`. Change history in `evaluator-changelog.md`.

## 4. Configuration contract (Gate 5)
- Only the LLM flag changes between A and B. Preflight recomputes the production aggregate and fails the run if it differs from Gate 1.
- No prompt, route, threshold, timeout, label or dataset change between configs. Changing any of these requires a new run ID.
- Timeouts (frozen before A, asserted equal before B, `config-X/config-contract.json`):
  - HTTP per turn: 240 000 ms (client side, harness).
  - LLM: `LLM_TIMEOUT_MS = 170 000` (server side, unchanged compose value).
  - Retries: 0. A timed-out or failed turn is recorded and stays in every denominator. No retry-until-success.
- Model substitution: none. Preflight fails if the installed tag or manifest digest differs.
- Environment: CPU-only Ollama inference on one Windows host (`environment/`). Docker only; no host Node process touches the application database.

## 5. Isolation (Gate 4)
- Each case runs as a fresh user (`bpm.<run>.<config>.<case>.a<attempt>@gymini-test.local`). The baseline snapshot must have zero rows in every observed table. A non-zero baseline or any cross-user row aborts the case as an isolation violation.
- Session: one session per case, created by the first turn.
- Proof run: `smoke/smoke-cases.json` (W001 then W002). Both baselines were 0 and the two user IDs differ. The unit harness (`smoke/harness.test.mjs`) also asserts the violation path.
- Caveat: the frontend React Query cache is not exercised. The harness is HTTP-only, so the account-switch cache rule is out of scope for this benchmark and is listed in threats to validity.

## 6. Checkpointing (Gate 3)
- Unit of atomicity: one case (`config_id + case_id`). A case is appended to `checkpoint.jsonl` only after every turn and its post-snapshot are complete. The per-case record is written first and its SHA-256 is recorded in the checkpoint row.
- `attempts.jsonl` records `STARTED` before each case. On resume, a `STARTED` without a terminal row is written as `DISCARDED_INTERRUPTED` and the case is re-run as the next attempt on a new user. Discarded attempts are never counted.
- Heartbeat: `heartbeat.json` (stage, current case and turn, cases completed, timeouts, errors, last completion timestamp, PID).
- Process: runner PID in `logs/`. Stdout and stderr in `logs/`.

## 7. Observation (what counts as evidence)
- Route: `ci_global_trace` and `ci_confirmation_boundary` matched by `correlationId` to the `/ai/ask` response `data.traceId`. No route is inferred from answer text. A turn without a matching trace is `UNOBSERVED` and counts as incorrect.
- Semantic fallback: `ci_global_llm_route` (typed route output) and `ci_v2_llm_interpretation` (interpreter). The second has no correlation ID, so it is attributed by the turn's time window. Valid because turns run one at a time against one stack.
- Qwen calls: Ollama access log (`/api/chat`, `/api/generate`) by time window, reported separately from embeddings (`/api/embed`).
- Writes: normalized before/after snapshots of `fitness_agent_actions`, `agent_workflow_sessions` (ai test DB), `workout_programs` (fitness test DB) and `user_profiles` (user test DB). Only `*_test` databases in the test Postgres container are reachable (`assertTestOnly`).

## 8. Known confounds (declared before the run)
1. **RAG generation uses Qwen even in Config A.** `KNOWLEDGE_QA` answers are generated by the RAG chat path, which calls the same model. The contamination guard targets semantic-fallback events only (`ci_global_llm_route`, `ci_v2_llm_interpretation`). RAG generation calls are counted and reported separately, and are not treated as fallback invocations.
2. **Profile default.** The production schema defaults `sessionDurationMinutes` to 60, so `F_MG_NO_DAYS` carries 60 on file while §9 does not name it. Recorded in `post-freeze-annotation-issues.md`. Not repaired.
3. **Equipment is not a gate at draft time.** Equipment validation runs at confirmation (`validateAiPlanExerciseEquipment`). Equipment constraints are measured as observed behaviour, not scored automatically in this version.
4. **Qwen3 30B is not evaluated.** Only the 4B tag is installed and approved.

## 9. Warmup (excluded from metrics)
Three synthetic prompts (`WARMUP_TURNS` in the runner) run under the same flag as the config, against a warmup user. None of them is in the dataset (preflight asserts this). Output: `warmup/config-X.json`, marked `excludedFromMetrics: true`. In Config A the contamination guard applies to warmup too.

## 10. Smoke evidence already obtained (TEST FIXTURE + REAL HTTP/API + DB)
Config A, two real cases (`smoke/smoke-cases.json`, `smoke/preflight-A.json`):
- Route of the start turn was observed through the trace (`START_WORKFLOW`), for both cases.
- The production stack asked for `daysPerWeek` in both cases. Under Config A the slot was not extracted from the full utterance (`slots_json` stayed `{}`). The utterance was verified intact in storage, so this is observed behaviour, not an encoding artifact. It is the kind of result the benchmark is designed to measure, and it is not treated as a harness defect.
- Confirm turns with no pending action are recorded as `NO_PENDING_ACTION` control errors, not skipped.
