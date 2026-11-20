# V-T012 DEP-01 — Cấu hình AWS thực tế của luồng AI generation (đọc-chỉ)

Ngày 2026-10-20 · Claude Code. Tài khoản `191798898985` (`gymini-admin`), region `ap-southeast-1`. Chỉ dùng lệnh **đọc** (`sts get-caller-identity`, `sqs get-queue-attributes`, `lambda list-functions / list-event-source-mappings / get-function-configuration`). Không tạo/sửa/xóa gì. Giá trị biến môi trường chỉ được in cho danh sách tên không nhạy cảm; mọi giá trị khác bị che (`<set>`).
Lệnh thứ ba (DynamoDB, EventBridge Scheduler, DLQ) **bị hệ thống phân quyền từ chối** (phân loại "khám phá credential"), nên tôi dừng ở đó và không tìm cách vòng qua. Các mục đó là **NOT_VERIFIED**.

## 1. Đã đọc được (REAL AWS READ-ONLY)
| Thành phần | Giá trị thực tế |
|---|---|
| Queue `fitness-assistant-dev-ai-tasks` | VisibilityTimeout **600 s**; retention 4 ngày; RedrivePolicy → `…-ai-tasks-dlq`, **maxReceiveCount = 2**; 0 message đang chờ/ẩn |
| Event source mapping | `ai-worker` ← queue, **BatchSize 1**, `ReportBatchItemFailures`, Enabled |
| Lambda `ai-worker` | timeout **300 s**, 1024 MB, nodejs22; `QUEUE_PROVIDER=sqs`, `LLM_PROVIDER=bedrock`, `BEDROCK_CHAT_MODEL=apac.amazon.nova-pro-v1:0`, có `FITNESS_LAMBDA_NAME` và `USER_LAMBDA_NAME`, **không có `FITNESS_SERVICE_URL`** |
| Lambda `ai-jobs` | timeout 600 s (chứa handler `ai-generation-recovery` trong source) |
| Lambda `ai` (HTTP) | timeout 30 s |
| Biến `RATE_LIMIT_PROVIDER`, `AI_RATE_LIMIT_TABLE` | **không đặt** ở bất kỳ Lambda AI nào |
| Biến `AI_GENERATION_*`, `AI_AUTOSAVE_*` | **không đặt** ở bất kỳ Lambda AI nào ⇒ dùng mặc định trong code |

## 2. Hệ quả (phân tích từ giá trị thật + code)
1. **Quota không được chia sẻ (HIGH).** `RATE_LIMIT_PROVIDER` không đặt ⇒ mặc định `memory`: bộ đếm riêng cho từng instance Lambda. Quota `ai-expensive`/`ai-ask` thực tế **không được thực thi** khi có nhiều instance; chi phí Bedrock không bị chặn trần bởi lớp này. Cần `RATE_LIMIT_PROVIDER=dynamodb` + bảng `fitness-assistant-dev-ai-rate-limit` (khóa `key`, TTL `expiresAt`) + quyền `dynamodb:UpdateItem`. Sự tồn tại của bảng/IAM: **NOT_VERIFIED**.
2. **Lease (900 s) dài hơn cả timeout Lambda (300 s) lẫn visibility (600 s) (HIGH).** Nếu worker chết/timeout ở ≤300 s, lease vẫn "sống" đến 900 s. Message hiển thị lại ở 600 s, thấy `IN_FLIGHT` (lease chưa hết) và bị trả lỗi; với **maxReceiveCount = 2**, lần nhận tiếp theo đi thẳng vào DLQ. Operation nằm ở RUNNING cho tới khi bộ recovery (nếu có lịch) dọn. Cấu hình hợp lý: `AI_GENERATION_LEASE_SECONDS ≈ 330` (> timeout 300 s, < visibility 600 s) để lần nhận ở 600 s tiếp quản được.
3. **Số lần thử không khớp.** Code `AI_GENERATION_MAX_ATTEMPTS=3` và `MAX_PUBLISHES=3`, queue chỉ cho 2 lần nhận. Không gây sai dữ liệu (claim vẫn bảo vệ), nhưng ngân sách "3" không bao giờ đạt qua queue; cần quyết định cố ý (nâng maxReceiveCount hoặc hạ code).
4. **Lỗi mã đã sửa trong lượt này (P1, chỉ có thể thấy được nhờ bước 1):** `nutrition.processor.ts` gọi fitness-service bằng axios tới `FITNESS_SERVICE_URL || localhost:3002`, bỏ qua `requestService` (transport Lambda). Worker AWS không có `FITNESS_SERVICE_URL` ⇒ **mọi kế hoạch dinh dưỡng trên AWS fail** ở bước lấy thực phẩm ("Chưa có dữ liệu thực phẩm…") và autosave không bao giờ tới fitness-service. Đã đổi cả hai lời gọi sang `requestService` (HTTP giữ nguyên khi không có `*_LAMBDA_NAME`). Test `nutrition-processor-lambda-transport.test.ts` 3/3 (TEST FIXTURE ở tầng AWS SDK): đường Lambda dùng cho cả hai lời gọi, axios không bị chạm; Lambda lỗi ⇒ plan fail đúng thông điệp; local/docker không đổi. **Chưa deploy**; cần deploy worker để có hiệu lực.

## 3. Cấu hình đề xuất (chưa áp dụng — thay đổi hạ tầng cần bạn duyệt)
| Biến / tài nguyên | Hiện tại | Đề xuất |
|---|---|---|
| `RATE_LIMIT_PROVIDER` (ai, ai-worker) | không đặt (memory) | `dynamodb`; bảng `fitness-assistant-dev-ai-rate-limit` có TTL `expiresAt`, IAM `UpdateItem`; kiểm bằng test thật trước khi bật |
| `AI_GENERATION_LEASE_SECONDS` (ai-worker, ai-jobs) | 900 (mặc định) | 330 |
| SQS `maxReceiveCount` | 2 | 3 (khớp `MAX_ATTEMPTS`) hoặc đặt `AI_GENERATION_MAX_ATTEMPTS=2` |
| Lịch `ai-generation-recovery` (EventBridge → `ai-jobs`, rate 5 phút, input `{"job":"ai-generation-recovery"}`) | **chưa xác minh** | xác nhận có/không; nếu chưa có thì tạo, vì replay autosave (R222-04) và dọn operation mắc kẹt chỉ chạy khi có runner |
| Thứ tự rollout | — | áp 2 migration ai-service **trước** khi deploy producer/worker/jobs; chỉ bật `AI_GENERATION_REQUIRE_OPERATION=true` sau khi queue legacy rỗng |

## 4. NOT_VERIFIED (đang chờ quyền)
Bảng DynamoDB (tồn tại, TTL, billing), IAM của role Lambda đối với DynamoDB/SQS/Bedrock/Lambda-invoke, lịch EventBridge Scheduler (đích, input, trạng thái), độ sâu DLQ, các migration đã áp trên Aurora, cutoff message legacy. Muốn đọc tiếp cần cho phép rõ ràng các lệnh đọc đó (ví dụ thêm quy tắc quyền Bash cho `aws dynamodb describe-table|describe-time-to-live`, `aws scheduler list-schedules|get-schedule`, `aws sqs get-queue-attributes`, `aws iam get-role-policy|list-attached-role-policies` với profile `gymini-admin`).

## 5. Đọc bổ sung sau khi được cấp quyền (REAL AWS READ-ONLY, cùng ngày)
| Mục | Kết quả thực tế |
|---|---|
| DynamoDB `fitness-assistant-dev-ai-rate-limit` | **KHÔNG TỒN TẠI** (`ResourceNotFoundException`). Toàn tài khoản chỉ có 1 bảng: `fitness-assistant-tfstate-lock` |
| Hệ quả | Nếu chỉ đặt `RATE_LIMIT_PROVIDER=dynamodb` mà chưa tạo bảng, limiter **fail-closed** và chặn toàn bộ lời gọi AI tốn phí. Hiện tại không có quota phân tán nào được thực thi (provider mặc định `memory`) |
| Role `…-ai-worker-role` | Policy runtime chỉ có: `secretsmanager:GetSecretValue` (secret ai-database), `sqs:ReceiveMessage/DeleteMessage/GetQueueAttributes` trên queue ai-tasks, `lambda:InvokeFunction` tới các service Lambda, `bedrock:InvokeModel` (Nova Pro profile `apac.…`, foundation-model nova-pro, cohere embed), + `AssumeDivuzhaBedrockRole`. **Không có quyền DynamoDB.** Không có `sqs:SendMessage` (đúng: worker không publish; Lambda `ai` HTTP mới publish) |
| EventBridge Scheduler | 14 lịch, **tất cả DISABLED** (dev đang tắt tiết kiệm chi phí theo `.dev/aws/shutdown-20261019.json`). **Không có lịch nào cho `ai-generation-recovery`** (chỉ có ai-autoaccept/pubmed/rss/local-evidence/web…) |
| Hệ quả | Bộ recovery (dọn operation mắc kẹt, replay autosave R222-04) **chưa bao giờ chạy trên AWS**: handler có trong `ai-jobs` nhưng không có trigger |
| DLQ `…-ai-tasks-dlq` | 0 message |

### Việc cần làm để V-T012 chạy đúng trên AWS (mỗi mục là thay đổi hạ tầng — cần xác nhận riêng trước khi thực hiện)
1. Tạo bảng DynamoDB `fitness-assistant-dev-ai-rate-limit` (PK `key` kiểu S, TTL `expiresAt`, PAY_PER_REQUEST) và thêm `dynamodb:UpdateItem` (và `GetItem`) trên bảng đó vào policy của role `ai` + `ai-worker`; **sau đó** mới đặt `RATE_LIMIT_PROVIDER=dynamodb` ở các Lambda AI. Thứ tự này bắt buộc để không tự khóa dịch vụ.
2. Đặt `AI_GENERATION_LEASE_SECONDS=330` ở `ai-worker` và `ai-jobs`; cân nhắc nâng `maxReceiveCount` của queue từ 2 lên 3.
3. Tạo lịch EventBridge Scheduler `…-ai-generation-recovery` (rate 5 phút, đích `ai-jobs`, input `{"job":"ai-generation-recovery"}`), để **DISABLED** cho tới khi dev được bật lại theo quy trình `aws-dev-power`.
4. Deploy ai-service mới (các sửa P1 của worker dinh dưỡng, dedupe câu hỏi thường) **sau khi** áp 3 migration ai-service lên Aurora.

## 6. Đã tạo trên AWS (script `scripts/aws/ai-quota-and-recovery-setup.ps1 -Apply`, bạn đã duyệt)
Đã tạo: bảng DynamoDB cho rate limit, chính sách IAM tương ứng, và lịch recovery ở trạng thái **DISABLED**. **Chưa áp dụng** biến môi trường Lambda (`RATE_LIMIT_PROVIDER=dynamodb`, `AI_GENERATION_LEASE_SECONDS=330`) — chạy `-ApplyLambdaEnv` **chỉ sau khi** deploy bản ai-service mới và áp 3 migration ai-service lên Aurora (nếu đặt trước, code cũ sẽ không hiểu hoặc schema thiếu cột). Bật lịch recovery khi môi trường dev được bật. Nhãn: REAL AWS (tạo tài nguyên); chưa kiểm hành vi sau deploy.
