# Chat Service — AWS Manual Console Deployment Plan

Companion to `docs/CHAT_SERVICE_AWS_READINESS_REPORT.md` (full audit and
evidence). This document is written for **manual deployment through the
AWS Console** — no Terraform/CDK, no AWS CLI. Nothing in this document has
been executed; every step below is prepared, not performed.

**Architecture**: ECS Fargate (task) + Application Load Balancer, in the
existing `fitness-assistant-dev-vpc`, private app subnets
(`fitness-assistant-dev-private-app-a/b`), talking to the existing Aurora
cluster. A separate one-time Lambda (`chat-migrate-lambda.zip`, already
built) creates `fitness_assistant_chat` and runs its migrations. No EC2
anywhere in this plan.

## Region / Account

All steps below are performed in **ap-southeast-1**, account
**191798898985**.

---

## Step 1 — Secrets Manager: chat database secret

Console → Secrets Manager → **Store a new secret**.

- Secret type: **Other type of secret**
- Key/value pairs (plaintext JSON also works — switch to the "Plaintext"
  tab and paste this shape, filling in real values you choose):
  ```json
  {
    "username": "<a real Aurora-compatible username>",
    "password": "<a strong generated password>",
    "host": "fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com",
    "port": 5432,
    "database": "fitness_assistant_chat"
  }
  ```
- Encryption key: default (`aws/secretsmanager`) unless this project uses
  a dedicated CMK for the other 6 service secrets — match whatever
  convention `fitness-assistant/dev/user-database` etc. already use.
- Secret name: **`fitness-assistant/dev/chat-database`** (exact name —
  `migrate-lambda.ts` reads `DATABASE_SECRET_ID` and expects this shape).
- Do not enable rotation for this pass (match the other 6 services'
  current configuration unless already changed there).
- **Do not paste a real password anywhere else** (not into the task
  definition's plain environment variables, not into any log).

If a dedicated Postgres role for chat doesn't exist yet on the Aurora
cluster, create it first via your existing Aurora access method (psql
from within the VPC, or whatever the other 6 services' setup used) with
at minimum `CREATEDB` privilege — `ensureChatDatabaseExists()` in the
migration Lambda needs to `CREATE DATABASE` the first time it runs.

---

## Step 2 — ECR repository

Console → ECR → **Create repository**.

- Visibility: Private
- Repository name: **`fitness-assistant-dev-chat`**
- Tag immutability: match the other 6 repositories' existing setting
- Scan on push: enable (match existing convention)

After creation, note the repository URI
(`191798898985.dkr.ecr.ap-southeast-1.amazonaws.com/fitness-assistant-dev-chat`)
— you'll push `gymini-chat-service:aws-local` (already built locally this
pass, `linux/amd64`) to it manually via `docker tag`/`docker push` from
your own terminal (outside this Console-only plan, but not an AWS
"deploy" action in the CLI/CDK sense — it's the standard Console-directed
image-push step every ECR repo needs).

Also create a **second** repository if you prefer separating the
migration Lambda's container packaging from its zip artifact — not
required here, since `chat-migrate-lambda.zip` is a plain Lambda zip
deployment package, not a container image.

---

## Step 3 — IAM: migration Lambda execution role

Console → IAM → Roles → **Create role**.

- Trusted entity: AWS service → Lambda
- Attach: `AWSLambdaBasicExecutionRole` (managed policy — CloudWatch Logs)
- Add an inline policy, scoped exactly:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "secretsmanager:GetSecretValue",
        "Resource": "arn:aws:secretsmanager:ap-southeast-1:191798898985:secret:fitness-assistant/dev/chat-database*"
      }
    ]
  }
  ```
- Role name: `fitness-assistant-dev-chat-migrate-role`
- This role also needs VPC access (ENI create/describe/delete) if the
  Lambda runs inside the VPC to reach Aurora — attach
  `AWSLambdaVPCAccessExecutionRole` too (standard for every other
  service's migration Lambda; match that exact pattern).

---

## Step 4 — Migration Lambda

Console → Lambda → **Create function**.

- Author from scratch
- Function name: **`fitness-assistant-dev-chat-migrate`**
- Runtime: **Node.js 22.x**
- Architecture: **x86_64**
- Execution role: use existing role → `fitness-assistant-dev-chat-migrate-role`
- After creation:
  - **Code** tab → **Upload from** → **.zip file** → upload
    `backend/services/chat-service/artifacts/chat-migrate-lambda.zip`
    from your machine.
  - **Runtime settings** → **Edit** → Handler: **`dist/migrate-lambda.handler`**
  - **Configuration → General configuration** → Timeout: **60 seconds**
    (schema is tiny — 3 migrations — but leave margin), Memory: **256 MB**.
  - **Configuration → Environment variables** → add:
    - `DATABASE_SECRET_ID` = `fitness-assistant/dev/chat-database`
    - `AWS_REGION` = `ap-southeast-1` (usually auto-set by the Lambda
      runtime already; add explicitly only if `migrate-lambda.ts`'s own
      fallback isn't picking it up)
  - **Configuration → VPC** → select `fitness-assistant-dev-vpc`, both
    private app subnets, and the existing `fitness-assistant-dev-lambda-sg`
    (it already has whatever egress-to-Aurora rule the other services'
    migration Lambdas rely on — confirm it allows TCP 5432 to the Aurora
    SG; if not, add that rule to the Aurora security group's inbound
    rules, source = `fitness-assistant-dev-lambda-sg`, not `0.0.0.0/0`).

---

## Step 5 — Run the migration

Console → Lambda → `fitness-assistant-dev-chat-migrate` → **Test** tab →
create a test event (empty `{}` body is fine, the handler takes no
input) → **Test**.

Expected successful response:
```json
{
  "status": "ok",
  "database": "fitness_assistant_chat",
  "databaseCreated": true,
  "migrateExitCode": 0,
  "output": "..."
}
```

If it throws `"Refusing to run Chat Service migrations against non-chat
database."` — the secret's `database` field is wrong; fix the secret
(Step 1) and re-run. If it throws a Prisma error, read the `output` field
in the thrown error message (it includes Prisma's own stderr) — never a
password, only migration SQL/connection diagnostics.

**Do not proceed until this returns `databaseCreated` (first run) or
`migrateExitCode: 0` on a re-run.**

---

## Step 6 — CloudWatch log group (runtime service)

Console → CloudWatch → Log groups → **Create log group**.

- Name: **`/ecs/fitness-assistant-dev-chat`**
- Retention: match the other 6 services' existing setting.

---

## Step 7 — IAM: ECS task execution role and task role

Two separate roles — do not conflate them.

**Execution role** (`fitness-assistant-dev-chat-execution-role`):
- Trusted entity: AWS service → Elastic Container Service → Task
- Attach: `AmazonECSTaskExecutionRolePolicy` (managed — covers ECR pull +
  CloudWatch Logs)
- If injecting the DB secret via the task definition's native `secrets`
  field (recommended, Step 9), add an inline policy:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "secretsmanager:GetSecretValue",
        "Resource": "arn:aws:secretsmanager:ap-southeast-1:191798898985:secret:fitness-assistant/dev/chat-database*"
      }
    ]
  }
  ```

**Task role** (`fitness-assistant-dev-chat-task-role`):
- Trusted entity: same (ECS Tasks)
- Inline policy — scoped Lambda invoke only:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "lambda:InvokeFunction",
        "Resource": [
          "arn:aws:lambda:ap-southeast-1:191798898985:function:fitness-assistant-dev-auth",
          "arn:aws:lambda:ap-southeast-1:191798898985:function:fitness-assistant-dev-user"
        ]
      }
    ]
  }
  ```
  (Confirm the exact deployed User Service Lambda function name in the
  Lambda console before pasting this — use its real name if different
  from `fitness-assistant-dev-user`.)
- Do **not** attach the Secrets Manager permission here too if the
  execution role already has it via task-definition `secrets` injection —
  pick one path (Step 9 explains which).

---

## Step 8 — Security group

Console → EC2 → Security Groups → **Create security group**.

- Name: **`fitness-assistant-dev-chat-sg`**
- VPC: `fitness-assistant-dev-vpc`
- Inbound rules: **none yet** — add exactly one after the ALB's own
  security group exists (Step 11): TCP 3005, source = the ALB's security
  group (not a CIDR).
- Outbound rules: default allow-all is acceptable (standard for an
  application SG that only needs to reach Aurora + Lambda + the internet
  for TURN/Metered calls), or scope it down to TCP 5432 → Aurora SG, TCP
  443 → 0.0.0.0/0 (Lambda invoke + Metered/TURN HTTPS calls) if this
  project's other services' SGs are scoped that tightly — match whatever
  convention they use.

Then, on the **Aurora cluster's own security group**, add an inbound
rule: TCP 5432, source = `fitness-assistant-dev-chat-sg`. **Never** add a
database-port rule with source `0.0.0.0/0`.

---

## Step 9 — ECS cluster (if none suitable exists)

Console → ECS → Clusters → check for an existing cluster the other
services' Fargate tasks (if any) already use. If none exists:

- **Create cluster** → Name: **`fitness-assistant-dev-cluster`** →
  Infrastructure: **AWS Fargate (serverless)** → Create.

---

## Step 10 — Task definition

Console → ECS → Task definitions → **Create new task definition**.

- Task definition family: **`fitness-assistant-dev-chat`**
- Launch type: **AWS Fargate**
- Operating system/architecture: **Linux/X86_64**
- Task size: **CPU: 0.5 vCPU, Memory: 1 GB** (DEV sizing — see the
  readiness report §26 reasoning: Node + Prisma + Socket.IO's connection
  bookkeeping is light at dev traffic levels, but 0.25 vCPU risks GC
  pauses under any real concurrent-connection load; 0.5/1GB is the
  conservative-but-not-oversized floor)
- Task execution role: `fitness-assistant-dev-chat-execution-role`
- Task role: `fitness-assistant-dev-chat-task-role`

**Container definition:**
- Name: `chat-service`
- Image URI: `191798898985.dkr.ecr.ap-southeast-1.amazonaws.com/fitness-assistant-dev-chat:<tag>`
  (the tag you pushed in Step 2)
- Port mappings: container port **3005**, protocol TCP, app protocol HTTP
- Environment variables (plain, non-secret):
  | Key | Value |
  |---|---|
  | `NODE_ENV` | `production` |
  | `CHAT_SERVICE_PORT` | `3005` |
  | `CORS_ORIGIN` | `http://fitness-assistant-frontend-dev-191798898985.s3-website-ap-southeast-1.amazonaws.com` |
  | `ENABLE_REST_CORS` | `true` |
  | `AUTH_LAMBDA_NAME` | `fitness-assistant-dev-auth` |
  | `USER_LAMBDA_NAME` | (the real User Service Lambda function name) |
  | `AWS_REGION` | `ap-southeast-1` |
- Secrets (native ECS secrets injection — recommended path, avoids
  writing a Secrets-Manager client into `server.ts`):
  | Key | Value source |
  |---|---|
  | `CHAT_DATABASE_URL` | *(see note below — the secret is a JSON object, not a single connection string)* |
  | `INTERNAL_API_SECRET` | a dedicated secret ARN for the shared internal secret (create this the same way as Step 1 if it doesn't already exist as its own secret; do not reuse the DB secret for it) |

  **Note on `CHAT_DATABASE_URL`**: the chat DB secret (Step 1) is a JSON
  object (`username`/`password`/`host`/`port`/`database`), not a single
  URL string — ECS's per-key `secrets` field (`valueFrom` with a
  `:key::` JSON-key suffix) can inject `username`/`password`/etc. as
  *separate* environment variables, but `server.ts`/`chat.repository.ts`
  expect one `CHAT_DATABASE_URL` connection string. Two options, pick
  one:
  - **(A, simplest for DEV)**: inject the 5 individual fields as separate
    env vars (`DB_USERNAME`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`,
    `DB_NAME`) via ECS secrets, and add a tiny startup shim (not present
    in source today — a real, small code change, do this before Step 12
    if you choose this path) that assembles `CHAT_DATABASE_URL` from
    them before `server.ts` starts.
  - **(B, zero code change, chosen for this plan)**: store a *second*,
    separate secret containing the fully-assembled connection string
    directly (e.g. `fitness-assistant/dev/chat-database-url`, plaintext
    value `postgresql://user:pass@host:5432/fitness_assistant_chat?schema=public`),
    and point the task definition's `CHAT_DATABASE_URL` secret at *that*
    ARN instead. This duplicates the credential across two secrets but
    requires no source change — acceptable for DEV; consider
    consolidating later if this pattern proves annoying to keep in sync.
- Health check (container-level, optional but recommended alongside the
  ALB's own): command `CMD-SHELL, wget -qO- http://localhost:3005/health || exit 1`,
  interval 20s, timeout 5s, retries 5, start period 30s — mirrors the
  existing `Dockerfile`'s own dev healthcheck convention exactly.
- Logging: **awslogs** driver, log group `/ecs/fitness-assistant-dev-chat`,
  region `ap-southeast-1`, stream prefix `chat`.

**Networking (on the service, not the task definition):** none set here
— configured in Step 12.

---

## Step 11 — Application Load Balancer

Console → EC2 → Load Balancers → **Create load balancer** → **Application
Load Balancer**.

- Name: **`fitness-assistant-dev-chat-alb`**
- Scheme: **Internet-facing**
- IP address type: IPv4
- VPC: `fitness-assistant-dev-vpc`
- Mappings: select subnets in at least 2 AZs — for an internet-facing
  ALB these must be **public** subnets (create/use existing public
  subnets in this VPC if the private-app subnets are the only ones
  listed in the task's own context — the ALB itself sits in public
  subnets and forwards into the private ones where the Fargate tasks
  run; this is standard and does not put Aurora or the tasks themselves
  in a public subnet).
- Security group: create a new one, **`fitness-assistant-dev-chat-alb-sg`**
  — inbound TCP 80 (and 443 if/when a certificate is added, §28 of the
  readiness report) from `0.0.0.0/0`; outbound: allow to
  `fitness-assistant-dev-chat-sg` on TCP 3005.
- Listener: HTTP : 80 → forward to a new target group (next step).

**Target group** (create during the same wizard, or separately first):
- Name: **`fitness-assistant-dev-chat-tg`**
- Target type: **IP** (required for Fargate)
- Protocol/port: HTTP / 3005
- VPC: `fitness-assistant-dev-vpc`
- Health check path: **`/health`**, healthy threshold 2, unhealthy
  threshold 3, timeout 5s, interval 20s (matches the container's own
  healthcheck cadence)
- **Attributes → Stickiness**: enable, type **Load balancer generated
  cookie**, duration **86400 seconds (1 day)** — see the readiness
  report §14 for exactly why this is needed while the frontend's Socket.IO
  client still tries polling before WebSocket upgrade.
- **Attributes → Deregistration delay**: **30 seconds**.
- **Attributes → Idle timeout** (this is actually an ALB-level attribute,
  set on the load balancer itself under **Load balancer attributes**,
  not the target group) — change from the 60s default to **120 seconds**.

After creating the SG, go back to `fitness-assistant-dev-chat-sg` (Step
8) and add the deferred inbound rule now: TCP 3005, source =
`fitness-assistant-dev-chat-alb-sg`.

---

## Step 12 — ECS service

Console → ECS → Clusters → `fitness-assistant-dev-cluster` (or the
existing one) → **Create service** (under "Services").

- Task definition: `fitness-assistant-dev-chat` (latest revision)
- Service name: **`fitness-assistant-dev-chat`**
- Desired tasks: **1** (DEV sizing — do not set higher without first
  adding the Redis adapter per the readiness report §9/§28)
- Deployment type: Rolling update
- Networking: `fitness-assistant-dev-vpc`, subnets = both
  `fitness-assistant-dev-private-app-a`/`-b`, security group =
  `fitness-assistant-dev-chat-sg`, **do not assign a public IP** (the ALB
  is the only public entry point; tasks stay private).
- Load balancing: Application Load Balancer → select
  `fitness-assistant-dev-chat-alb` → container `chat-service:3005` →
  existing listener (port 80) → existing target group
  `fitness-assistant-dev-chat-tg`.
- Health check grace period: **60 seconds** (gives the container's own
  30s `start_period` room plus margin for Prisma client init).

Create the service, then wait for the task to reach `RUNNING` and the
target group to report the target as `healthy`.

---

## Step 13 — Frontend environment update

This does **not** modify unrelated frontend code (per instruction) — only
adds one new build-time environment value.

- In the frontend's real `.env.production` (not committed — mirror the
  existing `.env.production.example` convention), add:
  ```
  VITE_CHAT_WS_URL=http://<fitness-assistant-dev-chat-alb-DNS-name>
  ```
  (Use the ALB's own DNS name shown on its Console detail page, e.g.
  `fitness-assistant-dev-chat-alb-123456789.ap-southeast-1.elb.amazonaws.com`
  — HTTP, not HTTPS, until Step 14/§28's TLS work is done.)
- Rebuild the frontend (`pnpm --filter web build`, same as any other
  frontend deploy) and upload the new build output to the existing
  frontend S3 bucket/site — **not performed by this plan**, per
  instruction ("Do NOT: ... upload S3 frontend").

---

## Step 14 — (Future, not DEV-blocking) TLS

Not set up in this plan (readiness report §28) — no domain was provided
or fabricated. When ready: request/import an ACM certificate for a real
domain pointed at the Chat ALB, add an HTTPS:443 listener, redirect
HTTP→HTTPS, and switch the frontend's `VITE_CHAT_WS_URL` to
`https://...` (Socket.IO automatically uses `wss://` when the page/socket
URL is `https://`).

---

## Step 15 — Real frontend smoke test

After Step 13's rebuild is live:
1. Load the frontend site, sign in.
2. Open a direct conversation with an eligible PT/client pair, confirm
   messages send/receive in real time (Socket.IO connects successfully —
   check the browser's Network tab for a `101 Switching Protocols` or
   successful polling handshake to the ALB DNS name).
3. Initiate a voice/video call between two real logged-in sessions,
   confirm ringing, accept, and ICE/media signaling work end to end.
4. Confirm a message sent while one party's socket is briefly
   disconnected still arrives (REST fallback path, §1 of the readiness
   report).

This step is **manual verification by a human**, not something this pass
performed — no browser test was run as part of this deployment
preparation (see the readiness report §21).
