# User Service Final AWS Configuration Report — 2026-08-28

## 1. Scope

Hoàn thiện readiness của Fitness Assistant User Service để cấu hình AWS Lambda cuối cùng. Không deploy, không gọi AWS mutate, không chạy Terraform/CDK/SAM apply.

## 2. Repository state

- Branch: `master`
- Commit: `44ec149 feat: notifications/reminders, all 6 types, scope confirmed with user`
- Worktree: dirty sẵn từ nhiều task trước; các thay đổi trong report này chỉ tập trung User Service Lambda safety.

## 3. AWS target provided by user

- Region: `ap-southeast-1`
- HTTP API: `https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com`
- User Lambda: `fitness-assistant-dev-user`
- Handler chính: `dist/lambda.handler`
- Jobs handler cần cấu hình thêm: `dist/jobs-lambda.handler`
- Upload bucket: `fitness-assistant-uploads-dev-191798898985`

## 4. Non-goals observed

- Không triển khai production.
- Không tạo resource AWS mới.
- Không chạy migration phá dữ liệu.
- Không commit `.env`.
- Không hard-code secrets.

## 5. File storage audit

Các điểm filesystem còn lại đã được phân loại:

- Profile photo legacy: local-only, bị 410 trên Lambda; S3 presign path dùng cho AWS.
- PT application documents: đã thêm S3 presign/confirm và signed redirect.
- Contract PDF: đã chuyển sang private S3 khi chạy Lambda hoặc có `USER_UPLOAD_BUCKET`.
- InBody OCR: chỉ dùng file tạm `/tmp` rồi xoá; phù hợp Lambda.
- Dropbox Sign provider: vẫn cần local file nếu bật e-sign; hiện AWS target đang `REQUIRE_CONTRACT_ESIGN=false`.

## 6. Profile photo result

Profile photo AWS flow hiện là:

```text
POST /profile/me/photo/presign
Client PUT direct to S3
POST /profile/me/photo/confirm
DB stores s3://profile-photos/<userId>/<uuid>.<ext>
API returns short-lived signed GET URL as photoUrl
```

Không còn giả định S3 object là public.

## 7. PT application document result

Đã thêm AWS-safe flow:

```text
POST /pt-applications/me/upload/presign
POST /pt-applications/me/upload/confirm
GET  /pt-applications/documents/s3?key=...&exp=...&sig=...
```

DB lưu ref ổn định `s3://pt-applications/...`; UI nhận signed route ngắn hạn. Route signed nội bộ redirect 302 sang S3 presigned GET.

## 8. Contract PDF result

`generateContractPdf()` hiện:

- Lambda hoặc có `USER_UPLOAD_BUCKET`: render PDF buffer trong memory, upload private S3, lưu `s3://contracts/<contractId>/contract.pdf`.
- Local/Docker: giữ flow cũ, ghi `uploads/contracts/<contractId>.pdf`.

`GET /contracts/:id/pdf` redirect 302 sang S3 presigned GET nếu DB chứa `s3://...`.

## 9. E-sign state

Dropbox Sign provider vẫn không đọc trực tiếp private S3 PDF. Đã thêm lỗi rõ ràng nếu ai bật e-sign với `s3://` PDF:

```text
keep REQUIRE_CONTRACT_ESIGN=false or add a /tmp download bridge
```

Với cấu hình AWS hiện tại `REQUIRE_CONTRACT_ESIGN=false`, đây không còn là blocker deploy User Service.

## 10. Background jobs result

Đã thêm `src/jobs-lambda.ts`.

Supported jobs:

- `session-auto-confirm`
- `reschedule-expiry`
- `session-settlement`

Handler worker không gọi `setInterval`; mỗi EventBridge invoke chạy đúng một job.

## 11. EventBridge schedule recommendation

Dựa trên constants hiện tại:

- `session-auto-confirm`: mỗi 10 phút, event `{ "job": "session-auto-confirm" }`
- `reschedule-expiry`: mỗi 10 phút, event `{ "job": "reschedule-expiry" }`
- `session-settlement`: mỗi 5 phút, event `{ "job": "session-settlement" }`

Có thể dùng cùng ZIP `user-lambda.zip`, tạo Lambda function riêng hoặc alias/config riêng trỏ handler `dist/jobs-lambda.handler`.

## 12. API Gateway route impact

Các route mới nằm dưới prefix đã có:

- `/profile/*`
- `/pt-applications/*`
- `/contracts/*`

Vì API Gateway hiện có `ANY /prefix` và `ANY /prefix/{proxy+}`, không cần thêm public prefix mới. Không expose `/internal`.

## 13. Database migration impact

Không có Prisma schema change mới cho task này. Không cần migration mới vì các field hiện có vẫn là string URL/path:

- `UserProfile.photoUrl`
- `PTApplication.*Url`
- `PTApplicationCertificate.certificateFileUrl`
- `PTApplicationMedia.fileUrl`
- `Contract.contractPdfPath`

Nếu AWS DB chưa apply migration repo mới nhất thì cần chạy migration riêng theo quy trình hiện có, nhưng task này không tạo migration mới.

## 14. IAM policy required for User Lambda

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

## 15. S3 CORS required

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

## 16. Required Lambda environment variables

Không ghi secret value trong repo. Các biến cần có:

- `AWS_REGION=ap-southeast-1`
- `DATABASE_SECRET_ID=fitness-assistant/dev/user-database`
- `USER_UPLOAD_BUCKET=fitness-assistant-uploads-dev-191798898985`
- `AUTH_LAMBDA_NAME=fitness-assistant-dev-auth`
- `INTERNAL_SERVICE_SECRET` hoặc `INTERNAL_API_SECRET`
- `REQUIRE_CONTRACT_ESIGN=false`
- `ANTHROPIC_API_KEY` chỉ cần nếu bật InBody OCR AI thật.

## 17. InBody OCR audit

InBody upload dùng multer destination:

- Lambda: `/tmp/inbody-uploads`
- Local: `uploads/`

Controller xoá temp file sau OCR. Runtime cần outbound internet/NAT hoặc provider reachable nếu dùng Anthropic SDK. Nếu chưa cấu hình `ANTHROPIC_API_KEY`, OCR AI không thể production-pass.

## 18. External dependencies

User Service gọi ngoài:

- Auth Lambda qua `AUTH_LAMBDA_NAME`
- Payment service trong settlement/contract money flows
- Chat service/notification paths tuỳ luồng
- Anthropic cho InBody OCR nếu bật
- Dropbox Sign nếu `REQUIRE_CONTRACT_ESIGN=true`

Các Lambda private cần outbound internet nếu gọi external SaaS.

## 19. Build evidence

Command:

```text
pnpm --filter @gym-coach/user-service build
```

Result: PASS, `tsc` exit code 0.

## 20. Test evidence

Command:

```text
pnpm --filter @gym-coach/user-service exec tsx --test src/__tests__/profile-photo-presign.test.ts src/__tests__/ptDocumentUrl.util.test.ts src/__tests__/jobs-lambda.test.ts src/__tests__/lambda-runtime.test.ts src/__tests__/lambda-filesystem-safety.test.ts
```

Result: PASS 36/36.

## 21. Artifact evidence

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

## 22. Isolated artifact smoke test

Extracted ZIP outside repo and invoked handlers.

Result:

- `HTTP_HANDLER_TYPE=function`
- `JOBS_HANDLER_TYPE=function`
- `/health` returned `200`
- Unknown job returned `400`
- `NO_UPLOADS_DIR_CREATED`

This proves artifact does not rely on workspace `node_modules` for these handlers.

## 23. Secret scan evidence

Extracted ZIP scan:

- Files scanned: `4,177`
- Result: `NO_SECRET_VALUE_PATTERNS_FOUND_IN_EXTRACTED_ZIP`

Searched for secret assignment/value patterns such as `DATABASE_URL=`, `JWT_SECRET=`, `INTERNAL_SERVICE_SECRET=`, provider API keys, private key marker, and secret-id literal.

## 24. Files changed by this pass

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

## 25. Final verdict

USER SERVICE READY FOR FINAL AWS CONFIGURATION

Next exact console step: upload `backend/services/user-service/artifacts/user-lambda.zip` to `fitness-assistant-dev-user`, keep handler `dist/lambda.handler`, then create/configure the jobs Lambda using the same ZIP with handler `dist/jobs-lambda.handler` and the EventBridge inputs listed above.
