# Gymini Full Business Audit — Progress Log

Read-only discovery/documentation audit. No source, schema, or infra files modified.

## Baseline (Phase 0)

- START_HEAD: `003545c6` (branch `aws-deploy`, local is 47 commits behind `origin/aws-deploy` — not pulled, per git-safety rules: no destructive/sync action taken without being asked)
- Git status at start: modified `backend/services/ai-service/package.json`, `backend/services/ai-service/src/services/bedrock.client.ts`, `pnpm-lock.yaml`; untracked `backend/services/ai-service/src/__tests__/bedrock-cross-account.test.ts`, `backend/services/ai-service/src/services/bedrock-credentials.ts`.
  - Classified **OTHER_AGENT** (looks like in-progress AWS cross-account Bedrock credentials work). Treated as read-only evidence only; not opened for editing, not reverted, not committed.
- Repo shape confirmed: pnpm workspace monorepo. `backend/services/{ai-service,auth-service,chat-service,fitness-service,gym-service,payment-service,user-service}`, `backend/gateway` (to confirm path), `frontend/{web,mobile}`.
- Existing `docs/` corpus: **195 top-level files** + subdirectories (`agentic-fitness/`, `ai-product/`, `ai-training/`, `architecture/`, `audit/`, `aws-deployment/`, `deployment/`, `features/`, `production-readiness/`, `research/`, `setup/`, `testing/`). This is a massive pre-existing evidence base (many domains already have design docs, implementation reports, "verification reports," and repeated "final signoff" reports — the repetition itself is a signal to treat prior VERIFIED/CLOSED claims skeptically and re-check against current code, per CLAUDE.md: code is authoritative, docs are evidence/history only).

## Approach

Given the scale (7 backend services + gateway, 2 frontend apps, 195+ pre-existing docs), this audit is being run as a genuine multi-phase pass per the task's own §33 instructions: raw structural discovery delegated to parallel read-only Explore subagents (to avoid loading the whole repo into one context), synthesized here into the 14 required deliverables + machine-readable JSON, with this file updated after every phase so a new session can resume without repeating work.

## Phase Log

### Phase 0 — Repo safety & shape — DONE (this entry)

### Phase 1 — Structural inventory (in progress)

Dispatched 2026-10-18, parallel read-only Explore agents:
1. Backend structural inventory (all services + gateway): routes/controllers, Prisma schema models, package.json per service.
2. Frontend web route/navigation/role inventory.
3. Frontend mobile (Capacitor) route/navigation/role inventory.
4. ai-service deep structural inventory: conversational intelligence, semantic interpreter, RAG, tools/agents, provider (Bedrock/Qwen) wiring.
5. Existing `docs/*` corpus categorization by domain/topic/date/claimed-status (not content-verified yet).

Status: **2 of 5 PENDING, 3 of 5 RETURNED** (frontend web, frontend mobile, backend services+gateway). Raw findings below; not yet synthesized into numbered deliverables.

### RAW FINDING — Backend structural inventory (agent a1376c57cc28fa173)

Every one of the 7 services has its OWN `prisma/schema.prisma` (own Postgres DB) — no service is schema-less/API-only-reader. Cross-service references are consistently "FK-by-value" (plain string id, no cross-DB FK) — a deliberate, repeatedly-documented repo convention.

**Domain-ownership map (cross-checked against CLAUDE.md's Source-of-Truth table — CONFIRMED MATCH for every row the table lists):**
- **auth-service**: User, PasswordResetToken, PartnerApplicationToken, RefreshToken, EmailVerification, AuditLog, PtDeactivationCall. Sole source of truth for `Role` enum (CUSTOMER/PT/ADMIN/GYM_OWNER — GYM_STAFF already removed, matches web/mobile finding) and JWTs. Self-service partner-application start/verify/set-password routes live here (pre-account).
- **user-service** (largest schema, owns PT↔client relationship + money-adjacent state): UserProfile, PTApplication(+Certificate/Media), Contract, Session, SessionReview, ClientReview, Notification(+Preference), PushDevice, PTAvailability(+ScheduleException), VietnamProvince/Ward, PTTrainingLocation, PTServicePackage, SessionRescheduleRequest, **InBodyEntry**, AuditLog, SessionSettlement, ClientJourney, AgentContractDraft. ~15 route files incl. contract lifecycle, session booking lifecycle (~17 routes), PT application review (11 routes). Background sweeps: contract-expiry, reschedule-expiry, session-settlement, session-autoconfirm, room-close-resolution. Direct `@anthropic-ai/sdk` usage here too (not just ai-service) + Dropbox Sign e-signature + PDF generation for contracts.
- **fitness-service** (1755-line schema — training/nutrition domain): Exercise(+Equipment/Alias/Source/Muscle), Workout(+Exercise/Set/SetSegment), Food(+Alias/Source), NutritionLog, **NutritionGoal**, BodyMetrics, **WorkoutProgram**(+Day/ExerciseGroup/Exercise/SetPrescription/Template), **WorkoutSchedule**, **FitnessRoadmap**, **RoadmapPhase**, **TrainingCycle**, **CycleAssessment**, **RecommendationAudit**, **CoachClientActionAudit**, PlanGenerationAudit, Cycle/ExerciseSessionFeedback(+Summary+AnalysisAudit), CycleInBodyLink, **NutritionProgram**(+Day/Meal/MealItem/Completion), Recipe(+Ingredient), Import/WorkoutImportBatch(+Record), ExerciseReviewDecision, WorkoutMutationEvent. 14 route files, largest is workout.routes.ts (~30 routes). Only service with just one auth middleware (no separate role middleware file). BullMQ worker + cycle-evaluation-sweep + workout-reminder background jobs.
  - **This exactly matches CLAUDE.md's Source-of-Truth table** for every model it names (FitnessRoadmap/RoadmapPhase/TrainingCycle/WorkoutProgram/WorkoutSchedule/Exercise/NutritionGoal/NutritionProgram/CycleAssessment/RecommendationAudit+CoachClientActionAudit) — strong evidence the documented ownership rules are currently accurate in code, not just aspirational.
- **gym-service** (1226-line schema — partner/branch domain): GymPartner(+Account), PartnerInvitation, GymPartnerDocument(+File), PartnerUploadIntent, GymBrand, Gym(+Photo/OperatingHours/BranchDocument), GymMembershipPlan/Contract, GymTrainerAffiliation, GymCheckIn, GymReview, GymPtCollaboration, GymMembershipReferral, GymComplaint, PartnerAuditLog/InternalNote, PlatformCommissionRate. 6 route files, owner.routes.ts and admin.routes.ts each ~45 routes. `middleware/partner-context.middleware.ts` enforces OWNER-vs-MANAGER (confirms web/mobile finding: `requirePartnerOwner` = "money and people = OWNER only", `requireGymScope` = MANAGER limited to assigned branches) — **this is the server-side half of the MANAGER-is-a-permission-not-a-role pattern** the frontend agents found client-side.
- **payment-service**: Wallet(+LedgerEntry), WithdrawalRequest, PaymentTransaction, PlatformCommission, PartnerReceivable, LedgerOperation, PaymentWebhookEvent. Real provider implementations: VNPay, MoMo, ZaloPay, PayOS. **STRIPE exists only as an enum value — no implementation** (flag for gap register: enum-vs-reality mismatch). Internal routes (service-to-service only, ~18 routes) are service-secret gated, not end-user JWT. reconciliation.service.ts sweep.
- **chat-service**: Conversation, ConversationParticipant, Message, CallSession. Own DB env var (`CHAT_DATABASE_URL`, distinct from others). Socket.IO for real-time messaging + call signaling. No background jobs.
- **ai-service** (936+ line schema): Conversation (AI Q&A log — distinct model from chat-service's Conversation), ChatSession, UserMemory, WorkoutPlan, PublishedPlan(+ModerationAnalysis/Review/ImprovementSuggestion/Adoption), TrainingPackage(+Purchase), PersonalizedService(+Order/PlanVersion/CheckIn/Review/RevisionRequest), NutritionPlan, KnowledgeSource/Document/Chunk/PipelineRun/ReviewItem, FitnessRecommendation, FitnessAgentAction, AgentWorkflowSession. 11 route files incl. personalized-service.routes.ts (~28 routes, full PT-coaching marketplace order lifecycle). `requireRole.middleware.ts` explicitly trusts gateway-injected `req.context.role` with a doc comment that this is only safe because ai-service isn't meant to be publicly reachable directly (flag for authorization-risk section). BullMQ plan-generation queue + knowledge-pipeline cron (RSS/PubMed/web crawl). Providers: `@anthropic-ai/sdk` AND `@aws-sdk/client-bedrock-runtime` (`bedrock.client.ts`/`bedrock-credentials.ts` — the files another agent has mid-edit) + Qdrant vector store + OpenSearch.
- **gateway**: no schema, pure reverse proxy (`http-proxy-middleware`) to all 7 services, path-prefix routed (~90 proxy registrations in `proxy.routes.ts`). **Confirms the known 20 req/15min auth rate limiter** exactly: `authRateLimiter` on `/auth/*`, default `AUTH_RATE_LIMIT_MAX_REQUESTS=20` / `AUTH_RATE_LIMIT_WINDOW_MS=900000`. Also a global 100 req/min limiter app-wide, and a 20 req/min limiter on `/ai/ask` specifically. `authMiddleware` here calls auth-service `/auth/verify` then injects `x-user-id/x-user-email/x-user-role` headers that every downstream service trusts.

**Cross-cutting risk flags from this agent** (to carry into §16 authorization audit and §25 gap register):
1. ai-service's role check trusts gateway-injected headers by design — worth verifying gateway is genuinely the only ingress (no service directly internet-exposed) before treating this as safe.
2. payment-service `PaymentProviderType.STRIPE` has no provider implementation — enum/reality mismatch, low severity unless something routes a real transaction to it.
3. Direct `@anthropic-ai/sdk` usage exists in BOTH user-service and ai-service — two independent LLM call sites outside the "AI capability" service boundary; worth checking in Phase on AI capability whether user-service's usage is a real second AI integration point or a legacy/narrow one (contract-related, per its file grouping).

### RAW FINDING — Frontend mobile route/role inventory (agent a69362ded26274286)

**Corrects the task's and the web-agent's premise**: `frontend/mobile` is NOT Capacitor and shares NO components with `frontend/web`. It is a fully separate **Expo/React Native app** (expo-router, RN 0.86) — confirmed via package.json (no `@capacitor/*` dep). It is actually `frontend/web` that is the Capacitor-wrapped app (has `capacitor.config.ts` + `android/`). The two "mobile-ish" surfaces are architecturally unrelated:
- `frontend/web` = Vite/React, Capacitor shell, routes in `src/app/routes.tsx`
- `frontend/mobile` = Expo/React Native, routes in `app/` (file-based, expo-router), independently hand-ported (per its own `MOBILE_MIGRATION_MANIFEST.md`) from a Figma reference + by reading web's code — route **paths** deliberately kept identical to web for deep-link parity, but zero shared JSX/components.

Role model confirmed identical to web: `client | pt | gym_owner | admin`, no `gym_manager` role (MANAGER is partner-account data, checked inside screens via `isManagerAccount`/`isBrandOwner`, not by the route guard — guards here are explicitly commented "UX-only, not a security boundary"). Nav: one shared `WorkspaceTabs` component wrapping expo-router `<Tabs>`, same shape per role, tab list differs.

Full per-role screen inventory captured (client: ~35 screens incl. hidden tabs; pt: 11; gym_owner: 9 + 2 non-route gate screens (ApplicantHome, PartnerOnboardingWizard); admin: 12; public/pre-auth: 7; root infra: 4; dev: 1).

**Methodologically important finding**: the repo's own `MOBILE_WEB_PARITY_AUDIT_2026-10-03.md` (root) lists ~26 web-only gaps as of Oct 3; this agent verified against current source + git log and found **nearly all have since been closed** by a "Phase 14B" commit series (`310ff6b4`…`0f073ac3`, each paired with a `docs(mobile): 14B.N` update) — the parity-audit doc is now stale on almost every row. This is a direct, concrete confirmation of CLAUDE.md's "docs are evidence/history, code is authoritative" rule and should be cited in the final audit as a worked example. Genuinely still-open gaps per current source: B6 (AI "explain plan" not streaming on mobile — minor), B3 (moot, web removed the feature too), D3 (admin "active PT list" screen — blocked on missing backend API, not a mobile omission), assorted E-section items explicitly deferred by product decision.

Native device capabilities inventoried: camera (QR check-in, photo capture), image picker (AI Coach image analysis, InBody photo scan, complaint evidence, avatar), location (gym branch GPS pin), push notifications, secure storage (auth tokens), file-system+sharing (data export, QR print), document picker (workout import), WebRTC+socket.io (PT↔client voice/video call, global CallProvider), clipboard/deep-linking (partner invites, payment-gateway return).

### RAW FINDING — Frontend web route/role inventory (agent a2694928ab3b2ab67)

- Framework: React + react-router v7 (`createBrowserRouter`), Vite. Route table: `frontend/web/src/app/routes.tsx`. Capacitor mobile wraps this SAME web bundle (per this agent; mobile-specific screens still to be confirmed by the separate mobile-inventory agent).
- Role/auth context: `frontend/web/src/app/context/AppContext.tsx`. **Confirmed roles: `client` | `pt` | `gym_owner` | `admin`.** No system-level `gym_staff`/`manager` role — a 5th role existed historically and was removed (ref "Money-flow plan 5.1"). One account can hold both `client` and `pt` simultaneously via an `activeView` toggle ("một tài khoản nhiều vai trò").
- **MANAGER is not a role** — both gym OWNER and MANAGER log in as `GYM_OWNER` with identical routes; MANAGER is a permission inside one partner account, enforced client-side by hiding `ownerOnly` nav items (Wallet/Managers/Collaborations) and server-side by `requirePartnerOwner`/`requireGymScope` (per `GYM_PARTNER_IDENTITY_MODEL.md`, to be verified against backend code in Phase 1 backend-agent results).
- Guards: `RequireRole`, `RequireOnboarding` (client-only), `RequirePartnerApplicant`/`RequireApprovedPartner` (gym_owner applicant-vs-approved split), `RootRedirect`, `config/landing.ts` (`ROLE_HOME`).
- Nav: no dedicated nav-config file; inline arrays in `components/layout/Sidebar.tsx` per role. No separate `BottomNav` component exists despite a code comment referencing a "5-slot mobile bottom nav" spec — **flag: spec/implementation gap, unconfirmed whether Capacitor/mobile layer has its own bottom nav (pending mobile-inventory agent)**.
- Gym Partner portal is NOT a separate frontend — lives in this same `frontend/web` app under the `gym_owner` role (`/partner/apply*` public self-onboarding, `/partner/application` gated status page, `/gym-owner/*` operational tree, 8 routes).
- **Full route table captured** for client (31 routes incl. tabbed aliases), pt (11 routes), gym_owner (9 routes + partner-application + applicant flow), admin (17 routes), public (7 routes), dev-only (2, intentionally orphaned/inert outside dev builds).
- Confirmed gaps (code-vs-doc, not code bugs):
  1. `GYM_PARTNER_WEB_ROUTE_MAP.md` describes 6 planned sub-routes (`/partner/apply/check-email`, `/partner/apply/password`, `/partner/application/status`, `/.../changes`, `/.../rejected`, `/.../approved`) that **do not exist** as real routes — consolidated into state-driven UI inside 3 components instead. A link/bookmark to the originally spec'd paths 404s.
  2. Admin's own code comment (`adminNav`) says Membership Oversight, a global cross-partner Audit Logs view, and a Notifications screen are deliberately left off nav because "their backing pages don't exist as standalone screens yet" — a gap already self-tracked by prior engineers, corroborating evidence not a new discovery.
  3. No dead nav links found; no orphaned reachable routes besides the 2 intentional dev-only ones; 3 legacy-redirect shim routes exist (`/client/gyms/:id`, `/admin/pt-service-refunds`, `/admin/withdrawals`) — all intentional back-compat, not bugs.
- AI Coach (`/client/ai-coach`) is deliberately NOT in any nav — primary surface is a global floating panel in `AppShell`; the route is a fallback reached only via a notification deep link.

Status: **1 of 5 PENDING, 4 of 5 RETURNED** (web, mobile, backend, ai-service). Only docs-corpus categorization still running.

### RAW FINDING — ai-service deep structural inventory (agent ae2136eddbdf799cd)

**Chat call chain for `POST /ai/ask`** (and `/ai/ask/stream`, which is cosmetic fake-streaming over an already-complete answer, not real token streaming): `ai.routes.ts` → `ai.controller.ts::ask` → `rag.service.ts::rag` → `llm/orchestrator.service.ts::runInner`, which runs in order: `languageGuard` → `safetyGuard` (deterministic regex, short-circuits on 12 unsafe categories before any LLM/RAG call) → `fitnessAgent.tryTurn()` (agent/workflow path, can return early) → parallel fetch of profile context + RAG retrieval + chat history + memories → `intentRouter.route()` → deterministic `recommendationEngine`/`responseFormatter` attempt → `promptBuilder.build()` → LLM call (tool-calling path if `ENABLE_TOOL_CALLING`, else direct) → `answerValidator.validate()` → `traceLogger`.

**Provider wiring** (`llm.service.ts`, switch on `LLM_PROVIDER`): `ollama` (local Qwen3-4B, default), `anthropic` (Claude), `bedrock` (delegates to the mid-edit `bedrock.client.ts`/`bedrock-credentials.ts` — Nova Pro + Cohere embeddings; the cross-account credential file exists because "this Lambda's AWS account has an account-level Bedrock block," per its own doc comment — confirms this is a live production blocker another agent is actively fixing, not stable ground to audit yet), `mock` (tests). Embedding provider selected independently (`EMBEDDING_PROVIDER`).

**Structured-output Zod validation** exists per capability (plan, nutrition-plan, roadmap-draft, client-plan-draft (PT-facing), cycle-analysis, cycle-assessment (explanation-only, never a decision per route comment), feedback-analysis, plan-improvement, plan-moderation-analysis, exercise-progression-explanation (deliberately schema-shaped with no decision field so it can't override the deterministic progression engine)) — i.e. every AI-generation surface does have a validation boundary before persistence, not just raw LLM JSON trust.

**RAG**: Qdrant (default) or OpenSearch, 4 chat collections (`exercises`,`fitness_knowledge`,`fitness_faq`,`fitness_evidence`); plan-generation retrieval is explicitly restricted to `fitness_evidence` only (code comment: plan generation must never source exercise selection from Qdrant, only from fitness-service's real DB catalog — a real deterministic-grounding guarantee, not just a claim). **Two ingestion pipelines exist**: `knowledge-pipeline/` (authoritative, live BullMQ worker, PubMed/RSS/web/local-evidence sources, quality scorer, optional LLM safety judge) vs `knowledge/` (**explicitly self-documented as deprecated** in its own README — cruder chunker, bypasses safety gate, CLI-only, gated by `ENABLE_RESEARCH_AUTOMATION`, holds real non-duplicated source coverage (Crossref/OpenAlex) not yet ported to the authoritative pipeline — a real, already-acknowledged gap, not silent dead code).

**Tools**: (A) true LLM function-calling (`llm/tools.ts`, gated `ENABLE_TOOL_CALLING`, **default OFF**) — only 2 tools offered to the model (`search_exercise_library` read-only, `get_user_fitness_data` reads already-fetched context); a 3rd tool `remember_user_fact` exists in the dispatcher but is deliberately NOT exposed to the model, per an inline-documented prompt-injection finding (ADV-003) — memory writes only happen via a separate deterministic non-LLM path. (B) Deterministic "agent" business-data tools (`fitness-agent-tools.ts`, dispatched by rule-based intent routing, NOT LLM tool-calling) — this is the real breadth of AI↔business-data integration: profile read/write, PT-candidate search, program-candidate search, roadmap diagnosis/ai-draft/accept/current/forecast, nutrition create/from-ai-plan/bootstrap/target-preview/substitute-meal-item, workout from-ai-plan/apply, equipment-feasibility validation gate, cycle evaluate/assess, food/exercise/substitute catalog lookups — all via HTTP/Lambda calls to user-service and fitness-service, never direct DB access.

**Proposal/confirmation state — lives in Postgres** (not Redis/in-memory), 3 models: `FitnessRecommendation` (PT/program candidate snapshot, confirm via choose endpoint), `FitnessAgentAction` (generic pending action, `status` PENDING + `expiresAt`, confirm/dismiss endpoints), `AgentWorkflowSession` (multi-turn slot-filling state incl. `pendingProfileUpdate`, `draftRef`, `revision`, `expiresAt` — **its own doc comment explicitly says "this row is NEVER business truth."**). Roadmap/client-plan drafts are computed+returned by ai-service but persisted only by the real owning service's own accept endpoint (fitness-service `/fitness-roadmaps/ai-draft/accept`, `/coach/clients/:id/plans`) — i.e. **the proposed-vs-persisted boundary described in CLAUDE.md's Source-of-Truth table is real in code, not just policy.**

**Safety**: all deterministic (regex/rule-based) — `safety_guard.ts` (main gate, 12 unsafe categories incl. medical emergency, PED dosing, extreme-calorie, prompt-injection, eating-disorder-disclosure, pregnancy-nutrition) + `safety-signals.ts` (finer symptom-aware classifier: radiating pain, neurological symptom, chest/cardio red flag, post-surgical/pregnancy state → fail-closed RAG so only curated evidence may answer or the system abstains) + a narrow documented point-fix (`target-weight-safety.ts`, BMI-aware unsafe target-weight rejection, explicitly noted as the only height-aware check in the codebase). **One genuinely-trained ML classifier exists** (`query-classifiers/`, offline-trained logistic-style model for routing incl. "personal-safety") but **its model-weight artifacts directory is empty in this checkout** — currently a no-op that falls back to the regex path; flag as "built but not currently deployed," not a load-bearing safety mechanism today.

**Feature flags of note (mostly default OFF)**: `CONVERSATIONAL_INTELLIGENCE_V2` (off/shadow/on, semantic turn-understanding layer), `GYMINI_UNIFIED_AI_COACH` (off/shadow/on, bounded multi-intent executor, only engages when CI-V2 already classified a turn as MULTI), `ENABLE_TOOL_CALLING` (off), `ENABLE_LLM_SELF_EVAL` (off, "no measurable user benefit in production" per comment). **This is a major finding for the AI-capability audit**: several richly-implemented "AI capability" layers described in code comments are NOT active by default — judging "is X implemented" requires checking the flag's actual deployed value, not just that the code exists.

**Tests**: 143 Jest `*.test.ts` files in ai-service (123 in `__tests__/`, 18 in `llm/__tests__/`, plus datasets/services), separate from a non-Jest offline `evaluation/` golden-case harness (agentic, conversational-workflow v1/v2, program-recommendation) — don't conflate the two when reporting test coverage.

### RAW FINDING — Existing docs corpus categorization (agent a18153e144d3ad1c5) — Phase 1 COMPLETE (5/5)

Corpus shape: 23 repo-root `.md` + 183 flat `docs/*.md` + subdirs (`ai-product/` 30, `ai-training/` 30, `deployment/` 71, `features/` 24, `production-readiness/` 19, `aws-deployment/` 7, `audit/` 4, `research/` 3, others small). 5 literal "- Copy" duplicate files identified (safe to ignore). Corpus is dominated by long "implement → evaluate(Codex) → remediate → signoff" chains for 3 features: AI Agent System (Sept 14-15), Conversational AI Coach + Conversational Intelligence V2 (Sept 15-Oct 3), FitnessRoadmap/Cross-System journey (Sept 9-10) — in each, only the last-dated file is non-superseded.

**Single most important lead identified: `docs/production-readiness/` (19 files)** — a structured, gap-ID-based (G-xx) cross-domain audit pinned to a specific git HEAD (`81d9f432`), with an explicit **NO-GO for public production** verdict in `00-executive-summary.md`, `12-deployment-infrastructure.md`, and `17-go-live-checklist.md`. `08-module-readiness.md` is flagged as a high-value single-file per-module status matrix (READY_WITH_GAPS/NOT_READY/PARTIAL/LEGACY/RESEARCH_ONLY). `15-production-gap-register.md` is the master gap list referenced by nearly every other file in that folder. **This must be reconciled against the many "VERIFIED"/"final signoff" claims found elsewhere in the corpus** — those likely describe dev/local-only verification, not the deployed-infra scope this audit covers.

Other high-value findings:
- Most recent AI work in the whole repo is `docs/ai-product/phase3-*`/`phase4-*` (Oct 5-11), explicitly **not production-ready** (`UNIFIED_AI_READY_FOR_SHADOW_ONLY`, all related flags default off) — a good freshness check against older AI "VERIFIED" claims from Sept.
- `ai-coach-demo-readiness-final.md` (2026-09-20, latest in its chain) concludes **BLOCKED — DEMO READY = NO**, even though earlier files in the *same chain* claim VERIFIED/signed-off — a concrete in-corpus example of claim inflation/drift the final audit should cite.
- `docs/ai-training/` (30 files, Qwen3-4B local fine-tune pipeline) — almost every file self-flags `TRAINING_NOT_RUN`/`PRODUCTION_CHANGED=NO`; only `v2.3a7-production-semantic-contract-alignment-implementation.md` claims real production code changes (`llm.service.ts`, `json_llm_call.util.ts`, `interpreter.ts`, new `reference-grounding-guard.ts`) — consistent with user's own memory of this workstream's status (V2.1 win, V2.2 regressed).
- `docs/deployment/` (71 files, AWS dev-infra ops logs, Sept29-Oct12) — low business-domain relevance, high infra relevance; treat as one cluster.
- Domain docs with clear single "latest" files already identified for: Roadmap (`GYMINI_NUTRITION_PROGRAM_LIVE_E2E_REPORT.md`/`GYMINI_CYCLE_TRANSITION_VERIFICATION_REPORT.md`), PT-Coaching (`GYMINI_PT_COACHING_VERIFICATION_REPORT.md`), Gym-Partner (`GYM_PARTNER_WEB_KNOWN_ISSUES.md`/`WEB_TEST_REPORT.md`, full history in `quan-ly-doi-tac.md`), Mobile (`MOBILE_WEB_PARITY_AUDIT_2026-10-03.md` — though Phase 1's own mobile-inventory agent already found most of its gaps closed by later commits, confirming even this "newest" doc is partly stale), Nutrition (`docs/nutrition.md` + `codex-nutrition-bootstrap-concurrency-signoff.md`), Exercise Catalog (`EXERCISE_CATALOG_PROVENANCE_AUDIT.md`/`EXERCISE_DUPLICATE_SEMANTIC_REVIEW.md`).
- No dedicated Identity/Account domain doc exists — closest coverage is `production-readiness/03-authentication-security.md` + `04-authorization-user-isolation.md`.

## PHASE 1 STATUS: COMPLETE (5/5 agents returned)

## Phase 2 — Production-readiness reconciliation — DONE

Read all 7 core files of `docs/production-readiness/` directly (README, 00-executive-summary, 01-system-inventory, 02-architecture-audit, 08-module-readiness, 15-production-gap-register [626 lines, 36 gaps], 17-go-live-checklist). This is a rigorous, evidence-labeled (CODE_INSPECTION/LIVE_LOCAL/TEST_FIXTURE/NOT_VERIFIED), gap-ID-based audit pinned to git HEAD `81d9f432` (a prior point on `aws-deploy`, ancestor of current HEAD `003545c6`). **Verdict: NO-GO for public production.** 4 P0, 20 P1, 10 P2, 2 P3 = 36 gaps total.

Key takeaways carried into this audit's own deliverables (full detail stays in the production-readiness folder, not re-transcribed here):
- **P0s**: G-01 JWT secret falls back to a public literal in tracked source; G-02 bearer tokens written to auth-service logs (reproduced LIVE_LOCAL — 1024/2000 log lines); G-03 no TLS in prod topology; G-04 destructive migrations (incl. one that deleted real InBody rows) with no backup/snapshot gate.
- **02-architecture-audit.md explicitly cross-checked CLAUDE.md's domain-ownership principle against code and marked it VERIFIED_OK** (separate Prisma schemas, UserProfile/NutritionGoal/WorkoutProgram/CycleAssessment owned correctly) — independent confirmation of what this audit's own Phase 1 backend-agent already found.
- **08-module-readiness.md** gives a per-module status matrix (READY_WITH_GAPS/NOT_READY/PARTIAL/LEGACY_DEAD_CODE/NOT_VERIFIED) for ~22 modules — directly reusable as the backbone of this audit's §7 Feature Completeness Classification; notably: Authentication=NOT_READY, most business modules (Workouts/Training-cycles/Roadmap/Nutrition/Coach/Marketplace/Chat/Conversational-Intelligence/Payments/Gym-management)=PARTIAL, Wallet/Booking/Membership/Notifications/Uploads=NOT_VERIFIED (not traced by that audit).
- **G-17 is a major AI-governance finding**: the `CONVERSATIONAL_INTELLIGENCE_V2` flag does NOT govern all LLM use — even with it off, the orchestrator still calls the LLM for UNKNOWN/WRITE_ACTION/KNOWLEDGE turns, observed LIVE_LOCAL taking 170s+ before a degraded fallback. This matters for this audit's AI-capability section: "is CI-V2 on/off" is not the same question as "is the LLM in the loop."
- **Equipment-compliance gap (08-module-readiness.md §Equipment-compliance)**: `validateAiPlanExerciseEquipment` only runs on the AI-generation path; self-service and coach-created manual programs skip equipment checks — explicit product decision needed, not silently fixed.
- G-24: no complete owner-check/cross-user-isolation test suite exists; authorization verified only by sampling.
- This audit's own prior findings (STRIPE enum-with-no-implementation, mobile-is-not-Capacitor, OWNER-vs-MANAGER permission split, proposed-vs-persisted boundary via `AgentWorkflowSession`/`FitnessAgentAction`) are all consistent with and complementary to this gap register — no contradictions found.

## PHASE 2 STATUS: COMPLETE

## Phase 3 — Synthesis (in progress)

Deliverables written so far (all in this directory):
- `02-business-domain-inventory.md` — DONE. 14 domains (DOM-01..DOM-14), ~80 capability rows with IDs, status, evidence. Includes one genuinely new discovered domain not in the task's candidate list: DOM-12 Gym Management/Partner Portal.
- `03-role-capability-permission-matrix.md` — DONE. 4 confirmed roles (CUSTOMER/PT/ADMIN/GYM_OWNER), MANAGER-is-a-permission-not-a-role pattern confirmed in 3 independent places (web/mobile/backend) with no contradiction, capability matrix by role, authorization boundary findings cross-referenced to production-readiness gap IDs.

Two more deep-dive agents dispatched (background, in flight as of this checkpoint):
6. PT client management & copilot audit (agent ac78d61d185df5960) — authorization tracing for PT→client access, PT-copilot use-case feasibility (§14 of task), AI-autonomy-boundary check, spot-check of `GYMINI_PT_PERMISSION_MATRIX.md` claims vs current code.
7. Conversational state & known-failure-case investigation (agent a2e74b1c9c9c70028) — Cases A-G from task §12, plus which operation-vocabulary items (MOVE/REPLACE/ADD_CONSTRAINT etc.) map to real distinct code paths today.

`10-business-gap-register.md` — DONE (12 gaps, BDG-01..BDG-12, deliberately not duplicating the external G-01..G-36 register; cross-referenced both ways).
`capabilities.json`, `roles-and-permissions.json`, `gaps.json` — DONE (machine-readable mirrors of the above three files).

## Agent 6 (PT copilot, ac78d61d185df5960) — RETURNED, fully synthesized

Wrote `08-pt-client-management-ai-copilot-audit.md` (full deliverable). Updated `02-business-domain-inventory.md` (CAP-08-03/04/07), `03-role-capability-permission-matrix.md` (both open questions resolved), `10-business-gap-register.md` (BDG-08 confirmed OPEN not pending; added BDG-13 doc-staleness finding), and all 3 JSON files (`capabilities.json`, `roles-and-permissions.json`, `gaps.json`) to match.

Headline findings: (1) PT→client authorization is genuinely robust — clientId always from URL path never body, fail-closed, re-verified fresh every call, across every handler including both nutrition- and training-side CycleAssessment review; (2) AI never autonomously messages a client or writes to a client's data — every tool acts on the calling user's own account only; (3) role model resolved — single mutually-exclusive enum, NOT multi-role, functional dual-capability works because ownership checks use userId not role; (4) PT-dashboard cross-client aggregate CONFIRMED missing — this single gap blocks 3 of 5 priority PT-copilot use cases from task §14; (5) one minor doc-staleness (permission matrix missing 2 routes).

## Agent 7 — FAILED mid-task (rate limit), RESUMED

Agent a2e74b1c9c9c70028 hit a session rate limit mid-investigation (not a logic error; harness confirms its partial work is saved). Resumed via SendMessage at user's "tiếp" instruction, asked to continue from where it stopped through all 7 cases + the operation-vocabulary mapping. Still in flight.

## `06-ai-capability-and-integration-audit.md` — DONE

Written using Phase 1 ai-service structural data (no new agent needed). Key finding stated plainly: the proposed-vs-persisted AI-authority boundary from CLAUDE.md is independently confirmed true in code **three separate times** (Phase 1 agent, PT-copilot agent's `generatePlanDraft` trace, and the independent production-readiness audit's own grep-based check) — genuinely strong, not just asserted. Also documents 3 concrete deterministic-grounding mechanisms (exercise catalog restriction, no-decision-field schemas for CycleAssessment/progression explanations, zero business-table Prisma writes in ai-service). Flags that `bedrock.client.ts` is currently mid-edit by a concurrent session, so neither this nor the production-readiness audit should be read as final on Bedrock readiness.

## Agent 7 — RESUMED SUCCESSFULLY, COMPLETED ALL 7 CASES + operation vocabulary

Full report delivered. Verdicts: Case A split (APPEARS_FIXED common case / CONFIRMED_LIVE_DEFECT for injury-mention+combined-plan exception), Case B CONFIRMED_LIVE_DEFECT, Case C CONFIRMED_LIVE_DEFECT, Case D CONFIRMED_LIVE_DEFECT, Case E APPEARS_FIXED, Case F APPEARS_FIXED(reporting)/ARCHITECTURAL_RISK(rollback, by design), Case G CONFIRMED_LIVE_DEFECT (cleanest finding: `timeframeWeeks` hardcoded to 16 on the chat path). Operation vocabulary: CREATE/UPDATE/REVISE/CHANGE_DURATION/CHANGE_TARGET/ADD_CONSTRAINT/EXPLAIN/CONFIRM/CANCEL all have real distinct paths; MOVE/CHANGE_FREQUENCY/incremental-ADD/REMOVE_CONSTRAINT/COMPARE collapse into full regeneration or don't exist.

**Synthesized into**: `07-conversational-state-and-revision-audit.md` (new), `09-health-safety-and-constraint-audit.md` (new, Case C is the headline health-safety finding of the whole audit), gap register BDG-14 through BDG-20 (6 new CONFIRMED_LIVE_DEFECT/architectural gaps), `gaps.json` fully updated with case verdicts + operation-vocabulary summary, `capabilities.json` updated (CAP-03-05, CAP-03-11, CAP-06-02, CAP-13-05).

**Single most actionable finding of the entire audit so far**: BDG-17 — the nutrition workflow already has a dated, named, production fix (`accumulateNutritionWorkflowConstraints`, "Final remediation M1") for exactly the constraint-loss bug class that still affects the workout workflow. Porting an existing, proven fix is a much smaller ask than building new infrastructure.

## `05-frontend-backend-database-coverage.md` — DONE

Three-way reconciliation (top-down/bottom-up/cross-cutting per task §6). Headline finding: no case was found where a doc claimed something was built/safe and current code proved it genuinely was not — the corpus's staleness consistently runs in the "team already did more than the doc says" direction, EXCEPT the AI-coach "VERIFIED" chain vs. the later, broader production-readiness NO-GO verdict, which the executive summary must present carefully (not contradictory, but easy to misread if only one is consulted).

## `06-ai-capability-and-integration-audit.md` — DONE (recorded earlier, listing for completeness)

## AUDIT COMPLETE

All 14 required markdown deliverables + 7 required JSON files written to this directory. Final file listing confirmed via `ls`:

01-executive-summary.md, 02-business-domain-inventory.md, 03-role-capability-permission-matrix.md, 04-business-workflow-catalog.md, 05-frontend-backend-database-coverage.md, 06-ai-capability-and-integration-audit.md, 07-conversational-state-and-revision-audit.md, 08-pt-client-management-ai-copilot-audit.md, 09-health-safety-and-constraint-audit.md, 10-business-gap-register.md, 11-test-coverage-and-business-invariants.md, 12-domain-dependency-and-architecture-map.md, 13-business-first-ai-development-roadmap.md, 14-audit-coverage-and-evidence-manifest.md, capabilities.json, roles-and-permissions.json, workflows.json, ai-integrations.json, gaps.json, tests-and-invariants.json, coverage-manifest.json.

**Repository safety confirmed at completion**: `git status` shows only the pre-existing concurrent-agent Bedrock changes (unchanged, untouched by this audit) plus two unrelated `.dev/aws/` scheduler files that appeared from infra automation elsewhere in the environment — this audit created and modified nothing outside this directory. END_HEAD = START_HEAD = `003545c6` (no commits made, none requested).

**Final verdicts**: `BUSINESS_AUDIT_PARTIAL_WITH_KNOWN_GAPS` / `AI_BUSINESS_COVERAGE_MAPPED` / `READY_FOR_BUSINESS_GAP_PRIORITIZATION`. 7 background agents dispatched total. 20 new business-domain/AI gaps found (0 P0, 7 P1, 9 P2, 4 P3), reconciled against (not duplicating) the pre-existing 36-gap production-readiness security/infra register (4 P0, 20 P1, 10 P2, 2 P3, NO-GO verdict).

A future session resuming this work should start at `01-executive-summary.md` for orientation, then `14-audit-coverage-and-evidence-manifest.md` §"Explicitly unresolved items" for the highest-value next investigative targets (10 items named, none hidden).

Synthesize Phase 1 agent results into:
- `02-business-domain-inventory.md` (first draft, domains + evidence pointers)
- `capabilities.json` skeleton
- Role discovery pass (Phase 2) once backend auth/role model is mapped by Phase 1 agent #1.

## Files created so far

- `docs/architecture/gymini-full-business-audit/AUDIT_PROGRESS.md` (this file)
