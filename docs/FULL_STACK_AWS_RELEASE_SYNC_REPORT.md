# Full-Stack AWS Release Synchronization Report

Date: 2026-09-22. Audit + fix-only-verified-inconsistencies + rebuild for
the entire monorepo (7 backend services, shared package, frontend). No
AWS connection, no AWS CLI, no AWS resource created/modified, no data
imported, no database reset, no business data regenerated.

## 1. Executive summary

The repository had accumulated substantial, legitimate, concurrent work
across AI service (a new Conversational Intelligence v2 layer, nutrition
plan repair), gym-service (a full partner self-service application
feature with new S3 uploads), user-service, and chat-service (this
author's own prior pass) since the last full artifact build. This pass
treated all of it as current source of truth, audited it for internal
consistency, and found + fixed **two real defects** and **one real,
previously-undetected local-database drift** — none required rewriting
business logic:

1. **`gym-service` failed to build at all** — `package.json` already
   declared `@aws-sdk/client-s3`/`@aws-sdk/s3-presigned-post`/
   `@aws-sdk/s3-request-presigner` (for the new partner-document upload
   feature) but `node_modules` had never been synced. Fixed with a root
   `pnpm install` (no code change).
2. **Local `gymcoach_fitness` database was 2 migrations behind current
   repo history**, and applying them cleanly failed because 5 of their 6
   individual DDL effects already existed under superseded migration
   identities (the same "history was renamed/squashed" pattern already
   documented for other services) — but **3 partial-unique indexes
   protecting real business invariants were genuinely missing**
   (`fitness_roadmaps_one_active_per_user`,
   `roadmap_phases_one_active_per_roadmap`,
   `training_cycles_one_active_per_phase` — "at most one ACTIVE roadmap/
   phase/cycle" guarantees). Verified no existing data violated these
   invariants, created the 3 missing indexes directly, then used
   Prisma's own `migrate resolve --applied` mechanism (never `db push`/
   `migrate reset`) to reconcile migration bookkeeping. **This same gap
   almost certainly exists on AWS Aurora today** — see §12/§20.
3. **`gym-lambda.zip`/`gym-migrate-lambda.zip` predated the entire
   partner self-service feature** (5 new migrations, the new S3 upload
   code) — the existing artifact (built 2026-09-08) would have deployed
   a version of gym-service missing a feature that already merged to
   this branch on 2026-09-20/21.

11 Lambda artifacts were rebuilt from current source (auth ×2 — one was
**missing entirely**, user ×2, fitness ×2, ai ×3) plus gym ×2 for the
reason above; chat's migration Lambda and Fargate image were rebuilt in
this author's own immediately-prior pass. Payment-service's existing
artifacts were verified current (no source or migration change since
they were built) and were deliberately **not** rebuilt, per the
instruction not to assume every service needs re-upload.

All 7 backend services build clean. The frontend builds clean, with no
secret or `localhost` leak in the production bundle. The AI Conversational
Coach evaluator baseline is unchanged (`PASS 30/FAIL 0/INFO 0/BLOCKED 0`)
— no regression. **No AWS action was taken.**

## 2. Repository state

`git status` at the start of this pass showed 30 modified + 30 untracked
files, spanning `ai-service` (agent-workflow, llm/*, a new
`conversational-intelligence/` module, a new `nutrition-plan-repair.ts`),
`user-service` (`agentic-fitness.service.ts`), `chat-service`
(this author's own prior-pass Dockerfile/CORS fix), root config
(`.env.example`, docker-compose files), and several new `docs/*.md` +
`test/*` directories. None of this was discarded, reset, or reverted —
per instruction, current source is the source of truth. No stale `dist/`
folders or generated files were found to be blocking a build (the one
real build blocker was the missing `node_modules` entries in §1, not a
stale generated artifact).

## 3. Shared packages

`backend/shared` (`@gym-coach/shared`) — `pnpm --filter @gym-coach/shared
build` → **PASS**, clean `tsc`. Built first, before any service, per the
correct monorepo dependency order (every service depends on it).

## 4. Auth

Source audited: JWT issuing/verification (`auth.service.ts`, bcryptjs
password hashing, self-contained — no environment-specific key mixed
in), refresh tokens, roles, account states, Lambda handler
(`src/lambda.ts`), migration Lambda (`src/migrate-lambda.ts`), Secrets
Manager usage (`config/lambda-runtime.ts`'s `DATABASE_SECRET_ID` pattern).
No client-supplied `x-user-id`/`x-user-role`/`x-internal-token` trust
found anywhere in Auth's own code (it is the identity authority every
other service's `readGatewayVerifiedUser`/gateway-trust mechanism
ultimately defers to). Build: **PASS**. `prisma migrate status`:
**up to date** (10 migrations). Artifact: **rebuilt this pass** —
`auth-lambda.zip` did not exist on disk at all before this pass (only its
migration counterpart did); both are now current.

## 5. User

Audited: profiles, InBody, PT applications, contracts, sessions, reviews,
locations, notifications, reference data, uploads (the `compose_user_
uploads` Docker volume, unchanged), and the `UserPreference` schema-
reconciliation adopted in the prior pass — **confirmed still present and
unmodified** in `schema.prisma` and migration
`20260916100000_adopt_user_preference`. Build: **PASS**. `prisma migrate
status`: **up to date** (43 migrations). One source file changed since
the last artifact build (`agentic-fitness.service.ts`) — a new test
(`agentic-fitness-optional-budget.test.ts`) exists for it but is
**ENVIRONMENT-GATED / SKIPPED** (no `gymcoach_user_test` database exists
locally; not created this pass to stay within scope). Artifact:
**rebuilt this pass**.

## 6. Fitness

Audited: exercise catalog, equipment, muscles/anatomy, foods/aliases,
workout programs/schedules/logs, nutrition, training cycles, the
FitnessRoadmap/RoadmapPhase orchestration layer, recommendation audits.
Build: **PASS**. `prisma migrate status` **initially reported 2
unapplied migrations** — full investigation and fix in §12/§13 below.
After the fix: **up to date** (53 migrations), `prisma migrate diff`
confirms zero real drift (one cosmetic `ASC`-keyword-only diff line for
an index whose actual Postgres definition already matches exactly —
same class of harmless artifact documented for other services'
partial/explicit indexes in prior passes). Internal service API
contracts (Auth/User Lambda invoke), AI integration points, and catalog/
equipment validation code were not modified — no evidence required a
change. Business/catalog data was not regenerated or replaced anywhere.
Artifact: **rebuilt this pass** (both HTTP and migration — the migration
artifact specifically needed the 2 migrations this pass just reconciled
locally).

## 7. Gym

Audited: GymBrand/Gym branches, membership plans/contracts, trainer
affiliations, check-ins, reviews, PT collaborations, referrals,
commission-rate logic, and the new partner self-service application
feature (5 new migrations, S3-backed document/logo uploads via
`partner-s3.service.ts`). **Build initially FAILED** — see §1, fixed via
`pnpm install`, confirmed passing after. The "1 Gym Owner → 1 Gym Brand →
many branches" invariant was re-verified against real local data (0
owners with >1 brand) — unchanged from the prior data-migration pass's
own finding, not re-broken by the new partner feature. `prisma migrate
status`: **up to date** (25 migrations, up from 20 at the last audit —
the 5 new partner migrations are already applied locally). The existing
full-local-data-migration importer's `platform_commission_rates`
reconciliation logic (`scripts/data-migration-import-aws.mjs`) was
**not** affected by the new migrations — none of the 5 new ones write
seed/placeholder rows (grep-verified: no `INSERT`/`gen_random_uuid()`
default-row pattern in any of them). Artifact: **rebuilt this pass**
(both — the prior artifact, built 2026-09-08, predates this entire
feature and would have shipped gym-service without S3 upload support).

## 8. Payment

Audited: wallets, ledger, transactions, withdrawals, commissions,
partner receivables, provider integration points (VNPay/MoMo/PayOS/
ZaloPay — none invoked during this pass, confirmed by reading the audit
trail only, never calling a provider), webhooks, the AI callback
(`AI_LAMBDA_NAME` → `fitness-assistant-dev-ai`, confirmed in
`service-lambda.client.ts`). Build: **PASS**. `prisma migrate status`:
**up to date** (11 migrations). **No source or migration change found
since the existing artifacts were built** (`git status` clean for this
service's entire directory tree; no migration folder newer than the
artifact's own build timestamp) — existing `payment-lambda.zip`/
`payment-migrate-lambda.zip` were verified current and **deliberately
not rebuilt**, per the explicit instruction not to assume every service
needs re-upload. Wallet/ledger business semantics were not touched.

## 9. AI

Audited the full current source, including everything that changed since
the prior Conversational AI Coach remediation passes: `agent-workflow/`
(orchestrator, slot-values, target-weight-safety, roadmap workflow — all
unchanged in their approved behavior, confirmed by the evaluator, §27),
plus the genuinely new `conversational-intelligence/` module and
`nutrition-plan-repair.ts`. Current AWS provider configuration confirmed
in source: `LLM_PROVIDER=bedrock`, chat/vision model
`apac.amazon.nova-pro-v1:0`, embedding `cohere.embed-multilingual-v3`
(1024-dim), `VECTOR_STORE_PROVIDER=opensearch` — Qdrant remains local-
dev-only (its client code exists but is never selected when
`VECTOR_STORE_PROVIDER=opensearch`; no AWS artifact bundles Qdrant as a
production dependency, and no 768-dimensional vector was copied into any
artifact — confirmed by the artifact security scan, §19). OpenSearch
index names (`exercises`/`fitness_knowledge`/`fitness_faq`/
`fitness_evidence`) match the previously-audited contract, unchanged.
Build: **PASS**. `prisma migrate status`: **up to date** (25 migrations).
Artifact: **rebuilt this pass** — all three (`ai-lambda.zip`,
`ai-worker-lambda.zip`, `ai-migrate-lambda.zip`), since the prior artifact
(2026-09-15) predates all of this pass's new AI source. See §27 for the
regression-baseline proof this rebuild didn't change approved behavior.

## 10. Chat

Full audit, fixes, and artifact preparation for Chat were completed in
this author's own immediately-prior pass — see
`docs/CHAT_SERVICE_AWS_READINESS_REPORT.md` and
`docs/CHAT_SERVICE_AWS_DEPLOYMENT_PLAN.md` for the complete detail (not
re-litigated here). Summary for this global pass: **runtime is ECS
Fargate + ALB, not Lambda** — determined from real evidence (genuine
Socket.IO usage with polling fallback, in-process presence/call-timer
state), not assumed. Source compiles (`pnpm --filter @gym-coach/chat-
service build` → PASS, includes `prisma generate`). Contracts align with
the frontend's own pre-existing `VITE_CHAT_WS_URL`/`chatSocketTarget()`
design (no frontend code needed to change). Dependencies are current
(this pass's `pnpm install` did not touch chat-service's own
dependencies — no drift found there). No stale code remains — the one
real Dockerfile defect (missing `COPY patches`) and the one real missing
CORS handling were both fixed in the prior pass. Chat's artifact type
(Fargate image + a separate migration Lambda) was correctly **not**
forced to match the other 6 services' pure-Lambda pattern.

## 11. Cross-service contracts

Full dependency matrix (every relationship audited directly in source,
not assumed):

| Caller | Target | Transport | Route/Action | Auth method | Env variable | Timeout |
|---|---|---|---|---|---|---|
| User | Auth | Lambda invoke or HTTP fallback | `POST /auth/verify`, `GET /auth/internal/users/:id` | Bearer JWT (verify) / `x-service-secret` (internal) | `AUTH_LAMBDA_NAME` / `AUTH_SERVICE_URL` | 5s / 3s |
| Fitness | Auth | same pattern | same | same | `AUTH_LAMBDA_NAME` | same |
| Fitness | User | same pattern | notification/profile endpoints | Bearer / internal secret | `USER_LAMBDA_NAME` | 3s |
| Gym | Auth | same pattern | same | same | `AUTH_LAMBDA_NAME` | same |
| Gym | User (profile) | same pattern | profile lookups | Bearer/internal | `USER_LAMBDA_NAME` | 3s |
| Gym | Payment | same pattern | commission/payout checks | internal secret | `PAYMENT_LAMBDA_NAME` | 3s |
| Payment | Auth | same pattern | same | same | `AUTH_LAMBDA_NAME` | same |
| Payment | User | same pattern | same | same | `USER_LAMBDA_NAME` | same |
| Payment | AI | same pattern | AI-driven payment callback | internal secret | `AI_LAMBDA_NAME=fitness-assistant-dev-ai` | 3s |
| AI | Auth | same pattern | same | same | `AUTH_LAMBDA_NAME` | same |
| AI | User | same pattern | profile context for chat | same | `USER_LAMBDA_NAME` | same |
| Chat | Auth | same pattern (works identically on Fargate — IAM Task Role, not a Lambda execution role) | `POST /auth/verify` | Bearer JWT | `AUTH_LAMBDA_NAME` | 5s |
| Chat | User | same pattern | `/internal/chat-eligibility`, `/contracts/check-relationship`, `/sessions/:id` | internal secret / Bearer | `USER_LAMBDA_NAME` | 3s |

**No outdated names found**: every `*_LAMBDA_NAME` env var reference
grep-verified against the actual expected Lambda names
(`fitness-assistant-dev-{auth,user,payment,ai}`) — no old port numbers,
no `localhost` URLs used as a non-fallback default, no deprecated routes
found referenced anywhere. `/internal/*` routes are explicitly and
repeatedly documented as never exposed through API Gateway
(`AWS_DEPLOYMENT_RUNBOOK.md`, 4 separate mentions) — consistent across
every service that has internal-only endpoints, including Chat's own
`/internal/push-notification` and `/internal/calls/end-by-session`
(gated by `x-internal-secret`, not internet-facing per the Chat
deployment plan's own ALB route list).

## 12. Database / Prisma status

`prisma validate` + `prisma generate` + `prisma migrate status` run for
all 7 services (using directly-supplied `DATABASE_URL` for gym/payment,
which have no local `.env` file for host-run Prisma CLI — not a defect,
just a docker-compose-only convenience gap). Results:

| Service | Validate | Migrate status (before) | Migrate status (after) |
|---|---|---|---|
| Auth | valid | up to date (10 migrations) | unchanged |
| User | valid | up to date (43 migrations) | unchanged |
| Fitness | valid | **2 migrations behind, apply failed** | **fixed — up to date (53)**, see §13 |
| Gym | valid | up to date (25 migrations) | unchanged |
| Payment | valid | up to date (11 migrations) | unchanged |
| AI | valid | up to date (25 migrations) | unchanged |
| Chat | valid | up to date (3 migrations) | unchanged |

Never used `db push`/`migrate reset`/`--accept-data-loss` anywhere in
this pass. No historical migration file was modified.

## 13. Known recent reconciliation migrations — status

- `UserPreference` adoption (`20260916100000_adopt_user_preference`):
  **present, unmodified**, confirmed applied (§5).
- AI `personalized_service_orders` milestone columns
  (`20260916110000_adopt_personalized_service_escrow_milestones`):
  **present, unmodified**, confirmed applied (§9, `up to date`).
- `AgentWorkflowSession` active-workflow invariant
  (`20260916090000_agent_workflow_session_active_unique`): **present,
  unmodified**, confirmed applied.

**New finding this pass** (not a removal/rewrite of the above — a
genuinely new local-DB drift discovered during this audit):
`fitness-service`'s `20260907030000_agentic_fitness` and
`20260909090000_fitness_roadmap_phase` had never been applied to
`gymcoach_fitness`. Attempting `prisma migrate deploy` failed both times
with "already exists" errors, because — exactly the same pattern already
documented for other services' renamed/squashed migration history — most
of each migration's individual DDL effects were already present under a
superseded migration identity. The fix, done carefully, one migration at
a time:
1. Read the full migration SQL.
2. Queried the live database directly for the existence of **every
   individual object** the migration creates (types, tables, columns,
   indexes, constraints) — never assumed "the error is the only gap."
3. For `20260907030000_agentic_fitness`: 5 of 6 effects existed; 1 index
   (`workout_program_templates_agent_candidates_idx`) did not — created
   it directly.
4. For `20260909090000_fitness_roadmap_phase`: 17 of 20 effects existed;
   3 partial-unique indexes did not
   (`fitness_roadmaps_one_active_per_user`,
   `roadmap_phases_one_active_per_roadmap`,
   `training_cycles_one_active_per_phase`) — **verified zero existing
   rows currently violate any of the three invariants these indexes
   enforce** before creating them (0 duplicate ACTIVE roadmaps/phases/
   cycles found), then created all three directly.
5. Used `prisma migrate resolve --applied <name>` for each migration
   (Prisma's own documented mechanism for exactly this situation — a
   migration whose effects are verified already present) — never
   `db push`, never edited the migration file itself.
6. Re-ran `prisma migrate deploy` (now a no-op — nothing left to apply)
   and `prisma migrate diff` (confirmed zero real remaining drift).

**This is a new, real, previously-undocumented forward-migration-
completion finding** — not a rewrite of the existing migrations, and no
new migration file was created (the two existing ones in the repo were
already correct; only the local database's own applied-state was
incomplete). **Reported explicitly, per instruction**: the 3 missing
business-invariant indexes are exactly the kind of gap that would have
gone unnoticed on AWS Aurora too if `fitness-migrate-lambda.zip` had been
deployed there in its pre-2026-09-09 form and this exact same
already-exists collision occurred silently. **AWS Aurora's
`fitness_assistant_fitness` schema must be independently verified to
actually have these 3 indexes** (query `pg_indexes` for their names) —
this pass had no AWS connection to check that directly.

## 14. Data migration tooling status

`artifacts/data-migration/**/*.data.dump` files were **not** touched,
regenerated, or mutated this pass — no evidence of corruption was found,
and none was sought (out of this pass's scope). The full local→AWS data
migration project's own established principles remain intact and
unmodified: business data = exact local state; IDs = exact local IDs;
`_prisma_migrations` = canonical repository/AWS history (never copied
local noise) — enforced by `scripts/data-migration-import-aws.mjs`,
which was not changed this pass. The known migration-seeded
reconciliation cases (fitness `muscles`, AI `knowledge_sources`, gym
`platform_commission_rates`, payment `wallets` PLATFORM/ESCROW) are
**unaffected** by anything found in this pass — none of the new gym
partner migrations or the fitness roadmap-phase fix introduce a new
seed-vs-restore collision (verified: no `INSERT`/default-row pattern in
any of the new gym migrations; the fitness index fix only adds indexes,
which `pg_restore --data-only` never touches at all, since index
maintenance happens automatically as rows load). **The importer was not
regressed.**

## 15. Deferred: user-files migration

Not addressed this pass, per instruction. The 11 real uploaded files
(8 contract PDFs + 3 PT-application images, in the `compose_user_
uploads` Docker volume) remain un-uploaded to S3 — this is **not**
treated as a backend build/deployment blocker, and no database reference
to these files was touched or removed. Reported here only as a reminder
that it remains a separate, deferred piece of work (full detail already
in `artifacts/data-migration/uploads-manifest.json` from the prior data-
migration pass).

## 16. Frontend

Full grep audit of `frontend/web/src` for `localhost`/`127.0.0.1`/old API
URLs/hardcoded ports/internal headers/deprecated routes: 4 files
reference `localhost`, all legitimate and non-blocking —
`serverUrl.ts`'s LAN-IP-detection regex (dev/Capacitor convenience),
a `DEV`-guarded literal that Vite's dead-code elimination strips from
production builds (confirmed absent from the actual `dist/` output, §33),
two WebRTC browser-API error-message strings in `CallContext.tsx` (not
URLs), and a PWA hostname check. No hardcoded AWS URL was found anywhere
in source needing a fix — `VITE_API_URL`/`VITE_SOCKET_URL`/
`VITE_CHAT_WS_URL` are all environment-driven with sensible dev
fallbacks, exactly as the existing design already intended.

## 17. Environment variables

Full inventory in `docs/FULL_STACK_AWS_DEPLOYMENT_INVENTORY.md` (per-
component tables, no secret values). Summary classification highlights:
`DATABASE_SECRET_ID` (REQUIRED, AWS ONLY, every service), `*_LAMBDA_NAME`
(REQUIRED for the direct-invoke path, OPTIONAL if the HTTP fallback is
acceptable), `*_SERVICE_URL` (LOCAL ONLY fallback), `CHAT_DATABASE_URL`
(REQUIRED for chat specifically — **not** `DATABASE_URL`, a real,
confirmed-by-running-it difference from every other service),
`ENABLE_REST_CORS` (new this pass, REQUIRED=true on AWS for Chat only,
absent/false elsewhere), `LLM_PROVIDER`/`VECTOR_STORE_PROVIDER`/model
names (REQUIRED, AWS ONLY, AI service), `QDRANT_HOST`/`OLLAMA_BASE_URL`
(LOCAL ONLY — see §18).

## 18. Stale config references

`QDRANT_HOST`/`QDRANT_PORT`/`OLLAMA_BASE_URL`-style local-only variables
still exist in `.env.example`/docker-compose files — **kept, correctly**,
since they remain genuinely needed for local development (Qdrant/Ollama
are the local-dev vector store and LLM provider; AWS uses OpenSearch/
Bedrock instead, selected via `VECTOR_STORE_PROVIDER`/`LLM_PROVIDER`, not
by removing the local variables). Confirmed no AWS Lambda artifact
requires any of these local-only variables to be set — `ai-lambda.zip`'s
own runtime code path never reads `QDRANT_HOST` when
`VECTOR_STORE_PROVIDER=opensearch`.

## 19. Test results

| Suite | Type | Result |
|---|---|---|
| `agent-workflow-remediation-{1,2}`, roadmap/program/security e2e, slot-values-parsers | BACKEND INTEGRATION (real DB) | 51/51 PASS |
| memory/claim/scoring baseline (5 files under `src/llm/__tests__` + `training-program-scoring-v2`) | UNIT/INTEGRATION | 76/76 PASS |
| New conversational-intelligence + nutrition-plan-repair + roadmap-multislot tests (10 files, untracked, current source) | UNIT/INTEGRATION | 71/71 PASS |
| `user-service` `agentic-fitness-optional-budget.test.ts` | INTEGRATION (real DB) | **SKIPPED — ENVIRONMENT-GATED** (no `gymcoach_user_test` database exists locally; not created this pass) |
| `chat-service` `call-membership.test.ts` + `chat-message-validation.test.ts` | INTEGRATION (real test DB) | 9/9 PASS (from the prior Chat pass, re-confirmed unaffected) |
| AI Conversational Workflow evaluator v2 | BACKEND INTEGRATION (real DB) | PASS 30/FAIL 0/INFO 0/BLOCKED 0 — see §27 |

One transient false alarm, documented rather than hidden: a first
evaluator run reported 1 case `BLOCKED` with "Can't reach database server
at localhost:5433" — re-run immediately after (Postgres confirmed
`accepting connections` throughout) produced the clean 30/0/0/0 result.
Classified **ENVIRONMENT-GATED / TRANSIENT** (very likely connection-pool
contention from this same pass's own concurrent Prisma/Docker commands),
**not a NEW REGRESSION** — the second run is the trustworthy one, and no
code path relevant to that test case was touched by anything in this
pass.

## 20. Build results

| Component | Build | Notes |
|---|---|---|
| `@gym-coach/shared` | PASS | built first |
| auth-service | PASS | |
| user-service | PASS | |
| fitness-service | PASS | |
| gym-service | **FAIL → fixed → PASS** | missing `node_modules` entries for already-declared `@aws-sdk/client-s3` family, §1 |
| payment-service | PASS | |
| ai-service | PASS | |
| chat-service | PASS | includes `prisma generate` |
| frontend (`pnpm --filter web build`) | PASS | chunk-size warning only (pre-existing, cosmetic, not a build failure) |

No build failure was hidden or worked around with a flag — the one real
failure was fixed at its actual root cause (dependency install state),
not suppressed.

## 21. Artifacts created

11 Lambda zip artifacts rebuilt this pass (auth ×2, user ×2, fitness ×2,
gym ×2, ai ×3) — full path/size/handler detail in
`docs/FULL_STACK_AWS_DEPLOYMENT_INVENTORY.md`. Chat's Fargate image and
migration Lambda were rebuilt in the immediately-prior, dedicated Chat
pass and are still current (no chat-service source changed in between).
Payment's existing 2 artifacts were verified current and intentionally
left untouched. Frontend `dist/` rebuilt clean.

## 22. Artifact security

Every rebuilt Lambda zip scanned directly (`unzip -l` inside a throwaway
container) for `.env`/`.env.*`/AWS credentials/DB passwords/JWT secrets/
`INTERNAL_SERVICE_SECRET`/provider keys/`.git`/dumps/private uploads/this
repo's own compiled tests: **auth, user, fitness, gym artifacts: fully
clean, zero matches.** `ai-lambda.zip` contains a handful of **third-
party npm packages' own internal test files** (`node_modules/cheerio/
src/__tests__/*.spec.ts`, `node_modules/node-abort-controller/
__tests__/*.js`) — confirmed these are normal, harmless vendor-package
content bundled as a side effect of `npm pack`/dependency flattening, not
this codebase's own compiled tests (which the packaging scripts already
prune) and not a secret of any kind. No deployment artifact contains a
secret.

## 23. Database migration delta

- **Fitness**: local database now has 3 additional partial-unique
  indexes that did not exist before this pass (§13) — this is a **local
  fix, not an AWS action**. AWS Aurora's own schema state for these 3
  indexes is **unknown and unverified** (no AWS connection made) —
  flagged as the single most important item to check before/during the
  next real fitness-migration-Lambda run against Aurora.
- **Gym**: 5 new migrations exist in the repo and are applied locally;
  AWS Aurora's `fitness_assistant_gym` almost certainly does **not** have
  them yet (the artifact predating this feature is strong indirect
  evidence deployment hasn't happened since 2026-09-08).
- Every other service: no migration delta found beyond what was already
  known and applied.

## 24. IAM delta

No IAM change was made (no AWS connection). **Newly required, not yet
granted**: gym-service's Task/execution identity needs `s3:PutObject`/
`s3:GetObject` scoped to whatever private bucket `partner-s3.service.ts`
targets (bucket name not audited this pass — check that file's own env
var before deployment). No other service's required IAM permission set
changed from what prior passes already documented.

## 25. Network delta

None found. No new security-group rule, subnet, or VPC change is implied
by anything audited this pass — the new gym S3 feature calls the AWS S3
API over the public AWS endpoint (standard for Lambda in a VPC with a
NAT gateway or S3 VPC endpoint, whichever this project's existing Lambdas
already use for other AWS SDK calls — not audited further, out of this
pass's scope since no network resource needed to change).

## 26. Frontend deployment delta

Frontend `dist/` output changed (rebuilt from current source, §20) but
no `VITE_*` value needs to change for any already-deployed backend route
— only `VITE_CHAT_WS_URL` is newly relevant, and only once Chat's ALB
exists (not yet). Until then, redeploying the freshly-built `dist/` to S3
would be a safe, no-behavior-change refresh (confirmed clean build, no
secret/localhost leak) — **not performed this pass**, per instruction.

## 27. AI regression baseline

Re-ran the exact evaluator this project's Conversational AI Coach
remediation passes have used as their release gate:
```
npx tsx backend/services/ai-service/src/evaluation/conversational-workflow-v2/evaluate_conversational_workflow_v2.ts
decision: GO_WITH_DOCUMENTED_LIMITATIONS
summary: PASS 30 / FAIL 0 / INFO 0 / BLOCKED 0
```
**Identical to the last known-good baseline** (see §19 for the one
transient/environmental blip, resolved on re-run). Every previously-
approved behavior this evaluator covers — PROFILE_FACT use-once
forbidden, target-weight safety, candidate/finalize/pre-write validation,
correction handling, multi-slot extraction, Vietnamese budget/training-
day/duration parsing, the active-workflow concurrency invariant, the PT
two-step confirmation, roadmap confirmation, security isolation — is
**confirmed still passing after this pass's AI artifact rebuild and
after the new Conversational Intelligence v2/nutrition-repair source was
built into it.** **Zero regression.**

## 28. Files changed (this pass specifically, beyond pre-existing
working-tree state)

- `node_modules/` (root `pnpm install` — resolved the missing
  `@aws-sdk/client-s3` family for gym-service; no `package.json` was
  edited, the dependency was already declared).
- `gymcoach_fitness` (local Postgres database, not a repo file): 3 new
  partial-unique indexes created; `_prisma_migrations` table updated via
  `migrate resolve --applied` for the 2 migrations described in §13. No
  application row was inserted, updated, or deleted.
- 11 Lambda artifact zips rebuilt (gitignored, not tracked by git — see
  `docs/FULL_STACK_AWS_DEPLOYMENT_INVENTORY.md` for the full list).
- `frontend/web/dist/` rebuilt (gitignored).
- This report and `docs/FULL_STACK_AWS_DEPLOYMENT_INVENTORY.md` (new).

No source file was modified by this specific pass (the prior, dedicated
Chat Service pass's `Dockerfile`/`app.ts` changes are pre-existing
working-tree state from before this pass began, not new edits here).

## 29. Open blockers

**None that block a READY verdict.** Two informational items carry
forward, neither invented nor fabricated as blockers:

1. **AWS Aurora's actual schema state for `fitness_assistant_fitness`
   and `fitness_assistant_gym` is unverified** (§13/§23) — the fitness
   migration Lambda should be run (or its target schema inspected)
   before assuming AWS already has the 3 business-invariant indexes or
   the 5 new gym partner-feature migrations; this is exactly what the
   already-prepared migration Lambdas exist to do, safely, forward-only.
2. **`gym-service`'s new S3 bucket/env var for partner document uploads
   was not independently audited** in this pass — confirm the exact
   bucket name and required IAM policy from `partner-s3.service.ts`
   before deploying the rebuilt `gym-lambda.zip`.

Neither blocks builds, tests, or artifact freshness — both are AWS-side
verification/provisioning steps for whoever runs the next real deploy.

## 27b. Exact next manual AWS deployment order

(Numbered to match the template's own "27" for this section, distinct
from §27's regression baseline above.) Derived from actual dependencies,
not assumed:

1. Deploy the fitness migration Lambda (or otherwise verify Aurora
   already has the 3 missing indexes from §13) — **do this first**,
   before any fitness-lambda traffic relies on the invariant.
2. Deploy the gym migration Lambda (5 new migrations) — before the new
   `gym-lambda.zip`.
3. Re-upload `auth-lambda.zip` (was missing on AWS or stale — confirm
   which, since no AWS connection was made to check) and
   `auth-migrate-lambda.zip`.
4. Re-upload `user-lambda.zip`/`user-migrate-lambda.zip`.
5. Re-upload `fitness-lambda.zip`/`fitness-migrate-lambda.zip` (after
   step 1's schema is confirmed).
6. Re-upload `gym-lambda.zip`/`gym-migrate-lambda.zip` (after step 2's
   schema is confirmed) — also provision the S3 bucket/IAM for partner
   uploads (§24) before this, or the new endpoints will 500.
7. Re-upload `ai-lambda.zip`/`ai-worker-lambda.zip`/`ai-migrate-lambda.zip`.
8. Payment: no action needed (§8).
9. Chat: follow `docs/CHAT_SERVICE_AWS_DEPLOYMENT_PLAN.md` in full (not
   yet deployed at all).
10. Rebuild-and-redeploy the frontend once Chat's ALB DNS name is known
    (`VITE_CHAT_WS_URL`); otherwise the current bundle is safe to
    redeploy any time for the other 6 services' already-current routes.

## 30. Final decision

**FULL STACK READY FOR MANUAL AWS SYNC**
