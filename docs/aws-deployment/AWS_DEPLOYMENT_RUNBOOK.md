# AWS deployment runbook — dev

## Phase 1

```bash
cd infra/terraform/environments/dev
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
curl https://uo90qua3rk.execute-api.ap-southeast-1.amazonaws.com/hello
```

Expected:

```json
{"status":"ok","service":"fitness-assistant","environment":"dev"}
```

## Phase 2

Currently blocked until the AWS account is verified for CloudFront.

After verification:

```bash
cd infra/terraform/environments/dev
terraform plan -out=tfplan-phase2
terraform apply tfplan-phase2
```

Build and upload frontend:

```powershell
$env:VITE_API_URL='https://uo90qua3rk.execute-api.ap-southeast-1.amazonaws.com'
pnpm --filter @gym-coach/web build
Remove-Item Env:VITE_API_URL
aws s3 sync frontend/web/dist s3://fitness-assistant-frontend-dev-191798898985 --delete --cache-control max-age=31536000,public --exclude index.html
aws s3 cp frontend/web/dist/index.html s3://fitness-assistant-frontend-dev-191798898985/index.html --cache-control no-cache --content-type text/html
```

## Safety checks

Before every apply, confirm the plan has no unexpected:

- destroy operations
- NAT Gateway
- RDS/Aurora
- ECS service
- OpenSearch
- ElastiCache
- production environment

---

<a id="merged-aws-rollback-and-cleanup"></a>

## Consolidated reference: AWS_ROLLBACK_AND_CLEANUP.md

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

## AWS rollback and cleanup

Do not use `terraform destroy` for this project without explicit approval.

### Phase 1 rollback

1. Revert the Lambda source/config change in Git.
2. Run `terraform plan`.
3. Confirm the plan only updates the dev Lambda/API resources in place.
4. Apply the reviewed plan.

### Phase 2 rollback

Frontend artifact rollback:

1. Rebuild or retrieve the previous `frontend/web/dist`.
2. Upload it to `s3://fitness-assistant-frontend-dev-191798898985`.
3. If CloudFront exists, create an invalidation for `/*`.

CloudFront/OAC cleanup after failed account verification:

- Terraform currently tracks the OAC created before CloudFront failed.
- Prefer leaving it until account verification is resolved.
- If cleanup is required, remove it only through a reviewed Terraform plan that shows no unrelated destroy.

### Database rollback

No AWS database was created in this session. Future DB phases must include snapshot/backup and migration rollback instructions before apply.


---

<a id="merged-user-service-final-aws-config-report-2026-08-28"></a>

## Consolidated reference: USER_SERVICE_FINAL_AWS_CONFIG_REPORT_2026-08-28.md

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

## User Service Final AWS Configuration Report — 2026-08-28

### 1. Scope

Hoàn thiện readiness của Fitness Assistant User Service để cấu hình AWS Lambda cuối cùng. Không deploy, không gọi AWS mutate, không chạy Terraform/CDK/SAM apply.

### 2. Repository state

- Branch: `master`
- Commit: `44ec149 feat: notifications/reminders, all 6 types, scope confirmed with user`
- Worktree: dirty sẵn từ nhiều task trước; các thay đổi trong report này chỉ tập trung User Service Lambda safety.

### 3. AWS target provided by user

- Region: `ap-southeast-1`
- HTTP API: `https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com`
- User Lambda: `fitness-assistant-dev-user`
- Handler chính: `dist/lambda.handler`
- Jobs handler cần cấu hình thêm: `dist/jobs-lambda.handler`
- Upload bucket: `fitness-assistant-uploads-dev-191798898985`

### 4. Non-goals observed

- Không triển khai production.
- Không tạo resource AWS mới.
- Không chạy migration phá dữ liệu.
- Không commit `.env`.
- Không hard-code secrets.

### 5. File storage audit

Các điểm filesystem còn lại đã được phân loại:

- Profile photo legacy: local-only, bị 410 trên Lambda; S3 presign path dùng cho AWS.
- PT application documents: đã thêm S3 presign/confirm và signed redirect.
- Contract PDF: đã chuyển sang private S3 khi chạy Lambda hoặc có `USER_UPLOAD_BUCKET`.
- InBody OCR: chỉ dùng file tạm `/tmp` rồi xoá; phù hợp Lambda.
- Dropbox Sign provider: vẫn cần local file nếu bật e-sign; hiện AWS target đang `REQUIRE_CONTRACT_ESIGN=false`.

### 6. Profile photo result

Profile photo AWS flow hiện là:

```text
POST /profile/me/photo/presign
Client PUT direct to S3
POST /profile/me/photo/confirm
DB stores s3://profile-photos/<userId>/<uuid>.<ext>
API returns short-lived signed GET URL as photoUrl
```

Không còn giả định S3 object là public.

### 7. PT application document result

Đã thêm AWS-safe flow:

```text
POST /pt-applications/me/upload/presign
POST /pt-applications/me/upload/confirm
GET  /pt-applications/documents/s3?key=...&exp=...&sig=...
```

DB lưu ref ổn định `s3://pt-applications/...`; UI nhận signed route ngắn hạn. Route signed nội bộ redirect 302 sang S3 presigned GET.

### 8. Contract PDF result

`generateContractPdf()` hiện:

- Lambda hoặc có `USER_UPLOAD_BUCKET`: render PDF buffer trong memory, upload private S3, lưu `s3://contracts/<contractId>/contract.pdf`.
- Local/Docker: giữ flow cũ, ghi `uploads/contracts/<contractId>.pdf`.

`GET /contracts/:id/pdf` redirect 302 sang S3 presigned GET nếu DB chứa `s3://...`.

### 9. E-sign state

Dropbox Sign provider vẫn không đọc trực tiếp private S3 PDF. Đã thêm lỗi rõ ràng nếu ai bật e-sign với `s3://` PDF:

```text
keep REQUIRE_CONTRACT_ESIGN=false or add a /tmp download bridge
```

Với cấu hình AWS hiện tại `REQUIRE_CONTRACT_ESIGN=false`, đây không còn là blocker deploy User Service.

### 10. Background jobs result

Đã thêm `src/jobs-lambda.ts`.

Supported jobs:

- `session-auto-confirm`
- `reschedule-expiry`
- `session-settlement`

Handler worker không gọi `setInterval`; mỗi EventBridge invoke chạy đúng một job.

### 11. EventBridge schedule recommendation

Dựa trên constants hiện tại:

- `session-auto-confirm`: mỗi 10 phút, event `{ "job": "session-auto-confirm" }`
- `reschedule-expiry`: mỗi 10 phút, event `{ "job": "reschedule-expiry" }`
- `session-settlement`: mỗi 5 phút, event `{ "job": "session-settlement" }`

Có thể dùng cùng ZIP `user-lambda.zip`, tạo Lambda function riêng hoặc alias/config riêng trỏ handler `dist/jobs-lambda.handler`.

### 12. API Gateway route impact

Các route mới nằm dưới prefix đã có:

- `/profile/*`
- `/pt-applications/*`
- `/contracts/*`

Vì API Gateway hiện có `ANY /prefix` và `ANY /prefix/{proxy+}`, không cần thêm public prefix mới. Không expose `/internal`.

### 13. Database migration impact

Không có Prisma schema change mới cho task này. Không cần migration mới vì các field hiện có vẫn là string URL/path:

- `UserProfile.photoUrl`
- `PTApplication.*Url`
- `PTApplicationCertificate.certificateFileUrl`
- `PTApplicationMedia.fileUrl`
- `Contract.contractPdfPath`

Nếu AWS DB chưa apply migration repo mới nhất thì cần chạy migration riêng theo quy trình hiện có, nhưng task này không tạo migration mới.

### 14. IAM policy required for User Lambda

Tối thiểu cần cho Lambda role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:ap-southeast-1:<account-id>:secret:fitness-assistant/dev/user-database*"
    },
    {
      "Effect": "Allow",
      "Action": ["lambda:InvokeFunction"],
      "Resource": "arn:aws:lambda:ap-southeast-1:<account-id>:function:fitness-assistant-dev-auth"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::fitness-assistant-uploads-dev-191798898985/*"
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "*"
    }
  ]
}
```

Thay `<account-id>` bằng account thật khi cấu hình console/IAM.

### 15. S3 CORS required

Bucket upload dev cần CORS cho frontend origin hiện tại:

```json
[
  {
    "AllowedOrigins": [
      "http://fitness-assistant-frontend-dev-191798898985.s3-website-ap-southeast-1.amazonaws.com"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Nếu frontend chuyển qua CloudFront domain, thêm domain CloudFront vào `AllowedOrigins`.

### 16. Required Lambda environment variables

Không ghi secret value trong repo. Các biến cần có:

- `AWS_REGION=ap-southeast-1`
- `DATABASE_SECRET_ID=fitness-assistant/dev/user-database`
- `USER_UPLOAD_BUCKET=fitness-assistant-uploads-dev-191798898985`
- `AUTH_LAMBDA_NAME=fitness-assistant-dev-auth`
- `INTERNAL_SERVICE_SECRET` hoặc `INTERNAL_API_SECRET`
- `REQUIRE_CONTRACT_ESIGN=false`
- `ANTHROPIC_API_KEY` chỉ cần nếu bật InBody OCR AI thật.

### 17. InBody OCR audit

InBody upload dùng multer destination:

- Lambda: `/tmp/inbody-uploads`
- Local: `uploads/`

Controller xoá temp file sau OCR. Runtime cần outbound internet/NAT hoặc provider reachable nếu dùng Anthropic SDK. Nếu chưa cấu hình `ANTHROPIC_API_KEY`, OCR AI không thể production-pass.

### 18. External dependencies

User Service gọi ngoài:

- Auth Lambda qua `AUTH_LAMBDA_NAME`
- Payment service trong settlement/contract money flows
- Chat service/notification paths tuỳ luồng
- Anthropic cho InBody OCR nếu bật
- Dropbox Sign nếu `REQUIRE_CONTRACT_ESIGN=true`

Các Lambda private cần outbound internet nếu gọi external SaaS.

### 19. Build evidence

Command:

```text
pnpm --filter @gym-coach/user-service build
```

Result: PASS, `tsc` exit code 0.

### 20. Test evidence

Command:

```text
pnpm --filter @gym-coach/user-service exec tsx --test src/__tests__/profile-photo-presign.test.ts src/__tests__/ptDocumentUrl.util.test.ts src/__tests__/jobs-lambda.test.ts src/__tests__/lambda-runtime.test.ts src/__tests__/lambda-filesystem-safety.test.ts
```

Result: PASS 36/36.

### 21. Artifact evidence

Command:

```text
pnpm --filter @gym-coach/user-service run build:lambda-zip
```

Result:

- Artifact: `backend/services/user-service/artifacts/user-lambda.zip`
- Compressed size: `18,027,381` bytes
- Uncompressed size: `51,419,261` bytes
- Entries: `4,177`

Required entries present:

- `dist/lambda.js`
- `dist/jobs-lambda.js`
- `dist/app.js`
- `dist/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node`
- `node_modules/serverless-http/package.json`
- `node_modules/@aws-sdk/client-s3/package.json`
- `node_modules/@aws-sdk/s3-request-presigner/package.json`

### 22. Isolated artifact smoke test

Extracted ZIP outside repo and invoked handlers.

Result:

- `HTTP_HANDLER_TYPE=function`
- `JOBS_HANDLER_TYPE=function`
- `/health` returned `200`
- Unknown job returned `400`
- `NO_UPLOADS_DIR_CREATED`

This proves artifact does not rely on workspace `node_modules` for these handlers.

### 23. Secret scan evidence

Extracted ZIP scan:

- Files scanned: `4,177`
- Result: `NO_SECRET_VALUE_PATTERNS_FOUND_IN_EXTRACTED_ZIP`

Searched for secret assignment/value patterns such as `DATABASE_URL=`, `JWT_SECRET=`, `INTERNAL_SERVICE_SECRET=`, provider API keys, private key marker, and secret-id literal.

### 24. Files changed by this pass

- `backend/services/user-service/src/services/s3-upload.service.ts`
- `backend/services/user-service/src/services/profile.service.ts`
- `backend/services/user-service/src/controllers/profile.controller.ts`
- `backend/services/user-service/src/utils/ptDocumentUrl.util.ts`
- `backend/services/user-service/src/controllers/pt_application.controller.ts`
- `backend/services/user-service/src/routes/pt_application.routes.ts`
- `backend/services/user-service/src/services/contractPdf.service.ts`
- `backend/services/user-service/src/controllers/contract.controller.ts`
- `backend/services/user-service/src/providers/dropboxSign.provider.ts`
- `backend/services/user-service/src/jobs-lambda.ts`
- `backend/services/user-service/src/__tests__/profile-photo-presign.test.ts`
- `backend/services/user-service/src/__tests__/ptDocumentUrl.util.test.ts`
- `backend/services/user-service/src/__tests__/jobs-lambda.test.ts`
- `backend/services/user-service/src/__tests__/lambda-filesystem-safety.test.ts`
- `backend/services/user-service/artifacts/user-lambda.zip`

### 25. Final verdict

USER SERVICE READY FOR FINAL AWS CONFIGURATION

Next exact console step: upload `backend/services/user-service/artifacts/user-lambda.zip` to `fitness-assistant-dev-user`, keep handler `dist/lambda.handler`, then create/configure the jobs Lambda using the same ZIP with handler `dist/jobs-lambda.handler` and the EventBridge inputs listed above.


---

<a id="merged-fitness-service-final-aws-config-report-2026-09-02"></a>

## Consolidated reference: FITNESS_SERVICE_FINAL_AWS_CONFIG_REPORT_2026-09-02.md

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

## Fitness Service — AWS Lambda Manual Configuration Report

Ngày kiểm tra: 2026-09-02
Repository branch: `aws-deploy`
Commit hiện tại: `5969261 docs: Product Completeness pass — impact analysis, roadmap status board, implementation reports`

### 1. FITNESS SERVICE RESPONSIBILITIES

Fitness Service hiện chịu trách nhiệm các domain sau, dựa trên `backend/services/fitness-service/src/app.ts` và Prisma schema:

- Exercise library, muscle map, equipment, user equipment.
- Workout logs, workout exercises, sets, set segments, schedule lock, estimated 1RM.
- Workout programs/templates/schedules.
- Nutrition: food library, aliases, nutrition logs, goals, programs, meal completion.
- Training cycles, cycle assessment, feedback summaries, InBody link.
- Coach/PT features: client relationship check, coach client actions, plan/adaptive recommendation audit.
- Import/export endpoints cho dữ liệu fitness/content.
- Internal endpoints cho service-to-service only.

### 2. CODE / FRAMEWORK AUDIT

- Framework: Express + TypeScript.
- `src/app.ts` chỉ tạo Express app và export default app, không gọi `listen()`.
- `src/server.ts` là local/container runtime: load dotenv, connect Redis, start HTTP listener, start reminder intervals, close Prisma/Redis/worker on SIGTERM.
- Đã thêm Lambda adapter tại `src/lambda.ts`, tách khỏi `server.ts`.
- Runtime target phù hợp AWS Lambda Node.js 22.x / x86_64 / Amazon Linux 2023 khi Prisma binary target có `rhel-openssl-3.0.x`.

### 3. DATABASE ARCHITECTURE

- ORM: Prisma `5.22.0`.
- Datasource: PostgreSQL qua `DATABASE_URL`.
- Fitness Service có Prisma schema riêng tại `backend/services/fitness-service/prisma/schema.prisma`.
- Schema có migration history riêng: 48 migrations.
- Service không có DB-level foreign key trực tiếp sang Auth/User/Gym/Payment; các quan hệ user dùng `userId` string và service-to-service calls.
- Prisma Client generated vào `src/generated/prisma`.

### 4. SEPARATE DATABASE REQUIRED — YES/NO

YES.

Khuyến nghị tạo logical database riêng cho Fitness Service, ví dụ `fitness_assistant_fitness`, trong cùng Aurora PostgreSQL cluster dev nếu muốn tối ưu chi phí. Lý do:

- Fitness Service có schema lớn và migration history độc lập.
- Có `_prisma_migrations` riêng.
- Không có cross-service foreign key bắt buộc.
- Tách DB giúp tránh đụng Auth/User schema và giảm rủi ro migration.

### 5. MIGRATION AUDIT

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

### 6. LAMBDA COMPATIBILITY

Đã chuẩn bị code để chạy Lambda:

- Thêm `src/lambda.ts` export `handler`.
- Thêm `serverless-http`.
- Thêm lazy runtime config:
  - Nếu có `DATABASE_URL`, dùng trực tiếp.
  - Nếu không có `DATABASE_URL` và có `DATABASE_SECRET_ID`, load Secrets Manager rồi dựng URL runtime.
- Không import `server.ts` trong Lambda handler nên không tự `listen()` và không tự start interval workers.
- Redis cache chuyển sang optional no-op khi `FITNESS_DISABLE_REDIS=true` hoặc Lambda không có `REDIS_HOST`.
- BullMQ workout generation fail-closed 503 nếu Redis không cấu hình.

### 7. AUTH / SERVICE COMMUNICATION

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

### 8. REDIS / STATEFUL AUDIT

- Redis đang dùng cho exercise cache và BullMQ workout generation queue.
- Exercise cache đã có no-op fallback khi Redis disabled.
- `/workouts/generate` async queue cần Redis/BullMQ; nếu không có Redis, route trả 503 rõ ràng thay vì crash.
- Không migrate Redis/BullMQ worker vào Fitness HTTP Lambda.
- Không cần tạo ElastiCache cho giai đoạn manual Fitness Lambda cơ bản nếu chưa bật async workout generation.

### 9. FILESYSTEM AUDIT

- Runtime Fitness Service không có upload binary chính.
- Không thấy luồng persistent upload filesystem trong service runtime.
- Import/export chủ yếu xử lý payload JSON/CSV và dữ liệu DB.
- Scripts seed/import dùng filesystem nhưng không phải Lambda request path.
- Artifact isolated test xác nhận không tạo `uploads` directory.

### 10. BACKGROUND JOB AUDIT

- `src/server.ts` local/container runtime có reminder intervals.
- Đã thêm `src/jobs-lambda.ts` cho EventBridge/manual invocation:
  - `workout-upcoming-reminder`
  - `workout-unfinished-reminder`
- Jobs Lambda không start interval loop.
- BullMQ worker `src/workers/workout.worker.ts` không nằm trong HTTP Lambda handler; nếu cần async generation production-like thì phải có Redis + worker riêng hoặc phase riêng.

### 11. EXTERNAL DEPENDENCIES

Runtime dependencies:

- Aurora/PostgreSQL Fitness DB.
- Secrets Manager nếu dùng `DATABASE_SECRET_ID`.
- Auth Lambda hoặc Auth HTTP service.
- User Lambda hoặc User HTTP service.
- AI Service HTTP endpoint cho các tính năng AI workout/cycle explanation.
- Chat Service HTTP endpoint cho realtime notification.
- Pexels API nếu bật hình ảnh food/exercise từ Pexels.
- Redis only nếu bật cache/async queue thật.

### 12. FILES CHANGED

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

### 13. ENVIRONMENT VARIABLES

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

### 14. IAM REQUIREMENTS

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

### 15. API GATEWAY ROUTES

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

### 16. TEST RESULTS

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

### 17. HANDLER

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

### 18. BUILD COMMAND

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

### 19. ARTIFACT PATH

```text
backend/services/fitness-service/artifacts/fitness-lambda.zip
```

### 20. ZIP SIZE

```text
55,937,845 bytes
≈ 53.35 MB compressed
```

### 21. UNCOMPRESSED SIZE

```text
137,675,534 bytes
≈ 131.30 MiB uncompressed
```

File count after extraction: `4196`.

### 22. DATABASE MIGRATION REQUIRED — YES/NO

YES.

For AWS dev deployment, Fitness Service needs its own PostgreSQL logical database with the existing 48 migrations applied. This task added no new business migration, but AWS does not yet have the Fitness schema unless you create DB/secret and run migrations.

Do not use:

```text
prisma db push --accept-data-loss
```

### 23. AWS CONFIG CHANGES REQUIRED

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

### 24. BLOCKERS

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

### 25. FINAL VERDICT

FITNESS SERVICE READY FOR MANUAL AWS CONFIGURATION


---

<a id="merged-fitness-service-migration-lambda-report-2026-09-02"></a>

## Consolidated reference: FITNESS_SERVICE_MIGRATION_LAMBDA_REPORT_2026-09-02.md

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

## Fitness Service — Migration Lambda Artifact Report

### 1. MIGRATIONS FOUND

- Found `48` Fitness Service migration SQL files.
- Packaged path: `prisma/migrations/**/migration.sql`.
- ZIP verification:
  - `MIGRATION_SQL_COUNT=48`
  - `ZIP_ENTRY_COUNT=4193`

### 2. SAFETY GUARD

Implemented in:

```text
backend/services/fitness-service/src/migrate-lambda.ts
```

The handler reads `database` from `DATABASE_SECRET_ID` SecretString and refuses to continue unless it is exactly:

```text
fitness_assistant_fitness
```

If the secret points to `fitness_assistant`, `fitness_assistant_user`, `postgres`, or any other database, the handler stops with:

```text
Refusing to run Fitness Service migrations against non-fitness database.
```

The handler does not contain `prisma db push`, `prisma migrate dev`, `prisma migrate reset`, `--accept-data-loss`, `DROP DATABASE`, or destructive database reset logic.

### 3. DATABASE CREATE SUPPORT

Implemented.

Before running migrations, the handler:

1. Loads Aurora credentials from Secrets Manager.
2. Confirms the requested target database is exactly `fitness_assistant_fitness`.
3. Connects to Aurora maintenance database `postgres` using the same credentials.
4. Checks `pg_database`.
5. Runs only:

```sql
CREATE DATABASE "fitness_assistant_fitness"
```

if the database does not already exist.

It never drops any database and never targets Auth/User DBs.

### 4. HANDLER

AWS Lambda handler:

```text
dist/migrate-lambda.handler
```

Source:

```text
backend/services/fitness-service/src/migrate-lambda.ts
```

Runtime:

```text
Node.js 22.x
x86_64
```

### 5. ENV REQUIRED

Required:

```text
AWS_REGION=ap-southeast-1
DATABASE_SECRET_ID=fitness-assistant/dev/fitness-database
```

Secret JSON must contain:

```json
{
  "username": "<aurora-master-or-migration-user>",
  "password": "<password>",
  "host": "fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com",
  "port": 5432,
  "database": "fitness_assistant_fitness"
}
```

### 6. IAM REQUIRED

Migration Lambda execution role needs:

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
    }
  ]
}
```

Networking must allow Lambda to reach Aurora writer endpoint on PostgreSQL port `5432`.

### 7. BUILD COMMAND

From repository root:

```powershell
pnpm --filter @gym-coach/fitness-service run build:migrate-lambda-zip
```

Build result: PASS.

The script packages:

- compiled migration handler;
- Prisma CLI;
- `prisma/schema.prisma`;
- all 48 migrations;
- `schema-engine-rhel-openssl-3.0.x`;
- `libquery_engine-rhel-openssl-3.0.x.so.node`;
- production runtime dependencies.

### 8. ARTIFACT PATH

```text
backend/services/fitness-service/artifacts/fitness-migrate-lambda.zip
```

### 9. ZIP SIZE

```text
74,248,999 bytes
≈ 70.81 MB compressed
```

Because this is greater than `50 MB`, upload through S3 when using AWS Console, then select the S3 object as the Lambda code source.

### 10. AWS MANUAL SETTINGS

Manual Console settings:

1. Create Lambda, for example `fitness-assistant-dev-fitness-migrate`.
2. Runtime: `Node.js 22.x`.
3. Architecture: `x86_64`.
4. Handler: `dist/migrate-lambda.handler`.
5. Upload artifact via S3:

```text
backend/services/fitness-service/artifacts/fitness-migrate-lambda.zip
```

6. Environment variables:

```text
AWS_REGION=ap-southeast-1
DATABASE_SECRET_ID=fitness-assistant/dev/fitness-database
```

7. Attach VPC/private app subnets that can reach Aurora:

```text
fitness-assistant-dev-aurora.cluster-cda2u2ycivaj.ap-southeast-1.rds.amazonaws.com:5432
```

8. Attach security group allowing outbound to Aurora and Aurora inbound from Lambda SG on `5432`.
9. Set timeout high enough for real migrations, recommended `10–15 minutes`.
10. Set memory at least `1024 MB` initially for Prisma migration CLI.
11. Invoke manually once from AWS Console only after verifying the secret JSON database field is exactly `fitness_assistant_fitness`.

### 11. FINAL VERDICT

READY FOR REAL FITNESS DATABASE MIGRATION
