# Gymini — Free / No-Verification Architecture Audit

Status: RESEARCH ONLY. No code, Terraform, infrastructure, environment variable, secret, or `architecture.drawio` was changed. No provider account was created, no paid API was called, no model was invoked.

Access date for all web sources: 2026-10-06. Some facts were read through a summarising fetch tool; where a page did not state a fact, it is marked UNKNOWN rather than assumed NO. Re-check the marked items before an owner decision.

## 0. Bottom line

- **There is no AWS path with zero verification.** Classic AWS sign-up requires a valid payment method and a phone (SMS or automated call) identity check. The newer "Sign up for AWS (new)" flow can skip the card in some cases, but it provisions the project only in `us-east-2`, `eu-north-1`, or `ap-southeast-2` (Vietnam maps to `ap-southeast-2`), not `ap-southeast-1`, and it excludes AWS Marketplace, which third-party Bedrock models depend on.
- **Free-tier traps are real.** The AWS Free plan ends after 6 months or when credits run out, the account then closes, and resources are kept for 90 days before deletion.
- **Free and verification-light options exist for the non-AWS parts.** Confirmed: Neon Postgres (no card, pgvector), Grafana Cloud (no card), Upstash Redis (no card for the free database), GitHub Actions for public repos (free). Local Docker stacks (Postgres, Redis, Qdrant, MinIO) and Ollama need no provider account and already exist in this repo.
- **Recommended direction:** `AWS_PROD_FREE_DEV` — keep AWS as the production target, and run DEV on the existing local Docker Compose stack plus local Ollama. Re-research the UNKNOWN items first.

## 1. Diagram parse (Phase 1)

Source: `C:\Users\ASUS\Downloads\fitness-assistant-serverless-architecture.drawio` (modified 2026-08-26, 73 KB, 92 labelled cells). Note: the file is in Downloads, not in the repository; the repository has no copy.

Distinct services/components in the diagram (Lambda counted once for six functions):

| # | Component | Diagram label |
|---|---|---|
| 1 | DNS | Amazon Route 53 |
| 2 | Web firewall | AWS WAF (optional) |
| 3 | CDN | Amazon CloudFront |
| 4 | Frontend storage | Amazon S3 frontend bucket (static website) |
| 5 | API | Amazon API Gateway (REST) |
| 6 | Compute | AWS Lambda: Auth, User, Fitness, Payment, Gym, AI (6 functions) |
| 7 | Background compute | Lambda Worker |
| 8 | Network | VPC 10.0.0.0/16, private app subnets A/B, private DB subnets A/B, Lambda VPC attachment (ENI) |
| 9 | Database | Aurora Serverless v2 PostgreSQL (primary + replica) |
| 10 | DB proxy | Amazon RDS Proxy (optional) |
| 11 | Uploads | Amazon S3 uploads bucket |
| 12 | Queue | Amazon SQS |
| 13 | Scheduler | Amazon EventBridge (plus "Advanced scheduling" optional) |
| 14 | Secrets | AWS Secrets Manager |
| 15 | Logs/metrics/alarms | Amazon CloudWatch (logs, alarms, dashboards) |
| 16 | Alerts | Amazon SNS |
| 17 | Tracing | AWS X-Ray (optional) |
| 18 | Cost | AWS Budgets |
| 19 | Cost | AWS Cost Explorer |
| 20 | LLM | Amazon Bedrock |
| 21 | Vector store | Amazon OpenSearch Serverless |
| 22 | Source | GitHub |
| 23 | CI/CD | GitHub Actions |
| 24 | Auth | GitHub OIDC |
| 25 | IaC | Terraform |

**Diagram total: 25 distinct components.**

## 2. Diagram vs repository (Phase 2)

Evidence method: tracked files in git (`git ls-files`, `git grep`), Terraform resource types, Docker Compose service names, and the runbook documents under `docs/`.

Terraform (`infra/terraform/environments/dev` + modules) actually declares: one hello-world Lambda (`lambda-http-api` module), an API Gateway HTTP API (`aws_apigatewayv2_*`), S3 buckets (frontend, uploads, `s3_vectors` module, tfstate), a CloudFront distribution with OAC, IAM roles, a GitHub OIDC provider and CI roles, CloudWatch log group, and `aws_budgets_budget` "monthly_dev". It does **not** declare Aurora, RDS Proxy, SQS, EventBridge, Secrets Manager, Bedrock, OpenSearch, Route 53, WAF, SNS, or X-Ray.

Docker Compose (`infra/compose/docker-compose.dev.yml`) runs the full application locally: web, api-gateway, auth/user/fitness/ai/chat/payment/gym services, knowledge-worker, postgres, redis, **qdrant**, **ollama**, ollama-model-puller, n8n, prometheus, grafana, exporters, db-seeder, **minio**, minio-init. Prod compose (`docker-compose.prod.yml`) has no postgres service (external DB), and includes qdrant and ollama.

Application code: the default vector store is **Qdrant** (52 source files reference it). `OpenSearchVectorStore` exists as an adapter with its own tests (4 source files). No pgvector use. LLM default is `LLM_PROVIDER=ollama` (`llm.service.ts`); Bedrock is an accepted provider value (checked in 4 places). Earlier batches in this session ran `qwen3:4b-instruct-2507-q4_K_M` locally through Ollama on `127.0.0.1:11434`.

Runbook documents (`docs/`, and the deployment Word runbook reviewed in the previous audit) describe the real AWS DEV deployment as including: ECS/Fargate task definitions for the Chat service, NAT Gateway, VPC endpoints (VPCE) for OpenSearch/Secrets, Aurora, OpenSearch, Bedrock Nova configuration, ECR, and Lambda jobs/migrate functions.

### Classification

**BOTH** (diagram and repo): Route 53 is NOT in repo; so:
- BOTH: Lambda (API functions), S3 (frontend + uploads), CloudFront, API Gateway, Aurora PostgreSQL, Secrets Manager, CloudWatch, Bedrock, OpenSearch (adapter), SQS, EventBridge, SNS, Budgets, GitHub, GitHub Actions, GitHub OIDC, Terraform.
- DIAGRAM_ONLY (not found in IaC or code; mentioned in docs at most): Route 53, AWS WAF, RDS Proxy, X-Ray, Cost Explorer.
- REPO_ONLY (in repo, absent from diagram): **Qdrant** (default vector store), **Ollama** (default LLM), **Redis** (queue/cache), **MinIO** (local S3), **n8n**, **Prometheus**, **Grafana**, **ECS/Fargate** for Chat (runbook), **NAT Gateway** (runbook), **VPC endpoints** (runbook), **ECR** (runbook commands), **S3 Vectors** (`s3_vectors` Terraform module), **local Postgres** (compose).

Counts: REPO_ONLY_SERVICES_FOUND = 13. The diagram is therefore out of date relative to the implementation, most importantly on the vector store (Qdrant in code, OpenSearch in diagram), the LLM (Ollama in code, Bedrock in diagram), and the presence of ECS and NAT.

## 3. AWS account reality (Phase 3)

Platform-level finding (official):

- **Classic (Sign up for AWS, advanced)** — `https://docs.aws.amazon.com/accounts/latest/reference/getting-started.html` — "You can't proceed with the sign-up process until you add a valid payment method." Phone: "You might need to confirm your identity … Send SMS … or the automated system contacts you." **Card: YES. Phone: YES (SMS or call).** Free Tier credits apply.
- **Sign up for AWS (new)** — `https://docs.aws.amazon.com/accounts/latest/reference/sign-in-new.html` — "When you sign up for AWS, we might request payment information. Our verification process holds USD $1 … for 3-5 days … You will not incur charges until you upgrade." Logins: Google, GitHub, Apple, Amazon. **Card: SOMETIMES. Phone: not stated on this page (UNKNOWN).**
- Region for the new flow — `https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html` — project provisioned in `us-east-2`, `eu-north-1`, or `ap-southeast-2` based on contact country. Vietnam is in the `ap-southeast-2` list. **Gymini's `ap-southeast-1` is not selectable in the new flow.** Also: CloudFront+WAF is unavailable; WAF and CloudWatch Logs are only in `us-east-1`.
- Feature gap of the new flow — `https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html` — the new flow does **not** include AWS Marketplace, Savings Plans, Region selection, or IAM Access Analyzer.
- Free plan — `https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html` — "Your free account plan ends after six months or when your credits are fully used - whichever occurs first." "After your free account plan expires, your account closes automatically … AWS retains your content for 90 days before permanently deleting your account." Free plan excludes services that "could possibly deplete your credits", including Savings Plans and certain Marketplace offers.
- Credits — `https://aws.amazon.com/free/` — "$100 in credits immediately plus earning up to $100 more," up to $200 over 6 months. "30+ AWS services are always free within monthly usage limits on both the Free and Paid plans."

Columns requested:

| Service | FREE_USAGE_AVAILABLE | NO_PAYMENT_VERIFICATION_AVAILABLE |
|---|---|---|
| Whole AWS account (classic) | credits + always-free list | **NO** — card + phone |
| Whole AWS account (new flow) | credits + always-free list | SOMETIMES — card only if asked; region restricted; no Marketplace |
| Lambda | YES — 1M requests + 400,000 GB-s/month (official `aws.amazon.com/lambda/pricing/`) | only inside an account that exists |
| S3 | YES — listed "Available on both plans" (numbers not fetched) | only inside an account |
| CloudFront | YES — Free plan "$0/month … 100GB … 1M" (`aws.amazon.com/cloudfront/pricing/`); permanence wording UNKNOWN | only inside an account |
| Aurora PostgreSQL Serverless v2 | YES, **12-month** free tier: "up to 4 ACUs and 1 GiB of storage per cluster" (`aws.amazon.com/rds/aurora/pricing/`) | only inside an account |
| Route 53 | NO free hosted zone ($0.50/zone/month); 50 health checks free | only inside an account, and billed |
| API Gateway, SQS, SNS, EventBridge, CloudWatch | listed in the "always free" group; numeric limits NOT fetched (UNKNOWN in this audit) | only inside an account |
| Secrets Manager | NO free allowance: $0.40/secret/month, $0.05 per 10k API calls | only inside an account |
| OpenSearch Serverless | NO free tier; classic collections minimum 2 OCU; NextGen scales to zero after 10 minutes idle (`aws.amazon.com/opensearch-service/pricing/`) | only inside an account |
| Bedrock | Nova/Amazon models auto-enabled; credits may apply | Anthropic needs a use-case form; third-party models need Marketplace permissions and "a valid payment method configured" (`docs.aws.amazon.com/bedrock/latest/userguide/model-access.html`) |
| AWS WAF | not verified on fetched pages | only inside an account; us-east-1 for new flow |

## 4. Service audit (Phase 4)

Verification fields use the exact wording from the brief. Where a value is not supported by an official page it is UNKNOWN.

**Amazon Route 53** — current provider AWS. Role: DNS for the custom domain. Required for current architecture: OPTIONAL (a custom domain is needed only for a public URL). Usage: low. Pricing: $0.50/hosted zone/month (first 25), $0.40 per million queries. Always free: NO. Free tier: NO (50 health checks free). Card: YES (billing account needed for paid zones). Phone: UNKNOWN. KYC: UNKNOWN. Manual approval: NO. NO_VERIFY_FRIENDLY: NO. Suitable for DEV: CONDITIONAL (skip the domain for DEV, use the CloudFront domain). Source: `aws.amazon.com/route53/pricing/`.

**AWS WAF** — AWS. Role: optional edge filtering. Required: OPTIONAL. Pricing not fetched from an official page in this audit (UNKNOWN). Free: UNKNOWN. Region: `us-east-1` restriction for CloudFront under the new flow (project-regions page). NO_VERIFY_FRIENDLY: NO (requires billing account). Suitable for DEV: NO (not needed). Source: project-regions page.

**Amazon CloudFront** — AWS. Role: CDN for frontend and the API path. Required: YES. Usage: low for DEV. Pricing: Free plan $0/month (100 GB, 1M requests, flat-rate). Always free: UNKNOWN (plan wording). Free tier: YES. Card: YES on classic signup. Phone: as account. NO_VERIFY_FRIENDLY: NO (account gate). Suitable for DEV: YES within an existing account. Source: `aws.amazon.com/cloudfront/pricing/`.

**Amazon S3 (frontend + uploads + vectors + tfstate)** — AWS. Required: YES. Usage: low. Pricing: always-free storage/request allowance on both plans (general page). Free tier: YES. NO_VERIFY_FRIENDLY: NO (account gate). Suitable for DEV: YES within an account. Note: S3 Vectors is used by the `s3_vectors` Terraform module, not by the runtime code path (Qdrant is the default).

**Amazon API Gateway** — AWS. Required: YES (REST/HTTP API front door). Pricing and limits not fetched (UNKNOWN). Free: listed in always-free group (UNKNOWN numbers). NO_VERIFY_FRIENDLY: NO. Suitable for DEV: YES within an account.

**AWS Lambda (6 service functions + Worker)** — AWS. Required: YES in diagram; in the repo, the running backend is containers/local, and Lambda is the AWS target. Free: 1,000,000 requests + 400,000 GB-s per month (official). Always free: general always-free list (YES per the free page). NO_VERIFY_FRIENDLY: NO (account gate). Suitable for DEV: YES within an account; the local Docker stack replaces it at $0.

**Aurora Serverless v2 (PostgreSQL) + RDS Proxy** — AWS. Required: YES for production; for DEV, replaceable. Pricing: $0.12/ACU-hour (Standard), $0.10/GB-month storage (official pricing page). Free tier: 12 months, up to 4 ACU and 1 GiB storage per cluster. Scales to zero: UNKNOWN (page does not say). Minimum 0.5 ACU; an always-on 0.5 ACU cluster costs about 0.5 × $0.12 × 730 h ≈ **$43.8/month** (arithmetic from official prices, not a quote). RDS Proxy: no free tier (not verified). Card: YES (classic). NO_VERIFY_FRIENDLY: NO. Suitable for DEV: CONDITIONAL.

**Amazon SQS** — AWS. Required: YES (job queue). Usage: low. Free: always-free group (numbers UNKNOWN in this audit). NO_VERIFY_FRIENDLY: NO. Suitable for DEV: YES within account; locally, Redis/BullMQ already works.

**Amazon EventBridge** — AWS. Required: YES (schedules). Free: always-free group (UNKNOWN numbers). NO_VERIFY_FRIENDLY: NO. Suitable: YES within account; local cron alternative possible.

**AWS Secrets Manager** — AWS. Required: YES in AWS target. Pricing: $0.40/secret/month + $0.05 per 10k API calls (official). Free: NO. Estimated fixed cost: ~8 secrets seen in runbook × $0.40 ≈ **$3.20/month** (arithmetic). Card: YES (classic). NO_VERIFY_FRIENDLY: NO. Suitable for DEV: CONDITIONAL — local `.env` secrets are the no-account substitute (repo already uses env vars locally).

**Amazon CloudWatch (logs, metrics, alarms, dashboards)** — AWS. Required: YES. Free: always-free group (numeric limits UNKNOWN here). Logs in new flow: `us-east-1` only. NO_VERIFY_FRIENDLY: NO. Suitable: YES within account; locally, Prometheus/Grafana in compose.

**Amazon SNS** — AWS. Required: OPTIONAL (alerts). Free: always-free group (UNKNOWN numbers). NO_VERIFY_FRIENDLY: NO. Suitable: YES within account; local alternative none needed.

**AWS X-Ray** — AWS. Required: OPTIONAL. Free: UNKNOWN in this audit. NO_VERIFY_FRIENDLY: NO. Suitable: NO for DEV (not used in code paths found; 1 reference).

**AWS Budgets / Cost Explorer** — AWS. Required: YES for cost alerts (Budgets is in Terraform). Budgets: first two budgets free (UNKNOWN in this audit). Cost Explorer: API charges (UNKNOWN). NO_VERIFY_FRIENDLY: NO. Suitable: YES within account.

**Amazon Bedrock** — AWS. Role: LLM provider. Required: OPTIONAL — the code default is Ollama; Bedrock is a configured alternative. Pricing: per-token (UNKNOWN in this audit). Free: credits may apply on the classic Free plan. Card: YES for any third-party model (valid payment method for Marketplace). Phone: as account. KYC: NO. Model approval: Nova auto-enabled; Anthropic needs the one-time use-case form (student-friendly: a GitHub or project URL is acceptable per the docs). NO_VERIFY_FRIENDLY: NO. Suitable for DEV: NO for paid third-party models; CONDITIONAL for Nova-only tests inside an account.

**Amazon OpenSearch Serverless** — AWS. Role: vector store. Required: NO for DEV — code default is Qdrant (see §2). Pricing: classic minimum 2 OCU; NextGen scales to zero after 10 minutes idle. Price example $0.24/OCU-hour on the page. Classic minimum ≈ 2 × $0.24 × 730 h ≈ **$350/month** (arithmetic). Free: NO. Card: YES (account). NO_VERIFY_FRIENDLY: NO. Suitable for DEV: NO (fixed cost too high for idle DEV).

**GitHub (source)** — GitHub. Required: YES. Free: free account; public repos unlimited Actions. Card: NO for the free plan (per GitHub billing doc). NO_VERIFY_FRIENDLY: YES (email/OAuth). Suitable: YES. Source: `docs.github.com/en/billing/concepts/product-billing/github-actions`.

**GitHub Actions** — GitHub. Required: YES (CI). Free: unlimited minutes on public repos with standard runners; private repos get 2,000 minutes/month on the free plan. Card: NO for the free plan, but "usage is blocked once you use up your quota" when no payment method is on file. NO_VERIFY_FRIENDLY: YES (until quota). Suitable: YES. Source: GitHub Actions billing doc.

**GitHub OIDC** — GitHub/AWS. Required: YES for keyless deploy to AWS. Free: included. NO_VERIFY_FRIENDLY: depends on the AWS account (NO). Suitable: YES within an AWS account.

**Terraform** — HashiCorp. Required: YES for IaC. Free: CLI free; state stored in S3 bucket (tfstate). NO_VERIFY_FRIENDLY: YES (no account needed for the CLI). Suitable: YES.

**Repo-only components**

**Qdrant (vector store, code default)** — local Docker (compose) at $0; Qdrant Cloud free cluster: 0.5 vCPU, 1 GB RAM, 4 GB disk (official pricing). Card: UNKNOWN. Pausing: UNKNOWN. Sign-up methods: UNKNOWN. Suitable for DEV: YES (local, zero change).

**Ollama (LLM, code default)** — local, runs on the developer machine. Account: not required (per search summary; the repo's own runs demonstrate local use). License: UNKNOWN from official page fetched (MIT/other is per-model, not verified). Suitable for DEV: YES. Latency is the constraint (see Batch 5 work, not repeated here).

**Redis + BullMQ** — local Docker at $0. Upstash Redis free: 500K commands/month, 256 MB, 10 databases; "no signup, credit card, or API key" for an instant database; upgrade requires a card. Card for the free database: NO (official). Suitable: YES.

**MinIO (local S3)** — AGPLv3 open source, local Docker, no account. Note: the community edition is now distributed as source code only (search summary; verify before relying on a binary). Suitable: YES for DEV.

**Local Postgres** — Docker, no account. Suitable: YES; Prisma-compatible.

**n8n / Prometheus / Grafana / exporters** — compose-only for DEV. Grafana Cloud free: 10k active metrics series, 50 GB logs, 50 GB traces, 3 users, **"No credit card required"** (official pricing page). Suitable: YES as a hosted observability option.

**ECS/Fargate (Chat), ALB, NAT Gateway, VPC endpoints** — AWS. Required for the current AWS DEV target per runbook. NAT Gateway and ALB charge hourly (not verified in this audit; UNKNOWN amounts). NO_VERIFY_FRIENDLY: NO. Suitable for DEV: NO — replace Chat with local Docker in DEV.

## 5. Free / no-card alternatives (Phases 5, 6)

Each candidate: explicit sign-up card status. Marketing words such as "free forever" were not treated as proof.

| Candidate | Responsibility covered | FREE_SIGNUP_WITHOUT_CARD | Evidence | Notes |
|---|---|---|---|---|
| **Neon** (Postgres) | Aurora replacement for DEV | **CONFIRMED** | `neon.com/pricing`: "The Free plan is permanent (not a trial); no credit card required." | Free: 100 CU-hours/project, 1 GB/project, 20 GB account, 100 projects; pgvector: "Postgres extensions (pgvector, PostGIS, TimescaleDB, and more)"; auto-suspend after 5 minutes on Free. Sign-up methods not stated on the page. |
| **Supabase** (Postgres) | Aurora replacement | UNKNOWN | `supabase.com/pricing`: 500 MB database, 5 GB egress, paused after 1 week inactivity, 2 active projects; card rule not stated. | pgvector confirmed on `supabase.com/docs/guides/database/extensions/pgvector`. Pausing makes DEV unreliable. |
| **Upstash Redis** | Redis/queue cache | **CONFIRMED** (free database) | `upstash.com/pricing`: "a free Redis database instantly, with no signup, credit card, or API key"; 500K commands/month; 256 MB; 10 databases. Card required only to upgrade. | QStash pricing not on fetched page → QStash UNKNOWN. |
| **Grafana Cloud** | CloudWatch/observability for DEV | **CONFIRMED** | `grafana.com/pricing/`: "No credit card required" across products; 10k series, 50 GB logs, 50 GB traces, 3 users. | Replaces dashboards for DEV only. |
| **GitHub Actions** | CI/CD | **CONFIRMED** (free plan, no payment method required for the plan itself) | GitHub billing doc: "A payment method is not required to use the free plan itself … usage is blocked once you use up your quota" | Public repos: unlimited standard runners. |
| **Cloudflare R2** (S3-compatible object storage) | S3 uploads for DEV | UNKNOWN (official page silent on card) | `cloudflare.com/plans/`: R2 Standard storage 10 GB-month, 1M Class A, 10M Class B on Free; community/secondary sources say "no credit card required" — **not confirmed on an official page**. | Free tier applies only to Standard storage. R2 is S3-API compatible (provider docs; not re-fetched). |
| **Cloudflare Workers** | Edge/API alternative | UNKNOWN (official) | Workers Free: 100k requests/day, 10 ms CPU per request. Card not stated on official page. | Not evaluated further. |
| **Google Gemini API (AI Studio)** | Cloud LLM / embeddings for DEV | Likely NO card, **not confirmed** | `ai.google.dev/gemini-api/docs/pricing`: free tier includes several chat and embedding models; "Content used to improve our products: Yes" for the free tier. | **Privacy trap:** free-tier content is used to improve products. Not suitable for personal fitness data. Chat rate limits not stated on the page. |
| **Groq API** | Cloud LLM for DEV | UNKNOWN | `console.groq.com/docs/rate-limits`: free rate limits per model (e.g. GPT-OSS 120b: 30 RPM, 1K RPD, 8K TPM). Card and data-training policy not stated. | Re-check the signup page before use. |
| **OpenRouter** | Multi-model gateway | UNKNOWN (no verification required per FAQ wording "small free allowance"; card not explicitly excluded) | FAQ: free models 50 requests/day; 1000/day after $10 of credits; "We do zero logging of your prompts/completions … unless you opt-in." | Training policy depends on provider; training toggle exists. |
| **Qdrant Cloud** | Hosted vector store | UNKNOWN | `qdrant.tech/pricing/`: free single-node 0.5 vCPU / 1 GB RAM / 4 GB disk, "Free forever", no card statement. | Pausing unknown. Local Qdrant is the no-account option. |
| **LocalStack** | Local AWS emulation | **FALSE** (for "no account") | `blog.localstack.cloud`: since 23 March 2026 the single image "requires a user account and an auth token"; the free Hobby plan is non-commercial only. | Do not classify as no-account. |
| **MinIO** | Local S3 | Not a cloud signup | AGPLv3; local Docker; no account needed (search summary, plus the repo's own compose file). | Use locally only. |
| **Ollama** | Local LLM | Not a cloud signup | Repo runs `qwen3:4b-instruct-2507-q4_K_M` locally on `127.0.0.1:11434` (verified in this session). Official "no account" statement not fetched. | Latency is the real cost, not money. |

## 6. AI provider audit (Phase 7)

Comparison only. No production change is recommended by this section.

| Provider / model | Chat | Embeddings | API | Free quota | Rate limit | Card | Phone | KYC | Model approval | Data / training | Commercial limits | NO_VERIFY_FRIENDLY | Gymini compatibility |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Ollama local** (`qwen3:4b-instruct-2507-q4_K_M`, the repo default) | YES | YES (`nomic-embed` / Ollama embeddings configured in repo) | local HTTP | unlimited local | hardware | NO | NO | NO | NO | local only | none | **YES** | **Yes — already the default** |
| Gemini API free tier | YES | YES | YES | free models, limits per model | per model; chat RPM/RPD not stated | not stated (UNKNOWN official) | UNKNOWN | UNKNOWN | NO | **content used to improve products on free tier** | not for sensitive personal data | PARTIAL | Low (privacy) |
| Groq (GPT-OSS 120b, Llama families) | YES | UNKNOWN | YES | 30 RPM, 1K RPD, 8K TPM (GPT-OSS 120b) | as listed | UNKNOWN | UNKNOWN | UNKNOWN | NO | not stated | not stated | UNKNOWN | Medium (speed; data policy to check) |
| OpenRouter (free models) | YES | UNKNOWN | YES | 50 req/day free; 1000/day after $10 credits | as listed | not required initially (FAQ) | UNKNOWN | UNKNOWN | NO | zero logging unless opt-in; training toggle | per provider | PARTIAL | Medium |
| Amazon Bedrock (Nova) | YES | YES (Cohere embed via Bedrock is third-party) | YES | credits on Free plan | per account | YES for 3P (Marketplace) | as account | NO | Nova auto-enabled; Anthropic use-case form; 3P needs Marketplace | AWS terms | AWS terms | **NO** for 3P; PARTIAL for Nova | High fidelity to prod |

## 7. Vector store audit (Phase 8)

Question: does DEV need a managed vector database?

- Current code default is **Qdrant** (local Docker, $0). Replacing it changes nothing in code.
- **pgvector** is supported on Neon (confirmed) and Supabase (confirmed). Current code does not use pgvector; PostgreSQL is used for relational data via Prisma.
- Moving vectors into PostgreSQL + pgvector would remove the OpenSearch collection cost (≈ $350/month classic minimum, arithmetic) and the OpenSearch VPC endpoint complexity. It requires a new vector-store adapter (the OpenSearch adapter shows the pattern).

Classification:
- Keep Qdrant locally: **ZERO_ARCH_CHANGE** for DEV (already the default).
- pgvector on the existing Postgres: **MEDIUM_CHANGE** (new adapter, index migration, retrieval tests).
- Replacing OpenSearch Serverless in production: **MEDIUM_CHANGE** plus data migration; not recommended without a measured cost or latency reason.

## 8. Database audit (Phase 9, DEV only)

| Option | FREE_STORAGE | FREE_COMPUTE | SLEEP/PAUSE | CONNECTION_LIMIT | DATABASE_LIMIT | POSTGRES_VERSION | PGVECTOR | CARD | KYC | PROJECT_EXPIRATION | SUITABLE_FOR_SCHEMA | MIGRATION_DIFFICULTY |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Local Docker Postgres (compose) | disk | host | none | local | many | per image | via image | NO | NO | none | YES | NONE |
| Neon Free | 1 GB/project, 20 GB account | 100 CU-hours/project | suspends after 5 min | not stated | 100 projects | not stated | **YES** | **NO (confirmed)** | not stated | permanent (per page) | YES (Prisma/Postgres) | LOW |
| Supabase Free | 500 MB | shared CPU | paused after 1 week idle | not stated | 2 active projects | not stated | YES (docs) | UNKNOWN | UNKNOWN | paused, not deleted | YES | LOW–MEDIUM |
| Aurora Serverless v2 (AWS) | per AWS | 12-month free: 4 ACU, 1 GiB | scale-to-zero UNKNOWN | — | — | — | — | YES | as account | 12-month free | YES | — (current) |

Prisma compatibility is inferred from Postgres compatibility and the repo's existing `postgres` service; not separately tested in this audit.

## 9. Verification-friction scale (Phase 10)

- L0 — no account: local Docker stacks, local Ollama, local MinIO.
- L1 — email/OAuth only: GitHub, Upstash Redis (no-signup database), Neon (email/OAuth; the no-card statement is confirmed), Grafana Cloud (no card), Google AI Studio (likely).
- L2 — email + phone: not observed as a required step in the sources except the AWS identity check.
- L3 — payment card / billing: AWS classic (card + phone), AWS Route 53 (paid zones), OpenSearch Serverless, Bedrock 3P (Marketplace), GitHub Actions beyond quota.
- L4 — identity/KYC/business verification: not observed in fetched official pages for any candidate; UNKNOWN for several providers.
- L5 — manual approval/usage history: Anthropic use-case form on Bedrock (one-time, granted immediately after submission per the docs).

Assignments (highest applicable level):
- AWS account (classic): L3 (card + phone check).
- AWS account (new flow): L3 (card may be requested) and a region restriction.
- AWS Bedrock 3P (Anthropic/Meta/Qwen etc.): L5 (use-case form and Marketplace/card).
- Neon, Upstash Redis, Grafana Cloud, GitHub: L1.
- Gemini API: L1 claimed, card UNKNOWN → treat as L3 until confirmed (conservative).
- Local Docker, Ollama, MinIO: L0.
- LocalStack: L1 at least (account + token).

## 10. Cost scale (Phase 11)

- F0 realistically $0/month: local Docker stack (Postgres, Redis, Qdrant, MinIO, Ollama, n8n, Prometheus, Grafana) on the developer machine; GitHub Actions on public repos; Neon Free (within limits); Upstash Redis Free (within limits); Grafana Cloud Free (within limits).
- F1 near-zero usage-based: Lambda, S3, CloudFront, API Gateway, SQS, EventBridge, CloudWatch, SNS within free allowances (AWS, requires account).
- F2 small unavoidable fixed monthly cost: Secrets Manager (~$3.20/month for ~8 secrets, arithmetic), Route 53 zone ($0.50/month), Budgets (small).
- F3 meaningful fixed monthly cost: Aurora Serverless v2 always-on at 0.5 ACU (≈ $43.8/month, arithmetic; storage extra).
- F4 expensive / unsuitable for idle DEV: OpenSearch Serverless classic (≈ $350/month minimum, arithmetic); NAT Gateway and ALB (hourly, not priced in this audit).

No dollar figure above is an official quote. They are arithmetic on official unit prices fetched on 2026-10-06; they exclude taxes, data transfer, and free-tier credits.

## 11. Architecture change impact (Phase 12)

| Alternative | CODE_CHANGE | INFRA_CHANGE | DATA_MIGRATION | SECURITY_CHANGE | LOCK_IN | DIAGRAM | PRODUCTION |
|---|---|---|---|---|---|---|---|
| Local Docker Postgres/Redis/Qdrant/MinIO for DEV | NONE (compose exists) | SMALL | NONE (seed) | SMALL (local secrets via `.env`) | LOWER | NO | DEV_ONLY |
| Ollama for DEV LLM | NONE (default) | NONE | NONE | NONE | LOWER | NO | DEV_ONLY (latency) |
| Neon for DEV Postgres | SMALL (connection string) | SMALL | REQUIRED (dump/restore) | SMALL (hosted DB, data leaves machine) | SAME | NO | DEV_ONLY |
| Upstash Redis for DEV | SMALL (Redis URL) | SMALL | NONE | SMALL | SAME | NO | DEV_ONLY |
| Grafana Cloud for DEV observability | SMALL (exporter config) | SMALL | NONE | SMALL (metrics only, no PII policy needed) | SAME | NO | DEV_ONLY |
| pgvector instead of Qdrant/OpenSearch | MEDIUM | SMALL | REQUIRED (re-embed) | SMALL | LOWER | YES (diagram drops OpenSearch) | DEV_ONLY until benchmarked |
| Gemini API as LLM | SMALL (provider config) | NONE | NONE | **SIGNIFICANT** (free-tier data used for product improvement) | HIGHER | NO | **NO** for personal fitness data |
| Groq / OpenRouter as LLM | SMALL | NONE | NONE | SIGNIFICANT (third-party logging/training policy to confirm) | HIGHER | NO | NO until data policy confirmed |

## 12. Do not destroy AWS production (Phase 13)

Two views are separated deliberately.

- **Production target:** keep the AWS-native architecture in the diagram, with the runbook corrections (Qdrant/Ollama vs OpenSearch/Bedrock must be reconciled in the diagram, not silently changed).
- **Development:** use the local Docker stack, local Ollama, and optionally Neon/Upstash/Grafana Cloud. Do not replace production services to reach $0 for DEV.

## 13. Local emulation (Phase 14)

| Capability | Option | NO_ACCOUNT_REQUIRED | NO_CARD_REQUIRED | OFFLINE_CAPABLE | DOCKER_REQUIRED | WINDOWS_FRIENDLY | CURRENT_CODE_COMPATIBILITY |
|---|---|---|---|---|---|---|---|
| Postgres | Docker postgres (compose) | YES | YES | YES | YES | YES (Docker Desktop) | YES (Prisma) |
| Redis/BullMQ | Docker redis (compose) | YES | YES | YES | YES | YES | YES (queue provider) |
| Vector store | Docker Qdrant (compose) | YES | YES | YES | YES | YES | YES (default) |
| S3 | Docker MinIO (compose) | YES | YES | YES | YES | YES | YES (minio-init) |
| LLM | Ollama (host) | YES | YES | YES | optional | YES | YES (default) |
| Secrets | `.env` / env vars | YES | YES | YES | NO | YES | YES (repo uses env) |
| Observability | Prometheus/Grafana (compose) | YES | YES | YES | YES | YES | YES |
| AWS emulation | LocalStack | **NO** (account + token since 2026-03) | UNKNOWN for Hobby | partial | YES | YES | partial |
| Scheduler | local cron / app timer | YES | YES | YES | NO | YES | to be checked (EventBridge not in repo) |

## 14. Do not count these as free (Phase 15)

- AWS Free plan credits: expire at 6 months or when used, then the account closes and resources are deleted after 90 days (free-tier-plans page).
- AWS new-flow sign-up: no card "might" be requested, but the region is fixed to Sydney/Stockholm/Ohio and Marketplace is missing, so Bedrock 3P models and Singapore resources are not available.
- AWS "always free" services: they require an AWS account, and the account itself is card + phone (classic).
- Bedrock third-party models: need Marketplace permission and "a valid payment method."
- Gemini API free tier: free, but content is used to improve products.
- Supabase Free: projects pause after 1 week of inactivity.
- Neon Free: suspends after 5 minutes idle (fine for DEV, not for always-on).
- Qdrant Cloud Free: small (1 GB RAM), pausing unknown.
- LocalStack: no longer a no-account option; free plan is non-commercial.
- OpenSearch Serverless: no free tier; classic minimum 2 OCU.
- Self-hosting on a paid VPS: not free.

## 15. Risk audit (Phase 16)

Gymini stores personal fitness and body-data, medical-adjacent records, and payment-related records. Therefore:

- **Free LLM tiers that train on content** (Gemini free tier) — reject for user data.
- **Hosted DB or Redis for DEV** — use synthetic or seed data only; never copy production user data.
- **Observability hosted services** — ensure log redaction (no secrets, tokens, health values).
- **Local Ollama** — best privacy for DEV; no data leaves the machine.
- **Auto-deletion/pausing** (Supabase, Neon suspend, AWS Free plan closure): not acceptable for any system holding real data; acceptable only for disposable DEV.
- **Data residency**: Neon/Upstash/Groq/Gemini region and processing location not verified in this audit (UNKNOWN). AWS new flow forces Sydney/Stockholm/Ohio, not Singapore.
- **Vendor lock-in**: AWS-specific services (Aurora Data API, Secrets Manager, SQS, EventBridge) increase lock-in; local substitutes via Postgres/Redis/S3-compatible reduce it.

No provider was recommended solely for being free.

## 16. Final service matrix (Phase 17)

| Capability | Current Service | Current Verification Level | Current Free Status | Best No-Card Candidate | Candidate Verification Level | $0 DEV Possible? | Change Effort | Recommendation |
|---|---|---|---|---|---|---|---|---|
| DNS | Route 53 | L3 | none | Skip domain for DEV (use CloudFront URL) | L0 | YES | SMALL | Skip in DEV; keep prod |
| WAF | AWS WAF | L3 | none | none needed for DEV | — | YES (omit) | NONE | Omit in DEV |
| CDN | CloudFront | L3 | free plan | CloudFront itself (in account) | L3 | CONDITIONAL | NONE | Keep |
| Frontend storage | S3 static | L3 | free allowance | local static server / Cloudflare Pages (UNKNOWN card) | L0–UNKNOWN | YES (local) | SMALL | Keep prod; local for DEV |
| API front door | API Gateway | L3 | always-free group | local API gateway (compose `api-gateway`) | L0 | YES | NONE | Keep prod; local for DEV |
| Compute | Lambda (6 + worker) | L3 | always-free (1M req, 400k GB-s) | local Docker services | L0 | YES | NONE (compose) | Keep prod; local for DEV |
| Network | VPC, subnets, ENI | L3 | none | not applicable locally | — | YES (none) | NONE | Keep prod |
| Database | Aurora Serverless v2 | L3 | 12-month free (4 ACU, 1 GiB) | Neon (no card) or local Postgres | L1 / L0 | YES | LOW | Local Postgres for DEV; Neon optional |
| DB proxy | RDS Proxy | L3 | none | not needed | — | YES (omit) | NONE | Omit in DEV |
| Uploads | S3 uploads | L3 | free allowance | MinIO (local) / Cloudflare R2 (UNKNOWN card) | L0 / UNKNOWN | YES (local) | SMALL | MinIO for DEV |
| Queue | SQS | L3 | always-free group | Redis + BullMQ (local) / Upstash (no-card DB; QStash UNKNOWN) | L0 / L1 | YES (local Redis) | SMALL | Local Redis for DEV |
| Scheduler | EventBridge | L3 | always-free group | local cron / app timer | L0 | YES | SMALL | Local for DEV |
| Secrets | Secrets Manager | L3 | none ($0.40/secret) | `.env` (local) | L0 | YES | SMALL | Keep prod; `.env` for DEV |
| Logs/metrics | CloudWatch | L3 | always-free group | Prometheus/Grafana (compose); Grafana Cloud Free | L0 / L1 | YES | SMALL | Compose for DEV |
| Alerts | SNS | L3 | always-free group | none needed | — | YES (omit) | NONE | Omit in DEV |
| Tracing | X-Ray | L3 | UNKNOWN | omit | — | YES | NONE | Omit |
| Budgets | AWS Budgets | L3 | 2 free (UNKNOWN here) | omit in DEV (no AWS spend) | — | YES | NONE | Keep prod |
| Cost analysis | Cost Explorer | L3 | API charges | omit | — | YES | NONE | Omit |
| LLM | Amazon Bedrock | L5 (3P) / L3 (Nova) | credits (classic) | Ollama local | L0 | YES | MEDIUM (already supported) | Ollama for DEV |
| Vector store | OpenSearch Serverless | L3 | none (≈$350/mo classic min) | Qdrant local (default) / pgvector | L0 | YES | ZERO (Qdrant) | Qdrant for DEV |
| Source | GitHub | L1 | free | — | L1 | YES | NONE | Keep |
| CI/CD | GitHub Actions | L1 | free (public unlimited; private 2,000 min) | — | L1 | YES | NONE | Keep |
| OIDC | GitHub OIDC → AWS | L3 (AWS side) | free | — | — | CONDITIONAL | NONE | Keep prod |
| IaC | Terraform | L0 | free CLI | — | L0 | YES | NONE | Keep |
| Chat service | ECS/Fargate + ALB + NAT (runbook) | L3 | none | local Docker chat service | L0 | YES | SMALL | Local for DEV |
| Network egress | NAT Gateway | L3 | none (hourly) | none (local) | L0 | YES | NONE | Omit in DEV |
| Private AWS access | VPC endpoints (VPCE) | L3 | none (hourly) | none (local) | L0 | YES | NONE | Omit in DEV |

## 17. Four shortlists (Phase 18)

**A. KEEP — already good** (free or near-free, no migration justified): GitHub, GitHub Actions (public repo), Terraform, S3 + CloudFront allowances (inside the AWS account), Lambda always-free allowance (inside the account), GitHub OIDC.

**B. FREE BUT VERIFY-HEAVY**: AWS account (classic: card + phone), AWS Free plan (6-month expiry, closure, 90-day deletion), Aurora 12-month free tier (then billed), Secrets Manager (no free allowance), Route 53 (paid zone), OpenSearch Serverless (no free tier; ≈$350/mo classic minimum), Bedrock 3P models (Marketplace + card), AWS WAF and CloudWatch Logs (us-east-1 under the new flow), NAT Gateway and ALB (hourly, not priced here).

**C. BEST NO-CARD ALTERNATIVES** (confirmed on official pages): Neon Postgres (no card, pgvector), Upstash Redis (no card for the free database), Grafana Cloud (no card), GitHub Actions/GitHub (no payment method for the free plan). Conditional: Gemini API (no card claimed but free-tier data trains products — not for personal data), Cloudflare R2/Workers (free limits confirmed, card UNKNOWN on official page).

**D. NO-ACCOUNT LOCAL OPTIONS**: Docker Postgres, Docker Redis, Docker Qdrant, Docker MinIO, Ollama (local LLM). LocalStack is excluded (account and token required).

## 18. Architecture scenarios (Phase 19)

| | Scenario A — current AWS | Scenario B — AWS prod + free DEV | Scenario C — max $0 / min verification DEV |
|---|---|---|---|
| Fixed monthly cost (arithmetic, official unit prices) | Aurora ≈ $43.8 (0.5 ACU always-on, excl. storage); Secrets ≈ $3.20; OpenSearch Serverless classic ≈ $350; Route 53 $0.50; NAT/ALB hourly (not priced) | Prod as A. DEV: $0 (local stack) | DEV $0; prod not applicable |
| Variable cost | Lambda/S3/CloudFront/API GW/SQS/CloudWatch beyond free allowances; Bedrock per token | Prod as A; DEV none | none |
| Verify friction | L3 (AWS card + phone), L5 for 3P Bedrock | prod L3; DEV L0–L1 | DEV L0–L1 (Ollama, local Docker, Neon/Upstash/Grafana optional) |
| Code change | none | small (env-driven config; compose already exists) | small–medium (pgvector if OpenSearch dropped) |
| Infra change | none | DEV: docker only | DEV: none for compute; prod unchanged |
| Architecture drift | none | DEV differs from prod (accepted, documented) | larger drift; risk of "works locally, fails in AWS" |
| E2E fidelity | highest | high for logic, lower for AWS-specific behaviour (IAM, VPC, Lambda limits, SQS/EventBridge semantics) | lowest for AWS-specific paths; use prod for final E2E |
| RECOMMENDED_USE | production | **recommended** for ongoing development | only for disposable prototypes |

## 19. Owner-decision table (Phase 20)

| Current Service | Keep? | Replace for DEV? | Proposed DEV replacement | Why | Verification requirement | Migration risk |
|---|---|---|---|---|---|---|
| Route 53 | Keep (prod) | Yes | none (CloudFront URL) | No DEV domain needed | none | LOW |
| AWS WAF | Keep (prod, optional) | Yes | omit | Not needed in DEV | none | LOW |
| CloudFront | Keep | No (cheap in account) | — | Free allowance | AWS account (L3) | — |
| S3 frontend | Keep | Yes | local static / `web` service | Compose already serves web | none | LOW |
| API Gateway | Keep | Yes | local `api-gateway` (compose) | Already exists | none | LOW |
| Lambda (6+worker) | Keep | Yes | local Docker services | Already exist; code runs locally | none | LOW |
| VPC/subnets/ENI | Keep | Yes | none (local) | Not needed | none | NONE |
| Aurora Serverless v2 | Keep | Yes | local Postgres (Neon optional) | Prisma-compatible; $43.8+/mo | none for local; Neon no-card (confirmed) | LOW (dump/restore) |
| RDS Proxy | Keep (optional) | Yes | omit | Not needed locally | none | NONE |
| S3 uploads | Keep | Yes | MinIO (local) | Compose already has MinIO | none | LOW |
| SQS | Keep | Yes | local Redis + BullMQ | Existing queue provider | none | LOW–MEDIUM (semantics) |
| EventBridge | Keep | Yes | local scheduler | Small usage | none | LOW |
| Secrets Manager | Keep | Yes | `.env` (local) | $0.40/secret; DEV secrets local | none | LOW (never commit secrets) |
| CloudWatch | Keep | Yes | Prometheus/Grafana (compose) | Compose already has it | none (or Grafana Cloud no-card) | LOW |
| SNS | Keep (prod) | Yes | omit | Not needed | none | NONE |
| X-Ray | Keep (optional) | Yes | omit | Not used | none | NONE |
| Budgets | Keep | Keep | — | Protects prod spend | AWS account | NONE |
| Cost Explorer | Keep | Keep | — | Analysis only | AWS account | NONE |
| Bedrock | Keep (prod) | Yes | Ollama local | $0, no account; already default | none | MEDIUM (model quality/latency) |
| OpenSearch Serverless | Keep (prod) | Yes | Qdrant local (default) | ≈$350/mo minimum | none | NONE (already default) |
| GitHub / Actions / OIDC / Terraform | Keep | Keep | — | Free and verify-light | GitHub account | NONE |
| ECS/Fargate Chat, ALB, NAT, VPCE | Keep (prod) | Yes | local chat container | Hourly costs | none | LOW–MEDIUM |

## 20. Remaining UNKNOWN items (re-check before the owner decides)

1. Cloudflare: whether signing up for the Free plan (R2/Workers) requires a payment method.
2. Supabase: card requirement for the Free plan.
3. Groq: card requirement and data-training policy for the free key.
4. Qdrant Cloud: card requirement and pausing behaviour of the free cluster.
5. Ollama: official licence and "no account" statement from `ollama.com` (the fetched docs page was incomplete).
6. AWS: numeric always-free limits for API Gateway, SQS, SNS, EventBridge, CloudWatch; WAF pricing; whether Aurora scales to zero.
7. AWS new-flow phone verification (the page did not say).
8. MinIO community edition distribution (source-only claim came from a search summary).

## 21. Final summary

DIAGRAM_SERVICES_FOUND: 25
REPO_ONLY_SERVICES_FOUND: 13
AWS_SERVICES_WITH_FREE_ALLOWANCE: 4 verified numerically (Lambda, CloudFront, S3, Aurora 12-month); about 5 more listed as always-free but numerically unverified (API Gateway, SQS, SNS, EventBridge, CloudWatch)
AWS_SERVICES_TRULY_NO_VERIFY: 0 (AWS account creation itself is card + phone on the classic path)
NO_CARD_ALTERNATIVES_FOUND: 4 confirmed (Neon, Upstash Redis free database, Grafana Cloud, GitHub Actions free plan); 3 conditional or UNKNOWN (Gemini, Cloudflare R2/Workers, Groq/OpenRouter)
NO_ACCOUNT_LOCAL_ALTERNATIVES_FOUND: 5 (Docker Postgres, Docker Redis, Docker Qdrant, Docker MinIO, Ollama)

BIGGEST_FREE_TIER_TRAPS:
- AWS Free plan: closes after 6 months or when credits run out; resources deleted after 90 days.
- AWS classic sign-up requires a card and a phone check.
- AWS new sign-up cannot select ap-southeast-1 and lacks Marketplace (blocks third-party Bedrock models).
- Aurora free tier is 12 months and capped at 4 ACU / 1 GiB.
- OpenSearch Serverless classic: 2-OCU minimum, about $350/month arithmetic.
- LocalStack needs an account and token since March 2026.
- Gemini free tier: content used to improve products.
- Supabase free projects pause after 1 week of inactivity.

TOP_5_EASIEST_ZERO_COST_WINS:
1. Run DEV on the existing Docker Compose stack (Postgres, Redis, Qdrant, MinIO) — no account.
2. Use Ollama locally as the DEV LLM — already the code default.
3. Keep GitHub Actions on the public repo — free, unlimited.
4. Grafana Cloud free for hosted metrics/logs — no card (official).
5. Neon free Postgres when a shared hosted DEV database is needed — no card (official), pgvector available.

TOP_5_SERVICES_NOT_WORTH_REPLACING:
1. Lambda (in account; free allowance; code already targets it).
2. S3 + CloudFront (free allowances; cheap; in account).
3. Secrets Manager (small fixed cost; security value; keep in prod).
4. Terraform + GitHub OIDC (no cost; keyless deploy).
5. Aurora for prod (keep; DEV can use local Postgres).

TOP_5_VERIFY_HEAVY_SERVICES:
1. AWS account itself (card + phone on classic).
2. Bedrock third-party models (Marketplace + card; Anthropic use-case form).
3. OpenSearch Serverless (no free tier; ≈$350/mo classic minimum).
4. Route 53 paid zone (billing).
5. AWS WAF / CloudWatch Logs under the new flow (us-east-1 only).

AI_NO_CARD_OPTION: Ollama local (`qwen3:4b-instruct-2507-q4_K_M`) — confirmed local, no account, already in use. Cloud no-card option NOT CONFIRMED (Gemini card unknown and trains on free content; Groq card UNKNOWN).
DATABASE_NO_CARD_OPTION: Neon Postgres — CONFIRMED no card, pgvector, scale-to-zero after 5 min (Free). Local Postgres for DEV.
VECTOR_STORE_NO_CARD_OPTION: Qdrant local (existing default, $0); pgvector on Neon (CONFIRMED pgvector, no card). Qdrant Cloud free card UNKNOWN.
FRONTEND_NO_CARD_OPTION: NONE CONFIRMED for a hosted static host without an account; local static serving via compose `web` is the zero-account option. Cloudflare Pages/R2 card status UNKNOWN.
QUEUE_NO_CARD_OPTION: Local Redis + BullMQ (zero account, existing code path). Upstash QStash: NOT CONFIRMED (pricing page lacked QStash details).

RECOMMENDED_DEV_ARCHITECTURE: local Docker Compose stack (Postgres, Redis, Qdrant, MinIO, the Gymini services, Prometheus/Grafana) + Ollama on the host. Optional: Neon for a shared DEV database; Grafana Cloud free for hosted observability; GitHub Actions for CI.

RECOMMENDED_PRODUCTION_ARCHITECTURE: AWS-native as in the diagram (retain Aurora, Lambda, API Gateway, CloudFront, S3, SQS, EventBridge, Secrets Manager, CloudWatch, Budgets). Reconcile the diagram with the implementation: Qdrant/Ollama vs OpenSearch/Bedrock, and ECS/NAT/VPCE for Chat. Decide Bedrock vs Ollama for prod on latency and cost, not on "free".

ESTIMATED_ARCHITECTURE_CHANGE: LOW for DEV (compose and env-driven config already exist); MEDIUM if DEV moves to pgvector.

Final recommendation (exactly one): **AWS_PROD_FREE_DEV**

Reason: AWS cannot be used without a card and phone check on the classic path, and the new path cannot select Singapore or use Marketplace models. So AWS stays the production target, while DEV moves to local and free no-card services. Four UNKNOWN items (§20) must be confirmed before the owner commits to any hosted DEV provider.

## 22. Sources (access date 2026-10-06)

- AWS Free Tier — `https://aws.amazon.com/free/` — "Free Cloud Computing Services - AWS Free Tier" — credits, always-free group.
- AWS Free plan terms — `https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html` — "Choosing a plan" — 6-month expiry, closure, 90-day retention.
- Sign up for AWS (advanced) — `https://docs.aws.amazon.com/accounts/latest/reference/getting-started.html` — "Sign up for AWS (advanced)" — card required; phone identity check.
- Sign up for AWS (new) — `https://docs.aws.amazon.com/accounts/latest/reference/sign-in-new.html` — "Sign up for AWS (new)" — card may be requested; $1 hold.
- Compare sign-up options — `https://docs.aws.amazon.com/accounts/latest/reference/sign-up-for-aws.html` — "Compare sign-up options" — feature gaps (Marketplace, Region selection).
- AWS Regions for your projects — `https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html` — us-east-2, eu-north-1, ap-southeast-2 assignment; WAF and CloudWatch Logs in us-east-1.
- Payment verification — `https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/manage-cc-verification.html`.
- Bedrock model access — `https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html` — "Request access to models" — default model access; Anthropic FTU form; Marketplace permissions and valid payment method for third-party models.
- Aurora pricing — `https://aws.amazon.com/rds/aurora/pricing/` — ACU price, 12-month free tier (4 ACU / 1 GiB).
- OpenSearch Service pricing — `https://aws.amazon.com/opensearch-service/pricing/` — classic 2-OCU minimum; NextGen scales to zero.
- Secrets Manager pricing — `https://aws.amazon.com/secrets-manager/pricing/` — $0.40/secret/month.
- Route 53 pricing — `https://aws.amazon.com/route53/pricing/` — $0.50/zone/month; 50 health checks free.
- Lambda pricing — `https://aws.amazon.com/lambda/pricing/` — 1M requests, 400,000 GB-s/month.
- CloudFront pricing — `https://aws.amazon.com/cloudfront/pricing/` — Free plan $0/month, 100 GB, 1M requests.
- Neon pricing — `https://neon.com/pricing` — no card required; pgvector; 5-minute suspend on Free.
- Supabase pricing — `https://supabase.com/pricing` — Free limits; 1-week pause.
- Supabase pgvector docs — `https://supabase.com/docs/guides/database/extensions/pgvector`.
- Upstash pricing — `https://upstash.com/pricing` — "no signup, credit card, or API key" free Redis.
- Cloudflare pricing — `https://www.cloudflare.com/plans/` — R2 and Workers free limits (card not stated).
- Cloudflare R2 pricing — `https://developers.cloudflare.com/r2/pricing/` — free limits, last updated 2026-10-01.
- Gemini API pricing — `https://ai.google.dev/gemini-api/docs/pricing` — free tier; content used to improve products.
- Groq rate limits — `https://console.groq.com/docs/rate-limits` — free per-model limits.
- OpenRouter FAQ — `https://openrouter.ai/docs/faq` — free models; zero logging unless opt-in.
- Qdrant Cloud pricing — `https://qdrant.tech/pricing/` — free cluster specs.
- Grafana Cloud pricing — `https://grafana.com/pricing/` — "No credit card required".
- GitHub Actions billing — `https://docs.github.com/en/billing/concepts/product-billing/github-actions`.
- LocalStack release/pricing posts — `https://blog.localstack.cloud/localstack-single-image-next-steps/` and `https://blog.localstack.cloud/2026-upcoming-pricing-changes/` — auth token and account required since 2026-03.
- MinIO — `https://github.com/minio/minio` — AGPLv3 (search result, not fetched in full).
- Ollama — `https://docs.ollama.com/quickstart` (search result; full page not fetched).
- Repository evidence: `infra/terraform/environments/dev/main.tf`, `infra/compose/docker-compose.dev.yml`, `infra/compose/docker-compose.prod.yml`, `backend/services/ai-service/src/services/llm.service.ts`, `backend/services/ai-service/src/services/embedding-config.ts`, `.github/workflows/docker-test.yml`.
