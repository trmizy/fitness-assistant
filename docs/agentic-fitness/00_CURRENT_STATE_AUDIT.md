# Current state audit — 2026-09-07

Source inspection performed before implementation, on `aws-deploy` after the
payment-gateways fast-forward. Existing uncommitted Nutrition and documentation
changes are part of the baseline and must be preserved. This audit covers the
domain schemas, active routes, service write paths, retrieval and chat consumers;
it does not claim every line of the repository has been independently reviewed.

| Domain | Status | Source evidence and reuse decision |
| --- | --- | --- |
| User context | EXISTS / REUSE | `user-service/prisma/schema.prisma:UserProfile`, `InBodyEntry`; `ai-service/src/llm/profile_extractor.ts:PersonalizationContext` and `coach/coach_context_builder.ts`. Extend their projection; do not duplicate profiles or measurements. |
| Goal | PARTIAL | Profile owns primary goal, target/starting/current weight, preferences and screening. No user-confirmed reference-image attributes or dedicated goal-source/version contract. |
| Training | EXISTS / REUSE | Fitness schema: Exercise, normalized Equipment/UserEquipment, WorkoutProgram/Day/Exercise, set prescriptions, exercise groups, cycles and assessments. `workout.service.ts:createManualProgram` writes program and schedules transactionally. Template imports already reuse it. |
| Progression | EXISTS / REUSE | `exercise-progression.engine.ts`, `cycle-decision.engine.ts`, RPE/RIR, advanced-set and group models. Do not prescribe from LLM memory or equate advanced experience with drop sets. |
| Nutrition | EXISTS / REUSE | Versioned goals, bootstrap/screening, canonical consumption totals, adaptive decisions and InBody reassessment are present. `profile_extractor.ts` already retrieves daily consumption. Preserve these safety decisions. |
| PT professional data | PARTIAL / REUSE | UserProfile + approved PTApplication include experience, specialties, education, philosophy, pricing, service mode and certificates. Extend PTApplicationCertificate rather than creating a second certificate domain. Languages and explicit certificate verification/provenance are gaps. |
| PT eligibility | EXISTS / REUSE | `profile.repository.ts`, PTServicePackage, PTTrainingLocation, suspension/accepting-client flags, availability service with exceptions and booked sessions. Use bounded DB filtering and existing slot arithmetic. |
| Reputation/history | PARTIAL | SessionReview, contracts and sessions exist; cross-client normalized journey/outcome retrieval and provenance-aware similarity do not. Rating alone is insufficient. |
| Contracts/payment | EXISTS / REUSE | `contract.service.ts:requestContract` validates package, PT, availability, collaboration and existing relationship, snapshots price and creates PENDING_REVIEW. PT acceptance/signing/payment remain mandatory. Chat must not bypass this with direct contract insertion. |
| Gym | EXISTS / REUSE | GymBrand/Gym, approved/operational status, PT affiliation/collaboration and location models. No parallel gym/branch model is needed. |
| AI | PARTIAL / NEEDS_REFACTOR | `llm/tools.ts` supports exercise retrieval, own fitness data and memories, bounded to two calls. `orchestrator.service.ts` and `recommendation_engine.ts` already separate rules from explanations; no typed PT matching/action tools or persisted structured recommendation/action blocks. |
| Providers/vision | PARTIAL | `llm.service.ts` supports Ollama and Anthropic; InBody has a separate vision extraction flow. No Bedrock implementation found in this audit. Reference-goal analysis is a distinct flow and must not reuse measurement estimates. |
| Evidence | EXISTS / REUSE | Curated `data/processed/evidence`, Qdrant retrieval, `local-evidence.ts`, `plan_evidence.ts:evidenceUsedFromDocs`. General training/nutrition evidence already exists; no new competing registry. |
| Audit | PARTIAL / REUSE | Fitness RecommendationAudit and AI Conversation/ChatSession persist decisions/turns. Need durable candidate/context/scoring snapshots and action outcomes attached to the existing chat session. |
| Chat UI | PARTIAL | `AICoachPage.tsx`, `pendingAiTasks` store and `/ai/ask/stream` show text and citations; need image goal confirmation, candidate cards, plan/contract confirmations, persistence and recovery. |
| Business UI | EXISTS / REUSE | BookingPage, PTDiscoveryPage, PT profiles, contract and payment screens. Keep these as canonical detail/payment destinations. |
| Demo data | MISSING | No provenance-aware, idempotent dataset covering thousands of linked journeys and measurable outcomes for this agent use case. Seed must refuse production and never impersonate verified real outcomes. |

## Implementation boundaries

One fitness orchestrator with typed tools, authenticated user identity supplied
by middleware, bounded retrieval and deterministic compatibility/similarity.
Public explanations contain aggregates, never historical client identifiers or
measurements. Missing evidence remains missing. New action identity must survive
retries and concurrent confirmations at the domain write boundary, including
revalidation when availability or price changes after a preview.

## Verification baseline

Continuation audit: the working tree already contains `ClientJourney`,
`AgentContractDraft`, shared scoring schemas, and the user/fitness agent domain
services. These are PARTIAL implementations, not missing models to recreate.
Their routers were not mounted at audit time. AI orchestration, multimodal
input, persisted UI blocks, seed data and integration coverage remain gaps.
The continuation extends this work and preserves pre-existing changes.

The preceding merge ran 39 payment/contract tests, four backend typechecks and
a frontend build successfully. These are baseline results, not verification of
the new agent work. Real DB/API/browser coverage is required for the new flows.
