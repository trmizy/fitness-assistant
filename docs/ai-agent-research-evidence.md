# AI Agent System — Research Evidence Registry

Every entry below supported a real, named implementation decision in this codebase. Categorized per the task's own required split. `CODEBASE FACT` items are cross-references to the audit, not external sources.

---

## AI ENGINEERING RESEARCH

### 1. Multi-agent vs. single-agent architecture
- **Source**: "When to use multi-agent systems (and when not to)" — Claude/Anthropic engineering blog.
- **URL**: https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them
- **Year**: 2025
- **Finding used**: Multi-agent systems earned a 90.2% improvement over single-agent Claude specifically on breadth-first, independent-exploration research tasks, at ~10-15x the token cost; guidance is to reserve multi-agent architectures for tasks where that specific constraint (parallel independent exploration) is the bottleneck.
- **Decision supported**: Rejecting the literal "two autonomous LLM agents" proposal in favor of Option C (deterministic orchestrator + one bounded LLM narration step) — Gymini's PT-matching/automation problem is not a breadth-first research task, so the multi-agent cost premium isn't justified. See feasibility audit §9, §16.
- **Strength/limitation**: Directly on-point for the architecture decision; not fitness-domain-specific.

### 2. Agentic RAG patterns
- **Source**: "Agentic Retrieval-Augmented Generation: A Survey on Agentic RAG"
- **URL**: https://arxiv.org/abs/2501.09136
- **Year**: 2025
- **Finding used**: Agentic RAG (LLM-driven retrieval decisions) earns its complexity specifically for compound/multi-hop questions; static pipelines remain appropriate otherwise.
- **Decision supported**: Not upgrading Gymini's existing rule-based query-expansion retrieval to an agentic/LLM-driven retrieval loop (feasibility audit §6).
- **Strength/limitation**: Survey-level, not a controlled comparison against Gymini's specific corpus.

### 3. RAG chunking strategy
- **Sources**: "Best Chunking Strategies for RAG (and LLMs) in 2026" (Firecrawl); "The Ultimate Guide to Chunking Strategies for RAG Applications" (Databricks Community)
- **URLs**: https://www.firecrawl.dev/blog/best-chunking-strategies-rag , https://community.databricks.com/t5/technical-blog/the-ultimate-guide-to-chunking-strategies-for-rag-applications/ba-p/113089
- **Year**: 2025/2026
- **Finding used**: Recursive chunking (~400-512 tokens, 10-20% overlap) reaches 85-90% recall in Chroma's own published benchmark; semantic chunking only gains 2-3 points at materially higher embedding/compute cost.
- **Decision supported**: Keeping Gymini's existing 1200-char/160-overlap/sentence-snap chunker (already close to the recursive-chunking default) rather than migrating to semantic chunking. Feasibility audit §6.
- **Strength/limitation**: Numbers are from Chroma's own benchmark, not independently re-verified against Gymini's fitness-evidence corpus.

### 4. Human-in-the-loop / idempotency for agent actions
- **Sources**: "How to Build Human-in-the-Loop Oversight for AI Agents" (Galileo); "Idempotency for Agents: The Production-Safe Pattern You're Missing" (Medium/Data Science Collective)
- **URLs**: https://galileo.ai/blog/human-in-the-loop-agent-oversight , https://medium.com/data-science-collective/idempotency-for-agents-the-production-safe-pattern-youre-missing-a94ef0db20a9
- **Year**: 2025/2026
- **Finding used**: Synchronous approval for financial/irreversible actions; propose-then-commit with idempotency keys + precondition re-validation at commit time is the production-safe pattern — "if you gate approval after the side effect occurs, it's not approval, it's incident documentation."
- **Decision supported**: Confirmed (not changed — this was already implemented correctly) that Gymini's `createPTContractDraft`/`confirmPTContract` flow already matches this pattern (deterministic draft id, advisory lock, eligibility re-check at confirm time, payment gated behind a webhook, never AI-asserted). Feasibility audit §2.3, §14.
- **Strength/limitation**: General pattern literature, not fitness/coaching-specific.

### 5. Agent framework vs. custom orchestration
- **Source**: "The best AI agent frameworks in 2026" (LangChain); "Choosing an agent framework" (Speakeasy)
- **URLs**: https://www.langchain.com/resources/ai-agent-frameworks , https://www.speakeasy.com/blog/ai-agent-framework-comparison
- **Year**: 2026
- **Finding used**: ~28% of production multi-agent deployments in 2026 use custom orchestration; frameworks are most justified when a team needs explicit state/branching/checkpoints beyond what custom code comfortably provides.
- **Decision supported**: Not migrating to LangGraph or any agent framework — Gymini's custom TypeScript orchestrator already implements the needed guarantees (timeouts, fallback cascades, idempotent actions). Feasibility audit §9.

### 6. LLM tool-calling / function-calling accuracy
- **Source**: "LLM Function Calling and Tool Use Explained" (ml4devs)
- **URL**: https://www.ml4devs.com/what-is/llm-function-calling-and-tools/
- **Year**: 2025
- **Finding used**: Tool-selection accuracy degrades as the tool catalog grows/overlaps; production guidance is to combine LLM reasoning with deterministic tools for the actual computation rather than trusting the LLM to compute/rank.
- **Decision supported**: Keeping PT ranking (`scorePT`) fully deterministic; the new Recommendation Narrator explains rather than computes. Feasibility audit §8, §29 (this implementation's explicit "no fabricated percentages" validator).

### 7. Cold-start fairness in recommender systems
- **Source**: "Fairness among New Items in Cold Start Recommender Systems" (Zhu et al., SIGIR)
- **URL**: https://people.engr.tamu.edu/caverlee/pubs/Ziwei_SIGIR_2021.pdf
- **Year**: 2021 (SIGIR)
- **Finding used**: A new item/candidate with no interaction history should not be penalized as if that absence were negative signal — fairness for cold-start candidates requires treating "no data" differently from "bad data."
- **Decision supported**: The `scorePT` cold-start fix implemented in this session — dropping the `evidence` dimension from both numerator and denominator (not defaulting it to 0) when a PT's cohort is below `minimumCohort`. This is a real bug found and fixed during this implementation, verified by `fitness-agent-scoring.test.ts` and the live synthetic-data integration test. See `docs/pt-recommendation-methodology.md` §3.
- **Strength/limitation**: The cited paper addresses collaborative-filtering-style new-item fairness generally; Gymini's fix is a simpler weighted-formula analog of the same principle, not an implementation of the paper's specific algorithm.

---

## FITNESS SCIENCE

### 8. Extreme calorie restriction / RED-S guidance (pre-existing, re-confirmed, not newly researched this session)
- **Reference**: Already cited in the existing `llm/safety_guard.ts` implementation (IOC RED-S, ACSM guidance) — this implementation did not touch nutrition-safety logic, so no new fitness-science research was required for the scope actually built (PT recommendation, ClientJourney derivation, RAG consolidation, HITL UI). Flagged here explicitly per the task's "state what was NOT researched" instruction rather than fabricating new fitness-science citations for work that didn't touch that domain.

### 9. Outcome-metric interpretation for ClientJourney (methodology decision, not a new external citation)
No new peer-reviewed source was sought for `deriveGoalAchievement`'s specific body-composition-direction thresholds (the noise-floor/direction logic in `client-journey-derivation.service.ts`) — this is a conservative, clearly-labeled heuristic (`IMPROVED`/`NO_CHANGE`/`REGRESSED`/`UNKNOWN`), not a claim requiring a specific study. Documented as a **limitation, not a citation** — see `docs/adr-client-journey-attribution.md`'s "Causal-claim boundary" section.

---

## RECOMMENDER-SYSTEM RESEARCH

### 10. Case-based reasoning for personalized recommendation
- **Source**: "Case-based recommender systems" (Smyth), and hybrid CBR+CF approaches
- **URL**: https://www.researchgate.net/publication/225070235_Case-based_recommender_systems
- **Year**: (survey, widely cited foundational work)
- **Finding used**: CBR recommenders retrieve similar prior cases, score similarity, and adapt — structurally identical to `journeySimilarity`/`summarizeJourneys`. Hybrid CBR+CF approaches specifically address cold-start/sparsity, relevant once `ClientJourney` has enough real data.
- **Decision supported**: Confirming (not changing) that Gymini's existing similarity engine is methodologically sound for this data scale — recommending against introducing a learned ranking model. `docs/pt-recommendation-methodology.md` §1.

---

## SAFETY / RESPONSIBLE AI RESEARCH

### 11. Vision-LLM limitations for body/medical image interpretation
- **Source**: "Limitations in Chest X-Ray Interpretation by Vision-Capable Large Language Models" (PMC)
- **URL**: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12897257/
- **Year**: 2025
- **Finding used**: Vision-LLMs show real, measured accuracy gaps in small-detail detection and domain-specific reasoning for body/medical imagery.
- **Decision supported**: Confirms (does not change) that Gymini's existing `fitness-goal-vision.service.ts` design — qualitative categorical attributes only, explicit prohibition on inferring body-fat %/medical conditions — is correctly conservative, not under-scoped. Feasibility audit §10.

### 12. Synthetic-data disclosure / labeling norms
- **Sources**: EU AI Act synthetic-content labeling requirements; California AB 2013 training-data transparency law (summarized via GDPR Local / TrustArc / Pandectes AI-compliance overviews)
- **URLs**: https://gdprlocal.com/ai-transparency-requirements/ , https://pandectes.io/blog/labeling-ai-generated-content-what-the-new-rules-require/
- **Year**: 2025/2026 (regulatory)
- **Finding used**: Emerging regulatory consensus requires synthetic data/content to be clearly, machine-and-human-readably labeled as such, not silently mixed with real data.
- **Decision supported**: Every synthetic row this implementation writes carries `dataOrigin: "SYNTHETIC"` and `verificationStatus: "SYNTHETIC"`; `summarizeJourneys`'s own output text explicitly states "Demo synthetic dataset; not evidence of real coaching effectiveness" whenever `dataOrigin === "SYNTHETIC"`. This was already the existing codebase's design (this implementation didn't invent it), and this research confirms it aligns with where disclosure norms are heading, not just internal project convention.

---

## Research explicitly NOT completed for this implementation pass

- No new research was done on nutrition/calorie safety science (not touched this pass — see item 8).
- No research was done on workout-program-specific scoring weights, since `findTrainingPrograms` scoring was deliberately deferred (see `docs/pt-recommendation-methodology.md` §7) rather than built with invented weights.
- No formal statistical validation (e.g., calibration study) of the synthetic dataset's outcome-magnitude ranges was performed — explicitly flagged as unvalidated assumptions in `docs/synthetic-agentic-dataset-methodology.md`.
