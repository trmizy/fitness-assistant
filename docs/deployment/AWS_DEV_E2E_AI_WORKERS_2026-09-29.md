# AWS DEV E2E — AI Service / Worker / Jobs

**Phạm vi:** Phase 3. Tuyệt đối không gọi LLM thật (OpenAI/Anthropic), không gửi SQS message thật có thể kích hoạt worker. Chỉ test endpoint đọc thuần DB, kiểm tra hạ tầng SQS/EventBridge qua AWS CLI read-only, đọc source để phân biệt route nào gọi LLM.

## 1. Route mapping — LLM-call vs read-only (VERIFIED_SOURCE)

`backend/services/ai-service/src/app.ts` mount: `/ai`→ai.routes.ts, `/plans`→plan.routes.ts, `/admin/ai/marketplace`→admin-marketplace.routes.ts, `/admin/ai`→admin.routes.ts, `/marketplace`→marketplace.routes.ts + personalized-service.routes.ts, `/internal`→internal only (không public). `session.routes.ts` và `memory.routes.ts` **không được mount ở đâu cả** — dead code, không thể gọi qua bất kỳ path nào.

| Nhóm | Method+Path | Gọi LLM? | Ghi chú |
|---|---|---|---|
| ai.routes.ts | GET /ai/feedback/stats | Không | Đọc DB thuần |
| ai.routes.ts | POST /ai/analyze-cycle, /assess-cycle, /analyze-feedback, /generate-client-plan-draft, /generate-roadmap-draft, /explain-exercise-progression, /agent/goal-image, /agent/image-chat | **Có** | Tất cả POST này gọi LLM — **không test live** |
| plan.routes.ts | GET /plans/llm-health | Không | Health-check nội bộ, không gọi LLM thật |
| plan.routes.ts | GET /plans/current, /plans/nutrition/current, /plans/job/:jobId, /plans/:planId | Không | Đọc DB thuần |
| plan.routes.ts | POST /plans/nutrition/:id/explain, /adjust, POST tạo plan mới | **Có** | Không test live |
| admin.routes.ts | GET /admin/ai/overview, /requests, /requests/:id, /queue, /errors, /knowledge | Không | Đọc DB/queue-status thuần |
| admin-marketplace.routes.ts | GET /admin/ai/marketplace/plans | Không | Đọc DB |
| marketplace.routes.ts + personalized-service.routes.ts | GET /marketplace/plans*, /marketplace/packages*, /marketplace/services*, /marketplace/orders/mine | Không | Đọc DB (marketplace/PT service theo "Marketplace PT Service Rework") |
| marketplace.routes.ts | POST /marketplace/plans/:id/improvement-suggestions | **Có** | Không test live |

## 2. Test thật (VERIFIED_HTTP) — chỉ endpoint không gọi LLM

| Test ID | Endpoint | Expected | Actual | Evidence Type | Status |
|---|---|---|---|---|---|
| A01 | GET /ai/feedback/stats | 200 | 200, 107 bytes | VERIFIED_HTTP | PASS |
| A02 | GET /plans/current | 200 | 200, 58195 bytes (dữ liệu thật, nhiều plan) | VERIFIED_HTTP | PASS |
| A03 | GET /plans/nutrition/current | 200 | 200, 18371 bytes | VERIFIED_HTTP | PASS |
| A04 | GET /marketplace/plans?page=1&limit=5 | 200 | 200, 3356 bytes | VERIFIED_HTTP | PASS |
| A05 | GET /marketplace/packages | 200 | 200, 9127 bytes | VERIFIED_HTTP | PASS |
| A06 | GET /plans/llm-health | 200, không phát sinh chi phí LLM | 200, 228 bytes | VERIFIED_HTTP | PASS |
| A07 | GET /admin/ai/overview (ADMIN) | 200 | **503**, Lambda timeout 30000ms | VERIFIED_HTTP + VERIFIED_INFRA | **FAIL — xem BUG-A1** |
| A08 | GET /admin/ai/queue (ADMIN) | 200 | **503**, Lambda timeout 30000ms | VERIFIED_HTTP + VERIFIED_INFRA | **FAIL — cùng BUG-A1** |
| A09 | GET /admin/ai/errors (ADMIN) | 200 | 200, 5615 bytes | VERIFIED_HTTP | PASS |
| A10 | GET /marketplace/services?page=1&limit=5 | 200 (có thể rỗng) | 200, 68 bytes (danh sách rỗng — trạng thái hợp lệ, chưa có personalized service nào được publish) | VERIFIED_HTTP | PASS |

### BUG-A1 (P1/P2) — `/admin/ai/overview` và `/admin/ai/queue` timeout 30s, trả 503
- **Bằng chứng CloudWatch:** 3 request liên tiếp trong log `fitness-assistant-dev-ai`, mỗi request `Duration: 30000.00 ms`, `Status: timeout` — đúng bằng Lambda timeout config, API Gateway trả về 503 cho client.
- **Đối chứng:** `/admin/ai/errors` (cùng router `admin.routes.ts`, cùng ADMIN token) trả về bình thường trong <1s → không phải lỗi auth/role, không phải Lambda cold-start chung, mà cụ thể ở 2 handler `getOverview`/`getQueue`.
- **Root cause category:** Application code (nghi ngờ truy vấn aggregate chậm hoặc gọi phụ thuộc bị treo) — **chưa xác định được dòng code cụ thể trong phạm vi thời gian audit này**, cần trace sâu hơn (không tự sửa theo scope).
- **Không phải do Aurora restart** — test này chạy sau khi Aurora đã ổn định và các endpoint DB khác (A02-A05, A09) đều nhanh, bình thường.

## 3. AI Worker (`fitness-assistant-dev-ai-worker`) — hạ tầng SQS (VERIFIED_INFRA)

- **Event Source Mapping:** CÓ, `Enabled`, `EventSourceArn: arn:aws:sqs:...:fitness-assistant-dev-ai-tasks`, `BatchSize: 1`, `FunctionResponseTypes: [ReportBatchItemFailures]` (partial-batch-failure reporting đã bật đúng chuẩn).
- **DLQ:** CÓ, `fitness-assistant-dev-ai-tasks-dlq`, redrive policy `maxReceiveCount: 2` — message lỗi 2 lần sẽ vào DLQ.
- **Trạng thái queue tại thời điểm audit:** cả queue chính và DLQ đều **0 message** (Visible=0, NotVisible=0) — không có backlog, không có message bị stuck.
- **Không gửi bất kỳ message thật nào vào queue** (đúng theo hard safety rule) — do đó **không verify được code xử lý message thực thi đúng hay không qua live E2E**; chỉ verify được cấu hình hạ tầng.
- **Phát hiện đáng chú ý:** `aws logs describe-log-groups` **không tìm thấy log group nào cho `fitness-assistant-dev-ai-worker`** (không có `/aws/lambda/fitness-assistant-dev-ai-worker`). Lambda tự tạo log group khi cold-start lần đầu thành công — việc log group không tồn tại nghĩa là **worker này chưa từng được invoke thành công lần nào** kể từ khi log group hiện tại (nếu có) hết hạn/bị xoá, hoặc chưa từng cold-start. → **NOT_TESTED thật sự (chưa ai từng thấy nó chạy), không chỉ là "tôi không test".**

## 4. AI Jobs (`fitness-assistant-dev-ai-jobs`) — cơ chế trigger

- **Event Source Mapping:** KHÔNG có (rỗng).
- **EventBridge Rules:** Toàn bộ account **không có bất kỳ EventBridge rule nào** (kiểm tra `aws events list-rules`, danh sách rỗng) — nghĩa là **không có schedule tự động nào** cho ai-jobs (cũng như cho bất kỳ *-jobs Lambda nào khác: fitness-jobs, gym-jobs, payment-jobs, user-jobs — tất cả đều không có event source mapping và không có EventBridge rule).
- **Kết luận:** Cơ chế trigger thật của `ai-jobs` **không xác định được qua kiểm tra hạ tầng read-only** trong phạm vi audit này — có thể được gọi trực tiếp (Lambda:Invoke) từ ai-service, nhưng chưa verify qua source trong thời gian cho phép. **BLOCKED/NOT_TESTED**, cần audit source code riêng (`grep InvokeCommand` trong ai-service) ở phiên sau nếu cần xác nhận.
- Tương tự, `fitness-jobs`, `gym-jobs`, `payment-jobs`, `user-jobs` đều **không có event source mapping và không có EventBridge rule** — cùng tình trạng NOT_TESTED/không rõ cơ chế kích hoạt, không riêng gì AI.

## Tổng kết Phase 3

| Hạng mục | Kết quả |
|---|---|
| AI Service read-only endpoints | 8/10 PASS thật (VERIFIED_HTTP), 2 FAIL (BUG-A1, timeout) |
| AI LLM-triggering endpoints | KHÔNG test (đúng theo hard rule cấm chi phí LLM) |
| AI Worker (SQS consumer) | Hạ tầng đúng cấu hình (VERIFIED_INFRA), nhưng **chưa từng được invoke** (không có log group) — không thể xác nhận code xử lý message hoạt động đúng |
| AI Jobs | Cơ chế trigger không xác định được — BLOCKED |
| Các *-jobs Lambda khác (fitness/gym/payment/user) | Cùng tình trạng: không rõ cơ chế trigger, không có EventBridge rule nào trong account |

**Không có chi phí AI/LLM nào phát sinh trong toàn bộ audit này** — xác nhận qua việc chỉ gọi các GET đã phân loại rõ "Không" trong bảng mục 1.
