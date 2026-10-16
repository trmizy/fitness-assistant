# Chat Service — AWS Readiness Report

Date: 2026-09-22. Audit + deployment-readiness fixes + artifact preparation
only. No AWS connection, no AWS CLI, no AWS resource created/modified.

## 1. Executive summary

Chat Service is a Node.js/Express + **real Socket.IO** server (not raw
WebSocket, not SSE) backing text messaging and WebRTC voice/video call
signaling, backed by its own Postgres schema (4 models, 3 migrations, zero
seed data). It is genuinely stateful in-process (online-presence map, call
ring/grace timers) and uses Socket.IO's transport fallback
(`websocket`+`polling`) — this repository's own frontend client is
configured that way. Based on that evidence, **Lambda is not appropriate**
for the realtime/API server: converting Socket.IO to a Lambda-compatible
protocol would be a product rewrite, explicitly out of scope. **ECS
Fargate behind an Application Load Balancer** is the correct, evidence-
based choice — no EC2, consistent with the project's serverless-first
preference for everything that genuinely fits it, and a real exception
for the one component that doesn't.

Two real deployment-readiness defects were found and fixed:
1. The production `Dockerfile` failed to build at all — `pnpm install
   --frozen-lockfile` errored on a missing patch file for an unrelated
   frontend dependency recorded in the shared lockfile, because the
   `patches/` directory was never copied in (an omission `Dockerfile.dev`
   didn't have). Fixed; the image now builds and runs correctly, verified
   locally.
2. The REST API (`app.ts`) had **no CORS handling at all** — safe only
   because local dev always sits behind `backend/gateway`'s own Express
   proxy, which supplies it. On AWS, Chat's REST endpoints sit directly
   behind their own ALB with nothing else in front of them, so browser
   cross-origin REST calls would be silently blocked. Fixed with a
   default-off `ENABLE_REST_CORS` opt-in (verified: unset = identical to
   today's behavior, byte-for-byte, `true` = correct
   `Access-Control-Allow-Origin` on the real frontend origin).

Everything else audited — authentication, authorization (including three
separate cross-user-isolation guarantees already covered by this repo's
own regression tests), the migration Lambda, graceful shutdown, health
endpoint — was already correct and did not need changes. The migration
Lambda artifact (`chat-migrate-lambda.zip`) already existed, already
follows the same pattern as every other service's, and was rebuilt this
pass to guarantee it matches current source exactly.

**No AWS action was taken.** Everything below is audit findings, code
fixes already applied locally, and locally-built/tested artifacts.

## 2. Chat Service current architecture

Single Node process: one `http.Server` (`server.ts`) carries both an
Express app (`app.ts`) and a Socket.IO server (`socket/index.ts`) — they
are not separable into "API" vs. "realtime" without splitting the actual
runtime object both depend on. `prisma generate` targets
`native`/`linux-musl-openssl-3.0.x`/`rhel-openssl-3.0.x` (the RHEL target
already present for Lambda/Fargate on Amazon Linux 2023). No Redis,
BullMQ, SQS, or any background-worker file exists anywhere in this
service (grep-verified across `package.json` and `src/**`). Its own
`CHAT_DATABASE_URL` env var name (not `DATABASE_URL`, unlike every other
service) is a real, confirmed-by-running-it difference — noted throughout
this report and the deployment plan.

## 3. Protocols

| Protocol | Entrypoint | Transport | Connection lifetime | State | Horizontal-scaling requirement |
|---|---|---|---|---|---|
| HTTP REST | `app.ts` routes (`/health`, `/metrics`, `/chat/*`, `/chat/calls/*`, `/internal/*`) | plain HTTP/JSON | one request/response | none (stateless, DB-backed) | none — any number of instances behind an ALB works today |
| Socket.IO | `socket/index.ts` `initSocket()` | Socket.IO protocol (Engine.IO framing) over WebSocket **with polling fallback** — confirmed by the frontend's own `socketClient.ts`: `transports: ["websocket", "polling"]` | long-lived (minutes to hours; a call can run indefinitely) | **in-process**: `onlineUsers: Map<userId, Set<socketId>>`, `graceTimers: Map`, `ringTimeouts: Map` — all module-level, single-instance | **REQUIRED beyond 1 instance** — see §9 |
| Background jobs | none | — | — | — | n/a |

No SSE, no raw (non-Socket.IO) WebSocket endpoint, no BullMQ/SQS consumer.

**Socket.IO specifics audited, not assumed:**
- **Auth handshake**: `io.use()` middleware requires `socket.handshake.auth.token`
  (a real JWT) and calls `verifyToken()` — the exact same Auth-verification
  path the REST middleware uses (direct Lambda invoke if
  `AUTH_LAMBDA_NAME` is set, HTTP fallback otherwise). No client-supplied
  `x-user-id`/query-param identity is ever trusted for the socket
  connection itself.
- **Rooms**: `user:${userId}` (personal notification room, auto-joined),
  `admin:notifications` (ADMIN role only), and one room per
  `conversationId` — joining the latter requires a live
  `chatRepository.isUserParticipant()` DB check first (`chat:join_conversation`),
  and the send handler re-checks Socket.IO's own `socket.rooms` membership
  (not a separate, staleness-prone cache) before persisting a message.
- **Namespaces**: default namespace only; no custom namespaces.
- **Reconnect behavior**: the frontend client auto-reconnects (8 attempts,
  backoff to 5s) and refreshes the JWT on every (re)connect via an async
  `auth` callback — a stale token can never be handed to a resumed
  session.
- **Sticky-session / Redis adapter**: see §9. **No Redis adapter is
  configured today** (no `@socket.io/redis-adapter` dependency exists in
  `package.json`).

Socket.IO's own semantics (framing, polling fallback, room/namespace
model) are load-bearing for this application — it is not treated as "just
a WebSocket" anywhere in this report or its recommendations.

## 4. Authentication

REST (`middleware/auth.middleware.ts`): fast path first — trusts
`x-user-id`/`x-user-email`/`x-user-role` **only** when `x-gateway-secret`
matches this service's own `INTERNAL_SERVICE_SECRET`/`INTERNAL_API_SECRET`
(`@gym-coach/shared`'s `readGatewayVerifiedUser`, the same audited
mechanism every gateway-fronted service uses — a client can never see or
forge that secret because the gateway strips any client-supplied copy of
those headers before ever setting its own). Falls through to a real
`Authorization: Bearer <JWT>` → `verifyToken()` call otherwise. **No
client-supplied identity header is ever trusted without that secret
check.**

Socket.IO: **always** a real `verifyToken()` call against the handshake's
`auth.token` — no gateway-trust fast path exists for sockets (correctly:
a browser's raw WebSocket/polling connection isn't proxied through the
gateway's own header-stripping Express middleware the same way REST is
when connecting directly to an ALB).

**`verifyToken()`/`getInternalUser()` already support the exact same
direct-Lambda-invocation model as User/Fitness/Gym/Payment/AI**: if
`AUTH_LAMBDA_NAME` is set, calls go through
`@aws-sdk/client-lambda`'s `InvokeCommand` with an API-Gateway-v2-shaped
synthetic event (`lambda-http.client.ts`) instead of an HTTP round-trip.
This works identically whether Chat itself runs on Lambda or Fargate —
the only requirement is that whatever compute Chat runs on has an IAM
identity (a **Task Role** on Fargate, not the Task Execution Role) with
`lambda:InvokeFunction` scoped to the real
`fitness-assistant-dev-auth`/`fitness-assistant-dev-user` ARNs. No new
authentication mechanism was invented — the existing one already covers
this.

## 5. Authorization

Every conversation/message/call action was traced to its actual
authorization check (not assumed from naming):

| Action | Check | Cross-user isolation proof |
|---|---|---|
| Create direct conversation | `canCreateDirectChat` → user-service `/internal/chat-eligibility` (PT/client relationship or approved-PT discovery), fail-**closed** on error | delegated, not bypassable client-side |
| List conversations | `findConversationsByUserId(userId)` — query itself is scoped to the caller | structural — cannot return another user's rows |
| Read messages (REST) | `chatRepository.isUserParticipant(conversationId, userId)` before any row is returned | 403 otherwise |
| Send message (REST) | same `isUserParticipant` check before insert | 403 otherwise |
| Mark-read | same check, explicit in the controller | 403 otherwise |
| Join conversation room (socket) | `isUserParticipant` DB check before `socket.join()` | rejected with `chat:error` otherwise |
| Send message (socket) | re-checks `socket.rooms.has(conversationId)` (Socket.IO's own membership bookkeeping — as trustworthy as a fresh query, since joining already required the DB check) | rejected otherwise |
| Call initiate (chat-origin) | `canInitiateCallFromChat` — both caller and callee must be conversation participants, plus a user-service block-check (fails **open** if user-service is down — documented risk, not a cross-user leak since participant-check already passed) | |
| Call initiate (session-origin) | HMAC-SHA256 signed, timing-safe-compared `joinToken` (userId/sessionId/calleeId/purpose/expiry all bound) minted by user-service, verified in `joinToken.ts` | forged/reused/wrong-party tokens rejected |
| Call accept/reject/cancel/end | `call.callerId`/`call.calleeId` compared against the authenticated `userId` from the DB row, never trusted from the payload | `403`/silently ignored otherwise |
| ICE candidate / media toggle relay | `isCallParticipant(userId, call)` — **this exact check is the fix for a real, already-remediated P0** (documented in this repo's own `call.handler.ts` comment and covered by `call-membership.test.ts`): the original ternary's "else" branch resolved to the caller for ANY third party, not just the real callee, letting an unrelated authenticated user inject signaling into someone else's call | now fixed and regression-tested |

**Conclusion: knowing a `conversationId`/`callSessionId`/`userId` is
never sufficient on its own** — every read/write path re-derives
authorization from the database or a signed token, never from
client-supplied identity claims. Verified with the project's own real
regression test (`call-membership.test.ts`, 4/4 pass — see §21) which
specifically reproduces the exact attack scenario.

## 6. Database

`prisma/schema.prisma`, target `env("CHAT_DATABASE_URL")` (confirmed —
**not** `DATABASE_URL`, the only one of the 7 services with this
difference; running `prisma migrate deploy` with `DATABASE_URL` set
instead fails immediately with Prisma's own schema-validation error).

- **4 models**: `Conversation`, `ConversationParticipant`, `Message`,
  `CallSession`.
- **3 enums**: `ConversationType`, `CallType`, `CallStatus`, `CallOrigin`
  (4 enums total).
- **3 migrations**: `20260317060850_init_chat`,
  `20260413055255_add_call_sessions`,
  `20260525063358_make_conversation_id_optional`.
- **No `CREATE EXTENSION`, no raw/special SQL beyond ordinary
  CREATE TABLE/INDEX/ENUM/ALTER** (grep-verified across all 3 migration
  files).
- Indexes: `conversation_participants(conversationId, userId)` unique +
  `(userId)`; `messages(conversationId, createdAt)` + `(senderId)`;
  `call_sessions(callerId)` + `(calleeId)` + `(conversationId)` +
  `(status)`.
- FKs: `ConversationParticipant`/`Message`/`CallSession` →
  `Conversation`, all `ON DELETE CASCADE` (CallSession's
  `conversationId` is nullable — session-origin calls have no chat
  conversation at all).

**Fresh-database test, actually run** (not assumed): created an isolated
temporary database, ran `prisma migrate deploy` from zero — all 3
migrations applied cleanly, resulting schema matches production exactly
(verified via `\d` against every table). Confirms current repository
migration history alone can create `fitness_assistant_chat` from zero.
Never used `db push`/`migrate reset`/`--accept-data-loss`.

## 7. Migration status

Zero schema drift risk: no migration contains any `INSERT`/`COPY`/`UPDATE`/
`gen_random_uuid()`/hardcoded seed row (grep-verified, confirmed empty
result). This is the **only one of the 7 services with zero migration-
time data writes at all** — no reconciliation logic of any kind is needed
for Chat in the existing data-migration importer
(`scripts/data-migration-import-aws.mjs`'s `MIGRATION_SEEDED_TABLES` has
no `chat-service` entry, correctly).

## 8. Local Chat data compatibility

Using an isolated temporary database (never `gymcoach_chat` itself):
migrated schema from zero (§6), then restored
`artifacts/data-migration/chat-service/gymcoach_chat.data.dump` using the
same mechanism the full-migration importer uses (`_prisma_migrations`
excluded from the restore, `session_replication_role = 'replica'` for
the session). Result:

```
conversations: 1,475 / call_sessions: 18 / conversation_participants: 2,950 / messages: 10,318
```

— **every count matches local exactly**, 0 orphaned foreign keys
(`messages`/`conversation_participants`/`call_sessions` all resolve to a
real restored `conversations.id`), and `_prisma_migrations` retained
exactly its 3 canonical repo-history rows (not overwritten by local's
own copy). **BACKEND INTEGRATION** evidence, not assumed.

## 9. Redis requirements

**Not used today** (confirmed: zero references to `redis`/`ioredis`/
`bullmq` anywhere in `package.json` or `src/**`). Classification of the
in-process state that WOULD need it:

| State | Used for | Classification |
|---|---|---|
| `onlineUsers` (presence map) | `user:online`/`user:offline` broadcasts, "is callee online" check before ringing | **REQUIRED FOR HORIZONTAL SCALING** — with >1 Fargate task and no shared adapter, a user connected to instance A never sees presence events from a user on instance B, and `onlineUsers.has(calleeId)` on instance A will wrongly say "offline" for a callee actually connected to instance B |
| `graceTimers` / `ringTimeouts` | 30s reconnect grace, 30s ring timeout | **REQUIRED FOR HORIZONTAL SCALING** — same reasoning; a rejoin routed to a different instance than the one holding the timer will not find it |
| Socket.IO room fanout (`io.to(...)`) | message/call-event delivery to the right connected sockets | **REQUIRED FOR HORIZONTAL SCALING** — Socket.IO's own room bookkeeping is per-instance without an adapter; a recipient connected to a different instance than the sender never receives the emit |

**At today's DEV scale (`desiredCount = 1`), none of this is a
correctness problem** — every connection lands on the same single
process, so all in-memory state is trivially consistent. **The moment
`desiredCount` (or an auto-scaling policy) goes above 1, this becomes a
real correctness bug**, not a performance one: users can silently miss
messages/call events/presence updates depending purely on which task
they happened to connect to.

**Recommended AWS solution when scaling beyond 1 task**: **ElastiCache
Serverless for Redis** (managed, no capacity planning needed for dev-to-
small-prod traffic, consistent with "prefer managed/serverless") paired
with adding the `@socket.io/redis-adapter` + `ioredis` (or `redis`)
packages and calling `io.adapter(createAdapter(pubClient, subClient))` in
`initSocket()`. **This code change was deliberately NOT made this pass**
— it is a real product/dependency change, not a deployment-packaging fix,
and `desiredCount = 1` for DEV makes it unnecessary right now (per
instruction: "do not blindly deploy Redis if it is unnecessary" / "fix
only deployment-readiness issues that are necessary"). Flagged as an open
item for whenever DEV moves beyond a single task (§28).

## 10. Background jobs

None exist. No BullMQ worker file, no SQS consumer, no scheduled-job
entrypoint anywhere in this service. The only "background" behavior is
in-process `setTimeout`-based (ring timeout, reconnect grace) — these are
short-lived (30s) and belong with the realtime connection state they
manage, not a separate worker; splitting them out would require the same
Redis-backed cross-instance coordination as §9's presence/room state, not
a queue. No SQS/EventBridge Scheduler resource is needed for Chat at all.

## 11. Recommended AWS runtime

**ECS Fargate + Application Load Balancer**, for the HTTP+Socket.IO
server. **AWS Lambda**, unchanged from the existing pattern, for the
one-time database migration only (`chat-migrate-lambda.zip`, already
built and verified — see §7 and §22).

## 12. Why this runtime

- **Socket.IO is genuinely long-lived and stateful** (§3/§9) — Lambda's
  execution model (bounded invocation, no persistent in-memory state
  across invocations, no native Socket.IO-protocol support behind API
  Gateway) cannot host this without either (a) a full rewrite to raw
  API Gateway WebSocket semantics — explicitly forbidden by this task as
  a disguised product/architecture change, since Socket.IO's own framing,
  polling fallback, and room model would all have to be reimplemented or
  dropped — or (b) an external state store for every piece of connection
  state, which is most of what Fargate gets "for free" from just being a
  persistent process.
- **Cold starts** are irrelevant for a persistently-connected realtime
  server the way they matter for a bursty REST API — Fargate's steady-
  state process model fits the actual traffic pattern (long-lived
  connections, not independent short requests) better regardless of the
  above.
- **Sticky sessions / horizontal scaling**: Fargate + ALB is the standard,
  well-understood pattern for exactly this problem (target-group cookie
  stickiness, or a Redis adapter to remove the need for it — see §9/§14);
  API Gateway WebSocket API has no equivalent concept compatible with
  Socket.IO's own reconnect/room semantics.
- **Cost for dev**: one small Fargate task (§27 sizing) is inexpensive at
  dev traffic levels and avoids paying for an idle EC2 instance — no EC2
  is used anywhere in this design, per instruction.
- **Consistency with current Gymini architecture**: every other service
  is Lambda + API Gateway HTTP API because they are genuinely stateless
  REST — Chat's REST half (`/chat/*`) could theoretically be Lambda too,
  but splitting REST and Socket.IO into two different runtimes for one
  logical service, when they share a single `http.Server` object and a
  large amount of authorization/repository code, adds real operational
  complexity (two deployables, two sets of logs, two IAM identities to
  keep in sync) for no benefit — a single Fargate task serving both is
  simpler and was preferred.
- **Security/operational burden**: one ALB + one Fargate service is a
  small, well-trodden addition to the existing VPC/subnet layout, with no
  new resource category the existing infra doesn't already use
  conceptually.

## 13. API Gateway / ALB design

**Chat gets its own internet-facing ALB** (`fitness-assistant-dev-chat-alb`),
serving **both** `/chat/*` REST and `/socket.io/*` realtime traffic on the
**same target group** (`fitness-assistant-dev-chat-tg`, port 3005) — they
share one Express+Socket.IO process, so there is no reason to split
ingress. The existing `fitness-assistant-dev-api` (API Gateway HTTP API)
is **not** extended to route Chat traffic: it fronts Lambda proxy
integrations for stateless REST services, and Socket.IO's polling+
WebSocket-upgrade semantics do not map cleanly onto that integration
style even via a VPC Link — adding one would be new complexity for no
real benefit when a plain internet-facing ALB already does the job
directly, and the frontend already has a dedicated `VITE_CHAT_WS_URL`
escape hatch specifically for "a different origin than the main API" for
exactly this reason (confirmed in `frontend/web/src/app/config/serverUrl.ts`,
pre-existing, not added this pass).

Real route list (from actual source, not invented):
```
GET    /health                              (no auth — ALB health check target)
GET    /metrics                             (Prometheus scrape — internal only, see §19)
POST   /chat/conversations/direct
GET    /chat/conversations
GET    /chat/conversations/:id/messages
POST   /chat/conversations/:id/messages
PATCH  /chat/conversations/:id/read
POST   /chat/calls
PATCH  /chat/calls/:id/accept
PATCH  /chat/calls/:id/end
POST   /internal/push-notification           (x-internal-secret gated — see §18, do not expose publicly beyond what the ALB SG already restricts)
POST   /internal/calls/end-by-session        (x-internal-secret gated)
        /socket.io/*                         (Engine.IO handshake + WebSocket upgrade)
```
No generic `ANY /{proxy+}` — the ALB listener rule set should mirror this
exact path list plus `/socket.io/*` as a prefix match, nothing broader.
The two `/internal/*` routes are protected by the shared-secret check in
`app.ts` itself, but should additionally be restricted at the network
level (§27) since the ALB is otherwise internet-facing.

## 14. Network design

See §27 for the full VPC/SG detail. ALB-specific Socket.IO audit:

- **WebSocket upgrade support**: ALB natively supports HTTP/1.1 Upgrade
  for WebSocket on both HTTP and HTTPS listeners — no special
  configuration beyond a normal listener + target group.
- **Idle timeout**: ALB's default is 60s, which will kill a Socket.IO
  connection during any gap between application-level events (Socket.IO's
  own ping/pong keeps this from being an issue in practice, since it
  pings well under 60s by default, but this should be raised to a more
  generous value, e.g. 120s, specifically because a WebRTC call's
  signaling can go quiet for a while between events even though the call
  itself is still active) — **recommend setting `idle_timeout.timeout_seconds`
  to 120 on the ALB**.
- **Health path**: `/health` (lightweight, §20).
- **Target protocol/port**: HTTP, port 3005 (the container's own
  `CHAT_SERVICE_PORT`).
- **Sticky sessions**: **required today**, because the frontend's own
  Socket.IO client is configured with `transports: ["websocket", "polling"]`
  (confirmed, §3) — a polling-fallback handshake makes several independent
  HTTP requests before/instead of upgrading, and without stickiness those
  requests can land on different tasks the moment `desiredCount > 1`,
  breaking the handshake. **Enable ALB target-group cookie-based
  stickiness (`AWSALB` cookie, duration matching Socket.IO's own
  reconnection window, e.g. 1 day)** if/when `desiredCount` ever exceeds
  1. At `desiredCount = 1` (today's DEV setting) stickiness is a no-op
  (only one target exists) but costs nothing to enable now for
  forward-compatibility. **If a Redis adapter is added later (§9), pure
  WebSocket-only clients would no longer strictly need stickiness — but
  this app's own client still tries polling first, so stickiness stays
  the correct recommendation regardless of the adapter.**
- **Graceful draining**: enable ALB target deregistration delay (e.g.
  30s) so in-flight REST requests and Socket.IO connections get a chance
  to finish/reconnect elsewhere during a deploy, matching the
  application's own 10s SIGTERM-to-force-exit window (§20) with margin.

## 15. IAM design

**Task Execution Role** (`fitness-assistant-dev-chat-execution-role`):
- `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`,
  `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage` (ECR pull — scope
  `Resource` to the `fitness-assistant-dev-chat` repository ARN).
- `logs:CreateLogStream`, `logs:PutLogEvents` (scoped to
  `/ecs/fitness-assistant-dev-chat:*`).
- `secretsmanager:GetSecretValue` on the exact
  `fitness-assistant/dev/chat-database` secret ARN — **only if** secrets
  are injected via the task definition's native `secrets` field (the
  simplest AWS-native option); not needed if the container instead reads
  `DATABASE_SECRET_ID` and calls Secrets Manager itself at runtime with
  the Task Role instead (either is valid — pick one, don't grant both
  roles the same permission redundantly).

**Task Role** (`fitness-assistant-dev-chat-task-role`) — runtime AWS API
calls the application code itself makes:
- `lambda:InvokeFunction` scoped to exactly
  `arn:aws:lambda:ap-southeast-1:191798898985:function:fitness-assistant-dev-auth`
  and the equivalent User Service Lambda ARN — **never** `lambda:InvokeFunction *`.
- `secretsmanager:GetSecretValue` on `fitness-assistant/dev/chat-database`
  **only if** the app reads it directly (see above — avoid duplicating
  this on both roles).

No S3, no SQS, no other AWS API is called anywhere in this service's
source.

## 16. Secrets

Expected secret name: `fitness-assistant/dev/chat-database` (matches this
service's own already-implemented `migrate-lambda.ts`, which reads it via
`DATABASE_SECRET_ID`). Expected JSON shape (already coded against,
confirmed in `migrate-lambda.ts`'s `DatabaseSecret` type):

```json
{
  "username": "...",
  "password": "...",
  "host": "fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com",
  "port": 5432,
  "database": "fitness_assistant_chat"
}
```

**This secret was NOT created.** No value is printed anywhere in this
report or any file this pass wrote. The runtime container should receive
`CHAT_DATABASE_URL` either via the ECS task definition's native
`secrets` field (mapping to individual JSON keys via `valueFrom` with a
`:key::` suffix — the standard ECS pattern) or by replicating the
migration Lambda's own "read `DATABASE_SECRET_ID`, build the URL at
startup" approach in `server.ts` — **not currently implemented in
`server.ts`** (only `migrate-lambda.ts` does this); for DEV, the simpler
native ECS `secrets` injection into `CHAT_DATABASE_URL` directly is
recommended rather than adding Secrets-Manager-client code to the
runtime server. No password is ever hardcoded in source.

## 17. CORS

**Fixed this pass** (§1) — REST: `ENABLE_REST_CORS=true` +
`CORS_ORIGIN=http://fitness-assistant-frontend-dev-191798898985.s3-website-ap-southeast-1.amazonaws.com`
on AWS (verified locally: correct single-origin
`Access-Control-Allow-Origin`, never `*` with credentials). Socket.IO:
already correctly origin-scoped via the same `CORS_ORIGIN` variable
(`socket/index.ts`, pre-existing, unchanged). Both use a **single**
origin string, not a list — matches this service's existing convention
(unlike `TURN_URL`, which already supports comma-separated multiple
values elsewhere in this same service; Chat's CORS was never extended to
a list because only one frontend origin has ever existed). If a
CloudFront/custom domain is added later, this single-origin config is
trivially swapped to the new origin string — no code change needed,
confirmed by reading the implementation (`cors({ origin: process.env.CORS_ORIGIN, credentials: true })`
takes a plain string).

## 18. Frontend changes

Audited `frontend/web/src/app/{config/serverUrl.ts,realtime/socketClient.ts}`
and `.env.production.example` directly. **Currently**:
`.env.production.example` sets `VITE_API_URL` only — **no
`VITE_SOCKET_URL`/`VITE_CHAT_WS_URL` exists for the AWS target yet**,
correctly, since Chat isn't deployed. `chatSocketTarget()`
(`serverUrl.ts`) already has 3 resolution branches, in priority order: an
in-app runtime override, `VITE_CHAT_WS_URL` (direct-to-chat-service,
path `/socket.io`), then `VITE_SOCKET_URL` (via a gateway proxy, path
`/chat-socket.io`). **Exact production env change required**: add
`VITE_CHAT_WS_URL=http(s)://<chat-alb-dns-name>` to the real
`.env.production` used for the frontend build — this is the
already-designed-for "direct to chat-service" path, needing zero code
change, only a new env value once the ALB exists. No unrelated frontend
code was modified this pass, per instruction.

## 19. Observability

- **CloudWatch log group**: `/ecs/fitness-assistant-dev-chat` (Fargate
  naming convention — the plan's own guidance, followed exactly since
  Fargate is the chosen runtime, not Lambda's `/aws/lambda/...` form).
- Structured logging already exists via `@gym-coach/shared`'s `pino`
  logger — request method/path/IP per HTTP request, `userId`/`socketId`
  on connect/disconnect, auth-rejection paths (`Auth middleware error`),
  DB error logging in every controller's catch block. **Never logs**: JWT
  token value, password, `INTERNAL_SERVICE_SECRET`/`INTERNAL_API_SECRET`
  value, DB credentials, or full message content in any log line audited
  (message *events* are logged with metadata like `conversationId`, not
  `content`, in the socket handlers — confirmed by re-reading every
  `logger.info`/`logger.error` call site in `chat.handler.ts`/
  `call.handler.ts`). `/metrics` (Prometheus) exposes connection counts
  and message counters only, no PII.
- Recommend restricting `/metrics` to internal-only access at the ALB/SG
  level (it is not currently gated by any secret in code) — internal
  monitoring should scrape it via a private path, not the public
  internet-facing listener.

## 20. Health / shutdown

`GET /health` (`app.ts`) returns process status/uptime only — **no DB
query, no Redis check, no external call** — exactly the lightweight
liveness check AWS target-group health checks need; verified running
against the real built container. Given the service has no Redis
dependency today and a DB outage would surface as request-level 5xxs
rather than making the process itself unhealthy, a plain liveness check
(not a DB-connectivity readiness check) is the correct choice here — a
DB-down chat service should still report healthy so ALB doesn't cycle
tasks needlessly during a transient DB blip; individual requests already
fail informatively.

**Graceful shutdown**: already fully implemented in `server.ts` — SIGTERM
closes the Socket.IO server, disconnects Prisma, closes the HTTP server,
with a 10s hard-exit fallback (`setTimeout(..., 10000).unref()`) if
something (e.g. a stuck connection) never lets `close()` finish. The
Dockerfile's `CMD ["sh", "-c", "exec node dist/server.js"]` uses `exec` so
Docker's SIGTERM actually reaches the Node process instead of dying with
the wrapper shell — verified both by reading the code and by a real
`docker stop -t 15` against the running container completing without
hitting the timeout. **Nothing needed to be added here** — set the ECS
task's own `StopTimeout` to at least 15s to give this existing mechanism
room to finish (ECS defaults to 30s, already sufficient).

## 21. Test results

| Test | Evidence type | Result |
|---|---|---|
| `pnpm --filter @gym-coach/chat-service build` (tsc + prisma generate) | UNIT (build) | PASS |
| `npx tsc --noEmit` after the CORS fix | UNIT (typecheck) | PASS |
| `prisma migrate deploy` on a fresh temp DB from zero | INTEGRATION (real DB) | PASS — schema matches production exactly |
| Existing `call-membership.test.ts` (4 cases, incl. the cross-user ICE-candidate injection regression) | INTEGRATION (real test DB, `gymcoach_chat_test`) | 4/4 PASS |
| Existing `chat-message-validation.test.ts` (5 cases) | UNIT | 5/5 PASS |
| Health endpoint on the real built container | LOCAL RUNTIME | PASS — `{"status":"healthy",...}` |
| REST auth rejection (no token / invalid token) on the real container | LOCAL RUNTIME | PASS — both `401` |
| Socket.IO connect rejection with no token, real `socket.io-client` against the real container | LOCAL RUNTIME | PASS — `connect_error: "Authentication required"` |
| CORS preflight with `ENABLE_REST_CORS=true` | LOCAL RUNTIME | PASS — correct single-origin header |
| CORS behavior unchanged with the flag unset | LOCAL RUNTIME | PASS — no CORS header at all, identical to pre-fix behavior |
| Graceful shutdown (`docker stop -t 15`) | LOCAL RUNTIME | PASS — container exits within the grace period |
| Data-only restore of the real local dump into a fresh schema | BACKEND INTEGRATION (real DB) | PASS — exact row counts, 0 orphaned FKs (§8) |
| Real browser end-to-end chat/call flow | **NOT TESTED** — no browser test was run this pass | N/A, not claimed |

No claim of `REAL BROWSER` testing is made anywhere in this report.

## 22. Artifacts created

- `backend/services/chat-service/artifacts/chat-migrate-lambda.zip` —
  rebuilt this pass (69.29 MB compressed, 2,879 entries), handler
  `dist/migrate-lambda.handler`, Node.js 22.x/x86_64-compatible RHEL
  Prisma engines included.
- Local Docker image `gymini-chat-service:aws-local` (`linux/amd64`,
  587 MB uncompressed / ~146 MB compressed layer size) built from the
  now-fixed `backend/services/chat-service/Dockerfile` — this file (not a
  separately named `Dockerfile.aws`) is the canonical AWS production
  image build, since it was already a dedicated multi-stage production
  build distinct from `Dockerfile.dev`; not pushed to ECR.
- This report and `docs/CHAT_SERVICE_AWS_DEPLOYMENT_PLAN.md`.

No Lambda artifact was built for the realtime/API server (correctly —
that component runs on Fargate, not Lambda; see §11-12).

## 23. Artifact security

`chat-migrate-lambda.zip` contents audited directly (`unzip -l` inside a
throwaway container, not assumed): no `.env`, no `.git`, no test files,
no credentials of any kind — only `node_modules/.bin/*` CLI shims (normal,
harmless), the compiled `dist/migrate-lambda.js` handler, `prisma/schema.prisma`
+ all 3 real migration files, and the RHEL Prisma query/schema engines
required for `prisma migrate deploy` to run inside Lambda. The Docker
image was built from the production `Dockerfile`, which already excludes
`.env`/`.git`/source `src/`/test files by construction (multi-stage build
only copies `dist/`, `node_modules`, `package.json`, `prisma/` into the
final `runner` stage) — confirmed by reading the Dockerfile's own COPY
list, not merely trusting the stage name.

## 24. AWS resources required (not created)

- ECR repository: `fitness-assistant-dev-chat`
- ECS cluster: reuse an existing suitable cluster if one exists (not
  audited — no AWS connection made this pass to check); otherwise
  `fitness-assistant-dev-cluster`
- ECS service: `fitness-assistant-dev-chat` (Fargate launch type,
  `desiredCount: 1` for DEV — §26)
- Security group: `fitness-assistant-dev-chat-sg`
- ALB: `fitness-assistant-dev-chat-alb` (internet-facing)
- Target group: `fitness-assistant-dev-chat-tg`
- Secrets Manager secret: `fitness-assistant/dev/chat-database` (contract
  only — §16, not created)
- CloudWatch log group: `/ecs/fitness-assistant-dev-chat`
- IAM roles: `fitness-assistant-dev-chat-execution-role`,
  `fitness-assistant-dev-chat-task-role` (§15)
- Migration Lambda: `fitness-assistant-dev-chat-migrate` (artifact ready,
  §22 — function itself not created)

All AWS naming fits within AWS's own length limits (ALB name ≤32 chars —
`fitness-assistant-dev-chat-alb` is 30; target group name ≤32 chars —
`fitness-assistant-dev-chat-tg` is 29; every other resource type's limit
is far more generous than these names need).

## 25. Exact manual AWS deployment order

See `docs/CHAT_SERVICE_AWS_DEPLOYMENT_PLAN.md` for full Console-click
detail. Order, derived from actual dependencies (not the task's own
example order, adjusted where evidence required it): Secrets Manager
secret → logical database bootstrap (via the migration Lambda, which
itself safely creates the DB if missing, §7/§22) → run the migration →
ECR repository + image push → CloudWatch log group → IAM roles → ECS
cluster/task definition/service → ALB + target group + listener → SG
rules (§27) → frontend `VITE_CHAT_WS_URL` env update + rebuild → real
browser smoke test.

## 26. Data migration impact

None beyond what the existing 7-service data migration plan already
covers. Chat's dump (`artifacts/data-migration/chat-service/gymcoach_chat.data.dump`)
needs no reconciliation logic (§7) and was already proven to restore
cleanly into a schema built from current repo migration history (§8).
This pass changed no application code path that touches persisted data
shape — the CORS and Dockerfile fixes are deployment/transport-layer
only.

## 27. Environment variables

| Variable | Required | AWS value | Notes |
|---|---|---|---|
| `CHAT_DATABASE_URL` | Yes | from Secrets Manager (§16) | **not** `DATABASE_URL` |
| `CHAT_SERVICE_PORT` | Yes | `3005` | matches `EXPOSE 3005` |
| `NODE_ENV` | Yes | `production` | |
| `CORS_ORIGIN` | Yes | `http://fitness-assistant-frontend-dev-191798898985.s3-website-ap-southeast-1.amazonaws.com` | single origin, used by both Socket.IO and (when enabled) REST CORS |
| `ENABLE_REST_CORS` | Yes (new, this pass) | `true` | see §1/§17 — must be explicitly set on AWS |
| `AUTH_LAMBDA_NAME` | Recommended | `fitness-assistant-dev-auth` | enables direct Lambda invoke instead of HTTP fallback |
| `USER_LAMBDA_NAME` | Recommended | the real User Lambda function name | same reasoning |
| `AUTH_SERVICE_URL` / `USER_SERVICE_URL` | Fallback only | not needed if the above two are set | HTTP fallback path, dev-only in practice |
| `INTERNAL_API_SECRET` (aka `INTERNAL_SERVICE_SECRET`) | Yes | from Secrets Manager or a dedicated secret, never hardcoded | gates `/internal/*` routes and signs join tokens |
| `AWS_REGION` | Yes | `ap-southeast-1` | used by both the Lambda-invoke client and Secrets Manager client |
| `TURN_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` | Optional | a real TURN provider for cross-network WebRTC calls | dev-only Open Relay defaults are rate-limited/shared — fine for DEV, not for real traffic |
| `METERED_DOMAIN`/`METERED_API_KEY` | Optional | a real Metered.ca account | preferred over the static TURN fallback if configured |

Network plan (§14 continuation): Chat SG → Aurora SG TCP 5432 (private
subnets only, never `0.0.0.0/0`); ALB SG → Chat SG on TCP 3005 only;
Internet → ALB SG on 80/443 only. No Redis SG rule needed today (§9).

## 28. Open blockers

**None that block a READY verdict for DEV, single-task deployment.**
Two forward-looking items, explicitly not blockers for `desiredCount = 1`:

1. **Redis adapter needed before scaling beyond 1 Fargate task** (§9) —
   not implemented this pass (a real code/dependency change, out of
   deployment-packaging scope); must be added before increasing
   `desiredCount` or enabling auto-scaling, or presence/call-signaling
   will silently misbehave across instances.
2. **TLS/HTTPS for the Chat ALB is not set up** (no ACM certificate, no
   custom domain was provided or fabricated) — for DEV, the frontend is
   itself plain HTTP (an S3 static website endpoint), so an HTTP-only
   Chat ALB is technically compatible (no mixed-content browser block)
   and can be stood up immediately; **production-readiness requires** an
   ACM certificate + a real domain for both the frontend and the Chat
   ALB (WSS, not WS) before this goes beyond a dev/demo environment. Not
   fabricated here per instruction.

## 29. Final decision

**CHAT SERVICE READY FOR MANUAL AWS DEPLOYMENT**
