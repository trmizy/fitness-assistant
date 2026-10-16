# 12 — Deployment and Infrastructure

## Verdict

**NO-GO.** The repository cannot reproduce a production environment. The only fully specified deployment is a local or single-host compose
stack that publishes plaintext HTTP. Terraform covers development only.

## Artefacts

| Artefact | Path | Assessment |
|---|---|---|
| Dev compose | `infra/compose/docker-compose.dev.yml` | Developer stack; publishes about 20 host ports (fine for dev) |
| Low-resource compose | `infra/compose/docker-compose.low-resource.yml` | Not reviewed in depth |
| Prod compose | `infra/compose/docker-compose.prod.yml` | One published port (`web:80`); services on the internal network; RDS endpoints by variable; secrets by `${…}` substitution |
| Verification override | `test/ai-chat-full-verification/docker-compose.verification.override.yml` | Test only; sets `CONVERSATIONAL_INTELLIGENCE_*` and `LLM_TIMEOUT_MS=170000` |
| Test compose | `docker-compose.test.yml` | CI-like test databases |
| Terraform | `infra/terraform/environments/dev`, modules `cloudfront-spa`, `iam`, `lambda-http-api`, `private-s3-bucket` | Dev only |
| CloudFormation | `infra/cloudformation/dev-on-demand.yaml` | Dev on-demand; not production |
| Monitoring config | `infra/monitoring/prometheus.yml`, Grafana | Not in prod compose (G-14) |
| Dockerfiles | 8 backend/gateway (`USER` set), web (no `USER`) | See G-31 |
| n8n | `infra/n8n/` | Workflow automation; exposure and credentials not reviewed (G-35 related) |

## Production compose — findings

- **Published ports:** only `web` at `80:80`. Services are on the default network. Good.
- **TLS:** none (G-03). `nginx.prod.conf` `listen 80`. No HSTS. No certificate volume.
- **Secrets:** `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `INTERNAL_API_SECRET` referenced by `${…}`. Empty values lead to the literal fallback in
  auth-service (G-01).
- **Database:** `DATABASE_URL` per service pointing at `${RDS_ENDPOINT}` with `sslmode=require`. Good. RDS itself is not defined in repo (G-12, G-13).
- **Redis:** `appendonly yes`, no password configured in the compose service block reviewed (`redis-server --appendonly yes` only). Network-only
  exposure; add `requirepass` or ACLs for production.
- **Qdrant:** `qdrant/qdrant:latest` (unpinned tag). Pin the version.
- **Ollama:** `ollama/ollama:latest` (unpinned). Pin. Model puller is a one-shot job (`restart: "no"`), a reasonable pattern.
- **Health checks:** present for gateway, auth, user, fitness, ai, payment, gym, redis, ollama. Liveness only (G-15).
- **Restart policy:** `unless-stopped` on services. Acceptable.
- **Startup ordering:** `depends_on` set, but not on health conditions everywhere (not verified line by line).
- **Migrations:** no migration service. Schema changes are not applied by the compose stack (G-04).
- **Environment:** `NODE_ENV: production` set for each Node service (seven matches). Good.
- **Scaling:** every service is a single container. No replicas, no load balancer, no sticky-session concern evident (Socket.IO state
  across replicas would need a Redis adapter; not verified).

## Images

- Backend and gateway images run as a non-root `USER`. Verified by Dockerfile grep (8 files).
- Web image runs as root (G-31).
- Base image digests are not pinned (tags such as `node:…` assumed; not verified).
- No image scanning in CI (G-11).

## Environment configuration

- `.env.example` (root) and `backend/services/ai-service/.env.example` are tracked. Placeholders only (checked for literal secret shapes; values not reproduced).
- Production variable list is not documented as a contract. Required and forbidden values must be listed (G-01, G-10).
- The live `.env` at repository root is gitignored (`.gitignore` lines 56–58). Good.

## AWS

- Terraform `lambda-http-api` creates one Lambda function, its log group, and an API Gateway permission. The function's runtime, handler and
  environment are module inputs for the dev environment only.
- IAM module exists; least-privilege policy not reviewed.
- S3 private bucket module: versioning enabled (in bootstrap and private bucket modules). Encryption and public-access block not verified.
- No RDS, ECS, EC2, ALB, WAF, Route 53, ACM, CloudWatch alarms, backups, or KMS keys in IaC.

## Scaling assumptions (to be stated)

- Single-region, single-instance per service in the compose topology.
- Stateful dependencies: PostgreSQL (per service), Redis (cache and rate limit), Qdrant, Ollama (CPU-bound inference; single model instance).
- Ollama is the throughput ceiling for AI turns (G-18).

## Required decisions and changes

1. Deployment target decision (G-12). Record it.
2. TLS and edge (G-03): managed load balancer or CloudFront with ACM.
3. Production IaC for the chosen target, including RDS with backups and encryption, Redis with auth, private subnets, security groups that expose
   only the edge (P5-T01).
4. Pin image versions and digests; add vulnerability scanning (G-22, G-11).
5. Redis authentication (new gap, folded into P5-T01).
6. Migration step with snapshot gate (G-04, P0-T05).
7. Monitoring and alerting deployed with the stack (G-14, P3-T01).
