# V-T012 PG-01 / Q-01 — Integration evidence (isolated PostgreSQL + Redis)

Ngày 2026-10-20 · Claude Code · trả lời blocker PG-01 và Q-01 của `V-T012_2_2_INDEPENDENT_REREVIEW.md`.
Không commit, không push, không AWS, không dùng DEV DB, không gọi model tính phí, không đụng heldout. Không sửa source production trong lượt này (chỉ thêm test và một script `test:integration`).

## 1. Môi trường (cô lập)
- Docker Desktop khởi động lại theo yêu cầu. Chỉ dùng container test có sẵn: `gymcoach-test-postgres-test-1` (Postgres 15, `localhost:55433`, DB `gymcoach_ai_test`) và `gymcoach-test-redis-test-1` (`127.0.0.1:56379`). Dev DB (`5433`) không được nối tới.
- `prisma migrate deploy` áp **chỉ vào DB test**: `20261019180000_ai_generation_operations`, `20261019190000_ai_generation_operation_epoch` (áp thành công trên PostgreSQL thật; trước đó DB ở `20260927150000`).
- Hai file test tự từ chối chạy nếu `DATABASE_URL` không phải `localhost:55433/*_test` hoặc Redis không phải `56379`.

## 2. Kết quả — BACKEND INTEGRATION
`pnpm test:integration` (tuần tự, `--test-concurrency=1`): **23 pass / 0 fail / 0 skipped**. File PG chạy riêng 3 lần liên tiếp: 18/18 mỗi lần, DB sạch sau mỗi lần.

| Hạng mục (PG-01) | Kết quả trên PostgreSQL thật |
|---|---|
| 12 submit đồng thời cùng (actor,key) | 1 hàng, 1 lần trừ quota, 1 plan; replay không tạo thêm |
| Cùng key khác payload (mọi trạng thái, kể cả FAILED) | 409, không reopen; actor khác cùng key = operation độc lập |
| `claimPublish` CAS, 10 claimant đồng thời | đúng 1 thắng; không vượt max; epoch sai không tiêu budget |
| Publish lỗi ở ADMITTED | dừng ở 3 lần gửi/epoch rồi operation+plan FAILED; chỉ lần retry sau mới mở epoch mới (tính phí lần 2 — chính sách đã ghi) |
| 10 claim worker đồng thời | đúng 1 CLAIMED; binding sai = MISMATCH |
| `runFenced` | owner ghi được; token cũ / plan khác / lease hết hạn bị từ chối, không ghi gì; lỗi trong `fn` rollback ghi của nó |
| Takeover sau khi lease hết hạn | worker cũ không renew/finish/ghi được |
| `settleStranded` (SQL `FOR UPDATE` thật) | op+plan cùng FAILED; plan COMPLETED được giữ; epoch cũ là no-op; idempotent |
| **Rollback** (trigger Postgres làm update plan ném lỗi) | operation **không** bị để FAILED; sau khi hết lỗi, lần sau hoàn tất cặp |
| `settleStranded` đua với worker đang giữ lease | tuần tự hóa, không kết quả mâu thuẫn |
| Reopen FAILED: epoch+1, plan mới; 2 reopen đồng thời | chỉ 1 lần tăng epoch; message epoch cũ = STALE_MESSAGE; polling trả epoch mới |
| `takeOverReserving` CAS 2 bên | 1 thắng; token thua không admit/xóa được |
| `recoverPendingGenerations` + reconciliation (SQL thật) | republish trong budget; PUBLISHED hết budget → FAILED; cặp op FAILED/plan QUEUED được sửa; chạy lần 2 không làm lại việc đã settle |
| `withGenerationOperation` đầu-cuối | 6 worker đồng thời → processor chạy đúng 1 lần; redelivery không chạy lại |
| Độ bền | PrismaClient thứ hai (pool khác) thấy dữ liệu đã commit |

| Hạng mục (Q-01) | Kết quả trên BullMQ + Redis thật |
|---|---|
| ID `<operationId>-e<epoch>` | được chấp nhận; enqueue trùng → đúng 1 job |
| Epoch khác | job riêng; ID dạng `op:epoch` bị validator BullMQ thật từ chối |
| `submitGeneration` → Redis | job đúng tên, đúng `operationId/epoch/planId/kind/actorUserId`; replay không thêm job, 1 lần trừ quota |
| Worker thật làm job FAILED | `describeOperationJob` báo FAILED + lý do qua ID suy từ epoch; user khác → FORBIDDEN |
| Vòng đời lưu giữ | job COMPLETED còn được giữ **nuốt** republish cùng ID (không chạy lại) cho tới khi bị xóa |

## 3. Phát hiện cần ghi nhận (mục 1 đã được sửa ở §8.4, review #1)
1. **BullMQ retention (Q-01):** nếu job BullMQ cũ của một execution còn được giữ (COMPLETED/FAILED) thì republish của recovery cùng `operationId-e<epoch>` bị nuốt và không chạy. Với `QUEUE_PROVIDER=sqs` (đường deploy) điều này không áp dụng; với BullMQ cần `removeOnComplete/removeOnFail` hoặc xóa job trước khi republish. Chưa là blocker cho SQS, nhưng phải quyết định nếu BullMQ được dùng ở môi trường nào ngoài dev. **ĐÃ SỬA sau review:** `enqueueAiTask` (BullMQ) xóa job failed/completed cùng id trước khi republish; test Redis thật cập nhật.
2. Bài test đầu tiên của tôi kỳ vọng sai ("retry ADMITTED không bao giờ tính phí lần hai"). Hành vi đúng và đã ghi trong tài liệu: bound áp dụng **theo epoch**; retry cùng key sau khi FAILED là epoch mới có tính phí.

## 4. Giới hạn trung thực
- Không phải multi-process thật: các race dùng nhiều kết nối/promise trong một process Node, cộng với một PrismaClient thứ hai. Chưa chạy hai process worker riêng biệt.
- Publisher/quota/model là giả; **SQS, DynamoDB, Lambda, EventBridge, DLQ: NOT_VERIFIED** (DEP-01 chưa làm).
- **R222-04 (autosave dinh dưỡng) chưa quyết định/chưa làm.** **REAL BROWSER: chưa chạy.**
- Chưa chạy full repository regression; chỉ chạy các suite nêu trên. Không dùng negative control mới cho bộ test tích hợp (trigger rollback đã chứng minh được lỗi được ném đúng chỗ).

## 5. R222-04 — autosave dinh dưỡng, phương án (B) durable intent (đã triển khai)

**Đính chính bằng chứng:** báo cáo correction trước viết "không thấy unique constraint trên (userId, sourcePlanId)". Sai: `@@unique([userId, sourcePlanId])` có trong schema và index `nutrition_programs_user_id_source_plan_id_key` có trong migration `20260816000000_catch_up_db_push_drift` và trong DB test. Hệ quả: **không thể tạo hai program** cho cùng plan; va chạm chỉ gây lỗi P2002. Vì vậy (B) **không cần migration ở fitness-service** và **không thêm cột ở ai-service**.

Rủi ro thật còn lại là **autosave bị mất** (worker mất lease/chết giữa lúc plan COMPLETED và lúc gọi fitness-service; redelivery thấy plan COMPLETED và bỏ qua). Thay đổi:
- **ai-service `generation-operations.ts`:** ý định được *suy ra*, không nhân đôi trạng thái: operation COMPLETED + `NUTRITION_PLAN` + job có `autoSaveOnComplete` + chưa có `payload.autoSaveAckedAt`. Store thêm `ackAutoSave`, `claimAutoSaveAttempt` (CAS đếm lần thử trong payload, tối đa `AI_AUTOSAVE_MAX_ATTEMPTS`=5), `listPendingAutoSave` (cửa sổ `AI_AUTOSAVE_REPLAY_WINDOW_HOURS`=72). `recoverPendingGenerations` có thêm bước replay (summary mới `autoSaved`). `acknowledgeAutoSave()` ghi ack cho worker đang giữ lease.
- **ai-service `nutrition.processor.ts`:** autosave trả boolean và ack khi thành công; `replayCompletedNutritionAutoSave` chỉ gửi plan **của chính epoch đó**, trạng thái COMPLETED, đúng chủ sở hữu (actor của operation), có nội dung; ngày dựng từ thời điểm hoàn tất (xác định), không từ lúc replay. Lỗi autosave không bao giờ đổi trạng thái plan/operation.
- **fitness-service `importAiPlan`:** P2002 trên (user, sourcePlanId) → trả `alreadyExists` thay vì lỗi (idempotent khi worker và replay đua nhau).

Bằng chứng:
| Kiểm tra | Nhãn | Kết quả |
|---|---|---|
| SQL jsonb: liệt kê, ack idempotent, sai epoch, 10 claim đồng thời ≤ max, cửa sổ, không có cờ | BACKEND INTEGRATION (PostgreSQL test) | pass |
| Recovery replay: thành công → ack → không replay lại; luôn lỗi → dừng ở max; plan/op vẫn COMPLETED | BACKEND INTEGRATION | pass |
| `replayCompletedNutritionAutoSave` tới HTTP server cục bộ: không gửi khi plan chưa COMPLETED / actor lạ / không có nội dung; gửi đúng `sourcePlanId`, `x-user-id`, ngày; 500 → false | BACKEND INTEGRATION (HTTP cục bộ, không phải fitness-service thật) | pass |
| `importAiPlan` 8 lần đồng thời cùng (user, plan): đúng 1 program, 7 alreadyExists, 7 ngày; user khác = program khác | BACKEND INTEGRATION (DB fitness test) | pass |
| Negative control: bỏ bản sửa P2002 | — | test fail "Unique constraint failed", bản sửa đã được áp lại |
| Fixture ack/replay/cap | TEST FIXTURE | pass |

Tổng đã chạy sau thay đổi: `pnpm test:integration` ai-service **29/29**; scoped ai-service (5 suite + 3 suite nutrition.processor) **188/188**; fitness-service 8 file liên quan `nutrition.service`/`importAiPlan` **103/103**; `tsc --noEmit` cả hai service sạch. Không phải full regression.

Giới hạn còn lại của R222-04: chưa chạy luồng thật worker → fitness-service HTTP đầu-cuối (REAL HTTP/API); recovery vẫn phụ thuộc lịch `ai-generation-recovery` được nối ở môi trường triển khai (DEP-01 NOT_VERIFIED). Replay chỉ tồn tại khi runner chạy; không có runner thì hành vi trở về best-effort cũ.

## 6. Bổ sung 2026-10-20 (phiên làm tiếp)

### 6.1 R222-04 REAL HTTP/API (đã chạy)
`nutrition-autosave.http.itest.ts` (4 test, `pnpm test:integration:http`): processor thật + Express app thật của fitness-service (auth nội bộ bằng token) + PostgreSQL thật, chỉ giả lập lời gọi LLM (đáp án mẫu đã ghi) và publisher. Một proxy mỏng chèn lỗi 503 vào đúng endpoint autosave.
- Autosave thành công → đúng 1 NutritionProgram, ack được ghi, replay không gửi lại.
- Mất autosave (outage) → plan/operation vẫn COMPLETED, chưa có program; recovery thử lại có giới hạn; hết outage → tạo đúng 1 program và ack.
- 6 lần lưu đồng thời cùng plan → vẫn 1 program. Gọi không có token → 401.
- Negative control: đặt `AI_AUTOSAVE_MAX_ATTEMPTS=0` (tắt replay) → test mất autosave fail (`undefined !== 1`).
Lưu ý: chạy test này/`test:integration` khi stack browser đang chạy sẽ xung đột (worker BullMQ của stack tranh job trên cùng Redis test); đã tắt stack trước khi xác nhận 29/29 hai lần.

### 6.2 REAL BROWSER R222-03 (Nova Pro, ai-service qua Bedrock)
`test/ai-chat-full-verification/browser-r222-03.mjs`: form đăng nhập thật, gateway/auth/user/fitness/ai thật trên DB test; chỉ lỗi mạng được chèn bằng Playwright (chuyển tiếp request tới backend thật rồi **làm rơi response**). Kết quả **17/17 pass**:
id sinh phía client và lưu trước khi gửi; "Thử lại" gửi đúng 1 request cùng id và cùng câu hỏi; gửi lại có chủ ý dùng id mới; reload giữa chừng → trạng thái "chưa rõ" + "Thử lại" (không tự gửi lại), retry dùng lại id cũ; đăng xuất qua UI xóa token, user B cùng browser không thấy bản ghi của user A.
Lần chạy với model 4B cục bộ có 2 mục fail (2d, 4c) do model trả lời >30 s làm client ngắt luồng; với Nova Pro (~8 s) cả hai pass. **Phát hiện:** server chỉ dedupe lệnh tạo kế hoạch; retry sau khi mất response với một **câu hỏi thường** tạo thêm một hội thoại trùng tên (đo qua `/ai/sessions`). Câu chữ UI đã sửa không còn hứa "không tạo trùng" chung chung (chat-request-identity.ts + test 12/12). Dedupe server cho câu hỏi thường **chưa làm** (quyết định sản phẩm riêng).

### 6.3 DEP-01 (kiểm tra code, không truy cập AWS)
- Repo **không có IaC** cho SQS ai-tasks, DynamoDB `fitness-assistant-dev-ai-rate-limit`, EventBridge `ai-generation-recovery`, event-source mapping/DLQ/visibility (chỉ có URL queue trong `scripts/aws/dev-stop.ps1`; `infra/terraform|cloudformation` không chứa chúng). Chúng được tạo ngoài repo ⇒ **NOT_VERIFIED**, cần kiểm tra trên tài khoản `gymini-admin` (chưa được cho phép; profile `divuzha` chỉ được cấp để dùng Nova Pro).
- Đã sửa: `intEnv` (generation-operations) và `ai-rate-limiters` im lặng chấp nhận NaN/âm — với rate limiter đó là **fail-open**. Giờ `utils/env-int.ts` ném lỗi rõ tên biến khi giá trị đặt nhưng sai (`env-int.test.ts`, 5 test).
- Việc còn lại cho DEP-01: bảng DynamoDB/TTL/IAM UpdateItem, lease 900 s so với timeout Lambda/visibility SQS/DLQ/maxReceiveCount, lịch recovery (EventBridge → `ai-generation-recovery`, rate 5 phút), thứ tự áp migration trước khi rollout, cutoff message legacy (`AI_GENERATION_REQUIRE_OPERATION`).

## 7. Verdict
`PG-01: VERIFIED` · `Q-01: VERIFIED cho BullMQ; SQS NOT_VERIFIED` · `R222-04: CORRECTED (BACKEND INTEGRATION + REAL HTTP/API cục bộ)` · `R222-03: VERIFIED REAL BROWSER (17/17, Nova Pro)` · `DEP-01: NOT_VERIFIED (cần truy cập AWS gymini)` · `V-T012: chưa đóng — còn DEP-01 và review độc lập (Codex đã rút; cần chỉ định người review).`

Tái chạy: `docker start gymcoach-test-postgres-test-1 gymcoach-test-redis-test-1`, rồi từ `backend/services/ai-service`:
`NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test REDIS_HOST=127.0.0.1 REDIS_PORT=56379 LLM_PROVIDER=mock FITNESS_DISABLE_REDIS=true pnpm test:integration`

## 8. Bổ sung (đồng ý 3 mục): dedupe câu hỏi thường, DEP-01, review

### 8.1 Dedupe server cho câu hỏi thường (làm theo quyết định của bạn)
- **Vì sao:** REAL BROWSER cho thấy retry sau khi mất response tạo hội thoại thứ hai (server chỉ dedupe lệnh tạo kế hoạch).
- **Thiết kế:** cột nullable `conversations.client_request_id` + `UNIQUE (user_id, client_request_id)` (migration additive `20261020100000_conversation_client_request_id`, đã áp vào DB test; **chưa** áp lên môi trường nào khác). `ragService.rag` (điểm chung của `/ai/ask` và `/ai/ask/stream`) tra theo **user đã xác thực**: gặp lượt đã lưu ⇒ trả lại đúng lượt đó (`replayed: true`, cùng `sessionId` nên client nhận lại phiên gốc), **không gọi model lần hai**. Cùng id khác câu hỏi hoặc khác `sessionId` ⇒ 409 `IDEMPOTENCY_KEY_CONFLICT`. Client cũ không gửi id ⇒ hành vi cũ. Hai lượt đua nhau: unique index giữ đúng một lượt, bên thua trả lời bằng lượt thắng và **xóa phiên rỗng** do chính nó tạo (chi phí duy nhất là một lần gọi model thừa).
- **Bằng chứng:** `rag-client-request-dedupe.test.ts` 6/6 (DB test thật, chỉ thay orchestrator): replay không gọi model lần hai, 1 phiên/1 tin; replay trong phiên đã biết; sai sessionId/khác câu hỏi ⇒ 409; theo từng user; gửi mới (id mới) và client cũ không bị dedupe; 6 lượt đồng thời ⇒ 1 lượt, không phiên mồ côi. **REAL BROWSER 18/18** (kịch bản mới 2c2: sau retry chỉ còn **1** hội thoại; trước đó là 2).
- UI: câu chữ "không bị tạo trùng / nhận lại đúng kết quả" nay đúng sự thật (chat-request-identity.ts, test 12/12).
- **Giới hạn:** chỉ lượt **đã lưu** mới được replay; retry khi lượt đầu lỗi trước khi lưu (ví dụ model lỗi) vẫn chạy mới (đúng ý). Phiên rỗng do lượt lỗi (có sẵn từ trước) không thuộc thay đổi này. Cần áp migration trước khi deploy mã ai-service mới.

### 8.2 DEP-01
Xem [V-T012_DEP01_AWS_CONFIG_REVIEW.md](V-T012_DEP01_AWS_CONFIG_REVIEW.md): đọc được SQS/Lambda; phát hiện quota không chia sẻ (RATE_LIMIT_PROVIDER không đặt), lease 900 s > Lambda 300 s/visibility 600 s với maxReceiveCount 2, và **lỗi P1 đã sửa**: worker dinh dưỡng trên AWS gọi fitness-service bằng axios tới localhost (nay dùng `requestService`, test 3/3). DynamoDB/EventBridge/DLQ/IAM: NOT_VERIFIED (lệnh đọc bị hệ thống phân quyền từ chối).

### 8.3 Tổng số liệu cuối phiên (không phải full regression)
ai-service nhóm agent/workflow/revision/CI/generation/dedupe/transport/RAG (48 file): **564/566** (2 lỗi cũ không liên quan); `test:integration` PG+Redis 29/29; fitness-service muscle-profiles 2/2 + importAiPlan idempotency 2/2; frontend chat-request-identity 12/12; REAL BROWSER 18/18; `tsc` ai-service và fitness-service sạch.

### 8.4 Review độc lập (skill `code-review`, mức high, chạy trong ngữ cảnh tách biệt) — 10 phát hiện và cách xử lý
Phạm vi: 7 file lõi đã đổi trong phiên (generation-operations, rag.service, workout-draft-intents, nutrition.processor, env-int, internal.controller, nutrition.service). Đây là review do một lượt chạy tách biệt của chính công cụ review, **không phải người review độc lập** (Codex đã rút, chưa chỉ định người). Tôi tự xác minh từng phát hiện trước khi sửa.

| # | Phát hiện | Đánh giá | Xử lý |
|---|---|---|---|
| 1 | BullMQ giữ job failed/completed cùng id nên republish của recovery không chạy lại | Đúng (chỉ chế độ BullMQ; SQS không bị) | `enqueueAiTask` (BullMQ) xóa job **failed/completed** cùng id trước khi add; job waiting/active vẫn được dedupe. Test Redis thật đổi theo: republish sau COMPLETED và sau FAILED đều chạy lại; trùng khi đang waiting vẫn 1 job |
| 2 | "đúng rồi" bị hiểu là KHÔNG vì bỏ dấu "đừng"="đúng"="dung" | Đúng, **nghiêm trọng về nghĩa** | Khẳng định xét trước; chỉ "dung roi/vay/the" là YES, "dung bo/xoa/lam" là NO; "thôi bỏ luôn đi" là YES; test |
| 3 | "đổi buổi thứ 4 sang buổi tối" thành `REPLACE_SESSION_FOCUS` | Đúng một phần: không phá lịch (từ chối giữ nguyên) nhưng câu trả lời nói sai; trước đây nhánh chọn-ngày còn **thu lịch về 1 buổi** nên hiện tại vẫn tốt hơn | Câu trả lời nay nói rõ "cũng như giờ giấc hay mức nặng nhẹ của từng buổi"; test xác nhận nhận diện và không phá lịch |
| 4 | Từ trùng khi bỏ dấu: "vài"≈"vai", "mong", "sung", "dau" | Đúng | Cần nhóm cơ trong **3 từ quanh** từ chỉ đau; cụm "chấn thương/bị thương/căng cơ/bong gân" gộp thành một token; loại "vài ngày…", "mong là…"; "hết/khỏi/bớt đau" không phải ràng buộc; 3 test |
| 5 | Replay dùng ngày hoàn tất (tới 72 giờ trước) nên chương trình đã "trôi" vào quá khứ | Đúng | Cửa sổ bắt đầu khi **lưu** (replay time); idempotency vẫn theo `sourcePlanId`; test PG cập nhật |
| 6 | `republished` đếm sai khi thua claim; budget cạn bị tính là lỗi | Đúng (độ chính xác số liệu) | Chỉ đếm khi `publishCount` tăng; 503 sau khi settle FAILED tính vào `failed` |
| 7 | `assertGenerationLeaseHeld` nằm trong `try` có `catch` đánh dấu plan FAILED; chỉ nhờ trùng hợp mà plan COMPLETED không bị lật | Đúng | `catch` ngoài ném lại ngay `StaleLeaseError`, không đụng plan |
| 8 | `allowZero` so sánh theo tên biến; comment đặt nhầm chỗ | Đúng (chất lượng code) | Truyền `allowZero` tại nơi gọi; chuyển comment |
| 9 | Khối try/catch không thụt lề; replay thiếu trường phụ (recommendation, evidenceUsed…) | Thụt lề: đúng, đã sửa. Thiếu trường: đúng, **giới hạn đã ghi nhận** — lượt đã lưu chỉ có `answer`/`structuredBlocks`; client hiển thị cùng nội dung chính |
| 10 | Thiếu `INTERNAL_SERVICE_SECRET` thì gửi header token rỗng thay vì bỏ header | Đúng | `serviceHeaders()` bỏ hẳn header khi không có secret |

Sau sửa: scoped 48 file 567/569 (2 lỗi cũ không liên quan), `test:integration` PG+Redis 29/29, `tsc` sạch.
