# 07 — AI and LLM Safety

Policy under audit:

    User → Conversational Intelligence → Orchestrator → authoritative services → recommendation → deterministic validation
         → confirmation where required → business service → DB

and never `User → LLM → DB`.

Model of interest: `qwen3:4b-instruct-2507-q4_K_M` (Ollama, local). No Qwen3 30B, no fine-tuning, no new AI framework in scope.

## Entry points that reach an LLM

| Entry | Path | LLM use |
|---|---|---|
| Chat ask | `POST /ai/ask` → `rag.service` → `orchestrator.service.ts` | Conversational Intelligence routing (typed fallback when flag on); RAG answer generation (always, when retrieval returns); fallback text when LLM unavailable |
| Agent actions | `/ai/agent/*` | Recommendations and drafts |
| Plan generation | `/ai/generate-client-plan-draft`, `/ai/generate-roadmap-draft` | Draft producers only |
| Cycle analysis | `/ai/analyze-cycle`, `/ai/assess-cycle`, `/ai/analyze-feedback` | Analysis; decisions by `CycleAssessment` rules |
| Image chat | `/ai/agent/image-chat`, `/ai/agent/goal-image` | Vision model (not traced) |
| Explanations | `/ai/explain-exercise-progression` | Explanation text |
| Knowledge | RAG over Qdrant | Retrieval and generation |

## Structured output and validation

- JSON-mode calls: `llm/json_llm_call.util.ts` extracts JSON, validates with Zod, retries (about 2 attempts for narrators), and falls back per
  phase when retries are exhausted.
- Schema validation exists for routing output (`global/llm-route.ts`: `limitLlmRoute`, typed route topic).
- Exercise identity: LLM drafts reference `Exercise.id` and are validated by fitness-service (`validateExerciseIds`) before persistence
  (per the grounding policy). Equipment validation runs at confirmation only for AI-generated plans (known gap, see [08-module-readiness.md](08-module-readiness.md)).

## LLM cannot … (verification)

| Requirement | Evidence | Status |
|---|---|---|
| Issue arbitrary SQL | No `$queryRawUnsafe` or raw SQL with model text in production code (grep) | VERIFIED_OK (code) |
| Select arbitrary internal tools | `ENABLE_TOOL_CALLING` defaults to off; enabled only when exactly `"true"` (`orchestrator.service.ts` line 91) | VERIFIED_OK (code); tool surface when enabled not audited |
| Bypass authorization | Route handlers take identity from the gateway; LLM output is not an identity source | VERIFIED_OK (code, sampled) |
| Mutate the DB directly | No Prisma writes in `llm/` or `conversational-intelligence/` (grep) | VERIFIED_OK (code) |
| Fabricate confirmation | Confirmation requires the confirm endpoint (cards) or a profile-workflow confirmation; a text "confirm" never confirms a workout draft (documented gate FR16; code path sampled) | VERIFIED_OK (code, documented); runtime red-team NOT_VERIFIED |
| Promote inferred values to authoritative facts | Candidate slots live in `slotsJson`, documented as non-authoritative; persistence through services | VERIFIED_OK (schema comment) |
| Leak another user's context | Context builders scoped by `userId`; RAG retrieval filter by user not traced end to end | PARTIAL |

## Prompt construction, logging and injection exposure

- Logs record routing decisions and ids (`ci_global_llm_route`: correlation id, user id, latency, raw route, accepted route). No user text in these
  lines (inspected logger calls). Prompts themselves are not logged in the grep results.
- Prompt injection: a dedicated evaluation harness exists (`ai-service/src/evaluation/agentic/run_agentic_evaluation.ts`, entry
  "Prompt injection … Needs ENABLE_TOOL_CALLING"). Results were not reproduced; the harness is designed for tool-calling mode, which is off by default.
  Therefore the injection surface in production is the routing and drafting prompts, not tool execution. Evaluation under the production
  configuration is NOT VERIFIED.
- Sanitisation of user text before prompt insertion: not traced.

## Feature flag and kill switch (G-17)

- `CONVERSATIONAL_INTELLIGENCE_V2` and `_V2_LLM` both default to `off` (`conversational-intelligence/index.ts` lines 24–27).
- Production compose sets neither, so the CI-V2 path is off in production.
- Even with `_LLM=off`, the orchestrator issued Qwen requests for UNKNOWN, WRITE_ACTION and KNOWLEDGE turns in the local stack
  (`LIVE_LOCAL`: three `/api/chat` calls, each returning HTTP 500 after 170 seconds, while `CONVERSATIONAL_INTELLIGENCE_V2_LLM=off`).
  The LLM kill switch therefore does not stop all model use.

## Fallback, timeout and retry

| Aspect | Observed value | Source |
|---|---|---|
| Server LLM timeout | 170,000 ms (verification compose), 60,000 ms fallback in orchestrator | G-18 |
| Client timeout (benchmark harness) | 240,000 ms | research harness |
| User-visible degraded turn | 171.6 s and 172.7 s; text "Tạm thời AI chưa sẵn sàng…" | `LIVE_LOCAL` research logs |
| Typed fallback on routing | `ci_v2_llm_failed_fallback_to_deterministic` warning path | `interpreter.ts` line 181 |
| Retries | `attempts: 2` in narrators; JSON util retries | `json_llm_call.util.ts` |

The degraded message is acceptable as a last resort. The 170-second wait is not acceptable for public production (G-18).

## Model-quality claims

- No accuracy claim is made for Qwen3 4B in this document. Research results (BPM benchmark) are a separate track.
- A fallback that succeeds is not evidence of model quality (per the audit brief).

## Required before public release

1. Single kill switch for every LLM entry point, tested with zero model requests (G-17, P2-T01).
2. Turn budget, deterministic fallback, breaker, concurrency cap (G-18, P2-T02).
3. Per-user quota for LLM and vision endpoints (G-33, P2-T03).
4. Prompt-injection and cross-user context tests on the release candidate under production flags (P2 gate).
5. Sanitisation of user text in prompts documented and tested.
