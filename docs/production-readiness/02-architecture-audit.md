# 02 — Architecture Audit

## Verdict

The service decomposition matches the stated principles in the places sampled, but the boundaries are enforced mostly by convention
and by the gateway. Three structural points need decisions before production:

1. **Two deployment models coexist** (EC2 compose with RDS, and Lambda handlers in ai-service and auth-service) with no recorded decision (G-12).
2. **Identity is re-derived per hop.** The gateway verifies the token through auth-service, sets `x-user-id`, and downstream services trust
   the header or re-verify (G-16).
3. **Internal APIs share one static secret** and some are reachable through the public proxy (G-09).

## Principle check

| Principle (from the audit brief) | Evidence | Status |
|---|---|---|
| Owning services are the source of truth | Separate Prisma schemas per service; `UserProfile`, `NutritionGoal`, `WorkoutProgram`, `CycleAssessment` owned in their services (CLAUDE.md table) | VERIFIED_OK (schema ownership) |
| Enterprise Data Agent answers "what is true" | Read path in `fitness-agent-tools.ts` and `global-turn.ts` `readState()` reads authoritative data before answering | PARTIAL (sampled, not traced end to end) |
| Recommendation agent answers "what to recommend" | `recommenders.ts`, recommendation workflows | PARTIAL |
| Conversational Intelligence has no business authority | Writes only through `fitness-agent.service.ts` confirmation path; no Prisma writes in `conversational-intelligence/` (grep) | VERIFIED_OK (code) |
| LLM output never authorises a DB mutation | No Prisma writes in `llm/` or `conversational-intelligence/`; confirmation requires the `/actions/:id/confirm` endpoint or a profile-workflow step | VERIFIED_OK (code); runtime fuzzing NOT_VERIFIED |
| Mutations pass auth, ownership, validation, confirmation, idempotency | Confirm path: owner-scoped conditional update (`fitness-agent.service.ts` ~777–826). Workout import idempotent via `@@unique([userId, sourcePlanId])` and `agentActionId @unique` | PARTIAL (not every mutation route traced; see G-24) |
| Vector DB is not business truth | Qdrant used for knowledge retrieval (`vector-store/`, `knowledge/`); business facts read from services | VERIFIED_OK (code, sampled) |
| Candidate conversational state not authoritative | `AgentWorkflowSession.slotsJson` documented as never authoritative (schema comment) | VERIFIED_OK (schema comment; code path sampled) |
| READ operations automatic where authorised | Read tools call authorised endpoints with the user's identity | PARTIAL |

## Service boundaries

- **Gateway** is the only public entry point in the compose topology (only `web:80` is published; web nginx proxies to gateway).
  It owns rate limiting, CORS, helmet, Socket.IO handshake auth, and per-route role checks for admin areas.
- **Auth-service** owns identity. Its `/auth/verify` is the token oracle for every service (G-16).
- **Fitness-service** is the largest domain (43 relations in its Prisma schema). It hosts workouts, cycles, nutrition, roadmaps and PT actions.
- **AI-service** hosts conversational routing, LLM clients, RAG, marketplace and agent workflows. It calls fitness and user services over
  internal HTTP with the shared secret.
- **Payment and gym** are separate schemas with provider integrations and webhooks.

## Coupling and failure propagation

- Every authenticated request depends on auth-service availability (G-16).
- AI turns depend on the LLM endpoint, with a 170-second server timeout (G-18), and optionally on Qdrant and Redis (G-19).
- Fitness exercise reads depend on Redis when enabled (G-19).

## Architectural debt noted (not blocking by itself)

- Duplicate verification: gateway verifies, then ai, chat and fitness call `/auth/verify` again through their own clients.
- Two lambda runtime shims (`config/lambda-runtime.ts` in ai and auth) with different validation rules (see G-01).
- Soft cross-service references (G-28).
- Prisma schema does not express some partial unique indexes (G-27).

## Recommendations (architecture, not features)

1. Record the deployment decision before any hardening work (G-12).
2. Verify identity once, at the gateway, with local signature verification and a status cache; downstream services trust gateway headers
   only over a private network (P1-T09).
3. Replace the shared internal secret with per-service identity (P1-T04, P1-T05).
4. Keep the Conversational Intelligence boundary as it is: deterministic routing, typed LLM fallback, confirmation before any write.
