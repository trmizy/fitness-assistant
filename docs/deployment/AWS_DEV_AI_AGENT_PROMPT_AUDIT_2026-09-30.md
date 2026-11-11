# AWS DEV AI Agent / Prompt / Structured Output Audit — 2026-09-30

Scope: current source of `backend/services/ai-service` and frontend AI calls.  
Mode: source-backed audit + local mock tests. No live paid provider call.

## Mounted AI capabilities

Contrary to an older report, `session.routes.ts` and `memory.routes.ts` are mounted in current source:

```text
src/routes/ai.routes.ts
  router.use(requireAuth)
  router.use("/agent", fitnessAgentRoutes)
  router.use("/sessions", sessionRoutes)
  router.use("/memories", memoryRoutes)
```

Therefore sessions/memories are not dead code in the current branch.

| Capability | Entrypoint | Tools/context | Provider | Output validation | Persistence | Mounted/reachable |
|---|---|---|---|---|---|---|
| Chat/RAG coach | `POST /ai/ask`, `/ai/ask/stream` | profile/context, retriever/vector store, memories, history | `llm.service` provider | answer validators/guards; not a strict single JSON schema for natural text | conversations, sessions, memories | Yes |
| Fitness agent actions | `/ai/agent/*` | profile, InBody, workout/nutrition history, agent actions | service logic + LLM/vision for image | Zod/body validation + tool/action constraints | `fitnessAgentAction`, recommendations | Yes |
| Goal image / image chat | `/ai/agent/goal-image`, `/ai/agent/image-chat` | uploaded base64 image, optional session context | Bedrock/vision path | schemas + magic-byte validation + provider result parsing | structured blocks/conversation | Yes |
| Workout plan generation | `POST /plans/workout/generate` -> SQS/BullMQ worker | Fitness catalog, allowed exercise candidates, user context | LLM via worker | Zod parse + workout invariant validator + semantic candidate validation | `workout_plans` | Yes |
| Nutrition plan generation | `POST /plans/nutrition/generate` -> SQS/BullMQ worker | food list, nutrition target fields, exclusions | LLM via worker | Zod parse + nutrition invariants + repair | `nutrition_plans` | Yes |
| Cycle explanation | `/ai/analyze-cycle`, `/ai/assess-cycle`, `/ai/analyze-feedback` | deterministic cycle/feedback summaries from fitness-service | LLM explanation | Zod/custom schemas, deterministic decision remains upstream | conversation/response only | Yes |
| PT client draft | `/ai/generate-client-plan-draft` | PT/client profile + allowed exercises | LLM | Zod output + allowed exercise filtering | draft only | Yes |
| Roadmap draft | `/ai/generate-roadmap-draft` | roadmap diagnosis, goal/image attributes | LLM | Zod schema + fallback | draft only | Yes |
| Marketplace moderation/improvement | `/marketplace/*`, `/admin/ai/marketplace/*` | plan metadata/reviews/rules | deterministic + optional LLM report | schema + admin review | marketplace tables | Yes |
| Knowledge pipeline jobs | `jobs-lambda` | local/PubMed/RSS/web sources, vector store | embeddings + optional LLM safety judge | source trust/review queue | knowledge tables/vector index | Not public; scheduled |

## Prompt and context audit

### Workout plan prompt

Source: `src/schemas/plan.schemas.ts`.

Important positive controls:

- Requires raw JSON only.
- Explicitly says to use only allowed exercise IDs.
- Includes allowed exercise catalog/candidates.
- Runtime parser extracts/repairs JSON.
- `PlanContentSchema.safeParse()` validates structure.
- Worker performs final invariant validation against allowed exercise IDs and day candidates.

Status: code-enforced for exercise ID existence/candidate matching; not prompt-only.

### Nutrition plan prompt

Source: `src/schemas/nutrition-plan.schemas.ts`, `src/services/nutrition.processor.ts`.

Positive controls:

- Requires JSON object only.
- Uses DB food IDs and a bounded allowed food list.
- Parses via `safeParseJsonCandidate`.
- `NutritionPlanContentSchema.safeParse()` validates structure.
- `validateNutritionPlanInvariants()` and serving repair run after parse.
- `excludedFoodKeys` are enforced by filtering/checking, not only prompt text.

Status: code-enforced for major shape and exclusion constraints.

### PT client plan draft

Source: `src/services/client-plan-draft.service.ts`, schemas under `client-plan-draft`.

Positive controls observed in tests:

- Empty allowed exercise list rejected.
- Injury filtering can leave no safe exercise and returns an honest empty draft.
- Invented exercise IDs are dropped.
- Missing cycle-feedback data gap is forced even if LLM omits it.

Status: code-enforced.

### Cycle/feedback/progression

Source: `cycle-assessment.service.ts`, `feedback-analysis.service.ts`, `exercise-progression-explanation.*`.

Important boundary:

- AI explains an already-computed decision.
- Schemas/comments explicitly prevent AI from overriding deterministic decision state.

Status: mostly code-enforced, low transaction risk.

### Vision prompts

Source: `fitness-goal-vision.service.ts`, `fitness-vision-chat.service.ts`.

Positive controls:

- Base64 JSON, no multipart.
- Magic-byte check for JPEG/PNG.
- Raw image size capped.
- Prompt says to ignore text/instructions inside image.
- No body-fat/medical diagnosis.

Status: validation exists before provider call.

## Structured output validation status

Local selected mock/unit run:

```text
pnpm --filter @gym-coach/ai-service build
Result: PASS

Selected mock/unit test run:
296 tests, 296 pass, 0 fail
```

The selected tests covered:

- Bedrock serialization and timeout/error wrapping with mocked transport.
- Cohere embedding shape/dimension guards.
- OpenSearch vector-store mapping/search/upsert error behavior.
- Workout invariant validation.
- Nutrition macro/TDEE/safety guard tests.
- Client plan draft allowed-exercise filtering.
- Tool validation and bounded tool-calling.
- Rate-limit middleware behavior.

Additional mixed run:

```text
221 tests, 211 pass, 10 fail
```

All 10 failures were local environment failures due missing `DATABASE_URL` in “real DB” agent workflow tests, not assertion failures in business logic.

## Prompt injection / data isolation

Source-level controls:

- `requireAuth` accepts either trusted internal token + gateway headers or verified Bearer JWT through Auth Lambda/client.
- User context comes from `req.context.userId`, not raw frontend `x-user-id`.
- `fitnessAgentAction.findFirstOrThrow({ where: { id, userId: req.context.userId } })` protects agent action ownership.
- Tool list exposed to the model includes only read-oriented tools; `remember_user_fact` exists but is not model-selectable in `AVAILABLE_TOOLS`.
- Tool validators reject unknown tools and invalid args.
- Service-to-service clients carry internal token and user ID.

Local unit tests passed for:

- unknown tool rejection;
- invalid tool args;
- tool-call count bound;
- direct auth/gateway-token cases;
- safety triage phrases.

Limitations:

- Full adversarial E2E with real DB was not run because isolated test DB was not available in this audit.
- User-provided text and some DB text are still injected into prompts; sanitization/validation mitigates but does not make prompt injection impossible.

## Frontend AI contract map

| UI feature | Frontend client call | Backend endpoint | Status |
|---|---|---|---|
| AI plans list | `planService.getCurrentPlans()` | `GET /plans/current` | Route exists; live unauth returns 401; authenticated was previously reported PASS |
| Nutrition AI plans | `planService.getCurrentNutritionPlans()` | `GET /plans/nutrition/current` | Route exists |
| Workout generation | `planService.generateWorkoutPlan()` | `POST /plans/workout/generate` | Route exists; queues SQS/BullMQ |
| Nutrition generation | `planService.generateNutritionPlan()` | `POST /plans/nutrition/generate` | Route exists |
| Plan job polling | `planService.getPlanJobStatus()` | `GET /plans/job/:jobId` | Route exists |
| Goal image | `fitnessAgentService.image()` | `POST /ai/agent/goal-image` | Route exists |
| Image chat | `fitnessAgentService.imageChat()` | `POST /ai/agent/image-chat` | Route exists |
| Agent confirm/choose/dismiss | `fitnessAgentService.*` | `/ai/agent/...` | Routes exist |
| Roadmap AI draft | `fitnessRoadmapService.generateAiDraft()` | `POST /fitness-roadmaps/ai-draft` | Fitness-service route dependency; earlier AWS audit found missing API Gateway route for `/fitness-roadmaps` |
| Marketplace suggestions | `marketplaceService.generateImprovementSuggestions()` | `POST /marketplace/plans/:id/improvement-suggestions` | Route exists; calls LLM, not live-tested |
| Admin AI dashboard | `adminAiService.getOverview/getQueue/getErrors` | `/admin/ai/*` | `errors` passes; `overview/queue` timeout due BullMQ Redis dependency |

Frontend/network issue:

- API Gateway CORS currently allows only S3 website origin.
- `OPTIONS /plans/current` and `OPTIONS /ai/ask` return 401 through Lambda/auth, no CORS header.
- CloudFront or any non-allowlisted origin will see Axios `Network Error`.

## Dead/unmounted AI code

Current source:

- `session.routes.ts`: mounted.
- `memory.routes.ts`: mounted.
- `jobs-lambda.ts`: not public, scheduled by EventBridge Scheduler.
- `knowledge-pipeline/queue.ts` BullMQ repeatable jobs: effectively legacy/container path for AWS; EventBridge jobs-lambda is the AWS path.
- `ai.worker.ts` BullMQ `new Worker` top-level: should be container-only, but is currently imported by Lambda worker and therefore not cleanly isolated.

## Provider/cost risk

Provider configuration observed in AWS:

- `LLM_PROVIDER=bedrock`
- `BEDROCK_CHAT_MODEL=apac.amazon.nova-pro-v1:0`
- `EMBEDDING_PROVIDER=bedrock`
- `BEDROCK_EMBEDDING_MODEL=cohere.embed-multilingual-v3`
- `VECTOR_STORE_PROVIDER=opensearch`

Cost controls present:

- HTTP Lambda timeout 30s.
- `LLM_TIMEOUT_MS=25000` for HTTP, `180000` for worker.
- SQS `maxReceiveCount=2`.
- Worker batch size 1.
- Some LLM JSON calls retry 2–3 times then deterministic fallback.

Cost risks:

- `RATE_LIMIT_PROVIDER` unset, so Lambda uses in-memory limiter, not distributed DynamoDB.
- AI HTTP role has no DynamoDB rate-limit permission.
- Queue retry × provider retry can multiply paid calls in worker. Worst-case logical worker request can be processed up to 2 SQS receives, and each internal phase may retry provider calls 2–3 times depending on path.

## Overall validation status

Prompt validation: `READY_WITH_FIXES`.

Structured output validation: mostly strong for plan/nutrition/drafts; `READY_WITH_FIXES`.

User isolation: source controls are strong; live DB adversarial isolation not run in this pass.

Prompt injection: mitigated, not eliminated; no live exploit found.
