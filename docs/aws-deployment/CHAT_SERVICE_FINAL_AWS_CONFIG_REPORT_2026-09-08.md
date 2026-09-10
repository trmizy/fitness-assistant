# Chat Service — AWS Manual Deployment Readiness Report

Ngày kiểm tra: 2026-09-08  
Scope: `backend/services/chat-service` only  
AWS target: `ap-southeast-1`, manual AWS Console deployment  

## 1. CHAT SERVICE RESPONSIBILITIES

Source-backed responsibilities:

- Direct conversation creation between two users.
- Authenticated conversation list.
- Message history with pagination.
- Send message through REST.
- Send message through Socket.IO.
- Mark conversation read.
- Realtime conversation room join/leave.
- Realtime new-message and conversation-updated delivery.
- User online/offline presence events.
- Internal realtime notification push to user/admin rooms.
- Voice/video call session records.
- WebRTC call signaling through Socket.IO: initiate, accept, reject, cancel, offer, answer, ICE candidate, end, leave room, media toggle, rejoin.
- Session-linked open-room call support with signed join token.
- Internal force-end call by coaching session.

No source-backed support found for:

- group chat;
- per-recipient read receipts;
- delivered receipts;
- typing indicator;
- message reactions;
- edit/delete message;
- reply/quote;
- message search;
- attachment upload/metadata;
- URL previews;
- native push/email sending;
- AI assistant chat inside Chat Service.

## 2. FRAMEWORK / RUNTIME AUDIT

- Framework: Express + TypeScript.
- Realtime: Socket.IO over an `http.Server`.
- `src/app.ts` creates and exports the Express app.
- `src/server.ts` creates `http.createServer(app)`, calls `initSocket(httpServer)`, then `httpServer.listen(PORT)`.
- `src/server.ts` handles `SIGTERM`, closes Socket.IO, disconnects Prisma, then closes HTTP server.
- `src/socket/index.ts` initializes Socket.IO and registers connection handlers.
- `src/socket/chat.handler.ts` handles chat realtime events.
- `src/socket/call.handler.ts` handles WebRTC call signaling events.
- Production Dockerfile exists and builds successfully.

Build verification:

```text
pnpm --filter @gym-coach/chat-service build
Result: PASS

docker build -f backend/services/chat-service/Dockerfile -t fitness-assistant-chat-service:local-audit .
Result: PASS
```

## 3. REALTIME TECHNOLOGY

Current realtime technology:

```text
Socket.IO
```

Source evidence:

- `package.json` dependency: `socket.io`.
- `src/server.ts`: `http.createServer(app)` and `initSocket(httpServer)`.
- `src/socket/index.ts`: `new Server(httpServer, { cors: ... })`.

Transport semantics:

- No explicit `transports` option is configured.
- Socket.IO/Engine.IO default behavior applies: HTTP long-polling handshake/fallback with WebSocket upgrade when possible.
- No native `ws` server found.
- No SSE endpoint found.
- No HTTP polling implementation outside Socket.IO transport.

## 4. SOCKET.IO / WEBSOCKET COMPATIBILITY

```text
SOCKET.IO COMPATIBLE WITH API GATEWAY WEBSOCKET AS-IS = NO
```

Reason:

- Socket.IO is not plain RFC WebSocket application messaging; it uses Engine.IO handshake/framing, rooms, reconnect semantics, and optional polling transport.
- API Gateway WebSocket routes (`$connect`, `$disconnect`, `$default`) do not provide Socket.IO server semantics.
- Current code relies on Socket.IO `socket.join`, `io.to(room).emit`, `socket.rooms`, `socket.id`, and Socket.IO middleware handshake auth.
- Current code stores online users and call timers in process memory.

## 5. CHAT_RUNTIME_RECOMMENDATION

```text
CHAT_RUNTIME_RECOMMENDATION = ECS_FARGATE_LONG_LIVED_SERVICE
```

This is the correct primary runtime for the current code.

## 6. WHY THIS RUNTIME IS REQUIRED

Fargate/long-lived service is required because the current Chat Service depends on:

- persistent Socket.IO server attached to an HTTP server;
- live socket connections;
- Socket.IO rooms for user/conversation/admin fanout;
- process-local `onlineUsers` map;
- process-local `ringTimeouts` and `graceTimers`;
- WebRTC signaling events relayed between currently connected peers;
- server-side graceful shutdown of active sockets.

API Gateway WebSocket + Lambda would require a redesign:

- connection registry storage;
- explicit route handlers;
- API Gateway Management API fanout;
- replacement for Socket.IO rooms;
- replacement for Engine.IO polling/upgrade semantics;
- replacement for process-local presence/timers.

## 7. HTTP LAMBDA COMPATIBILITY

```text
HTTP LAMBDA COMPATIBILITY = PARTIAL, NOT PREPARED AS PRIMARY ARTIFACT
```

The Express app itself does not call `listen()`, so pure REST routes could be adapted to Lambda. However, current HTTP routes are not cleanly separable from realtime behavior:

- REST `sendMessage()` persists a message and tries to broadcast through `getIo()`.
- `/internal/push-notification` returns `503` if Socket.IO is not ready.
- `/internal/calls/end-by-session` updates call rows, but live peer notification still depends on socket runtime.

No HTTP Lambda artifact was built because splitting REST into Lambda now would silently degrade realtime delivery unless a separate bridge to the Socket.IO service is designed.

## 8. WEBSOCKET SERVERLESS COMPATIBILITY

```text
WEBSOCKET SERVERLESS COMPATIBILITY = NOT COMPATIBLE AS-IS
```

API Gateway WebSocket mapping is not safe without redesign. Current Socket.IO events cannot be directly mapped to `$connect/$disconnect/$default` handlers while preserving rooms, presence, reconnect, and call signaling behavior.

## 9. DATABASE REQUIRED — YES/NO

```text
YES
```

Chat Service uses Prisma/PostgreSQL for:

- conversations;
- conversation participants;
- messages;
- read marker via `Message.readAt`;
- call sessions.

## 10. DATABASE NAME

Recommended logical DB:

```text
fitness_assistant_chat
```

Do not reuse:

```text
fitness_assistant
fitness_assistant_user
fitness_assistant_fitness
fitness_assistant_gym
fitness_assistant_payment
fitness_assistant_ai
postgres
```

Datasource in Prisma:

```text
CHAT_DATABASE_URL
```

## 11. MIGRATION COUNT + RISKS

Migration count:

```text
3
```

Statement audit:

```text
CREATE=16
ALTER=4
DROP=0
DELETE=0
TRUNCATE=0
CREATE_TYPE=4
ALTER_TYPE=0
CREATE_INDEX=8
FOREIGN_KEY=3
UNIQUE=1
CONSTRAINT=7
```

Risks:

- No destructive SQL (`DROP`, `DELETE`, `TRUNCATE`) found in Chat migrations.
- `20260525063358_make_conversation_id_optional` alters `call_sessions.conversationId` to nullable.
- No AWS migration was run.
- No `prisma db push`.
- No `prisma migrate reset`.
- No `--accept-data-loss`.

## 12. REDIS REQUIRED — YES/NO

```text
CURRENT SOURCE REDIS REQUIRED = NO
REDIS REQUIRED FOR MULTI-TASK SOCKET.IO REALTIME CORRECTNESS = YES
```

No Redis/ioredis/pub/sub/Socket.IO adapter was found in Chat Service source.

For a single Fargate task in dev, current in-process rooms/presence can work.

For multiple Fargate tasks or 100k-user target, Redis or another Socket.IO adapter/state layer is required so rooms, fanout, and presence work across instances.

## 13. CONNECTION STATE STORAGE

```text
CONNECTION STATE STORAGE REQUIRED = YES for serverless WebSocket redesign
CURRENT STORAGE = process memory + Socket.IO rooms
RECOMMENDED AWS STORAGE = Fargate single-task memory for dev; Redis adapter before horizontal Socket.IO scale
```

Current state:

- `onlineUsers: Map<string, Set<string>>` in `src/socket/index.ts`.
- Socket.IO rooms: `user:<id>`, conversation IDs, `admin:notifications`.
- Call timers: `ringTimeouts`, `graceTimers`.

Do not move to API Gateway WebSocket without persistent connection registry.

## 14. MESSAGE DELIVERY / IDEMPOTENCY AUDIT

Current delivery:

- Messages are persisted in PostgreSQL with server-generated IDs.
- REST send and Socket.IO send both create DB rows.
- Realtime delivery is best-effort through `io.to(...).emit`.
- Offline users receive persisted messages later through HTTP history, not through a queued realtime replay.

Risks:

- No client-generated message ID.
- No message idempotency key.
- Retried sends can create duplicates.
- Realtime event delivery is at-most-once.
- Ordering is DB timestamp-based for history; realtime arrival order depends on socket delivery.
- `Message.readAt` is a single field on the message, not a per-recipient receipt model.

## 15. PRESENCE / TYPING AUDIT

Presence:

- Implemented with process-local `onlineUsers` map.
- Emits `user:online` on connect and `user:offline` when last socket for user disconnects.

```text
PRESENCE SERVERLESS SAFE = NO
```

Typing:

- No typing event handler found.

```text
TYPING SERVERLESS SAFE = NOT APPLICABLE / NOT IMPLEMENTED
```

## 16. ATTACHMENT / S3 AUDIT

No attachment/media upload support was found in Chat Service.

Search did not find runtime use of:

- `multer`;
- `uploads`;
- `writeFile`;
- `createWriteStream`;
- S3;
- presigned upload;
- attachment metadata model.

Existing bucket can be reused only after a real feature is implemented:

```text
fitness-assistant-uploads-dev-191798898985
```

Suggested future prefix if chat attachments are added:

```text
chat-attachments/*
```

No S3 IAM permission is required by current Chat Service source.

## 17. WEBRTC / CALL AUDIT

Chat Service handles WebRTC signaling only.

Socket.IO events include:

- `call:initiate`
- `call:accept`
- `call:reject`
- `call:cancel`
- `call:offer`
- `call:answer`
- `call:ice_candidate`
- `call:end`
- `call:leave_room`
- `call:media_toggle`
- `call:rejoin`

Media transport is not provided by Chat Service or AWS API Gateway.

ICE server behavior:

- Static STUN defaults: Google STUN servers.
- Optional static TURN: `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`.
- Optional Metered TURN credential fetch: `METERED_DOMAIN`, `METERED_API_KEY`.
- Metered credentials are cached in process memory for 6 hours.

TURN is required for reliable real-world mobile/restrictive NAT calling.

## 18. AUTH / AUTHORIZATION AUDIT

HTTP auth:

- `auth.middleware.ts` first accepts trusted gateway-verified user headers via `readGatewayVerifiedUser`.
- Fallback verifies JWT with Auth Service.
- Updated to support `AUTH_LAMBDA_NAME`, fallback `AUTH_SERVICE_URL`.

Socket auth:

- Socket.IO handshake uses `socket.handshake.auth.token`.
- Updated to verify token through Auth Lambda if `AUTH_LAMBDA_NAME` is configured.

Internal auth:

- `/internal/push-notification` checks `x-internal-secret === INTERNAL_API_SECRET`.
- `/internal/calls/end-by-session` checks `x-internal-secret === INTERNAL_API_SECRET`.
- `joinToken.ts` fails fast if `INTERNAL_API_SECRET` is missing.

Authorization:

- Conversation message/history/read routes check participant membership.
- Socket join checks participant membership before joining a room.
- Socket send requires the socket to already be in the conversation room.
- Direct chat creation delegates PT/client eligibility to User Service.
- Call creation checks conversation participants or session authorization through User Service.
- Call signaling checks caller/callee where relevant.

Risk:

- Internal endpoints use `INTERNAL_API_SECRET` header name, not the newer `x-service-secret` convention used elsewhere.

## 19. SERVICE COMMUNICATION

Outbound calls found:

- Auth Service:
  - `/auth/verify`
  - `/auth/internal/users/:userId`
- User Service:
  - `/internal/chat-eligibility`
  - `/contracts/check-relationship`
  - `/sessions/:coachingSessionId`

Prepared AWS direct invoke:

- `AUTH_LAMBDA_NAME=fitness-assistant-dev-auth`
- `USER_LAMBDA_NAME=fitness-assistant-dev-user`

Fallback local URLs:

- `AUTH_SERVICE_URL`
- `USER_SERVICE_URL`

No outbound calls to Fitness, Gym, Payment, or AI were found in Chat Service source.

Inbound calls from other services are expected through:

- `POST /internal/push-notification`
- `POST /internal/calls/end-by-session`

## 20. AI CHAT INTEGRATION

No direct AI assistant conversation integration was found in Chat Service.

No evidence found for:

- Chat Service calling AI Service;
- AI streaming through Chat Service;
- partial token persistence;
- AI async job callbacks into Chat Service.

## 21. BACKGROUND JOBS

No scheduled background job was found.

Process-local timers exist only for active call behavior:

- `ringTimeouts`: 30-second ring timeout for chat-origin calls.
- `graceTimers`: 30-second reconnect grace for active chat-origin calls.

No `src/jobs-lambda.ts` was created because there is no source-defined cadence/job.

## 22. SQS / QUEUE REQUIRED — YES/NO

```text
SQS REQUIRED = NO
QUEUE PURPOSE = none in current source
```

No SQS/BullMQ/RabbitMQ/Kafka/Redis queue usage found.

## 23. STREAMING AUDIT

```text
STREAMING REQUIRED = NO
```

No SSE/token/delta/chunk streaming implementation found in Chat Service.

Socket.IO realtime messages are event delivery, not token streaming.

## 24. SECURITY / PRIVACY RISKS

Observed protections:

- Message content max length is 5000 characters.
- Participant authorization exists for REST history/send/read and socket join/send.
- Socket handshake requires JWT.
- Internal endpoints require a shared internal secret.

Risks:

- No rate limiting/spam/flood protection in Chat Service itself.
- No message idempotency; client retries can duplicate messages.
- Message content is stored as plain text.
- No sanitization layer is visible in Chat Service; frontend must render message text safely.
- Request logger logs method/path/ip, not full message content.
- Error logs may include stack/message but do not intentionally log full private chat bodies.
- No attachment support yet, so MIME spoofing/malicious filenames are not active risks in current source.

## 25. 100K USER SCALE AUDIT

Current code is not ready for 100k-user realtime scale as-is.

Key bottlenecks:

- single-process Socket.IO state;
- in-memory presence;
- in-memory call timers;
- no Redis Socket.IO adapter;
- no sticky-session strategy documented for polling fallback;
- Prisma DB connection count if many Fargate tasks are added;
- message fanout limited to one process unless adapter is added;
- TURN provider/capacity must be sized separately for real calls.

Do not assume 100k concurrent sockets. For dev/manual deployment, start with one Fargate task; before horizontal scaling, add Redis adapter or redesign to API Gateway WebSocket with persistent connection registry.

## 26. COST ARCHITECTURE COMPARISON

Applicable options:

- API Gateway WebSocket + Lambda:
  - low idle cost;
  - not compatible with current Socket.IO code as-is;
  - requires substantial rewrite and connection registry.
- ECS/Fargate + ALB/WebSocket:
  - has idle compute/ALB cost;
  - best fit for current long-lived Socket.IO runtime;
  - lowest product risk for preserving current realtime/call behavior.
- Hybrid HTTP Lambda + realtime container:
  - possible later;
  - current code would need a bridge because REST send/internal notification directly depends on `getIo()`;
  - not recommended as first real deployment path.

## 27. ENV VARIABLES

| VARIABLE | REQUIRED? | SECRET? | PURPOSE | AWS VALUE / PLACEHOLDER |
|---|---:|---:|---|---|
| `NODE_ENV` | Yes | No | Runtime mode | `production` |
| `AWS_REGION` | Yes if Lambda invoke/migration | No | AWS SDK region | `ap-southeast-1` |
| `AWS_DEFAULT_REGION` | Optional | No | AWS SDK fallback | `ap-southeast-1` |
| `CHAT_SERVICE_PORT` | Yes for container | No | HTTP/Socket.IO port | `3005` |
| `CHAT_DATABASE_URL` | Yes for container runtime | Yes | Prisma datasource | Secret-injected DB URL for `fitness_assistant_chat` |
| `DATABASE_SECRET_ID` | Migration Lambda only | No | Load DB JSON from Secrets Manager | `fitness-assistant/dev/chat-database` |
| `DATABASE_URL` | No | Yes | Not used by Chat Prisma datasource | Leave unset unless tooling needs it separately |
| `INTERNAL_API_SECRET` | Yes | Yes | Internal endpoints and join-token verification | existing shared internal API secret |
| `INTERNAL_SERVICE_SECRET` | Recommended | Yes | User/Auth internal calls compatibility | existing shared internal service secret |
| `AUTH_LAMBDA_NAME` | Recommended | No | Direct Auth Lambda invoke | `fitness-assistant-dev-auth` |
| `AUTH_SERVICE_URL` | Fallback/local | No | Auth HTTP fallback | local/API fallback only |
| `USER_LAMBDA_NAME` | Recommended | No | Direct User Lambda invoke | `fitness-assistant-dev-user` |
| `USER_SERVICE_URL` | Fallback/local | No | User HTTP fallback | local/API fallback only |
| `FITNESS_LAMBDA_NAME` | No | No | Not used by source | unset |
| `FITNESS_SERVICE_URL` | No | No | Not used by source | unset |
| `GYM_LAMBDA_NAME` | No | No | Not used by source | unset |
| `GYM_SERVICE_URL` | No | No | Not used by source | unset |
| `PAYMENT_LAMBDA_NAME` | No | No | Not used by source | unset |
| `PAYMENT_SERVICE_URL` | No | No | Not used by source | unset |
| `AI_LAMBDA_NAME` | No | No | Not used by source | unset |
| `AI_SERVICE_URL` | No | No | Not used by source | unset |
| `CORS_ORIGIN` | Yes | No | Socket.IO CORS origin | frontend origin |
| `ROOM_OPEN_BEFORE_MINUTES` | Optional | No | Session room open window | default `15` |
| `TURN_URL` | Optional/recommended for calls | No | Static TURN URLs | TURN server URLs |
| `TURN_USERNAME` | Conditional | Yes-ish | Static TURN username | TURN credential |
| `TURN_CREDENTIAL` | Conditional | Yes | Static TURN password/credential | TURN credential |
| `METERED_DOMAIN` | Optional/recommended for calls | No | Metered TURN domain | Metered domain |
| `METERED_API_KEY` | Conditional | Yes | Metered TURN credential API key | secret |
| `REDIS_HOST` | No | No | Not used by source | unset |
| `REDIS_PORT` | No | No | Not used by source | unset |
| `REDIS_URL` | No | Yes | Not used by source | unset |
| S3 upload bucket vars | No | No | Not used by source | unset |
| API Gateway management endpoint vars | No | No | Not used by source | unset |

## 28. IAM REQUIREMENTS

Chat Fargate task role, if using direct Lambda invoke:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": [
        "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-auth",
        "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-user"
      ]
    }
  ]
}
```

Chat migration Lambda:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:<account-id>:secret:fitness-assistant/dev/chat-database*"
    }
  ]
}
```

ECS execution role normally needs ECR image pull and CloudWatch logs permissions. If task definition injects secrets from Secrets Manager, the execution role needs `secretsmanager:GetSecretValue` for those exact secrets.

Not required by current source:

- S3;
- SQS;
- DynamoDB;
- `execute-api:ManageConnections`;
- broad Lambda wildcard invoke.

## 29. HTTP API GATEWAY ROUTES

If routing HTTP through ALB/API Gateway proxy to the Fargate service, source-backed HTTP routes are:

PUBLIC:

- `GET /health`
- `GET /metrics`

AUTHENTICATED:

- `POST /chat/conversations/direct`
- `GET /chat/conversations`
- `GET /chat/conversations/:id/messages`
- `POST /chat/conversations/:id/messages`
- `PATCH /chat/conversations/:id/read`
- `POST /chat/calls`
- `PATCH /chat/calls/:id/accept`
- `PATCH /chat/calls/:id/end`

INTERNAL ONLY:

- `POST /internal/push-notification`
- `POST /internal/calls/end-by-session`

Do not expose:

```text
/internal/*
```

Do not use:

```text
ANY /{proxy+}
```

Recommended explicit prefix if proxying is needed:

```text
ANY /chat
ANY /chat/{proxy+}
GET /health
GET /metrics
```

Internal routes should stay private/service-to-service only.

## 30. WEBSOCKET ROUTES

API Gateway WebSocket routes:

```text
NOT APPLICABLE
```

Current Socket.IO event routes:

- connection handshake: `socket.handshake.auth.token`
- disconnect
- `chat:join_conversation`
- `chat:leave_conversation`
- `chat:send_message`
- `chat:message:send`
- `call:initiate`
- `call:accept`
- `call:reject`
- `call:cancel`
- `call:offer`
- `call:answer`
- `call:ice_candidate`
- `call:end`
- `call:leave_room`
- `call:media_toggle`
- `call:rejoin`

These are Socket.IO events, not API Gateway WebSocket route keys.

## 31. HTTP HANDLER

```text
NOT APPLICABLE
```

No HTTP Lambda artifact was built because primary recommendation is Fargate and current HTTP behavior is coupled to Socket.IO runtime.

## 32. WEBSOCKET HANDLER(S)

API Gateway WebSocket handlers:

```text
NOT APPLICABLE
```

Current source handlers:

- `src/socket/index.ts` → `initSocket(httpServer)`
- `src/socket/chat.handler.ts` → `registerChatHandlers(io, socket, user)`
- `src/socket/call.handler.ts` → `registerCallHandlers(io, socket, user)`

## 33. JOBS HANDLER

```text
NOT APPLICABLE
```

No source-defined scheduled job/cadence exists for Chat Service.

## 34. MIGRATION HANDLER

```text
dist/migrate-lambda.handler
```

Source:

```text
backend/services/chat-service/src/migrate-lambda.ts
```

Safety guard:

```text
database === "fitness_assistant_chat"
```

Refusal error:

```text
Refusing to run Chat Service migrations against non-chat database.
```

Command:

```text
prisma migrate deploy
```

The handler sets:

```text
CHAT_DATABASE_URL
```

because Chat Prisma datasource uses `env("CHAT_DATABASE_URL")`.

## 35. HTTP ARTIFACT PATH + SIZE

```text
NOT APPLICABLE
```

No Chat HTTP Lambda ZIP was built.

## 36. WEBSOCKET ARTIFACT PATH + SIZE

```text
NOT APPLICABLE
```

No API Gateway WebSocket Lambda artifact was built.

For Fargate container artifact, see section 38.

## 37. MIGRATION ARTIFACT PATH + SIZE

Path:

```text
backend/services/chat-service/artifacts/chat-migrate-lambda.zip
```

Size:

```text
72,660,196 bytes
≈ 69.29 MiB compressed
171,001,544 bytes
≈ 163.08 MiB uncompressed
```

ZIP content verification:

- `dist/migrate-lambda.js`: present
- `prisma/schema.prisma`: present
- `prisma/migrations/**/migration.sql`: `3`
- `node_modules/prisma/build/index.js`: present
- `node_modules/@prisma/engines/schema-engine-rhel-openssl-3.0.x`: present
- `node_modules/@prisma/engines/libquery_engine-rhel-openssl-3.0.x.so.node`: present
- `.env`/`.git`/tests: not present by name scan
- Secret pattern scan: `0` hits

Migration ZIP is greater than 50 MiB. Upload through S3 when using AWS Console.

## 38. CONTAINER / FARGATE REQUIREMENTS IF APPLICABLE

Production Dockerfile:

```text
backend/services/chat-service/Dockerfile
```

Local image build:

```text
fitness-assistant-chat-service:local-audit
```

Image inspect:

```text
image id: sha256:4aa7cb06990adc9134d3f0eb49c42e4821e80e72dfc6e517fb1e75f54b972d2b
size: 145,749,171 bytes
exposed port: 3005/tcp
cmd: ["sh","-c","exec node dist/server.js"]
user: node
```

Fargate/ALB requirements:

- ECS/Fargate service, not Lambda.
- Container port: `3005`.
- ALB listener must support WebSocket upgrade.
- Target group health check path: `/health`.
- Health check expected HTTP 200.
- Inject `CHAT_DATABASE_URL` securely.
- Configure `INTERNAL_API_SECRET`.
- Configure `AUTH_LAMBDA_NAME` and `USER_LAMBDA_NAME`, or HTTP fallback URLs.
- If private subnets call external Metered TURN API, keep NAT or add an appropriate outbound path.
- Start dev with desired count `1`.
- Before desired count `>1`, add Redis Socket.IO adapter and load balancer/sticky-session strategy or redesign realtime.

Change made:

- Production Dockerfile no longer runs `prisma migrate deploy` in `CMD`. Migrations should be run once through the migration Lambda artifact before starting/updating the service.

## 39. AWS MANUAL DEPLOYMENT ORDER

Recommended manual order:

1. Create/update Secrets Manager secret:
   - `fitness-assistant/dev/chat-database`
2. Secret JSON:

```json
{
  "username": "<aurora-master-or-migration-user>",
  "password": "<password>",
  "host": "fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com",
  "port": 5432,
  "database": "fitness_assistant_chat"
}
```

3. Create migration Lambda:
   - name: `fitness-assistant-dev-chat-migrate`
   - runtime: Node.js `22.x`
   - architecture: `x86_64`
   - handler: `dist/migrate-lambda.handler`
   - upload `chat-migrate-lambda.zip` through S3
   - timeout: `10–15 minutes`
   - memory: at least `1024 MB`
   - VPC/private app subnets if Aurora is private
   - SG allowed to reach Aurora PostgreSQL `5432`
4. Invoke migration Lambda manually once from AWS Console after checking secret database field.
5. Build/push Chat container image to ECR manually.
6. Create ECS task definition:
   - image from ECR;
   - port `3005`;
   - command default from Dockerfile;
   - env/secrets from section 27;
   - task role with Auth/User Lambda invoke if using direct invoke.
7. Create Fargate service in `fitness-assistant-dev-vpc`.
8. Place task in private app subnets.
9. Attach service security group.
10. Create/configure ALB target group with `/health`.
11. Ensure ALB listener supports WebSocket upgrade.
12. Route frontend/gateway Socket.IO traffic to Chat ALB endpoint.
13. Keep `/internal/*` private or protected by service-secret only.
14. Do not create API Gateway WebSocket for this current Socket.IO service.

## 40. BLOCKERS

Code/artifact blockers:

- None for a single-task dev Fargate deployment of current Chat Service.

Manual/external blockers:

- Chat DB secret must be created with exact database name `fitness_assistant_chat`.
- Chat migrations have not been run on AWS yet.
- Chat container image has not been pushed to ECR.
- ECS/Fargate service, ALB, target group, and routing are not created by this pass.
- TURN/Metered configuration is required for reliable real-world voice/video across restrictive networks.
- Multi-task/horizontal Socket.IO scale is not safe until Redis adapter/sticky-session strategy or a serverless WebSocket redesign is implemented.
- Current Chat runtime is not compatible with API Gateway WebSocket as-is.

No AWS deployment, AWS migration, AWS smoke test, temporary Lambda, test database, test WebSocket API, test ECS service, or staging resource was created.

## 41. FINAL VERDICT

CHAT SERVICE READY FOR REAL AWS FARGATE DEPLOYMENT
