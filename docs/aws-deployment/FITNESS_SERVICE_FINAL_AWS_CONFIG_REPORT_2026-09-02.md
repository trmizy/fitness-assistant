# Fitness Service — AWS Lambda Manual Configuration Report

Ngày kiểm tra: 2026-09-02
Repository branch: `aws-deploy`
Commit hiện tại: `5969261 docs: Product Completeness pass — impact analysis, roadmap status board, implementation reports`

## 1. FITNESS SERVICE RESPONSIBILITIES

Fitness Service hiện chịu trách nhiệm các domain sau, dựa trên `backend/services/fitness-service/src/app.ts` và Prisma schema:

- Exercise library, muscle map, equipment, user equipment.
- Workout logs, workout exercises, sets, set segments, schedule lock, estimated 1RM.
- Workout programs/templates/schedules.
- Nutrition: food library, aliases, nutrition logs, goals, programs, meal completion.
- Training cycles, cycle assessment, feedback summaries, InBody link.
- Coach/PT features: client relationship check, coach client actions, plan/adaptive recommendation audit.
- Import/export endpoints cho dữ liệu fitness/content.
- Internal endpoints cho service-to-service only.

## 2. CODE / FRAMEWORK AUDIT

- Framework: Express + TypeScript.
- `src/app.ts` chỉ tạo Express app và export default app, không gọi `listen()`.
- `src/server.ts` là local/container runtime: load dotenv, connect Redis, start HTTP listener, start reminder intervals, close Prisma/Redis/worker on SIGTERM.
- Đã thêm Lambda adapter tại `src/lambda.ts`, tách khỏi `server.ts`.
- Runtime target phù hợp AWS Lambda Node.js 22.x / x86_64 / Amazon Linux 2023 khi Prisma binary target có `rhel-openssl-3.0.x`.

## 3. DATABASE ARCHITECTURE

- ORM: Prisma `5.22.0`.
- Datasource: PostgreSQL qua `DATABASE_URL`.
- Fitness Service có Prisma schema riêng tại `backend/services/fitness-service/prisma/schema.prisma`.
- Schema có migration history riêng: 48 migrations.
- Service không có DB-level foreign key trực tiếp sang Auth/User/Gym/Payment; các quan hệ user dùng `userId` string và service-to-service calls.
- Prisma Client generated vào `src/generated/prisma`.

## 4. SEPARATE DATABASE REQUIRED — YES/NO

YES.

Khuyến nghị tạo logical database riêng cho Fitness Service, ví dụ `fitness_assistant_fitness`, trong cùng Aurora PostgreSQL cluster dev nếu muốn tối ưu chi phí. Lý do:

- Fitness Service có schema lớn và migration history độc lập.
- Có `_prisma_migrations` riêng.
- Không có cross-service foreign key bắt buộc.
- Tách DB giúp tránh đụng Auth/User schema và giảm rủi ro migration.

## 5. MIGRATION AUDIT

Kết quả audit migration hiện tại:

- Migrations: 48.
- SQL statement groups quan sát được:
  - `CREATE`: 48
  - `ALTER`: 117
  - `DROP`: 12
  - `DELETE`: 1
  - `TRUNCATE`: 0
  - `CREATE INDEX`: 104
  - Foreign keys: 41
  - `CREATE TYPE`: 4
  - `ALTER TYPE`: 0
- Không chạy migration AWS trong lượt này.
- Không chạy `prisma db push --accept-data-loss`.
- Khi cấu hình AWS Console, cần chạy existing migrations vào Fitness DB riêng bằng migration workflow an toàn, không chạy trực tiếp lên DB production.

## 6. LAMBDA COMPATIBILITY

Đã chuẩn bị code để chạy Lambda:

- Thêm `src/lambda.ts` export `handler`.
- Thêm `serverless-http`.
- Thêm lazy runtime config:
  - Nếu có `DATABASE_URL`, dùng trực tiếp.
  - Nếu không có `DATABASE_URL` và có `DATABASE_SECRET_ID`, load Secrets Manager rồi dựng URL runtime.
- Không import `server.ts` trong Lambda handler nên không tự `listen()` và không tự start interval workers.
- Redis cache chuyển sang optional no-op khi `FITNESS_DISABLE_REDIS=true` hoặc Lambda không có `REDIS_HOST`.
- BullMQ workout generation fail-closed 503 nếu Redis không cấu hình.

## 7. AUTH / SERVICE COMMUNICATION

Đã chuẩn bị direct Lambda invoke cho các luồng quan trọng:

- Auth verify:
  - Ưu tiên `AUTH_LAMBDA_NAME`.
  - Fallback `AUTH_SERVICE_URL` cho Docker/local.
- User service:
  - Ưu tiên `USER_LAMBDA_NAME` cho profile/equipment/InBody/PT relationship.
  - Fallback `USER_SERVICE_URL`.
- Persistent notifications:
  - Ưu tiên `USER_LAMBDA_NAME` tới `/internal/notifications`.
  - Fallback HTTP local.
- Chat notification realtime vẫn dùng `CHAT_SERVICE_URL`.
- AI calls vẫn dùng `AI_SERVICE_URL`.

## 8. REDIS / STATEFUL AUDIT

- Redis đang dùng cho exercise cache và BullMQ workout generation queue.
- Exercise cache đã có no-op fallback khi Redis disabled.
- `/workouts/generate` async queue cần Redis/BullMQ; nếu không có Redis, route trả 503 rõ ràng thay vì crash.
- Không migrate Redis/BullMQ worker vào Fitness HTTP Lambda.
- Không cần tạo ElastiCache cho giai đoạn manual Fitness Lambda cơ bản nếu chưa bật async workout generation.

## 9. FILESYSTEM AUDIT

- Runtime Fitness Service không có upload binary chính.
- Không thấy luồng persistent upload filesystem trong service runtime.
- Import/export chủ yếu xử lý payload JSON/CSV và dữ liệu DB.
- Scripts seed/import dùng filesystem nhưng không phải Lambda request path.
- Artifact isolated test xác nhận không tạo `uploads` directory.

## 10. BACKGROUND JOB AUDIT

- `src/server.ts` local/container runtime có reminder intervals.
- Đã thêm `src/jobs-lambda.ts` cho EventBridge/manual invocation:
  - `workout-upcoming-reminder`
  - `workout-unfinished-reminder`
- Jobs Lambda không start interval loop.
- BullMQ worker `src/workers/workout.worker.ts` không nằm trong HTTP Lambda handler; nếu cần async generation production-like thì phải có Redis + worker riêng hoặc phase riêng.

## 11. EXTERNAL DEPENDENCIES

Runtime dependencies:

- Aurora/PostgreSQL Fitness DB.
- Secrets Manager nếu dùng `DATABASE_SECRET_ID`.
- Auth Lambda hoặc Auth HTTP service.
- User Lambda hoặc User HTTP service.
- AI Service HTTP endpoint cho các tính năng AI workout/cycle explanation.
- Chat Service HTTP endpoint cho realtime notification.
- Pexels API nếu bật hình ảnh food/exercise từ Pexels.
- Redis only nếu bật cache/async queue thật.

## 12. FILES CHANGED

Các file chính đã đổi/thêm cho Lambda readiness:

- `backend/services/fitness-service/package.json`
- `pnpm-lock.yaml`
- `backend/services/fitness-service/prisma/schema.prisma`
- `backend/services/fitness-service/src/lambda.ts`
- `backend/services/fitness-service/src/jobs-lambda.ts`
- `backend/services/fitness-service/src/config/lambda-runtime.ts`
- `backend/services/fitness-service/src/utils/runtime.util.ts`
- `backend/services/fitness-service/src/clients/lambda-http.client.ts`
- `backend/services/fitness-service/src/clients/auth-service.client.ts`
- `backend/services/fitness-service/src/clients/user.client.ts`
- `backend/services/fitness-service/src/clients/notification.client.ts`
- `backend/services/fitness-service/src/middleware/auth.middleware.ts`
- `backend/services/fitness-service/src/repositories/redis.ts`
- `backend/services/fitness-service/src/services/workout.service.ts`
- `backend/services/fitness-service/src/controllers/workout.controller.ts`
- `backend/services/fitness-service/src/server.ts`
- `backend/services/fitness-service/src/__tests__/lambda-runtime.test.ts`
- `backend/services/fitness-service/src/__tests__/jobs-lambda.test.ts`
- `backend/services/fitness-service/scripts/build-lambda-artifact.js`
- `backend/services/fitness-service/artifacts/fitness-lambda.zip`

Lưu ý: worktree đã có nhiều thay đổi khác trước lượt này; không coi các file ngoài phạm vi Fitness Lambda là kết quả của lượt chuẩn bị này.

## 13. ENVIRONMENT VARIABLES

Biến cần cấu hình cho Fitness Lambda dev:

| Variable | Required | Purpose |
|---|---:|---|
| `NODE_ENV=production` | Yes | Runtime mode |
| `AWS_REGION=ap-southeast-1` | Yes | Lambda/Secrets/Lambda invoke region |
| `DATABASE_SECRET_ID` | Recommended | Secret JSON chứa DB credential |
| `DATABASE_URL` | Alternative | Chỉ dùng nếu không dùng Secrets Manager |
| `INTERNAL_SERVICE_SECRET` | Yes | Service-to-service internal auth |
| `INTERNAL_API_SECRET` | Conditional | Chat/internal legacy calls |
| `AUTH_LAMBDA_NAME=fitness-assistant-dev-auth` | Recommended | Direct Auth Lambda invoke |
| `USER_LAMBDA_NAME=fitness-assistant-dev-user` | Recommended | Direct User Lambda invoke |
| `AUTH_SERVICE_URL` | Fallback | Local/container fallback |
| `USER_SERVICE_URL` | Fallback | Local/container fallback |
| `AI_SERVICE_URL` | Conditional | AI features |
| `CHAT_SERVICE_URL` | Conditional | Realtime notification |
| `FITNESS_DISABLE_REDIS=true` | Recommended initially | Disable Redis cache/queue in Lambda |
| `REDIS_HOST`, `REDIS_PORT` | Conditional | Only if Redis enabled |
| `PEXELS_API_KEY` | Conditional | External media lookup |
| Reminder interval/threshold vars | Optional | Jobs/server tuning |

Không hard-code secret vào frontend, ZIP, Docker image hoặc source.

## 14. IAM REQUIREMENTS

Minimum IAM cho Fitness Lambda:

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
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:<account-id>:secret:fitness-assistant/dev/fitness-database*"
    },
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

Nếu không dùng `DATABASE_SECRET_ID`, bỏ quyền Secrets Manager. Nếu chưa dùng direct invoke User/Auth, có thể bỏ quyền Lambda invoke nhưng không khuyến nghị.

## 15. API GATEWAY ROUTES

Không expose `/internal`.

Route đề xuất cho API Gateway HTTP API:

- `GET /health`
- `GET /metrics`
- `ANY /exercises`
- `ANY /exercises/{proxy+}`
- `ANY /workouts`
- `ANY /workouts/{proxy+}`
- `ANY /nutrition`
- `ANY /nutrition/{proxy+}`
- `ANY /stats`
- `ANY /stats/{proxy+}`
- `ANY /food`
- `ANY /food/{proxy+}`
- `ANY /training-cycles`
- `ANY /training-cycles/{proxy+}`
- `ANY /coach`
- `ANY /coach/{proxy+}`
- `ANY /equipment`
- `ANY /equipment/{proxy+}`
- `ANY /imports`
- `ANY /imports/{proxy+}`
- `ANY /exports`
- `ANY /exports/{proxy+}`
- `ANY /templates`
- `ANY /templates/{proxy+}`

Khuyến nghị không dùng `ANY /{proxy+}` cho toàn API vì dễ vô tình expose `/internal`.

## 16. TEST RESULTS

Commands đã chạy:

```text
pnpm --filter @gym-coach/fitness-service build
```

Result: PASS.

```text
$env:NODE_ENV='test'
$env:FITNESS_DISABLE_REDIS='true'
pnpm --filter @gym-coach/fitness-service exec tsx --test src/__tests__/lambda-runtime.test.ts src/__tests__/jobs-lambda.test.ts src/__tests__/estimated-1rm.util.test.ts src/__tests__/schedule-lock.util.test.ts
```

Result: PASS `33/33`.

```text
pnpm --filter @gym-coach/fitness-service run build:lambda-zip
```

Result: PASS. ZIP created.

Isolated artifact test from extracted ZIP:

- `HTTP_HANDLER_TYPE=function`
- `JOBS_HANDLER_TYPE=function`
- `/health` status `200`
- `/health` body `{"status":"ok","service":"fitness-service"}`
- unknown jobs event status `400`
- required files present in ZIP: PASS
- secret pattern scan: PASS, `0` pattern groups with hits

Full Fitness Service test:

```text
$env:NODE_ENV='test'
$env:FITNESS_DISABLE_REDIS='true'
pnpm --filter @gym-coach/fitness-service test
```

Result: FAIL due local DB unavailable, not due Lambda handler import.

- tests: 635
- pass: 349
- fail: 86
- skipped: 200
- repeated root cause: `Can't reach database server at localhost:5433`

## 17. HANDLER

HTTP Lambda handler:

```text
dist/lambda.handler
```

Background jobs Lambda handler:

```text
dist/jobs-lambda.handler
```

Recommended AWS runtime:

```text
Node.js 22.x
Architecture: x86_64
```

## 18. BUILD COMMAND

From repository root:

```powershell
pnpm --filter @gym-coach/fitness-service run build:lambda-zip
```

The script internally:

1. Builds shared package.
2. Generates Prisma client.
3. Builds Fitness Service TypeScript.
4. Copies generated Prisma client into `dist`.
5. Deploys production dependencies.
6. Flattens/prunes Lambda package.
7. Writes ZIP.

## 19. ARTIFACT PATH

```text
backend/services/fitness-service/artifacts/fitness-lambda.zip
```

## 20. ZIP SIZE

```text
55,937,845 bytes
≈ 53.35 MB compressed
```

## 21. UNCOMPRESSED SIZE

```text
137,675,534 bytes
≈ 131.30 MiB uncompressed
```

File count after extraction: `4196`.

## 22. DATABASE MIGRATION REQUIRED — YES/NO

YES.

For AWS dev deployment, Fitness Service needs its own PostgreSQL logical database with the existing 48 migrations applied. This task added no new business migration, but AWS does not yet have the Fitness schema unless you create DB/secret and run migrations.

Do not use:

```text
prisma db push --accept-data-loss
```

## 23. AWS CONFIG CHANGES REQUIRED

Manual AWS Console/config steps required:

1. Create logical DB/database for Fitness Service, recommended `fitness_assistant_fitness`.
2. Apply Fitness Prisma migrations safely.
3. Create/update Secrets Manager secret for Fitness DB credential.
4. Create Lambda `fitness-assistant-dev-fitness`.
5. Upload `fitness-lambda.zip`.
6. Set handler `dist/lambda.handler`.
7. Set runtime Node.js 22.x, x86_64.
8. Attach to existing VPC/private app subnets if DB is private.
9. Attach security group that can reach Aurora/PostgreSQL on 5432.
10. Add IAM permissions for CloudWatch Logs, Secrets Manager, Auth/User Lambda invoke.
11. Set env vars from section 13.
12. Add API Gateway routes from section 15.
13. Keep `/internal` unexposed.
14. Optional: create second jobs Lambda using same ZIP with handler `dist/jobs-lambda.handler`.
15. Optional: EventBridge schedules for reminder jobs after DB/API smoke tests pass.

## 24. BLOCKERS

Code/artifact blockers:

- None found for basic manual Fitness Lambda upload and `/health` smoke test.

External/manual configuration blockers:

- Fitness AWS logical database and migrations are required before real DB-backed routes can pass.
- DB secret must be created and Lambda execution role must read it.
- Lambda must be VPC-attached only if Aurora is private.
- AI features need valid `AI_SERVICE_URL`.
- Chat notification needs valid `CHAT_SERVICE_URL`.
- Async workout generation queue remains unavailable unless Redis/BullMQ worker architecture is added; without Redis, route returns 503 by design.
- Full local integration suite currently fails because local test DB at `localhost:5433` is not reachable.

## 25. FINAL VERDICT

FITNESS SERVICE READY FOR MANUAL AWS CONFIGURATION
