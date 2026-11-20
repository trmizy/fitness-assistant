# 06 — AI Capability & Integration Audit

Maps every discovered AI capability to real domain services and source-of-truth data, per task §9/§10. Evidence drawn primarily from this audit's own Phase 1 ai-service structural agent (full call-chain trace) and `docs/production-readiness/` (independent prior audit, same conclusions reached from a different angle — cross-checked, no contradictions).

## 1. The map: USER REQUEST → UNDERSTANDING → CONTEXT → BUSINESS DATA → MODEL → VALIDATION → PROPOSAL → CONFIRMATION → PERSISTENCE

For the core chat surface (`POST /ai/ask`), every stage of this chain has a real, named, file-level implementation — this is not a thin wrapper around a raw LLM call:

| Stage | Component | File |
|---|---|---|
| Entry | Route + auth + rate limit + Zod validation | `src/routes/ai.routes.ts` |
| Understanding | Safety guard (deterministic) → fitness-agent intent parse → deterministic intent router | `src/llm/safety_guard.ts`, `src/services/fitness-agent-intent.ts`, `src/llm/intent_router.ts` |
| Context | Parallel fetch: profile/InBody/workout/nutrition history + chat history + memories + demand-driven `enterprise-data/*.reader.ts` | `src/llm/profile_extractor.ts`, `src/services/context-assembler.ts`, `src/repositories/conversation.repository.ts` |
| Business data | `fitness-agent-tools.ts` — all reads/writes go to user-service/fitness-service over HTTP/Lambda, never direct DB access from ai-service | `src/services/fitness-agent-tools.ts` |
| Model | Provider switch: ollama (default)/anthropic/bedrock/mock | `src/services/llm.service.ts` |
| Validation | Per-capability Zod schemas (11 distinct schemas, see §2) + `answer_validator.ts` + domain-specific validators (`proposed-change-validator.ts`, `meal-plan-validator.ts`) | `src/schemas/*.ts`, `src/llm/answer_validator.ts` |
| Proposal | `FitnessRecommendation` / `FitnessAgentAction` / `AgentWorkflowSession` — all Postgres, all explicitly documented as non-authoritative | `prisma/schema.prisma` |
| Confirmation | Explicit confirm/dismiss endpoints, owner-scoped conditional update | `src/routes/fitness-agent.routes.ts`, `src/services/confirmation-boundary.ts` |
| Persistence | Only the **real owning service's own endpoint** persists (e.g. fitness-service's `/fitness-roadmaps/ai-draft/accept`) — ai-service itself never writes the authoritative business tables | confirmed by Phase 1 agent: zero `WorkoutProgram`/`FitnessRoadmap` writes anywhere in ai-service |

**This is a genuinely strong, verifiable architectural finding**: the proposed-vs-persisted boundary that CLAUDE.md states as policy ("AI is not authoritative") is real in code, independently confirmed twice now — once by this audit's Phase 1 structural agent, once by the PT-copilot agent's direct trace of `generatePlanDraft` (never persists), and a third time by the independent `docs/production-readiness/02-architecture-audit.md` ("LLM output never authorises a DB mutation ... VERIFIED_OK (code)").

## 2. Capability-by-capability AI inventory

| Capability | Model/provider path | Validation | Governance state |
|---|---|---|---|
| Core chat (general Q&A, RAG-grounded) | ollama/anthropic/bedrock via `llm.service.ts` | `answer_validator.ts` (post-hoc) | **Active in production** but see BDG-01 — "LLM off" flags don't fully gate this |
| AI workout plan generation | same providers | `plan.schemas.ts` (full Zod shape) + `validatePlanEquipment` (deterministic, fitness-service) | Active; grounding restricted to `fitness_evidence` Qdrant collection only for plan generation (deliberate, code-enforced) |
| AI nutrition plan generation | same | `nutrition-plan.schemas.ts` | Active; one real invariant-violation bug fixed historically (`nutrition-generation-invariant-remediation.md`) |
| AI roadmap draft | same | `roadmap-draft.schemas.ts` | Active; draft-only, accept happens in fitness-service |
| PT-facing client plan draft | same | `client-plan-draft.schemas.ts` | Active; confirmed draft-only by direct trace (§08 audit) |
| Cycle-completion analysis + next-cycle draft | same | `cycle-analysis.schemas.ts` | Active |
| CycleAssessment explanation | same | `cycle-assessment.schemas.ts` — **schema deliberately has no decision field**, so AI explanation can never override the deterministic `CycleAssessment.decision` | Active; a real, code-enforced authority boundary, not just a convention |
| Session-feedback interpretation | same | `feedback-analysis.schemas.ts` | Active |
| Exercise-progression explanation | same | `exercise-progression-explanation.schemas.ts` — same no-decision-field pattern | Active |
| Marketplace plan moderation/improvement-suggestion AI assist | same | `plan-moderation-analysis.schemas.ts`, `plan-improvement.schemas.ts` | Active |
| AI image analysis (goal photo, InBody scan, chat image) | `fitness-goal-vision.service.ts`, local vision model per `INBODY_LOCAL_VISION_MIGRATION.md` | `GoalImageSchema` | Active |
| True LLM tool-calling | `llm/tools.ts` | n/a | **OFF by default** (`ENABLE_TOOL_CALLING`), confirmed in code AND prod compose |
| Conversational Intelligence V2 | `conversational-intelligence/*` | n/a | **OFF by default**, confirmed in code AND prod compose; does NOT gate all LLM calls even when off (BDG-01) |
| Unified AI Coach (bounded multi-intent) | `services/bounded-turn/` | n/a | **OFF/shadow**; most recent work (Oct 5-11) concludes shadow-only readiness, by the team's own assessment |
| ML-based safety/routing classifier | `query-classifiers/` | n/a | Trained but **not deployed** — model artifacts directory empty in this checkout, falls back to regex |
| RAG/knowledge grounding | `knowledge-pipeline/` (authoritative) vs `knowledge/` (self-documented deprecated) | quality scorer + optional LLM safety judge | Active (authoritative pipeline); deprecated pipeline has unported real sources (BDG-10) |

## 3. Provider/runtime contract (task §10)

- **Chat model**: `LLM_PROVIDER` env var — `ollama` (local Qwen3-4B, default), `anthropic` (Claude), `bedrock` (Nova Pro + Cohere embeddings via `bedrock.client.ts`), `mock` (tests). Production-readiness's independent `01-system-inventory.md` lists Ollama with `qwen3:4b-instruct-2507-q4_K_M` as the runtime dependency actually observed, and notes Bedrock/Anthropic code paths exist but "their production status was not verified" by that audit — consistent with this audit's finding that `bedrock.client.ts`/`bedrock-credentials.ts` are **currently mid-edit by a different concurrent session**, fixing a real documented production blocker ("this Lambda's AWS account has an account-level Bedrock block"). **This area of the codebase is actively in flux right now; neither audit should be read as a final verdict on Bedrock's production readiness.**
- **Embeddings**: independent of chat provider, `EMBEDDING_PROVIDER` (`bedrock`/`ollama`/`mock`), with a dimension-mismatch guard (`qdrant-collection.ts`) to prevent silent corruption if the provider changes (Bedrock Cohere = 1024-dim, Ollama nomic-embed-text = 768-dim).
- **Timeout**: `LLM_TIMEOUT_MS` — orchestrator code defaults to 60s, but **production/verification compose sets 170s** (two different variables involved, per production-readiness G-18) — users can wait nearly 3 minutes for a degraded fallback message. This is a real AI-UX gap this audit independently confirms via the same evidence the prior audit used (`LIVE_LOCAL` observation of 171.6s/172.7s turns).
- **Observability**: `/metrics` (prom-client) exists per service but is unauthenticated and not wired into any deployed monitoring stack (shared finding with G-14/G-34).
- **Feature flags**: see table in §2 — the dominant theme across this entire domain is that **most of the richly-implemented "advanced" AI capability layers are flagged off by default**, a finding independently reached by this audit's Phase 1 agent, the production-readiness audit, and the repo's own `ai-product/phase3-*` chain (which concludes `UNIFIED_AI_READY_FOR_SHADOW_ONLY` by the team's own assessment, dated more recently than any of the "VERIFIED" claims in the Sept conversational-intelligence chain).

## 4. Deterministic grounding guarantees (the good news this audit should state plainly)

Three separate, independently-confirmed mechanisms prevent the LLM from inventing business facts or bypassing business authority:

1. **Exercise/catalog grounding**: plan-generation RAG retrieval is hard-restricted to the `fitness_evidence` Qdrant collection only — exercise selection must resolve against fitness-service's real `Exercise.id` catalog, never against the `exercises` knowledge-base collection (code comment explicitly states this).
2. **Decision-authority grounding**: `cycle-assessment.schemas.ts` and `exercise-progression-explanation.schemas.ts` are schema-shaped with no decision/target field at all — it is structurally impossible for these AI outputs to override the deterministic adaptive-training-cycle decision or progression target, not just a convention the prompt asks the model to follow.
3. **Persistence grounding**: no Prisma write to a business-authoritative table exists anywhere in ai-service's `llm/` or `conversational-intelligence/` modules (confirmed by this audit's Phase 1 agent AND independently by the production-readiness audit's own grep-based check) — every real business write happens only through the owning service's own endpoint, after an explicit confirmation step.

## 5. Open items carried to later deliverables

- Case A–G (workout-frequency mismatch, session-move-as-replacement, constraint loss, etc.) — pending the conversational-state agent (resumed after a rate-limit interruption; see `AUDIT_PROGRESS.md`). Will be folded into `07-conversational-state-and-revision-audit.md`.
- Health/safety routing detail — covered structurally here (§2 ML-classifier row) but the dedicated `09-health-safety-and-constraint-audit.md` will go deeper on signal classes and cross-turn persistence (Case C/D overlap).
