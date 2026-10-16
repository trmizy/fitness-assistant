# Phase 3 — Rollout Remediation R1: routing guard, model budget, latency bound

**Owner**: Claude Code. **Date**: 2026-10-06. Product validation, not a research benchmark (pass/fail behaviour only).
**Verdict**: `R1_AI_BLOCKERS_PARTIAL` (§15). This is not permission for production rollout. Production defaults are unchanged (`GYMINI_UNIFIED_AI_COACH=off`, `CONVERSATIONAL_INTELLIGENCE_V2=off`, `CONVERSATIONAL_INTELLIGENCE_V2_LLM=off`).

## 1. Starting blockers (from Batch 5)

- **N2** — the typed Qwen routing fallback accepted `READ_STATE / PROGRAM_STATUS` for "Buổi chân hơi nặng." with no pending draft.
- **N3** — Batch 5 reported PT and nutrition READ turns as making one Qwen call each.
- **Latency** — a live general-QA turn took 181.9 s; a revision turn took 92 s.

## 2. Root cause of N2 (confirmed in code and live)

`conversational-intelligence/global/llm-route.ts`, `EVIDENCE.PROGRAM_STATUS` matched the bare word `buổi` (training session). "Buổi chân hơi nặng." contains `buổi`, so the topic-evidence check passed. The acceptance check (`limitLlmRoute`) had no context-consistency rule and no read-question-cue rule, so the model's READ route was accepted. The live probe reproduced it: routing returned `READ_STATE` after 60.6 s (cold model) and the route was accepted.

## 3. Root cause of N3 (corrected — it was a measurement error)

Call-path trace, live (`results/product/ai-phase3-batch5/r1-probe.mjs`, per-turn `llm_call` events attributed by the call's own start time):

| Turn | Deterministic stage (`classifyGlobal`) | LLM routing called? | Model calls | Route |
|---|---|---|---|---|
| "PT hiện tại của tôi là ai?" | `READ_STATE` / `PT_STATUS` ("state question about the user's own data") | no | 0 | READ_STATE |
| "Macro hiện tại của tôi bao nhiêu?" | `READ_STATE` / `NUTRITION_TARGET` | no | 0 | READ_STATE |
| "Buổi chân hơi nặng." (no draft) | `UNKNOWN` ("no confident signal") | yes (`llmEligible`: no draft) | 1 routing + 1 generation (timeout) | UNKNOWN after rejection |
| "Buổi chân hơi nặng." (pending draft) | `UNKNOWN` | **no** (`llmEligible` requires `!pendingDraft`); the draft path owns the turn | 0 semantic | — |

The Batch 5 "1 Qwen call" for PT and nutrition came from the earlier probe, which attributed calls by `--since` only (no upper bound, plus a ±500 ms edge). A call that ended just before a turn was counted in that turn. The corrected probe shows zero calls for both. **Batch 5 §11's per-turn counts for PT and nutrition are wrong; see the erratum in `phase3-batch5-rollout-readiness.md`.**

Two further observations from the trace:
- The nutrition READ returned "Mình chưa đọc được…" in two runs while fitness-service was down (§9). With fitness-service up it returns the correct "chưa có mục tiêu đã lưu" answer.
- A "Tạo lịch tập…" request failed during the same outage (fitness-service crash, §9).

## 4. Deterministic route changes

None to the deterministic router. The pure classifier already resolves the PT and nutrition paraphrases to READ_STATE (verified by `phase3-r1-routing-llm.test.ts`, 27 tests). No literal-string rule was added. The evidence that decides the outcome is a language class (question or state cue; topic word), not a sentence.

## 5. LLM acceptance guard (N2 fix)

Precedence, enforced in `routeAcceptance()` (llm-route.ts), applied at two points: inside `llmRouteImpl` and again in `global-turn.ts` (so a substituted model cannot bypass it):

1. Schema validity and a closed enum are necessary, not sufficient.
2. Hard limits (unchanged): no workflow start from a model answer; no READ without topic evidence; pain or injury wording is rejected.
3. **New — read-question cue.** A READ_STATE route requires a question or state cue in the message (`READ_CUE`: `?`, "hiện tại", "đang", "là gì", "bao nhiêu", "chưa", "ai", "nào", "của tôi"…). A bare evaluative statement ("Buổi chân hơi nặng.") is never a read.
4. **New — pending-draft revision wording.** With a pending draft, a READ_STATE route is rejected when the message carries revision wording (`REVISION_CUE`).
5. **Strong deterministic evidence wins.** The semantic router is only reached when the deterministic route is UNKNOWN (`global-turn.ts`), and it is never reached when a pending draft exists. A model answer can fill uncertainty only.
6. **Unknown is acceptable.** A rejected route becomes UNKNOWN, which is the existing clarification behaviour.

Every rejection carries a typed reason in telemetry: `no_route_proposed`, `pain_or_injury_wording`, `would_start_workflow`, `topic_evidence_missing`, `read_question_cue_missing`, `pending_draft_revision_wording`, `no_valid_output_or_timeout`.

Evidence-table fix: `PROGRAM_STATUS` no longer matches bare `buổi`. It matches program wording or "tập mấy buổi".

## 6. Model-call taxonomy and telemetry

`LlmCallPurpose = SEMANTIC_ROUTING | RECOMMENDATION_NARRATION | GENERAL_QA | GENERATION | OTHER` (`services/llm.service.ts`).

`llmService.callLLM` is now a thin telemetry wrapper around `callLLMCore` (behaviour identical). One structured `llm_call` line per model call records: `callPurpose`, `provider`, `model`, `timeoutMs`, `latencyMs`, `outcome` (`ok` | `timeout` | `error`), token counts on success. It never logs the prompt, answer or user text.

Purpose labels:
- routing → `SEMANTIC_ROUTING` (`llm-route.ts`)
- chat generation for knowledge intents → `GENERAL_QA`; other chat generation → `GENERATION` (`orchestrator.service.ts`)
- recommendation narrators → `RECOMMENDATION_NARRATION` (`recommendation_narrator.ts`, `program_recommendation_narrator.ts`)
- everything else → `OTHER` (default)

`ci_global_llm_route` also records `callPurpose`, `timeoutMs`, `accepted`, `acceptedRoute` and `rejectionReason`. This satisfies the "semantic routing vs narration" distinction in the brief: the two are now separate labels, not one count.

## 7. Timeout and retry changes

| Path | Before | After | Retry |
|---|---|---|---|
| Semantic routing (`llm-route.ts`) | borrowed `CYCLE_ANALYSIS_LLM_TIMEOUT_MS` = 80 s | own budget `LLM_ROUTING_TIMEOUT_MS` = **15 s** | none (1 attempt) |
| Chat generation (`orchestrator.service.ts`) | `AI_CHAT_LLM_TIMEOUT_MS` ‖ `LLM_TIMEOUT_MS`; dev and prod compose = **300 s**, verification = **170 s** | `AI_CHAT_LLM_TIMEOUT_MS` = **45 s** in dev, prod and verification compose | none in the generation path |
| Recommendation narrators (`callLlmJson`, 2 attempts) | 80 s × 2 | unchanged (not on the measured path; see §15) | 2 attempts |
| Ollama model residency | no keep-alive; model unloaded after 5 min | `OLLAMA_KEEP_ALIVE=30m` (dev compose, ollama service) | — |

Worst-case user-visible time for an UNKNOWN turn: routing 15 s + generation 45 s = **60 s**, down from ~170–182 s. Routing and generation are sequential by design, so the sum is bounded and no retry multiplies it.

Files changed for timeouts: `llm/json_llm_call.util.ts` (optional per-call `timeoutMs`; callers that pass none keep the old default), `conversational-intelligence/global/llm-route.ts` (`ROUTING_TIMEOUT_MS`), `infra/compose/docker-compose.dev.yml` and `docker-compose.prod.yml` (`AI_CHAT_LLM_TIMEOUT_MS`, `OLLAMA_KEEP_ALIVE` in dev), `test/ai-chat-full-verification/docker-compose.verification.override.yml`.

## 8. Cold vs warm behaviour

- Cold load of `qwen3:4b-instruct-2507-q4_K_M` on this CPU host: ~60–82 s (observed after container recreate and after idle expiry). Before this batch, the model was unloaded after 5 minutes idle, so cold turns recurred.
- Warm: a 26-token smoke prompt completes in ~8–21 s. A full RAG answer prompt does not complete within 45 s on this host (§10, general QA).
- Ollama keep-alive is now 30 minutes in the dev compose. This is a narrow configuration change, justified by the measured cold-load cost. The first request after a container restart is still cold.
- The application retry does not worsen cold load (no retry in the generation path; routing has one attempt).

Not tested in this batch: a true cold start after keep-alive expiry (would require a 30-minute wait).

## 9. Infrastructure defect found during R1 (out of AI scope, not fixed)

**N1 (confirmed again):** fitness-service crashed twice during the batch. Redis socket `ETIMEDOUT` surfaced as an unhandled `error` event (`repositories/redis.ts` registers no `error` listener), and the Node process exited while the container stayed "Up (unhealthy)". Consequence: nutrition reads and workout creation failed with 503 and "chưa đọc được" messages. Recovery was a manual container restart. Fixing this belongs to the fitness-service workstream; it was not changed here.

## 10. Live evidence

Corrected probe, current working tree (`results/product/ai-phase3-batch5/r1-probe.json`, single run per turn, new test user, no p50/p90 claim):

| Turn | HTTP | Total | Route | Model calls (purpose:outcome:latency) | Routing decision | Answer truthful? |
|---|---|---|---|---|---|---|
| PT READ | 200 | 718 ms | READ_STATE (deterministic) | none | — | yes ("chưa có PT") |
| Macro READ | 200 | 389 ms | READ_STATE (deterministic) | none | — | yes ("chưa có mục tiêu đã lưu") |
| Revision, no draft | 200 | 58.0 s | UNKNOWN | SEMANTIC_ROUTING ok 10.5 s; GENERAL_QA timeout 45.1 s | **rejected** `topic_evidence_missing` | yes (fallback: nothing recorded or changed) |
| General QA | 200 | 47.2 s | KNOWLEDGE_QA (deterministic) | GENERAL_QA timeout 45.0 s | — | yes (fallback) — but **no real answer** |

Before (Batch 5 live, same kind of turns): revision accepted `READ_STATE` (wrong, routing 60.6 s cold); general QA 181.9 s with degraded text.

Qwen3 4B smoke (`src/scripts/unified-coach-qwen-smoke.ts`, exact tag, `qwen3:4b-instruct-2507-q4_K_M` installed and verified; `results/…` not stored, output reproduced in this report):

| Scenario | Latency | Model calls | Result |
|---|---|---|---|
| S1 health | 56 ms | 0 | `llmAvailable: true` |
| S2 general QA (no RAG prompt) | 20.8 s this run (8.2 s in Batch 5) | 1 (GENERAL_QA-labelled by the script) | 173-char real answer; 26 prompt / 43 completion tokens |
| S3 ambiguous revision via the typed router | 6.7 s | 1 (SEMANTIC_ROUTING) | model proposed `READ_STATE/PROGRAM_STATUS`; **rejected** `topic_evidence_missing` |

The smoke's S2 and S3 latencies vary between runs on this CPU host; these are single runs.

## 11. Call counts (exact, from the corrected probe)

| Path | Semantic routing calls | Other model calls | Target |
|---|---|---|---|
| PT READ | 0 | 0 | 0 ✔ |
| Nutrition READ | 0 | 0 | 0 ✔ |
| Revision, no draft | 1 (rejected) | 1 generation (timeout) | ≤ 1 semantic ✔ |
| General QA | 0 | 1 generation (timeout) | expected 1 generation (latency not met, §15) |
| Known slot answer, confirmation, cancellation, deterministic draft revision | 0 by construction (the router is reached only on UNKNOWN; the draft gate excludes it) | 0 | 0 ✔ (asserted for the classifier stage; the draft gate is by code inspection) |

## 12. Test results

- `src/__tests__/phase3-r1-routing-llm.test.ts`: **27/27 pass**. Covers: PT and nutrition paraphrase matrices (deterministic READ); pending-draft revision paraphrases rejected as a PROGRAM_STATUS read; the same phrases without context not accepted; genuine program-status questions still accepted; the five model failure modes (A invalid JSON, B unsupported enum, C valid-but-inconsistent route, D timeout, E provider unavailable), each ending in no route; the routing budget passed to the model is 15 s; known deterministic phrases make zero model calls; every rejection carries a typed reason.
- `src/__tests__/unified-ai-fallback-truthful.test.ts` (Batch 5 D2): 2/2 pass.
- `src/__tests__/conversational-intelligence-remediation.test.ts` (Batch 5 D1): 35/35 pass.
- Type check: `tsc --noEmit -p tsconfig.json`: **0 errors** (after the concurrent merge, §14).

Test model: all model calls stubbed at the `llmService` boundary in the R1 file; the live probe and smoke are the only real-model evidence.

## 13. Full regression (before the concurrent merge)

Command: `LLM_PROVIDER=mock`, `DATABASE_URL`/`AI_DATABASE_URL` → isolated `gymcoach_ai_test` (localhost:55433; credentials not printed), `NODE_ENV=test`, `DEBUG_AI_PLAN=true`, `INTERNAL_SERVICE_SECRET` taken from the running verification stack.

| Run | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| Batch 5 final | 910 | 901 | 5 | 4 |
| **R1 final** | **937** | **928** | **5** | **4** |

The same five failures as Batch 5, by name: three `adoptPlan` tests (environment-dependent: they call live fitness-service for exercise mappability; classified in Batch 5 §18) and two Ollama tests (stale model-name expectation `llama3.2:3b`; baseline drift). **No new failures.** The full run completed before the concurrent merge described in §14. It was not re-run afterwards.

Shared-path suites were included in the full run: unified-turn, bounded-turn (Batch 3), revision (Batch 4), unified E2E (Batch 5, J1–J10), CI global / v2 / remediation, confirmation boundary, workflow, PT/program recommendation, nutrition reads, general-QA fallback, X1–X4 event-ordering.

## 14. Concurrent repository event (must be reviewed by the owner)

While R1 was finishing, the git reflog recorded, in the same working tree:
- 15:16:44 local — `reset: moving to HEAD`
- 15:16:49 local — `merge origin/feature/payment-gateways` into `aws-deploy`; HEAD moved `81d9f432` → `4fb1ae57`
- several files touched at the same second, including R1 files (`llm/json_llm_call.util.ts`, `llm/recommendation_narrator.ts`, `llm/program_recommendation_narrator.ts`, `llm/orchestrator.service.ts`, `services/llm.service.ts`)

This was not performed by this session. I did not revert, stash or re-edit any file in response. After the event, the R1 changes were still present (grep-verified), the R1 tests passed 29/29 (including the truthful-fallback file), and `tsc` reported 0 errors. The merge also brought in changes from another workstream (gateway, `llm/workout_schedule_context.ts`, `llm/intent_router.ts`), which this report did not review. **Owner action required:** confirm the merge is intended and that the R1 changes are part of the branch you intend to keep.

## 15. Remaining blockers and verdict

Closed by R1:
- **N2** — wrong READ route accepted on a revision turn: closed (guard + evidence fix; live rejection; 27 tests).
- **N3** — PT/nutrition READ model calls: closed as a measurement error; the deterministic path makes zero calls (live and classifier).
- Unbounded user-visible model wait on the routing path: closed (15 s, typed timeout, no retry).

Partially closed:
- **General QA latency** — the turn is now bounded at ~47 s (was 181.9 s), and failures are truthful. But on this CPU host a general answer with the full RAG prompt does not complete within 45 s, so general QA currently returns the fallback. Reducing the budget further would worsen this trade-off; the fix is hardware or a smaller prompt, and both are outside R1.

Open:
- ~~**Recommendation narration** can still wait up to 2 × 80 s...~~ **Closed in R1.1** — see `docs/ai-product/phase3-rollout-r1-1-narration.md`. Narration now has its own one-attempt, 20 s budget with a deterministic fallback; it was never business authority (it only chooses which claims to show, never the candidate ids/order/scores).
- **N1** — fitness-service unhandled Redis error (out of AI scope).
- Cold-load after keep-alive expiry not measured.
- Draft-path gate (`!pendingDraft`) verified by code inspection only; no live probe with an active draft yet.
- Concurrent merge (§14): resolved factually in R1.1 — HEAD advanced through several further merges after §14 was written; R1's own uncommitted code was swept into a later commit (`2bbee3d1`) by that process and verified intact at the new HEAD. See the R1.1 report for the full chain.
- Batch 5 unresolved items: draft-time equipment gate fails open (N4), `.env` test database default (N5, mitigated by explicit env in every run), `adoptPlan` live-dependency (N6), Ollama stale expectation (N7) — all still open as of R1.1, unchanged.

Verdict: **`R1_AI_BLOCKERS_PARTIAL`**. N2 and the measured N3 are closed. Latency is bounded and truthful but not yet acceptable for general QA. Narration timing was open at the end of R1 and was closed in the R1.1 follow-up (see that report for its own verdict). This is not a rollout decision; production defaults stay off.
