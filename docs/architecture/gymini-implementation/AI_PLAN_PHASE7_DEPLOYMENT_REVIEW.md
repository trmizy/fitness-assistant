# Giai đoạn 7 (bước 1–3) — Hồi quy, kiểm tra vận hành, review triển khai

Ngày 2026-10-20 · Claude Code. **Chưa deploy gì.** Bản này là điều kiện để bạn quyết định deploy; bước 4–6 (chạy thử phạm vi nhỏ, theo dõi, mở rộng) chỉ bắt đầu sau khi bạn duyệt.

## 1. Hồi quy (phạm vi và nhãn, không phải "toàn repo")
Chạy `tsx --test src/__tests__/*.test.ts` từng service trên **DB test cô lập** (55433) và Redis test (56379): BACKEND INTEGRATION / unit.
| Service | Kết quả | Ghi chú |
|---|---|---|
| ai-service | 1408 pass / 3 fail / 7 cancelled / 54 skip (1472) | 3 lỗi = persona thiết bị (cần danh mục bài tập thật từ fitness-service, stack đang tắt); 7 bị huỷ = `publishPlan`/`republishVersion` timeout 60–120 s (cần dịch vụ khác chạy). **Chưa chạy lại với stack bật** để xác nhận; chưa kiểm trên HEAD sạch cho nhóm này |
| fitness-service | 971 pass / 21 fail / 4 skip (996) | toàn bộ test của tôi pass (roster, quyết định đề xuất, muscle-profiles, `importAiPlan` idempotent). 21 lỗi nằm ở: danh mục bài tập/persona thiết bị, danh mục thực phẩm/`substituteMealItem`/filter, `GET /exercises/:id/substitute` 401, chu kỳ thích nghi — **có dấu hiệu thiếu dữ liệu danh mục trong DB test** (`test:catalog:setup` chưa chạy), nhưng **chưa kiểm trên HEAD sạch** nên chưa khẳng định là có từ trước |
| user-service | 318 pass / 6 fail / 1 skip (325) | 6 lỗi **đều do môi trường, không thuộc thay đổi của tôi**: 3 lỗi đóng phòng gọi pass khi đặt `INTERNAL_SERVICE_SECRET`; 2 lỗi agentic cần chạy seed demo (`dev:seed-agentic-demo`); 1 lỗi enum `NotificationEventType` thiếu giá trị `SESSION_PENDING_CONFIRMATION` ⇒ DB test user chưa áp migration mới của nhánh khác |
| gateway, auth-service, chat, gym, payment | **không chạy** | không có thay đổi của tôi; auth-service có thay đổi không phải của tôi (mục 4) |
Trước đó trên HEAD sạch (worktree 003545c6): nhóm workflow/workout/agent của ai-service có đúng 2 lỗi cũ; cả hai đã sửa (187 pass / 0 fail / 13 skip).

## 2. Kiểm tra vận hành (đã có bằng chứng ở Giai đoạn 1; không chạy lại toàn bộ)
| Hạng mục | Bằng chứng |
|---|---|
| Idempotency/retry/recovery (PG, Redis thật) | `test:integration` 29/29, `nutrition-autosave.http.itest` — BACKEND INTEGRATION |
| Chat retry không tạo trùng | REAL BROWSER 18/18 (R222-03) |
| Quota/rate limit | `ai-rate-limiters` + bảng DynamoDB đã tạo trên AWS; **biến môi trường Lambda chưa áp** |
| Quyền Lambda/role/Bedrock | `AI_PLAN_PHASE6_MODEL_ACCESS_REPORT.md` (chỉ đọc); **chưa có lần gọi thật từ Lambda** |
| PT: relationship re-verify, audit | REAL HTTP/API 15/15 + REAL BROWSER 12/12 (fixture hợp đồng) |

## 2.1 Rủi ro đã biết trước khi deploy
- **Trần Bedrock 50 request/phút** cho cả tài khoản divuzha (mục 3 báo cáo Giai đoạn 6).
- `AI_GENERATION_LEASE_SECONDS` mặc định 900 s > timeout Lambda worker 300 s ⇒ cần đặt 330 (script `-ApplyLambdaEnv`) **sau** khi deploy.
- Chưa có độ trễ đo từ trong AWS.
- Bộ đánh giá độc lập (Giai đoạn 5) chưa có ⇒ chưa có mốc chất lượng tổng quát để quyết định mở rộng.

## 3. Review triển khai theo từng thay đổi (mỗi thay đổi độc lập, có thể rollback riêng)
Thứ tự đề xuất: **DB trước, code sau, cấu hình bật tính năng cuối cùng**.
| # | Thay đổi | Phụ thuộc | Migration | Rollback |
|---|---|---|---|---|
| 1 | ai-service: 3 migration (`ai_generation_operations`, `…_epoch`, `conversation_client_request_id`) | Aurora ai DB | **thuần cộng thêm**: tạo bảng; thêm cột có default/nullable; thêm index (unique trên cột nullable) ⇒ code cũ chạy bình thường | giữ nguyên (code cũ bỏ qua bảng/cột mới); không cần `down` |
| 2 | fitness-service: `POST /internal/exercises/muscle-profiles`, `GET /coach/clients/adherence`, `POST /coach/clients/:id/ai-proposals/decision`, `importAiPlan` idempotent | không migration | không | redeploy bản trước (endpoint mới không ai gọi nếu ai-service cũ) |
| 3 | user-service: `GET /internal/contracts/active-clients` | `x-service-secret` | không | redeploy bản trước ⇒ fitness-service không đọc được danh sách client ⇒ roster báo "không đọc được danh sách" (503, không hiện số sai) |
| 4 | ai-service code: durable generation, dedupe chat, revisions (workout/nutrition/roadmap), PT Copilot, health gates | #1, #2, #3 đã lên trước | — | redeploy bản trước (schema giữ nguyên) |
| 5 | ai-worker: transport fitness qua Lambda, lease/recovery | #1; `FITNESS_LAMBDA_NAME` đã có | — | như #4 |
| 6 | frontend: thẻ PT proposal, nút "Mở AI Coach" cho PT, ẩn "Để sau" | #4 (thẻ chỉ xuất hiện khi backend trả khối mới) | — | redeploy bản trước; backend mới vẫn tương thích |
| 7 | Cấu hình AWS: `RATE_LIMIT_PROVIDER=dynamodb`, `AI_GENERATION_LEASE_SECONDS=330`, bật lịch recovery | **chỉ sau #1+#4+#5** | — | gỡ biến / tắt lịch (script `ai-quota-and-recovery-setup.ps1`) |
Thứ tự bắt buộc: #1 → (#2, #3) → #4/#5 → #6 → #7. Bật #7 trước #4 sẽ làm code cũ không hiểu biến mới hoặc thiếu cột.

## 4. Thay đổi trong cây làm việc KHÔNG phải của tôi (cần xử lý riêng trước deploy)
`backend/shared/src/log-safety.ts` + `backend/shared/src/index.ts` (xuất `httpLogSerializers`), `backend/services/auth-service/src/app.ts`, `backend/services/user-service/src/app.ts` (import `httpLogSerializers`), và các test `logger-redaction`, `log-secret-hygiene`. `@gym-coach/shared` được dùng từ `dist`: **phải build lại shared trước khi build/deploy user-service và auth-service**, nếu không import `httpLogSerializers` sẽ lỗi lúc chạy. Tôi không sửa các file này.
Ngoài ra cây làm việc có hơn 120 thay đổi chưa commit gồm cả công việc từ các phiên trước; **chưa có commit nào** — bạn cần quyết định cách tách commit/PR trước khi deploy (tôi không commit khi chưa được yêu cầu).

## 5. Kế hoạch chạy thử phạm vi nhỏ + rollback (bước 4, chưa thực hiện)
1. Áp migration #1 lên Aurora ai (kiểm `\d` sau khi áp). 2. Deploy #2, #3. 3. Deploy #4/#5. 4. Gọi thử một lần Nova Pro **từ Lambda** (chứng minh assume-role). 5. Mở cho nhóm nhỏ (tài khoản nội bộ) rồi mới bật #7. 6. Theo dõi: tỉ lệ 4xx/5xx `/ai/ask`, số `failed/stranded` trong `ai_generation_operations`, DLQ, throttling Bedrock (50 rpm), độ trễ p90, số audit PT.
Tiêu chí dừng/rollback: DLQ > 0 kéo dài, `stranded` tăng liên tục, throttling Bedrock > 1%, lỗi định tuyến sai đưa đến lưu nhầm (kiểm audit).
