# Gymini AI Agent System — Feasibility Audit

**Date:** 2026-09-14 · **Scope:** ai-service, user-service, fitness-service, frontend/web (AI-relevant surfaces) · **Method:** direct code reads + 3 parallel research passes, no speculation.

**Legend used throughout:** `[CODEBASE FACT]` = verified by reading real code · `[EXTERNAL RESEARCH]` = from a cited external source · `[ARCHITECTURAL RECOMMENDATION]` = this audit's judgment call, not a fact.

---

## 0. Executive Summary

The proposed "Enterprise Data Agent + Fitness Recommendation Agent" architecture is **not hypothetical — its deterministic equivalent is already built and in production**, just not framed as "agents":

- `user-service/src/services/agentic-fitness.service.ts::candidates()` **is** an Enterprise Data Agent in everything but name: it filters PT profiles, computes real-time availability (slot-counting against booked sessions), and computes historical-cohort similarity (`journeySimilarity`/`summarizeJourneys` in `backend/shared/src/fitness-agent-scoring.ts`).
- `scorePT()` (same shared file) **is** the Recommendation Agent's scoring core: a deterministic weighted formula (`goal:30, schedule:25, budget:20, reputation:10, evidence:15`).
- The propose→draft→confirm→execute contract-automation flow (`createPTContractDraft`/`confirmPTContract`) already implements the exact "propose-then-commit + idempotency key + precondition re-check" pattern `[EXTERNAL RESEARCH]` cited in §14 identifies as the correct production-safe pattern for financial/irreversible agent actions.

**What is genuinely missing is narrower than "build two agents":**
1. An actual LLM reasoning/explanation step — today's "why" text is hardcoded Vietnamese strings, not model-generated grounded reasoning.
2. Real data behind `ClientJourney` (historical outcomes) — schema and algorithm exist, **zero rows, no writer, no seed** anywhere in the repo.
3. Any PT/coaching seed or synthetic dataset at all (zero, in any environment).
4. A named/typed `EnterpriseContext` boundary — today the "enterprise agent" behavior is organized as HTTP-calling service methods, not a formal typed contract.
5. Visible risk/HITL affordances in the confirmation UI (risk level is computed server-side but never shown to the user).

**Recommendation (detailed in §16): ADOPT WITH MODIFICATIONS** — formalize what exists as Option C (deterministic orchestrator + enterprise context/tool layer + **one** LLM reasoning/narration step), not the literal two-autonomous-LLM-agent proposal. See §16 for full reasoning.

---

## 1. Current AI Architecture — AS-IS (ai-service)

`[CODEBASE FACT]`, verified against `backend/services/ai-service/src/llm/orchestrator.service.ts` and related files.

### 1.1 Orchestration model

Single orchestrator (`llmOrchestrator.run()`, ~1200 lines), **deterministic-first / LLM-as-narrator**:

1. Language detection (sync).
2. Safety gate (`safety_guard.ts`, regex, 11 unsafe categories) — short-circuits before any I/O.
3. `fitnessAgent.tryTurn()` — regex-routed domain-action dispatcher (roadmap/PT/nutrition/workout CRUD). If matched, returns immediately; RAG/LLM never invoked for that turn.
4. Parallel fetch: profile/personalization, Qdrant retrieval, 5 most-recent chat turns, ≤20 long-term memories.
5. Deterministic engines: nutrition/workout-schedule lookup, body-composition analysis, `recommendationEngine` (template-based), `answerValidator`.
6. **One** LLM call, only for intents needing generative narrative text (`general_fitness_knowledge`, `meal_plan_request`, `body_recomposition_request`, `combined_plan_request`, `nutrient_timing_request`, or any injury mention).
7. Validation + multi-layer fallback: LLM answer discarded and replaced with the deterministic answer on empty output, out-of-scope refusal, or critical numeric mismatch.

### 1.2 Tool selection — 3 distinct layers, mostly not LLM-driven

| Layer | File | Mechanism | LLM chooses? |
|---|---|---|---|
| Domain action tools (~30 methods: PT search, roadmap accept/activate, apply plan, contract draft/confirm, cycle evaluate/complete, nutrition log...) | `services/fitness-agent-intent.ts` | Regex/keyword, Vietnamese-diacritic-normalized | **No** — code comment: *"Ranking, prescription and action execution are never inferred by a model"* |
| Chat intent routing (meal_plan/workout_plan/general_knowledge/unsafe...) | `llm/intent_router.ts` | Regex | **No** |
| RAG-support tools (`search_exercise_library`, `get_user_fitness_data`, `remember_user_fact`) | `llm/tools.ts` | Native Ollama tool-calling (`qwen3:30b-a3b-instruct-2507-q4_K_M`) | **Yes**, but `ENABLE_TOOL_CALLING` defaults **off**; capped at 2 calls/turn, 1 round-trip |

### 1.3 RAG / Vector DB

- **Qdrant**, embeddings via Ollama `nomic-embed-text` (always, regardless of chat LLM provider — Anthropic has no embeddings endpoint).
- 4 collections: `exercises`, `fitness_knowledge`, `fitness_faq`, `fitness_evidence`. AI-generated workout plans never source exercises from Qdrant — only from the fitness-service catalog (`Exercise.id` remains the sole identity, per `gymini-ai-workout-grounding` project rule).
- Retrieval: rule-based query expansion, `TOP_K=5`, `MIN_SCORE=0.35`, equipment `must_not` filter for home-only requests, dedupe+sort by raw Qdrant score — **no LLM reranking**.
- **Two competing ingestion/chunking pipelines** writing into the same `fitness_evidence` collection:

| | `knowledge-pipeline/` | `knowledge/pipeline/` + `knowledge/connectors/` |
|---|---|---|
| Chunker | 1200 chars, 160 overlap, sentence-boundary snap | 1200-char hard slice, no overlap, no snap |
| Sources | PubMed, RSS, whitelisted web, curated JSONL | + Crossref, OpenAlex |
| Wired into running server | **Yes** — BullMQ worker + HTTP endpoints | **No** — CLI scripts only, gated `ENABLE_RESEARCH_AUTOMATION` |

`knowledge-pipeline/` is authoritative/production; the other is a manually-run, unconsolidated parallel path. **Real technical debt**, not dead code.

### 1.4 Memory

- Short-term: 5 most recent `Conversation` rows (Postgres/Prisma), filtered to exclude fallback/thumbs-down turns.
- Long-term: `UserMemory` table, written only via the (default-off) `remember_user_fact` tool, read capped at 20, pruned FIFO (`pruneOldestMemories`) — **no summarization** anywhere in the service.
- Isolation: every query scoped by `userId`; cross-user access attempts 403/404 (`memoryController.remove`, `fitnessAgent.service::ownSession`, `rag.service`).

### 1.5 Multimodal goal input — more mature than expected

`[CODEBASE FACT]`, `backend/services/ai-service/src/services/fitness-goal-vision.service.ts` + `fitness-vision-chat.service.ts`.

- `analyzeGoalImage()`: Claude vision (forced tool-use schema) extracts exactly a `GoalContext`-shaped object already: `muscularity: LOW|MODERATE|HIGH`, `relativeLeanness` (3-value qualitative enum, **not** a body-fat %), `focusMuscles` (7-value enum), `confidence`, `usable`.
- The system prompt **already encodes the correct safety boundary** this audit's own §5 hypothesis independently arrived at: explicitly instructs the model *not* to identify the person, infer health/sex/age/medical conditions, estimate body-fat % or measurements, or promise a result/timeline; requires human edit/confirm before persistence; images are never stored or logged.
- A second, general-purpose `fitness-vision-chat.service.ts` handles "photo + question" (equipment ID / workout-schedule photo transcription / general), grounded in the user's real profile/InBody data (bug-fixed this session per its own code comment) so it doesn't answer generically when real data exists.
- Confirmed flow: image → `GOAL_ANALYSIS` block (frontend renders an editable form) → user edits/confirms → `POST /ai/agent/goal/confirm` → `fitnessAgentTools.confirmGoal` → user-service `POST /profile/agent/goal` (persisted to the enterprise `UserProfile`, not AI memory — correctly classified per this audit's own §12 principle).
- **Not fully verified in this pass**: whether `findPTCandidates`/`findTrainingPrograms`/`scorePT` actually consume this persisted visual-goal-intent field downstream, or whether only the pre-existing `profile.goal` enum feeds recommendation today. Flagged as an open item for Phase 3 of the migration plan — this determines whether the "upload photo → gets matched to a PT" loop is actually closed end-to-end or currently dead-ends at persistence.

### 1.6 Safety

- `llm/safety_guard.ts` (652 lines): pre-pipeline regex gate — medical emergency, PED, extreme-calorie, minor/pregnancy/eating-disorder/allergy disclosures, prompt injection, off-topic. Runs before profile fetch or any LLM/RAG call.
- `knowledge-pipeline/safety-judge.ts`: separate, ingestion-time-only, optional LLM-as-judge (gated `KNOWLEDGE_ENABLE_LLM_SAFETY_JUDGE`) supplementing an unconditional regex `detectSafetyIssue()`.

---

## 2. Current AI Architecture — AS-IS (user-service: the real "Enterprise Data + Recommendation" layer)

`[CODEBASE FACT]`, `backend/services/user-service/src/services/agentic-fitness.service.ts`, `backend/services/user-service/prisma/schema.prisma`, `backend/shared/src/fitness-agent-scoring.ts`.

### 2.1 PT profile data model

Split across `UserProfile` (+`isPT`/`ptSuspended`/`isAcceptingClients`/`specialties[]`), `PTApplication` (experience years, languages, specialties, pricing, `serviceMode`, availability window, `DRAFT→SUBMITTED→UNDER_REVIEW→APPROVED/REJECTED`), `PTApplicationCertificate` (with verification status + expiry), `PTTrainingLocation` (structured province/ward FK, gym cross-reference).

**Present**: specialization, verified certification, experience, languages, price (per-session and per-package), structured location, computed availability, computed rating.
**Missing**: explicit supported-experience-level field (only free-text `targetClientGroups`), PT capacity/caseload cap, client gender/age-band preference.

### 2.2 PT service packages

`PTServicePackage`: sessions/price/duration/mode, soft-deleted only (`archivedAt`, never hard-deleted — preserves `Contract` snapshot integrity). Price/sessions read server-side from the package at contract-request time, never trusted from the client.

### 2.3 Contract lifecycle — already a correct propose-then-commit implementation

`Contract` states: `PENDING_REVIEW → PENDING_SIGNATURE → PENDING_PAYMENT → ACTIVE → COMPLETED/EXPIRED/CANCELLED/REJECTED`.

- `createDraft` → deterministic draft id (`sha256("pt-draft:"+userId+":"+actionId)`) — a retried draft-creation with the same `actionId` returns the same draft; payload mismatch 409s.
- `confirmDraft` → `prisma.$transaction(..., {timeout: 30000})` with `pg_advisory_xact_lock('agent-contract:'+userId)`; re-validates the draft's 15-minute TTL and re-runs `candidates()` to confirm the PT/package is **still eligible** before writing — a genuine precondition-revalidation-at-commit-time, matching `[EXTERNAL RESEARCH]` §14's "propose-then-commit... block tool calls until approval is recorded" guidance almost exactly.
- `Contract.agentActionId` has a unique constraint; a retried confirm returns the existing contract rather than double-creating.
- Payment is synchronous HTTP but happens at the later `PENDING_PAYMENT→ACTIVE` transition (via `payment-service`), and the contract flips `ACTIVE` only once payment-service's webhook confirms — **AI never marks a contract active on its own say-so**. (One exception: `createMarketplaceContract`, used by a separate marketplace flow where wallet payment already completed before the contract write.)
- `confirmDraft` calls the **exact same** `contractService.requestContract` the manual "Yêu cầu huấn luyện" UI button calls (`PTDiscoveryPage.tsx`) — confirmed, not a parallel write path.

### 2.4 Historical client outcomes — the single biggest real gap

`ClientJourney` model exists (`ptId`, `contractId`, `goal`, baseline/ending weight/body-fat/lean-mass, `sessionsPrescribed/Completed`, `goalAchievement`, `verificationStatus`, `dataOrigin: REAL|SYNTHETIC`), and a genuine similarity engine (`journeySimilarity`/`summarizeJourneys`, cohort-window based, `minimumCohort=5`) is already wired into `candidates()`.

**But: zero rows exist, and nothing writes to this table.** No `.create`/`.upsert` call anywhere in the backend tree. `user-service/prisma/seed.ts` seeds only Vietnam location reference data. No admin/coach endpoint, no cron/derivation job from `Contract`/`Session`/`InBodyEntry`. `InBodyEntry` itself has **no FK to `ptUserId`/`contractId`** — even a retroactive backfill can't reliably attribute a body-composition change to "the PT active at the time" without a schema addition.

**Practical consequence**: `summarizeJourneys` always evaluates cohort size 0 ≥ `minimumCohort` 5 as false, so `HistoricalSummary` always returns `{count: 0, note: "Not enough historical evidence."}` — for every PT, always, today. "Has this PT succeeded with similar clients" is architecturally answerable but currently returns nothing regardless of what agent architecture sits on top.

**What real partial signal exists and is live** (do not conflate with outcomes):
- `SessionReview`/`ClientReview` — real 1-5 star ratings + comments, aggregated via live SQL joins. Genuine reputation data.
- `Contract`/`Session` `groupBy` aggregates — real `clientsStarted`/`clientsCompleted`/`cancellationRate`/`noShowRate` per PT. Genuine engagement data, **not outcome data**.

### 2.5 PT availability

`PTAvailability` + `PTScheduleException`, cross-referenced against booked `Session` rows via `countSlotsFromRows` — genuinely computed open-slot capacity over a 28-day window, not a static flag.

### 2.6 Seed / synthetic data

**Zero PT seed data in any environment.** Every PT profile today exists only via the real application→approval flow. A demo/synthetic pathway exists in code (`agentic-fitness.service.ts::originFor()`, gated `ENABLE_AGENTIC_DEMO`, non-production only) but nothing populates it — dead code path today.

### 2.7 Ranking split (important nuance)

`agentic-fitness.service.ts::candidates()` returns an **eligibility-filtered, unranked** list (profile-query order). The actual compatibility **ranking** (`scorePT`, weighted formula) runs entirely on the **ai-service side** (`fitness-agent.service.ts`), not in user-service. So the "Enterprise Data" and "Recommendation" responsibilities are already split across a service boundary — just not a *named* one, and not one that passes a typed context object (it passes a JSON HTTP response).

---

## 3. Current AI Architecture — AS-IS (fitness-service tool layer)

`[CODEBASE FACT]`, `backend/services/fitness-service/src/services/{workout,fitness-roadmap,agent-program}.service.ts`.

### 3.1 Idempotency/concurrency pattern (consistent across all write endpoints)

No generic idempotency-key header and no optimistic-lock `version`/`updatedAt` field anywhere. The actual, consistently-applied mechanism is a **combination of three techniques**:

1. Per-user Postgres advisory transaction lock (`pg_advisory_xact_lock(hashtextextended(...))`) — used in `applyTrainingPlan` (`agent-plan:{userId}`), all roadmap mutations (`fitness-roadmap:{userId}`), and contract confirm (`agent-contract:{userId}`).
2. Unique caller-supplied action-id column, checked first, returned as no-op on repeat (`WorkoutProgram.agentActionId`, `Contract.agentActionId`).
3. Deterministic content-hash/idempotency-key re-validation at commit time (`applyTrainingPlan`'s `fingerprint` re-check → 409 on drift; `applyRoadmapRebuild`'s `assessmentId` re-validation; `createDraft`'s hashed draft id).

`[ARCHITECTURAL RECOMMENDATION]` This is already a correct, production-grade implementation of the exact pattern `[EXTERNAL RESEARCH]` recommends for agent-triggered writes. No new idempotency mechanism needs to be invented for a new agent architecture — it needs to be *reused*.

### 3.2 Specific endpoint behavior (verbatim-verified, not assumed)

| Tool | Real endpoint | Transactional | Key behavior verified |
|---|---|---|---|
| `applyTrainingPlan` | `POST /workouts/agent/apply` → `workoutService.createManualProgram` | Yes (30s agent timeout) | Hard-deletes incomplete `WorkoutSchedule` rows; soft-archives other `ACTIVE` `WorkoutProgram`s; reuses/creates `TrainingCycle` tied to active `RoadmapPhase`, 409 on phase mismatch |
| `activateRoadmap` | `POST /fitness-roadmaps/{id}/activate` | Yes | Does **not** auto-archive a different pre-existing `ACTIVE` roadmap — throws 409. (ai-service's own code comment calling this "a no-op" is imprecise — only true for the *same*-id case; surfaced to the user as a failed bundle step, not silently swallowed, but worth fixing the comment.) |
| `advanceRoadmapPhase` | `POST /fitness-roadmaps/{id}/advance` | Yes | **Confirmed silent no-op**: 200 OK, zero writes, if current phase still has an `ACTIVE` cycle — exactly as ai-service's defensive code assumed. |
| `applyRoadmapRebuild` | — | Yes | Idempotent by `assessmentId`; re-validates the id still matches the pending rebuild context before writing. |
| `archiveRoadmap` | — | Yes | 409 if any phase currently `ACTIVE`. |
| `generateRoadmapDraft` | fitness-service → HTTP → **ai-service** `/ai/generate-roadmap-draft` | n/a | fitness-service has no LLM of its own for this; it's a client of ai-service. Falls back to a hardcoded single-phase draft on failure. Response independently re-validated/clamped before being handed back — never trusted verbatim. |
| `importAiPlanToSchedule` | `POST /workouts/from-ai-plan` | Yes | **Two separate, differently-behaved exercise-name resolvers** exist: ai-service's `searchExerciseByName` (permissive/heuristic — plural-strip, synonym map, shortest-name-wins) pre-resolves names before this call; fitness-service's own internal `exerciseReferenceResolver` (strict exact-normalized-match-or-fail) is used only on the new-program-creation branch. An existing-program re-import skips resolution entirely and just re-validates already-persisted ids. Worth consolidating onto one resolver — currently two independently-tuned heuristics that could disagree. |
| `findTrainingPrograms` | — | n/a (read) | **Pure SQL-filtered list, zero ranking/scoring anywhere** — neither fitness-service nor ai-service scores workout-program candidates (unlike PT candidates, which get `scorePT`). |
| `findPTCandidates` | user-service | n/a (read) | Eligibility-filtered + availability-computed + historical-similarity-computed, but **unranked**; ranking happens ai-service-side via `scorePT`. |

---

## 4. Current AI Architecture — AS-IS (frontend)

`[CODEBASE FACT]`, `frontend/web/src/app/components/agent/FitnessAgentBlocks.tsx`, `AICoachPage.tsx`, `PTDiscoveryPage.tsx`, `GuidedRoadmapWizard.tsx`.

- Single chat entry point (`AICoachPage.tsx`, full route + floating panel), SSE streaming, renders 7 structured block types.
- `ACTION_CONFIRMATION`: title/kind-specific summary/note rendered; confirm button double-submit-protected (disabled state + JS re-guard) — no double-submit risk found. **But `risk` is computed server-side and never visually surfaced** (no badge/color) — a real, cheap-to-fix HITL/UX gap relative to `[EXTERNAL RESEARCH]` §14's synchronous-approval-with-full-context guidance.
- **Gap**: backend emits `SUBSTITUTE_RESULT` and `CYCLE_EVALUATION_RESULT` blocks that have no dedicated frontend type/rendering — currently masked by the plain-text chat answer already covering the human-readable summary, but the structured payload (decision codes, scores) has no card UI. Any richer agentic UI (e.g. an accept/reject card for a cycle evaluation) needs new frontend work, not just backend plumbing.
- Two independent image pipelines: goal-image (analyze-on-pick → `GOAL_ANALYSIS`) and image-chat (attach-then-ask-on-send → `IMAGE_CHAT`) — neither goes through the RAG/chat orchestrator.
- Manual PT browsing (`PTDiscoveryPage.tsx`) is richer than the chat card (full filter/detail/3-tab modal, but **no sort control**); chat gives a compact ranked shortlist with a "view full profile" link into the same page.
- Contract confirmation: manual path and chat path **converge on the identical `contractService.requestContract` function** — chat inherits real idempotency/audit for free, does not reinvent it.
- Roadmap wizard and chat's `CREATE_PLAN_BUNDLE` hit the **same** accept/activate endpoints, but the wizard's diagnosis + phase-by-phase forecast preview is wizard-only UX — chat's confirmation card shows less detail (no forecast numbers) unless deliberately re-surfaced.

---

## 5. Tool inventory (complete)

| Tool | Owning service | R/W | Business impact | Auth | Idempotent | Confirmation today | Category (§17) |
|---|---|---|---|---|---|---|---|
| `getUserFitnessContext` | user/fitness (aggregate) | R | none | user identity | n/a | none | READ |
| `findPTCandidates` | user-service | R | none | user identity | n/a | none | READ |
| `findTrainingPrograms` | fitness-service | R | none | user identity | n/a | none | READ |
| `getScientificEvidence` | ai-service/Qdrant | R | none | none | n/a | none | READ |
| `getCurrentRoadmap`/`getCurrentRoadmapForecast`/`getRoadmapDiagnosis` | fitness-service | R | none | user identity | n/a | none | READ |
| `getActiveCycle`/`evaluateCycle`/`getLatestAssessment` | fitness-service | R | none | user identity | n/a | none | READ |
| `getTodaySchedule`/`searchFood`/`searchExerciseByName` | fitness/user | R | none | user identity | n/a | none | READ |
| `generateRoadmapDraft` | ai-service (via fitness-service) | R (draft, unpersisted) | none | user identity | n/a | none needed (nothing written) | DRAFT |
| `createPTContractDraft` | user-service | W (draft row) | low — reversible, expires 15m | user identity | Yes (hashed draft id) | first `ACTION_CONFIRMATION` | DRAFT |
| `acceptRoadmapDraft` | fitness-service | W (DRAFT status roadmap) | low | user identity | Partial — single-pending-draft rule only; caller-supplied `idempotencyKey` field exists but ai-service never sends it | none surfaced (bundled into `CREATE_PLAN_BUNDLE` flow) | DRAFT |
| `applyTrainingPlan` | fitness-service | W (real, replaces active schedule) | **high** — deletes incomplete schedules | user identity | Yes (advisory lock + agentActionId + fingerprint) | `ACTION_CONFIRMATION` | WRITE |
| `activateRoadmap` | fitness-service | W | **high** — 409s on conflicting active roadmap | user identity | Yes (advisory lock) | bundled into `CREATE_PLAN_BUNDLE` | WRITE |
| `advanceRoadmapPhase`/`applyRoadmapRebuild`/`archiveRoadmap` | fitness-service | W | medium-high | user identity | Yes | `ACTION_CONFIRMATION` | WRITE |
| `importAiPlanToSchedule` | fitness-service | W | **high** — replaces schedule | user identity | Yes (`sourcePlanId`) | `ACTION_CONFIRMATION` (`SAVE_GENERATED_PLAN`) | WRITE |
| `confirmPTContract` | user-service (→ payment-service async) | W — **financial consequence** | **critical** | user identity | Yes (advisory lock + unique `agentActionId` + eligibility re-check) | second `ACTION_CONFIRMATION` | CRITICAL |
| `reviewRecommendation` (accept/reject cycle assessment) | fitness-service | W | medium | user identity | not verified in this pass | `ACTION_CONFIRMATION` | WRITE |
| `createNutritionLog`/`substituteMealItem` | fitness/nutrition | W | low, reversible, editable | user identity | not verified in this pass | substitution runs w/o confirm (deliberate product decision, documented in code); meal-log via confirm | WRITE / low-risk auto |
| `start/skip/cancelWorkoutSchedule` | fitness-service | W | low | user identity | not verified in this pass | `ACTION_CONFIRMATION` | WRITE |
| `search_exercise_library`/`get_user_fitness_data`/`remember_user_fact` | ai-service | R / W (memory) | low | user identity | n/a | none (LLM-autonomous, gated off by default) | READ / low-risk auto |

`[ARCHITECTURAL RECOMMENDATION]` The tool layer is already **sufficient in shape** to support the proposed architecture — it already implements the READ/DRAFT/WRITE/CRITICAL tiering §17 describes, just without that formal label. The gap is not missing tools; it's (a) unranked `findTrainingPrograms`, (b) two divergent exercise-name resolvers, (c) `risk` not visible in the UI, (d) `acceptRoadmapDraft`'s real idempotency key going unused.

---

## 6. RAG research & recommendation (chunking, retrieval)

`[EXTERNAL RESEARCH]`:
- Recursive character splitting at 400–512 tokens with 10–20% overlap is the strongest general-purpose default; Chroma's published research found recursive chunking reaches 85–90% recall at 400 tokens vs. 91–92% for semantic chunking — a 2–3-point gain that costs embedding every sentence during ingestion. ([Firecrawl: Best Chunking Strategies for RAG in 2026](https://www.firecrawl.dev/blog/best-chunking-strategies-rag), [Databricks community: Chunking Strategies guide](https://community.databricks.com/t5/technical-blog/the-ultimate-guide-to-chunking-strategies-for-rag-applications/ba-p/113089))
- Structured/manual-like documents favor recursive chunking; multi-topic research papers benefit more from semantic chunking; unstructured logs/transcripts are fine with fixed/token-based chunking. ([Atlan: Chunking Strategies for RAG](https://atlan.com/know/chunking-strategies-rag/))
- Agentic RAG (the model deciding when/how to retrieve, rewriting queries, judging sufficiency) is the current frontier pattern, but survey literature frames it as valuable specifically for compound/multi-hop questions, not as a default upgrade for every RAG deployment. ([Agentic RAG survey, arXiv:2501.09136](https://arxiv.org/abs/2501.09136))

`[ARCHITECTURAL RECOMMENDATION]`:
- Gymini's current 1200-char/160-overlap window with sentence snapping is **already close to the recursive-chunking default** the research recommends — do not switch to semantic chunking; the 2–3% recall gain does not justify the added embedding cost and latency for a fitness-evidence corpus of this size.
- **Consolidate the two ingestion pipelines onto `knowledge-pipeline/`** (the wired, worker-driven one) before adding any new source connectors — this is priority-0 technical debt, not a nice-to-have.
- Agentic (LLM-driven) retrieval is **not justified today** — Gymini's regex-based query expansion + fixed `TOP_K`/`MIN_SCORE` already reportedly scores `hitAtK=0.98` on the retrieval eval per the `orchestrator.service.ts` code comment (`ENABLE_TOOL_CALLING` gate rationale) — a high bar an agentic upgrade would need to beat to justify its added latency/cost.

---

## 7. PT recommendation & historical-outcome matching — research & recommendation

`[EXTERNAL RESEARCH]`:
- Case-based reasoning (CBR) recommenders retrieve similar prior cases, score similarity, and adapt the prior solution — this is structurally identical to what `journeySimilarity`/`summarizeJourneys` already implement. Hybrid CBR + collaborative-filtering approaches specifically address the cold-start/sparsity problem a small PT roster will face. ([Case-based recommender systems survey](https://www.researchgate.net/publication/225070235_Case-based_recommender_systems), [Hybrid RBR+CBR recommender](https://www.academia.edu/73663026/A_Hybrid_Recommender_System_Using_Rule_Based_and_Case_Based_Reasoning))
- Tool-selection/ranking accuracy for LLMs degrades as option sets grow or overlap — production guidance is to combine LLM reasoning with deterministic tools/validated responses for the actual computation, not to let the LLM directly compute or invent rankings. ([ml4devs: LLM Function Calling explained](https://www.ml4devs.com/what-is/llm-function-calling-and-tools/))

`[ARCHITECTURAL RECOMMENDATION]`:
- **Do not let an LLM directly rank PTs or invent match percentages.** Gymini's existing `scorePT` deterministic formula is correct and should remain the ranking authority — this matches both the external research and the project's own `gymini-fitness-science-guardrails`-style discipline of never letting an LLM assert a number it didn't compute.
- The LLM's value-add belongs **downstream of ranking**: turning `scorePT`'s numeric breakdown + evidence citations + (once populated) `ClientJourney` cohort summary into a personalized, evidence-grounded natural-language explanation — replacing today's hardcoded `why: [...]` strings. This is a narrow, low-risk, high-value LLM insertion point, not a new autonomous agent.
- `minimumCohort=5` in `summarizeJourneys` is a reasonable statistical floor for a KLTN-scale dataset — do not lower it just to make demo data "work"; instead populate real/synthetic data to legitimately clear it (§11).

---

## 8. Tool-selection architecture — research & recommendation

`[EXTERNAL RESEARCH]`:
- Benchmarked tool-calling accuracy varies materially by model (Claude Opus >99%, Sonnet near-identical at lower cost, GPT-4o 90–95%), and degrades further as the tool catalog grows or tool descriptions overlap. ([ml4devs: LLM Function Calling and Tools](https://www.ml4devs.com/what-is/llm-function-calling-and-tools/), [Deploybase: Best LLM for Function Calling](https://deploybase.ai/articles/best-llm-for-function-calling-tool-use-comparison))
- Reliability (consistency) and accuracy (correctness) are distinct — a system can be perfectly consistent and consistently wrong.

`[ARCHITECTURAL RECOMMENDATION]`:
- Gymini's current split — deterministic regex routing for high-stakes/audited domain actions, LLM tool-calling only for low-stakes RAG-support tools — is **already the pattern the external research recommends**, not a compromise to fix. Keep it.
- Do **not** migrate `fitness-agent-intent.ts`'s ~14 intent kinds to LLM tool-calling. The current regex router is auditable, has zero hallucination risk, and (per the code's own comment) the deterministic path already hits a high retrieval-eval score; an LLM router would need to *beat* that bar plus survive adversarial/injection testing to be worth the switch.
- Before flipping `ENABLE_TOOL_CALLING` on by default even for the 3 low-risk RAG-support tools, run the tool-selection-accuracy eval described in §13 against the current `qwen3:30b` config — no evidence in the repo that this has been measured beyond the original 20-case feasibility spike referenced in `llm/tools.ts`'s comment.

---

## 9. Agent interaction model & framework — research & recommendation

`[EXTERNAL RESEARCH]`:
- Anthropic's own guidance: multi-agent systems earned a 90.2% improvement over single-agent Claude on breadth-first research tasks, but cost ~10–15x the tokens of a single agent — and the explicit guidance is to reserve multi-agent architectures for tasks where independent, parallel exploration is the actual constraint, not to adopt them by default. ([Claude: When to use multi-agent systems](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them))
- ~28% of production multi-agent deployments in 2026 use custom orchestration rather than a framework; frameworks like LangGraph reduce time-to-production but add lock-in, and are most justified when a team needs explicit state/branching/checkpoints/resumable execution beyond what custom code comfortably provides. ([LangChain: best AI agent frameworks 2026](https://www.langchain.com/resources/ai-agent-frameworks), [Speakeasy: agent framework comparison](https://www.speakeasy.com/blog/ai-agent-framework-comparison))

`[ARCHITECTURAL RECOMMENDATION]`:
- **Gymini's task is not a breadth-first research problem** — it's a personalization/ranking/automation problem over a small, well-typed enterprise dataset. Anthropic's own criterion for multi-agent value (independent parallel exploration) does not apply here. This is direct evidence *against* the literal two-autonomous-agent proposal.
- **Do not adopt LangGraph or a similar framework.** Gymini's orchestrator already implements the propose→confirm→execute, timeout/fallback, and validation patterns a framework would provide, in plain TypeScript, integrated with the project's own Prisma/advisory-lock idempotency model. Migrating would mean re-deriving those guarantees inside a new framework's abstractions for no demonstrated capability gain, and would conflict with `gymini-parallel-agent-safety`'s "smallest architecture-consistent correction" principle.
- Preferred interaction model: **Model B** (§21) — Orchestrator/shared typed state, not direct Agent-to-Agent messaging. This matches what already exists organically (ai-service calls out to user-service/fitness-service via typed, Zod-validated HTTP responses) — the improvement needed is formalizing this into one `EnterpriseContext` type, not introducing a new message-passing protocol between two LLM runtimes.

---

## 10. Vision / multimodal goal input — feasibility

Already built and already correctly scoped (§1.5). `[ARCHITECTURAL RECOMMENDATION]`: no new vision pipeline is needed. The remaining work is (a) verifying/closing the loop from persisted goal-intent to recommendation inputs, (b) formalizing the existing `GoalVisualAttributesSchema` as the project's official `GoalContext` type referenced by the target architecture, rather than building a new schema.

`[EXTERNAL RESEARCH]` on vision-LLM limits (medical/body image interpretation shows real accuracy gaps in small-detail detection and domain-specific reasoning) supports treating Gymini's existing conservative design — qualitative categorical attributes only, explicit prohibition on inferring body-fat % or medical conditions — as correctly scoped, not under-scoped. ([PMC: Limitations in medical VLM interpretation](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12897257/))

---

## 11. Data gap analysis — PT seed / synthetic data

No PT, package, or `ClientJourney` seed data exists anywhere (§2.6). The demo/synthetic pathway (`ENABLE_AGENTIC_DEMO`, `dataOrigin: SYNTHETIC`) is coded but unpopulated.

`[ARCHITECTURAL RECOMMENDATION]` — build, but explicitly marked:

```
SYNTHETIC / DEMONSTRATION DATA — dataOrigin: "SYNTHETIC" on every row
```

Target composition for meaningful recommendation-quality evaluation:
- 50–100 PT profiles across specializations, price tiers, experience levels, service modes, locations (including deliberate "cold-start" PTs with zero history).
- 300–1000 `ClientJourney` rows with realistic distributions: mix of `goalAchievement` true/false, varied `verificationStatus`, enough per-PT cohort size to clear `minimumCohort=5` for a meaningful subset of PTs (so the similarity engine has something real to return in demos/tests), and enough that don't clear it (so the "not enough historical evidence" path is also exercised, not just hidden).
- This dataset must **not** be presented as evidence of real PT performance in the graduation-project write-up — it demonstrates the pipeline, not real-world efficacy.
- **This audit does not generate this dataset** — per the task's own instruction, that's an implementation step for a later phase, not part of this feasibility pass.

---

## 12. Data classification — Vector DB vs Enterprise DB

`[ARCHITECTURAL RECOMMENDATION]`, extending the already-correct existing split:

| Data | Belongs in | Why |
|---|---|---|
| `UserProfile`, `InBody`, `PTProfile`/`PTApplication`, `PTAvailability`, `WorkoutHistory`, `TrainingCycle`, `WorkoutSchedule`, `FitnessRoadmap`, `NutritionGoal`, `Contract`, `Payment` | Enterprise DB (Postgres, business services) | Operational, mutable, authoritative facts — already correctly placed |
| `ClientJourney` (once populated) | Enterprise DB | Structured, queryable, needs exact per-PT/per-user filtering — **not** a good vector-search candidate; keep structured, feed *summaries* of it into LLM prompts as text, never embed raw rows as the retrieval mechanism |
| Scientific papers, exercise knowledge, nutrition guidelines, curated evidence | Vector DB (Qdrant) | Unstructured, benefits from semantic retrieval — already correctly placed |
| Long-form PT methodology / case-study narratives, if ever authored | Vector DB, if long-form free text | Only if genuinely long-form; short structured reviews (current `SessionReview`) stay relational |
| Confirmed user goal image attributes (`GoalContext`) | Enterprise DB (`UserProfile`) | Already correctly persisted there, not as an embedding — this is a structured fact, not semantic knowledge |

**Conclusion**: `ClientJourney` should remain structured/relational and be **summarized into text at prompt-construction time**, not vectorized — a hybrid strategy, not a vector-DB migration. This preserves exact per-user/per-PT filtering (a vector similarity search over journeys would be strictly worse than the existing cohort-window SQL query for this use case) while still letting the recommendation LLM step consume it as grounded context.

---

## 13. Evaluation strategy

`[ARCHITECTURAL RECOMMENDATION]`, scoped to what's realistic for a KLTN-scale system:

| Area | Metric | Existing foundation |
|---|---|---|
| Tool selection (the 3 gated RAG tools only) | tool-selection accuracy, wrong-tool rate | Only a 20-case feasibility spike exists (`llm/tools.ts` comment) — needs a real eval set before enabling by default |
| RAG | retrieval relevance, citation correctness | `hitAtK=0.98` cited informally in code comments — needs to be a checked-in, re-runnable eval (`scripts/evaluateRetrieval.ts` exists — verify it's current) |
| PT recommendation | constraint satisfaction (hard filters never violated), ranking stability across repeated runs (deterministic formula ⇒ should be 100%), historical-cohort relevance (only measurable once §11's dataset exists) | `scorePT` is pure/deterministic — trivial to unit-test exhaustively |
| Agent automation | task completion rate, duplicate-write rate, confirmation correctness | Idempotency mechanisms already exist (§3.1) — write tests asserting double-confirm is a true no-op, not just assumed |
| Safety | unsafe-recommendation rate, unauthorized cross-user access attempts | `safety_guard.ts` already has some test coverage (`__tests__/safety_guard_*`) — extend to the new recommendation-narration LLM step specifically |
| System | latency, LLM calls/task, cost/task | Add explicit tracing for a new narration step (§ target-architecture doc, Observability) |

---

## 14. Security / safety Q&A

`[CODEBASE FACT]` where verified, `[ARCHITECTURAL RECOMMENDATION]` where this audit adds judgment.

1. **Could Agent 1 (Enterprise Data) access another user's data?** No — every existing query is scoped by the authenticated `userId`/`identity`, not a client-supplied id (`gymini-account-session-isolation` project rule already enforced: `ownSession()`, `memory.controller.ts` 403 check, `rag.service.ts` 404 check).
2. **How is identity propagated?** `AgentIdentity { userId, authorizationHeader }`, threaded through every `fitnessAgentTools` call to the downstream HTTP client — server-verified, not LLM-supplied.
3. **Can the LLM choose arbitrary user IDs?** No — `userId` is never a tool parameter; it comes from server-side auth context, not model output, in every path audited.
4. **Can Agent 2 (Recommendation) manipulate enterprise data?** Today, no — it only reads (`scorePT` is pure). If a future LLM-narration step is added (§7), it must remain read-only over enterprise data; any write stays behind the existing propose→confirm tools.
5. **Can a prompt injection trigger a write action?** Domain-action writes are gated by the regex intent router (not influenced by RAG content) plus explicit `ACTION_CONFIRMATION`/`confirmed:true`. The 3 LLM-tool-calling tools include `remember_user_fact` (write) — validated (length cap, enum category) but **not proven immune to injected instructions from retrieved RAG content**; this specific path (RAG content → tool-calling LLM → `remember_user_fact`) should get an explicit injection test before `ENABLE_TOOL_CALLING` is ever turned on by default.
6. **Can retrieved RAG content instruct the agent to call tools?** Not evaluated in this pass for the tool-calling-enabled path — flagged as an open risk item (see #5).
7. **Can a stale PT recommendation create an invalid contract?** No — `confirmDraft` re-runs `candidates()` and re-validates eligibility before writing (§2.3).
8. **Can the same confirmation execute twice?** No — unique `agentActionId` + advisory lock + deterministic draft id, verified across contract/plan/roadmap paths (§3.1).
9. **Can AI create financial consequences without confirmation?** No — contract creation is `PENDING_REVIEW` (no payment), and `ACTIVE` only follows a payment-service webhook, never an AI assertion.
10. **How are tool permissions enforced outside the prompt?** Server-side: Zod schema validation on every tool call (`fitness-agent-tools.ts`), risk-tiered action rows with 15-minute expiry, and the downstream business-service endpoints re-validate independently of what the LLM/orchestrator claims (e.g., `applyTrainingPlan`'s fingerprint re-check). The system prompt is never the security boundary — confirmed structurally, not just assumed.

---

## 15. Gap analysis matrix

| Capability | Current | Target | Gap | Reuse | Change | Risk | Priority |
|---|---|---|---|---|---|---|---|
| Enterprise context | Organic HTTP calls, JSON responses, Zod-validated | One typed `EnterpriseContext` object assembled once per turn | Formalization only | ~90% (logic exists) | Introduce a typed assembler/service in ai-service | Low | P1 |
| RAG | Qdrant, 2 competing pipelines, no reranking | Single consolidated pipeline, same retrieval params | Consolidate ingestion | ~85% | Merge `knowledge/pipeline` into `knowledge-pipeline/` | Low-medium (migration risk if sources differ) | P0 |
| Tool calling | Regex-first, LLM tool-calling gated off | Same split, kept | None required | 100% | Optional: eval + enable for 3 RAG tools only | Low | P2 |
| PT matching | Deterministic filter + `scorePT`, no LLM narration | Same scoring + LLM narration layer added downstream | Add narration step only | ~80% (scoring done) | New: LLM-narrated per-candidate explanation, validated against `scorePT` output | Medium (hallucination risk if not validated) | P1 |
| Historical outcomes | Schema + algorithm ready, 0 real rows | Populated `ClientJourney` (real + marked synthetic) | Full data gap | ~40% (schema/algorithm only) | New: population pipeline + synthetic dataset | Medium | P1 |
| Memory | Short-term 5 turns, long-term FIFO-20, no summarization | Same, possibly add summarization if context loss becomes a real problem | Minor | 90% | Optional: summarization pass | Low | P3 |
| Vision goal input | Fully built, correctly scoped, persistence confirmed | Same, loop-closure to recommendation verified | Verify downstream consumption | 90% | Verify/wire `profile.goal`-derived recommendation to read the visual-goal fields | Low | P2 |
| Workout automation | Transactional, idempotent, fingerprint-checked | Same | None required | 100% | None | Low | — |
| PT contract automation | Transactional, idempotent, precondition-revalidated, payment-gated | Same | None required | 100% | None | Low | — |
| Safety | Regex pre-gate + ingest-time LLM judge | Same + injection test for tool-calling path | Test coverage gap | 85% | Add injection test for `remember_user_fact` path | Medium (if `ENABLE_TOOL_CALLING` is later turned on) | P1 |
| Observability | Per-request tracing (`traceLogger`), timing breakdown | Add agent-run-level tracing for new narration step | Minor extension | 80% | Extend `traceLogger` fields | Low | P2 |
| Evaluation | Informal (`hitAtK=0.98` cited in comments), 20-case tool spike | Checked-in, re-runnable eval suite | Formalization | 50% | New: eval harness + fixtures | Medium | P1 |

---

## 16. Feasibility matrix & final decision

| Proposal | Status | Existing foundation | Missing | Difficulty |
|---|---|---|---|---|
| Enterprise Data Agent (as literally proposed: separate LLM agent) | **NOT RECOMMENDED as an LLM agent** | Deterministic equivalent already built and production-grade | Nothing — the deterministic version already does this correctly and more safely | N/A (don't build) |
| Enterprise Context formalization (typed object, same logic) | **READY** | ~90% | Typed assembler | Low |
| Recommendation Agent (as literally proposed: separate LLM agent making the recommendation decision) | **NOT RECOMMENDED as a decision-maker** | `scorePT` already makes the decision deterministically and correctly | Nothing to replace | N/A |
| Recommendation Narration (LLM explains an already-computed, validated recommendation) | **PARTIALLY READY** | Scoring/evidence/cohort inputs all exist | The narration step itself; validation harness to prevent contradiction of underlying numbers | Medium |
| Historical similarity (`ClientJourney`) | **MISSING (data only)** | Schema + algorithm 100% ready | Real/synthetic data + population pipeline | Medium |
| Image → GoalContext | **READY** | Fully built, safety-scoped correctly | Verify downstream consumption loop | Low |
| RAG upgrade (reranking/agentic retrieval) | **NOT RECOMMENDED now** | Current retrieval already scores well | Would need to prove it beats current eval | N/A (defer) |
| RAG pipeline consolidation | **READY** | Both pipelines exist and work individually | Merge decision + migration | Low-medium |
| Long-term memory upgrade (summarization) | **NOT URGENT** | FIFO cap works today | Only needed if context loss becomes observed | Low |
| Auto Apply Plan | **READY (already works)** | Fully idempotent/transactional | None | — |
| PT Contract Automation | **READY (already works)** | Fully idempotent/transactional/payment-gated | None | — |
| HITL confirmation | **PARTIALLY READY** | Confirmation mechanics solid | Risk not visually surfaced; 2 block types lack UI | Low |
| Agent framework adoption (LangGraph etc.) | **NOT RECOMMENDED** | Custom orchestration already implements the needed guarantees | N/A | N/A (don't adopt) |

### Final decision

```
RECOMMENDATION:

ADOPT WITH MODIFICATIONS
```

**What "adopt" means here**: adopt **Option C** — a deterministic orchestrator plus a formalized enterprise-context/tool layer plus **one** LLM recommendation-narration step — not the literal two-autonomous-LLM-agent architecture originally proposed.

**Why not the literal proposal (Option B)**: the deterministic equivalent of both proposed agents already exists, is production-grade (transactional, idempotent, audited, tested in the contract/roadmap/plan paths), and outperforms what an LLM-reasoning version would offer on the two properties that matter most for this domain — correctness of numeric ranking and auditability of financial/irreversible actions. Anthropic's own published guidance is that multi-agent architectures earn their cost specifically on breadth-first, independent-exploration tasks; Gymini's PT-matching/plan-automation problem is a personalization+automation problem, not that shape of task.

**What should change**:
1. Formalize the existing Enterprise Data logic into one typed `EnterpriseContext` (naming/structure, not new logic).
2. Add exactly one new LLM capability: a **Recommendation Narrator** that explains an already-computed `scorePT` result using real evidence/cohort data, with output validated against the underlying numbers (reusing the orchestrator's existing fallback-cascade pattern).
3. Build the `ClientJourney` population pipeline + a clearly-marked synthetic dataset (§11) — without this, no recommendation architecture (agentic or not) can honestly claim "based on similar client outcomes."
4. Consolidate the two RAG ingestion pipelines.
5. Surface `risk` in the confirmation UI; add card UI for the two currently-unrendered block types.
6. Fix the `activateRoadmap` no-op code comment (documentation accuracy, not behavior).
7. Consolidate the two exercise-name resolvers.

**What should NOT be built**: a second autonomous LLM agent for enterprise data access; LLM-driven PT ranking; a migration to LangGraph or any agent framework; direct LLM/SQL access; any write path that bypasses the existing propose→confirm→execute pattern.

Full migration sequencing: see `docs/ai-agent-system-migration-plan.md`. Clean architecture for presentation: see `docs/ai-agent-system-target-architecture.md`.

---

## 17. External research not completed

Web search access was available and used (§6, §7, §8, §9, §10 above each cite real sources). No topics from the task's required research list were left uncompleted, though the searches were representative rather than exhaustive (a handful of targeted queries per topic, not a full literature review) — appropriate for a KLTN-scale feasibility pass, not a publishable systematic review.
