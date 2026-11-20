# Plan Review — báo cáo giai đoạn 3 (2026-11-20) — Workstream A (Plan Review agent)

**NO AWS DEPLOY · NO CLOUD MUTATIONS · NO IAM CHANGES · NO COMMIT · NO PUSH.**
Bằng chứng gốc (log, kịch bản, ảnh chụp): `docs/plan-review/evidence-2026-11-20/`.

## 1. Phân công ownership thực tế
- Mình = Plan Review agent ⇒ chỉ Workstream A + các hạng mục "hồi quy bổ sung".
- **Không đụng** (vẫn uncommitted, mtime 17/11, không worktree/báo cáo nhận): `ai-service` `plan.controller.ts`, `conversation.repository.ts`, `workout-adjustment-constraints.ts` (+ `plan.routes.ts`, `conversation.service.ts`). **Workstream B (AI Plan owner) và C chưa bắt đầu** — C cần B và hợp đồng API đã thống nhất; không ai nhận B trong phiên này.
- Môi trường: stack **native** (tsx) trên DB dùng-một-lần `pr3_auth_test / pr3_user_test / pr3_fitness_test` (Postgres test container :55433). Không dùng Docker dev stack, Ollama, knowledge-worker, Aurora DEV. Docker Desktop được bật chỉ để chạy 2 container test. Tiến trình E2E đã tắt sau khi xong.
- Lưu ý chi phí: **AWS DEV đang chạy** (khởi động ở đầu phiên theo yêu cầu riêng), tự tắt 16:00 ngày 20/11.

## 2. Kết quả theo hạng mục
| Mục | Nhãn bằng chứng | Kết quả |
|---|---|---|
| A1 Browser E2E | **REAL BROWSER** (Chromium + Vite + gateway thật, đăng nhập bằng form) | **28/28 pass** |
| A2 Mobile E2E | — | **KHÔNG CHẠY ĐƯỢC**: máy không có Android SDK/adb/emulator/thiết bị. Jest-expo hỏng sẵn (thiếu plugin babel) ⇒ component test mới viết **CHƯA CHẠY**. Còn có: unit 7/7 + `tsc` (1 lỗi `global.css` có từ trước) |
| A3 Notification | **REAL HTTP/API** (fitness+user+gateway sống) | pass (trong 62/62) |
| A4 Gateway | **REAL HTTP/API** | pass (trong 62/62) |
| A5 Version/Approval | **REAL HTTP/API** + **BACKEND INTEGRATION** | pass; PV01–PV06 (10/10 cùng DB01–DB04) |
| A6 Regression | BACKEND INTEGRATION | 1089 test: 1064 pass, **21 fail**, 4 skip; **0 lỗi mới** so với baseline HEAD |
| Volume parser | unit | pass (20/20 validator) |
| Nhãn tiếng Việt + `parseDayFocusMuscleGroups` | unit | pass (4/4) |
| Active Cycle 409 | BACKEND INTEGRATION (fixture local) | 3/3 — cơ chế tái hiện, **chưa chứng minh là nguyên nhân trên AWS** |
| Web build | REAL BUILD | `vite build` pass (35s) sau thay đổi cuối |

### A1 — Browser E2E (28 kiểm tra; `evidence/browser-e2e.log`, ảnh `screenshots/`)
Học viên mở kế hoạch hiện tại → panel "PT duyệt kế hoạch"; xác nhận gửi nêu rõ không kèm InBody; **bấm đúp** "Xác nhận gửi" ⇒ đúng 1 bản ghi (DB); refresh giữ trạng thái; PT thấy hộp thư, mở kế hoạch (không có dữ liệu sức khoẻ), nút "Yêu cầu chỉnh sửa" khoá khi chưa có nhận xét; PT yêu cầu chỉnh sửa; học viên thấy phản hồi và gửi lại (bản mới, lịch sử giữ); **học viên sửa kế hoạch khi PT đang xem ⇒ PT bấm Duyệt nhận 409 và thông báo "đã thay đổi", DB không APPROVED**; gửi lại → PT duyệt → học viên thấy "PT đã duyệt"; sửa lại kế hoạch ⇒ UI nói duyệt cũ không còn áp dụng; token hết hạn ⇒ app đưa về trang đăng nhập, không tạo request; 360px/390px không tràn ngang.
- **Lỗi UX thật tìm thấy và đã sửa**: web vẫn hiện huy hiệu xanh "PT đã duyệt" cho bản duyệt đã lỗi thời (mobile đã đúng). Sửa `PlanReviewPanel.tsx`; chạy lại E2E 28/28.
- Hạn chế trung thực: (1) fixture chương trình tạo bằng API (TEST FIXTURE), phần còn lại qua UI; (2) **token hết hạn dùng 401 được chèn bằng route interception** (không có cách "thật" hợp lý để hết hạn JWT 15 phút) — quan sát phản ứng thật của app; (3) 503 trong console là các lời gọi sang AI/chat cố ý không chạy; (4) gateway local chạy với `RATE_LIMIT_MAX_REQUESTS=5000` (biến cấu hình có sẵn, chỉ cho lần test này) vì giới hạn 100 req/phút làm hỏng một lần chạy trước (429).

### A3/A4/A5 — API E2E (62 kiểm tra; `evidence/api-e2e.log`)
- 401 mọi route không/sai token; body có `clientUserId`/`role` ⇒ 400; học viên không hợp đồng ⇒ 403; client đọc inbox PT ⇒ 403; người ngoài đọc request ⇒ **404** (không IDOR); duyệt sai revision / sai hash ⇒ 409; reject thiếu note ⇒ 400; gửi trùng cùng khoá ⇒ 200 replay; **3 request song song cùng khoá ⇒ 1 bản ghi**.
- **user-service tắt**: PT duyệt ⇒ **503 fail-closed** (không duyệt, không thu hồi nhầm); học viên gửi ⇒ 503, không tạo gì; học viên huỷ (không cần roster) ⇒ 200 và sự kiện nằm **pending trong outbox**. Khôi phục user-service ⇒ job quét 60s giao hết; bất biến **số thông báo ở user DB = số sự kiện outbox (không trùng)**; sự kiện quyết định không bị tạo thêm/không đổi trạng thái.
- Version: sửa mô tả buổi/mô tả chương trình **không** bump; sửa số lần **bump 1→2**; sửa rồi trả lại (A→B→A) ⇒ version 3, bản duyệt cũ **không hồi sinh**, gửi lại là request mới gắn v3; **PT duyệt song song với sửa kế hoạch** ⇒ an toàn (quyết định hoặc thành công trước, hoặc 409+SUPERSEDED).
- **Hợp đồng bị chấm dứt**: PT bị chặn 403, không duyệt được, request mở ⇒ `ACCESS_REVOKED`, inbox rỗng, học viên không gửi được nữa.
- fitness-service tắt ⇒ gateway trả 5xx (không phải thành công giả).
- PV06 (mới): bắt đầu buổi, ghi/hoàn thành set **không** đổi version (lịch sử không phải nội dung duyệt).

## 3. File đã thay đổi trong giai đoạn này
- `frontend/web/src/app/components/plan-review/PlanReviewPanel.tsx` — huy hiệu "Đã duyệt bản cũ — cần gửi lại".
- `backend/services/ai-service/src/llm/proposed-change-validator.ts` (+ `__tests__/proposed-change-validator.test.ts`): bỏ nhãn kỳ "tuần 4:", ưu tiên số có đơn vị, phân biệt hàng nghìn "38.225"/thập phân "62,5"; `extractLeadingNumber` được export. **"tuần 4: 38225 kg → 45000 kg" = +17,73%** (test khẳng định ~17,73; qua ngưỡng 20% của người mới; trước đây đọc là 4→45000 và bị loại).
- `backend/services/ai-service/src/workers/ai.worker.ts`: chỉ `export` thêm `splitGoalForDay` để test; + `src/__tests__/ai-worker-day-focus-accents.test.ts` (nhãn có dấu cho mọi goal × 2–7 buổi, không còn chữ không dấu/tiếng Anh; nhóm cơ phân giải đúng).
- `backend/services/fitness-service/src/__tests__/training-cycle-active-409.integration.test.ts` (mới) và PV06 trong `plan-review.program-version.integration.test.ts`.
- `frontend/mobile/src/features/planReview/__tests__/PlanReviewCard.test.tsx` (mới, **chưa chạy được**).
- Bằng chứng: `docs/plan-review/evidence-2026-11-20/*`.

## 4. Active Training Cycle 409 — kết luận có kiểm soát
`advanceRoadmap` kiểm tra "còn chu kỳ đang chạy?" theo **phạm vi giai đoạn** (`fitness-roadmap.service.ts` ~1346–1348), nhưng `startCycle` (gọi ngay sau đó, ~1460) chặn theo **toàn user** (`training-cycle.service.ts:545–550`). Một chu kỳ ACTIVE **không thuộc giai đoạn** (lẻ/legacy) lọt qua kiểm tra đầu và vấp kiểm tra sau ⇒ lỗi tiếng Anh chung "An active training cycle already exists" dù chu kỳ giai đoạn đã đóng đúng. Test 409-B tái hiện, kiểm tra không ghi dở (phase vẫn ACTIVE, không có chu kỳ/audit thừa) và phục hồi sau khi đóng chu kỳ lẻ; 409-C xác nhận chỉ mục unique DB. **Chưa sửa** (yêu cầu chỉ điều tra); đề xuất: `advanceRoadmap` phát hiện ACTIVE toàn user và trả thông điệp tiếng Việt chỉ rõ chu kỳ cần đóng. **Cần đọc-chỉ-đọc dữ liệu chu kỳ của người dùng đó mới biết có đúng ca này không** (cũng có thể là hai lần bấm).

## 5. Hồi quy (A6)
- Lệnh: `tsx --test --test-concurrency=2 src/__tests__/*.test.ts` trên Postgres test + Redis test, catalog đã seed, **cổng 3002 để trống** (một số test gọi thẳng :3002; một lần chạy trước bị lẫn vì stack E2E chiếm cổng nên đã hủy và chạy lại). Log: `evidence/fitness-regression-r5.log`.
- 1089 test, 1064 pass, 21 fail, 4 skip. So từng tên với `head-baseline-fail.txt` (22 lỗi trên HEAD sạch): **0 lỗi mới**; 1 test baseline (`runUpcomingReminderSweep … finds today's…`, phụ thuộc thời điểm) lần này qua — không coi là "đã sửa".
- Đây là hồi quy **fitness-service**, không phải toàn repo. ai-service chạy các suite liên quan (validator, nhãn, worker) nhưng không chạy lại toàn bộ.

## 6. Còn blocked / chưa làm
1. **Workstream B/C** (AI Plan identity "Plan A.1", "lên 7 bài", ngân sách token, kịch bản tích hợp C1–C11): phụ thuộc file của luồng khác; chưa ai nhận.
2. **Mobile E2E** trên emulator/thiết bị; jest-expo cần cài đủ phụ thuộc (`@babel/plugin-transform-…` thiếu) — ngoài phạm vi (không đổi `node_modules`).
3. Thông báo trên Lambda/EventBridge, route API Gateway AWS, migration lên AWS (đều cấm).
4. Nguyên nhân 409 trên AWS cần xem dữ liệu thật (cấm).
5. IAM `lambda:InvokeFunction` vẫn bị classifier chặn (không bypass).

## 7. Verdict
- Backend + web của Plan Review: bằng chứng **thật** ở mức REAL BROWSER / REAL HTTP/API / BACKEND INTEGRATION, không lỗi mới.
- **NOT READY FOR COMMIT như một tính năng đầy đủ**: thiếu mobile E2E thật, thiếu Workstream B/C và khoảng trống ownership. Phần Plan Review riêng có thể xem xét để commit sau khi owner duyệt diff.
