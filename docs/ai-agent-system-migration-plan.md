# Gymini AI Agent System — Migration Plan

**Companion to:** `docs/ai-agent-system-feasibility-audit.md` (evidence), `docs/ai-agent-system-target-architecture.md` (destination).

**Principle:** no rewrite. Every phase is additive/formalizing on top of the existing, already-production-grade deterministic system. Each phase is independently shippable and flag-gated where it touches a live user-facing flow.

---

## Phase 0 — Audit (this deliverable)

Complete. Outputs: the 3 companion documents plus this plan.

---

## Phase 1 — Fix documented inaccuracies & consolidate technical debt (no new features)

**Scope:**
- Fix the `activateRoadmap` code comment in `fitness-agent.service.ts` (§3, feasibility audit) — currently claims same-roadmap-vs-different-roadmap is always a no-op; it isn't for a different pre-existing ACTIVE roadmap.
- Consolidate `knowledge/pipeline/` + `knowledge/connectors/` into `knowledge-pipeline/` (or formally deprecate the manual one with a clear comment/README, if consolidation is deferred).
- Consolidate the two exercise-name resolvers (`fitness-agent-tools.ts::searchExerciseByName` vs. fitness-service's internal `exerciseReferenceResolver`) onto one, or explicitly document why two must remain (permissive-preview vs. strict-persist may be a legitimate intentional split — verify with the owning team, this may be **Codex's** active domain per `gymini-parallel-agent-safety`, check `git log`/current branch activity before touching).

**Files/services impacted:** `ai-service/src/services/fitness-agent.service.ts` (comment only), `ai-service/src/knowledge*/` (consolidation), `ai-service/src/services/fitness-agent-tools.ts` + `fitness-service/src/services/exercise-reference-resolver.service.ts` (resolver consolidation).

**DB changes:** none. **API changes:** none (internal consolidation only). **Risk:** low, but the exercise-resolver item overlaps a domain flagged as actively owned by a concurrent workstream — check first, don't touch if active. **Tests:** existing `chunking.test.ts`, `knowledge_pipeline.test.ts` should cover the consolidated pipeline; add a resolver-consistency test if unifying. **Rollback:** trivial (revert commit), no data migration involved.

---

## Phase 2 — Formalize `EnterpriseContext` (typing exercise, no logic change)

**Scope:** define the typed shapes from the target-architecture doc §5 (`EnterpriseContext`, `GoalContext`, `RankedRecommendation`, `RecommendationResult`, `AgentState`) in `backend/shared/src`, following the existing pattern of `fitness-agent-scoring.ts`/`fitness-agent.ts`. Refactor `fitness-agent.service.ts`'s ad-hoc object assembly (already doing this work, just untyped/inline) to construct and pass this typed object internally.

**Files/services impacted:** `backend/shared/src/` (new types), `backend/services/ai-service/src/services/fitness-agent.service.ts` (refactor, no behavior change).

**DB changes:** none. **API changes:** none — this is internal typing, not a new endpoint. **Risk:** low (pure refactor, existing tests should catch regressions). **Tests:** existing `fitness-agent-*.test.ts` suite must pass unchanged; add type-level tests if useful. **Rollback:** trivial.

---

## Phase 3 — Close the vision→recommendation loop (verify + wire if needed)

**Scope:** Verify whether `findPTCandidates`/`findTrainingPrograms`/`scorePT` currently consume the persisted goal-image attributes (`UserProfile` fields written via `/profile/agent/goal`) or only the base `profile.goal` enum. If not consumed, wire `GoalContext.focusMuscles`/`muscularity` into the existing preference-building logic in `fitness-agent.service.ts` (e.g., as an additional soft-scoring input or a `why`-string input) — **do not** invent a new numeric score dimension without a specification review, since `scorePT`'s weights (30/25/20/10/15) are a deliberate tuned formula.

**Files/services impacted:** `ai-service/src/services/fitness-agent.service.ts`, possibly `backend/shared/src/fitness-agent-scoring.ts` (only if a new scoring dimension is genuinely warranted — default to NOT changing the formula, prefer using it as narration input only).

**DB changes:** none. **API changes:** none. **Risk:** low if scoped to narration-input only; medium if the scoring formula itself changes (requires the same rigor as any `gymini-fitness-science-guardrails`-covered calculation change). **Tests:** add a fixture asserting a confirmed goal image influences the recommendation output (narration or scoring, per decision). **Rollback:** trivial if narration-only; requires care if the formula changed (versioned via `FITNESS_SCORING.version`, already exists).

---

## Phase 4 — `ClientJourney` population pipeline (real data path)

**Scope:** the single highest-value gap. Two sub-parts:

**4a — Schema fix for retroactive attribution:** `InBodyEntry` has no FK to `ptUserId`/`contractId`. Add a nullable link (e.g., `activeContractId` captured at measurement time, or a join through `TrainingCycle`/`Contract` date-range overlap as a lower-effort alternative that needs no schema migration). Decide which approach based on how InBody entries are actually created today (check if there's a natural capture point).

**4b — Derivation job:** on `Contract` completion (`COMPLETED` status), derive a `ClientJourney` row from: baseline InBody (nearest entry at/before contract start) + ending InBody (nearest entry at/before contract end) + `Session` completion count + existing `SessionReview`/goal data. Mark `verificationStatus: SYSTEM_DERIVED`, `dataOrigin: REAL`. This can be a cron job or triggered on the contract-completion state transition (prefer trigger-on-transition for correctness/timeliness).

**Files/services impacted:** `user-service/prisma/schema.prisma` (migration for 4a, if chosen), new service (e.g., `client-journey-derivation.service.ts`) in `user-service`, hooked into the existing `Contract` completion path (`contract.service.ts`).

**DB changes:** yes — one migration for the InBody link (4a) if chosen, plus ongoing `ClientJourney` inserts (4b, no schema change needed for the table itself, it already exists). **API changes:** none required (internal derivation), though an admin-facing "view derived journeys" endpoint may be useful for QA. **Risk:** medium — touches real contract-completion logic; must not affect the existing completion flow's correctness (additive-only, wrap in its own error boundary so a derivation failure never blocks contract completion itself). **Tests:** new unit tests for the derivation logic; integration test asserting `summarizeJourneys` returns real (non-empty) cohorts once enough journeys exist. **Rollback:** derivation job can be disabled via a feature flag without affecting `Contract`/`InBody` data integrity.

---

## Phase 5 — Synthetic PT/journey dataset (demonstration data)

**Scope:** build the dataset described in feasibility audit §11 (50–100 PT profiles, 300–1000 `ClientJourney` rows), using the existing (currently dead) `ENABLE_AGENTIC_DEMO`/`dataOrigin: SYNTHETIC` pathway in `agentic-fitness.service.ts::originFor()`. Write a seed script analogous to `seed_vietnam_locations.ts`, explicitly gated to non-production.

**Files/services impacted:** new `user-service/prisma/seeders/seed_agentic_demo.ts` (or similar), no production code changes beyond what already exists (`originFor()` is already there).

**DB changes:** none (uses existing schema). **API changes:** none. **Risk:** low — purely additive, non-production-gated, clearly marked `SYNTHETIC`. **Tests:** seed script itself should be idempotent (safe to re-run) and assert row counts. **Rollback:** delete seeded rows (all tagged `dataOrigin: SYNTHETIC`, trivially filterable).

---

## Phase 6 — Recommendation Narrator (the one new LLM capability)

**Scope:** implement the `NAR` step from the target architecture — one bounded LLM call that takes the already-ranked `scorePT` output + RAG evidence + (once Phase 4 lands) historical cohort summary, and produces a grounded natural-language explanation replacing the current hardcoded `why: [...]` strings. Must include a validator (reuse the existing `answerValidator`/fallback-cascade pattern from `orchestrator.service.ts`) that discards the narration and falls back to the current template strings if the LLM's text contradicts the underlying numbers (e.g., invents a percentage not in `compatibility`, or claims cohort evidence when `historicalCohort.count === 0`).

**Files/services impacted:** new `ai-service/src/llm/recommendation_narrator.ts` (or similar), wired into `fitness-agent.service.ts`'s PT/program recommendation path, behind a new flag.

**Feature flag:** `ENABLE_RECOMMENDATION_NARRATION` (default off during development/eval).

**DB changes:** none. **API changes:** none (additive field in the existing `PT_RECOMMENDATIONS`/`PROGRAM_RECOMMENDATIONS` block response, `narration` optional). **Risk:** medium — new LLM call in a user-facing recommendation path; must not increase latency unacceptably (reuse existing `withTimeout`/fallback pattern) and must not be trusted for numbers. **Tests:** unit tests for the validator (does it correctly reject a fabricated number/cohort claim); eval fixtures per feasibility audit §13. **Rollback:** flag off, or fallback path is already the "rollback" — no user-facing breakage possible since validation always has a deterministic fallback.

---

## Phase 7 — Frontend HITL/UX gaps

**Scope:**
- Surface `risk` visibly in `ACTION_CONFIRMATION` (badge/color per tier: WRITE vs CRITICAL at minimum).
- Add rendering for `SUBSTITUTE_RESULT` and `CYCLE_EVALUATION_RESULT` block types in `FitnessAgentBlocks.tsx` (currently masked by plain-text answer only).
- If Phase 6 ships, render `recommendation.narration` in the existing `PT_RECOMMENDATIONS`/`PROGRAM_RECOMMENDATIONS` cards (falls back to existing `why[]` list if `usedNarrationFallback`).

**Files/services impacted:** `frontend/web/src/app/components/agent/FitnessAgentBlocks.tsx`, `frontend/web/src/app/services/fitnessAgent.ts` (type union extension).

**DB changes:** none. **API changes:** none (consuming already-emitted fields). **Risk:** low, pure frontend addition. **Tests:** component tests if the project has them for this file; otherwise manual verification per `gymini-ui-information-architecture` mobile-width checks (360/375/390/412). **Rollback:** trivial.

---

## Phase 8 — Evaluation harness

**Scope:** formalize the informally-cited `hitAtK=0.98` RAG metric and the 20-case tool-calling spike into checked-in, re-runnable eval suites (extend `scripts/evaluateRetrieval.ts` if it already covers this — verify current state first). Add PT-recommendation eval (constraint satisfaction + ranking determinism, trivial since `scorePT` is pure) and narration-validator eval (does the validator correctly catch fabricated claims — adversarial test set).

**Files/services impacted:** `ai-service/src/scripts/evaluateRetrieval.ts`, `ai-service/src/evaluation/` (existing directory — extend, don't duplicate).

**DB changes:** none. **API changes:** none. **Risk:** low. **Tests:** this phase *is* tests. **Rollback:** N/A.

---

## Phase 9 — Optional: enable LLM tool-calling for the 3 RAG-support tools

**Scope:** only after Phase 8's eval exists — run the tool-selection-accuracy eval against current model config, and specifically test the prompt-injection path flagged in feasibility audit §14 (#5/#6: can retrieved RAG content trigger `remember_user_fact`). Only flip `ENABLE_TOOL_CALLING=true` by default if both pass a defined bar.

**Files/services impacted:** none beyond configuration — the capability (`llm/tools.ts`) already exists.

**DB changes:** none. **API changes:** none. **Risk:** medium (injection surface) until the eval is run. **Tests:** the injection eval itself is the test. **Rollback:** flag off, instantly.

---

## Phase 10 — Observability extension

**Scope:** add the new `traceLogger` fields from the target-architecture doc §7 (`agentRunId`, `enterpriseContextMs`, `narrationUsed`, `narrationFallbackReason`, `businessAction`/`businessActionResult`).

**Files/services impacted:** `ai-service/src/llm/trace_logger.ts`, `ai-service/src/llm/types.ts` (`AiChatTiming`).

**DB changes:** none (assuming trace storage is already external/log-based — verify). **API changes:** none. **Risk:** low. **Tests:** trace-shape assertions. **Rollback:** trivial.

---

## Feature flags summary

| Flag | Purpose | Default |
|---|---|---|
| `ENABLE_RECOMMENDATION_NARRATION` | Gate Phase 6's new LLM narration step | off, until eval passes |
| `ENABLE_AGENTIC_DEMO` | Existing — gates synthetic PT/journey data pathway | off in production (already the case) |
| `ENABLE_TOOL_CALLING` | Existing — gates LLM-driven RAG-support tool calling | off, until Phase 9's eval passes |
| `ENABLE_RESEARCH_AUTOMATION` | Existing — gates the manual research-automation ingestion pipeline; **candidate for removal** once Phase 1 consolidates it | currently off by default |

No new flags were invented beyond what Phase 6/9 genuinely require — per the task's own instruction not to add flags that don't help migration.

---

## Compatibility guarantee

Every existing flow (`AICoachPage.tsx` chat, `PTDiscoveryPage.tsx` manual browse/hire, `GuidedRoadmapWizard.tsx`, nutrition flow, workout scheduling) continues to work unmodified through all 10 phases — none of them touch a shared write path in a breaking way; Phases 2–3 are internal refactors, Phase 4–5 are additive data, Phase 6 is additive+flagged, Phase 7 is additive UI, Phases 8–10 are non-functional. The only phase that touches a live business-logic path (`Contract` completion, Phase 4b) is additive and explicitly required not to block or alter the existing completion transition.
