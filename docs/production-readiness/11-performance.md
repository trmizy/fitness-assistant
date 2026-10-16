# 11 — Performance

No performance number in this document is invented. Each figure is labelled with its source.

## Measured evidence available

| Measurement | Value | Source | Evidence label |
|---|---|---|---|
| Qwen3 4B generation on the research host (CPU-only Ollama, Q4_K_M) | 13–90 s per call observed in research runs; cold load about 88 s | Research run logs and Ollama access log | LIVE_LOCAL (single host, not production hardware) |
| Qwen calls timing out | 170 s (500 responses) | Ollama access log, 2026-10-03 | LIVE_LOCAL |
| Degraded AI turn end-to-end | 171.6 s and 172.7 s | Research harness HTTP timings | LIVE_LOCAL |
| Gateway limiter headers on dev stack | `RateLimit-Limit: 2000`, window 60 s | curl headers | LIVE_LOCAL |
| Mobile startup (warm, cold) | Warm start 223 ms median reported; cold start target 2.5 s | `PERFORMANCE_BASELINE.md` | Historical document; not re-measured |

The mobile baseline document lists several metrics as "not measured". Treat it as a plan, not evidence.

## Likely bottlenecks (from code)

1. **Qwen inference.** Sequential per turn; CPU-bound on the research host; 170-second server timeout. Highest impact on AI latency and capacity (G-18).
2. **Auth round-trip per request** through the gateway and again in downstream clients (G-16).
3. **Sequential LLM calls** in some paths: routing call, then RAG answer generation, then narration. Count per turn not measured.
4. **Exercise catalog reads** cached in Redis for 300 seconds; cache misses hit PostgreSQL with `findMany` on filters (not measured).
5. **Plan drafting** (`generatePlanDraft`, roadmap drafts) involves multi-step LLM and database work. Not measured.
6. **Cycle analysis** (`analyze-cycle`) and feedback analysis: LLM with 80-second per-phase timeout (`CYCLE_ANALYSIS_LLM_TIMEOUT_MS`).

## N+1 and query patterns

- Not systematically measured. Spot checks found `findMany` with `include` in several repositories (typical Prisma pattern).
- P4-T02 requires query logs under a realistic load before any optimisation.

## Missing indexes

- Not verified against query plans. Indexes on `userId` plus status or date exist on the main tables (see [05](05-database-integrity.md)).

## Blocking requests

- LLM calls run inside request handlers (synchronous HTTP). No background job for drafts is evident in the chat turn path.
- Image upload endpoints allow 6 MB bodies inline.

## Capacity planning inputs still missing

- Expected concurrent users, turns per minute, LLM concurrency target.
- Target hardware for production inference (GPU or CPU class) and the cost model.
- Load test scenarios (P4-T01).

## Statement

No throughput, latency percentile or capacity claim for production is supported by the current evidence. Public launch requires P4 results
measured on the production topology.
