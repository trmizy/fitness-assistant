# Gymini AI Agent System — Implementation Report

**Date**: 2026-09-14 · **Scope**: implementation phase following `docs/ai-agent-system-feasibility-audit.md`. Companion: `docs/ai-agent-evaluation-report.md` (real measured results), `docs/pt-recommendation-methodology.md`, `docs/synthetic-agentic-dataset-methodology.md`, `docs/adr-client-journey-attribution.md`, `docs/ai-agent-research-evidence.md`.

---

## PHASE 4 UPDATE (2026-09-14) — architectural redesign in response to Codex Regression #3

Codex's independent Regression #3 (`docs/codex-ai-agent-regression-3-report.md`) returned NO-GO: ADV-001 reopened (48/50 fourth-generation narrator paraphrases accepted by the Phase-3 regex validator) and ADV-003 reopened (a stable-preference-shaped prompt injection persisted a real `UserMemory` row). Full detail: `docs/ai-agent-hardening-fix-report.md`'s "PHASE 4 ADDENDUM", `docs/recommendation-claim-catalog-design.md`, `docs/user-memory-provenance-design.md`.

- **Recommendation Narrator rebuilt around Structured Claim Grounding**: the LLM no longer writes any factual sentence — it selects claim IDs from a deterministic, per-call catalog built only from real fields (`PTCandidate`/`CompatibilityScore`/`HistoricalSummary`/`AgentEvidence`); a deterministic renderer is the only code that produces user-facing text. Categories with no real grounding field (price, location, schedule guarantees, medical/PED, action-completion, implied credentials...) simply have no claim type — a new paraphrase has nothing to select, closing the class structurally rather than by pattern coverage. `fitness-agent.service.ts` and the `RecommendationNarration` external shape are **unchanged** — this was a pure internals rewrite.
- **`remember_user_fact` removed from the model-offered tool list** — the LLM can no longer trigger a memory write via tool-calling under any circumstance. Legitimate memory-writing moved to a new deterministic pipeline that scans the user's own raw chat message directly (never an LLM paraphrase), with an instruction-override-framing guard that specifically defeats "ignore previous instructions... remember that..." even when the wrapped preference text is itself legitimate-shaped.
- **A real methodology mistake from Phase 3 was found and corrected**: the Phase-3 report claimed `data/eval/retrieval/ground-truth-retrieval.csv` did not exist — Codex's own independent check found it does (1035 rows, at the repo root). Root cause: Phase 3's file search was scoped only to `backend/services/ai-service`. Corrected this pass, and the exercise-retrieval metric was actually reproduced for real: Hit@5=0.98, Recall@5=0.98, MRR=0.8187 on 100 cases (matching Regression #1's original figures).
- `validateNarration()` (the Phase-2/3 regex validator) is kept fully unchanged and exported for Codex's direct-call backward compatibility, but is deliberately **not** wired into the new pipeline — see the design doc for why (it would have rejected the new, legitimate, fully-grounded certification feature).
- Training Program Recommendation remains explicitly NOT started — still gated behind independent Codex sign-off.

---

## PHASE 3 UPDATE (2026-09-14) — final hardening pass

A second pass, in direct response to Codex's independent Regression #2, closed the items this report's §26/§27 had left open or that Codex's own evaluation found broken. Full detail: `docs/ai-agent-hardening-fix-report.md`'s "PHASE 3 ADDENDUM".

- **Recommendation Narrator validator redesigned** from a growing blacklist (Phase 2) to semantic-claim-category checks with sentence-level negation-awareness and a root-cause fix for a real diacritic-collision bug ("tính từ" vs. "tỉnh" both normalizing to "tinh"). Codex's own unmodified evaluator: 255/255 pass (was 6/30 on the new adversarial set before this redesign).
- **`ClientJourney` idempotency** closed at the DB level: `@@unique([contractId])` migration (duplicate-free verified first) + `upsert()`, proven under real 10-way concurrent writes.
- **Contract/apply-plan stale-state** (PT stops accepting clients / package archived between draft and confirm) closed with real DB-backed 409 tests.
- **Live tool-calling prompt-injection harness** built and run against a real local model for 3 attack shapes; the deterministic memory-policy boundary held in every case even when the model complied with the injected instruction.
- **A real regression was found and fixed** in `memory_policy.ts` (from Phase 2, surfaced only once this pass ran the *full* pre-existing ai-service test suite, not just new/touched files): `classifyMemoryFact`'s allow/deny vocabulary was Vietnamese-only, silently defaulting a legitimate English stable-preference fact to DENY. Fixed by adding English vocabulary to both pattern lists.
- **One prior finding corrected, not fixed**: the "`.env` LLM_BASE_URL port misconfiguration" named in the Phase-2 evaluation report was wrong — `127.0.0.1:11435` is a deliberate SSH tunnel to a remote model host, inactive during both evaluation sessions, not a typo. The file was correctly left untouched in both passes.
- **Training Program Recommendation remains explicitly NOT started** — gated behind independent Codex Regression #3 sign-off, per this pass's own instruction.

---

## What existed before this pass

Per the feasibility audit: a production-grade deterministic orchestrator, tool layer, RAG pipeline, and — discovered mid-audit — an **already-implemented** deterministic Enterprise-Data/Recommendation split in `user-service/agentic-fitness.service.ts` + `scorePT`. The concrete gaps identified were: no LLM narration/explanation layer, `ClientJourney` schema-ready but zero real data, zero PT/journey seed data, a cold-start scoring bug (found *during* this implementation, not in the original audit — see below), two competing RAG ingestion pipelines, and missing HITL risk visibility in the frontend.

## What was missing → what was implemented

| Gap | Implemented |
|---|---|
| No typed `EnterpriseContext` | `backend/shared/src/fitness-agent-context.ts` — `EnterpriseContext`, `RankedPTRecommendation`, `RecommendationNarration`, `RecommendationResult` types + a `buildEnterpriseContext` helper |
| No LLM narration/explanation for recommendations | `backend/services/ai-service/src/llm/recommendation_narrator.ts` — `narrateRecommendations()` + deterministic `validateNarration()`, wired into `fitness-agent.service.ts`'s PT recommendation branch |
| `ClientJourney` unpopulated | `backend/services/user-service/src/services/client-journey-derivation.service.ts` — real derivation from completed `Contract` + `InBodyEntry`, wired into `contract.service.ts::checkAndCompleteContract` (the only place a contract naturally completes) |
| No PT/journey seed data | `backend/services/user-service/src/scripts/seed-agentic-demo.ts` — 60 synthetic PTs, 331 `ClientJourney` rows, run for real against the dev DB, idempotent (verified by direct row-count re-check) |
| Cold-start scoring bug (found during this pass) | `backend/shared/src/fitness-agent-scoring.ts::scorePT` — `evidence` dimension now excluded from both numerator and denominator when a PT's cohort is below `minimumCohort`, instead of defaulting to 0 |
| Two competing RAG pipelines | `knowledge/pipeline/chunk.ts` + `index_to_qdrant.ts` formally deprecated in place (header comments + new README), `knowledge-pipeline/` confirmed as the one production path — done by a delegated agent, verified with a real scoped test run (22/22 pass) |
| Risk not visible in confirmation UI | `FitnessAgentBlocks.tsx` — risk badge (LOW/MEDIUM/HIGH, Vietnamese labels, theme-token colors) — done by a delegated agent, verified with a real build (`npm run build`, exit 0) |
| `SUBSTITUTE_RESULT`/`CYCLE_EVALUATION_RESULT` had no frontend rendering | Added to `fitnessAgent.ts` type union + `FitnessAgentBlocks.tsx` render branches — done by a delegated agent; also fixed a real pre-existing bug found in the process (a generic `block.candidates` renderer was misrendering `SUBSTITUTE_RESULT`'s differently-shaped `candidates` field as broken PT cards) |

## What was intentionally reused (not rebuilt)

- `scorePT`, `journeySimilarity`, `summarizeJourneys` — kept as the sole ranking/similarity authority; the narrator explains, never re-ranks.
- The entire propose→draft→confirm→execute contract-automation flow (`createPTContractDraft`/`confirmPTContract`) — already correct, untouched.
- `applyTrainingPlan`'s transactional/idempotent apply-plan flow — already correct, untouched.
- The regex-based domain-action intent router (`fitness-agent-intent.ts`) — kept as the sole router for CRUD/financial actions; the LLM was never given tool-calling authority over these.
- `callLlmJson` (`llm/json_llm_call.util.ts`) — reused as the narrator's LLM-call+retry+fallback mechanism rather than writing a new one.
- The `sha256(seed:parts)` deterministic-UUID pattern from `agentic-fitness.service.ts::createDraft` — reused for both the seed script's row ids and nowhere else new.

## EnterpriseContext

Defined in `backend/shared/src/fitness-agent-context.ts`. Deliberately a **typing/naming exercise**, not a new data-fetching mechanism — every field is a rename of an already-real runtime value already assembled inline in `fitness-agent.service.ts`. Not yet threaded through every call site (a larger refactor than this pass's scope justified); the type exists and is ready for that follow-up.

## Image → GoalContext → Recommendation

**Confirmed still not fully closed.** `fitness-goal-vision.service.ts` extracts a `GoalVisualAttributesSchema`-shaped object (muscularity/leanness/focusMuscles/confidence/usable) with correct safety boundaries (no body-fat %, no medical inference), and `confirmGoal` persists it to `UserProfile.goalIntent`/`goal` via `POST /profile/agent/goal`. **Not verified in this pass** (and not wired, since doing so responsibly requires a scoring-methodology decision, see `pt-recommendation-methodology.md` §Phase 3 deferral) whether `findPTCandidates`/`scorePT` read anything beyond the base `profile.goal` enum from that persisted intent. This is honestly reported as **DEFERRED**, not claimed complete — see Migration Plan Phase 3.

## ClientJourney

Real derivation service (`client-journey-derivation.service.ts`), attribution via date-range overlap (no schema migration — see `docs/adr-client-journey-attribution.md`), wired into the single real completion path. Verified live: real contract-completion tests still pass (13/13, now genuinely DB-free again after fixing an isolation bug this implementation introduced and then caught — see Evaluation Report), and the pure `deriveGoalAchievement` logic has 7/7 passing unit tests.

## Synthetic Dataset

60 PTs / 331 journeys / 331 reviews, seeded for real against the dev DB (`gymcoach_user`, confirmed via `docker ps` before running), re-run once to verify idempotency (identical counts both times, confirmed by direct `prisma.count()` queries, not just the script's self-reported totals). Full methodology, including a real bug found and fixed mid-implementation (experience-level dilution — see `synthetic-agentic-dataset-methodology.md`), documented separately.

## PT Recommendation

Unchanged ranking formula except the cold-start fix (§ above). Full methodology in `pt-recommendation-methodology.md`.

## Training Program Recommendation

**Deliberately not extended.** `findTrainingPrograms` still returns an unranked, filtered list. Inventing scoring weights without a dedicated fitness-science-grounded design pass would violate this task's own "don't overclaim/don't guess" instruction — documented as a next step (Migration Plan Phase 8), not built.

## RAG

Two-pipeline consolidation handled by a delegated agent (real, verified): `knowledge/pipeline/` deprecated in place, `knowledge-pipeline/` confirmed as the sole production path, Crossref/OpenAlex porting evaluated and explicitly deferred (documented gap, not half-built) rather than forced.

## What the LLM does / is forbidden from doing

**Does**: explains an already-computed `scorePT` ranking using real evidence/cohort data, in Vietnamese, per-candidate.
**Forbidden** (enforced by `validateNarration`, not just prompted): inventing a percentage that isn't the real `compatibility.total`; claiming historical evidence when the cohort is empty; citing scientific evidence not in the real supplied evidence list; guarantee/causal-promise language. Any violation → that candidate's narration is dropped, template fallback used, recommendation itself unaffected.

## Confirmation / Contract / Plan automation

Unchanged — already correct per the feasibility audit. Re-verified in this pass, not re-built: `checkAndCompleteContract`'s money-settlement behavior is still exactly as before (13/13 tests pass), with the ClientJourney derivation call added as a strictly best-effort, injectable, non-blocking side step.

## Failures / fallbacks

Every new LLM call point (`narrateRecommendations`) degrades to the pre-existing deterministic behavior on any failure — timeout, disabled flag, schema-invalid output, or per-candidate validation rejection. Verified structurally (the function never throws, wrapped again defensively at the call site) and by the adversarial validator test suite (7/7 pass, each simulating one fabrication class).

---

See `docs/ai-agent-evaluation-report.md` for the full list of what was actually measured (test counts, pass/fail, real DB row counts) versus what remains unmeasured.
