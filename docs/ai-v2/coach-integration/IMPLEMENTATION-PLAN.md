# IMPLEMENTATION-PLAN — Tích hợp Multi-Agent V2 vào AI Coach (M9.1–M9.5)

Soạn 2026-11-16 (baseline `a6b517cd`). **Mỗi lúc chỉ MỘT milestone ACTIVE.** Milestone kế tiếp chỉ bắt đầu khi chủ dự án nói rõ, và `CURRENT-STATE.md` được cập nhật. Đây là kế hoạch của AI: nó **không** phải quyết định đã được duyệt; các lựa chọn thiết kế nằm ở `DECISIONS.md` với trạng thái `PROPOSED` cho tới khi chủ dự án phê duyệt.

Quy ước trạng thái task: `DONE` · `ACTIVE` · `READY` (đủ điều kiện) · `BLOCKED_ON_DECISION` · `BLOCKED` · `NOT_STARTED`. Không đoán task đã xong: chỉ `DONE` khi có bằng chứng ghi ở cột Tests.

Ràng buộc chung cho mọi milestone: V1 phải còn chạy; không deploy (D-001); không gọi AWS/Nova/Bedrock/DB thật khi chưa có phê duyệt riêng; không sửa benchmark để tăng điểm; không vượt release blocker (CURRENT-STATE §Known); thay đổi phía V1 chạm `agent-v2` cần phê duyệt pin.

---
## M9.1 — Audit, bản đồ chức năng và hạ tầng tiếp nối  `COMPLETE` (commit `37f3d99a`)
Phạm vi: chỉ tài liệu + `CLAUDE.md` ở worktree `ai-v2-coach-integration-plan`. Không đụng runtime.
| ID | Task | File | Dependencies | Acceptance | Tests / bằng chứng | Status |
|---|---|---|---|---|---|---|
| M9.1-T1 | Kiểm kê chức năng AI hiện có và đường dữ liệu | `CAPABILITY-MAP.md` | — | Mỗi dòng có file thật và nhãn trạng thái | CODE AUDIT | DONE |
| M9.1-T2 | Kiến trúc mục tiêu, adapter, invariants | `ARCHITECTURE.md` | T1 | Nguồn file/commit cho nhận định chính | CODE AUDIT | DONE |
| M9.1-T3 | Nhật ký quyết định tách APPROVED/PROPOSED | `DECISIONS.md` | T2 | Không có đề xuất AI nào ở APPROVED | rà soát | DONE |
| M9.1-T4 | Kế hoạch và checkpoint | `IMPLEMENTATION-PLAN.md`, `CURRENT-STATE.md` | T1–T3 | Next action chính xác, STOP conditions | rà soát | DONE |
| M9.1-T5 | `CLAUDE.md` bootstrap | `CLAUDE.md` | T4 | Một mục ngắn, không trùng quy tắc cũ | diff | DONE |
| M9.1-T6 | Verify tài liệu (commit local nếu được phép) | — | T1–T5 | Đường dẫn tồn tại; chỉ file tài liệu thay đổi | script kiểm tra: 50 tên file + đường dẫn đều resolve; scan secret sạch | DONE — commit `37f3d99a` sau khi có ngoại lệ hẹp cho hook (D-010); không dùng `ALLOW_TEST_ARTIFACTS=1` |
Hook pre-commit đã được xử lý bằng ngoại lệ đường dẫn chính xác (D-010) + test `scripts/git/check-staged-test-artifacts.test.mjs`.

---
## M9.2 — Cầu nối AI Coach ↔ V2 phía server (cờ OFF, chỉ fake)  `ACTIVE` — T1, T2 đã làm (fixture); T3–T5 CHƯA mở
Mục tiêu: một lớp tích hợp mỏng, **không nhân đôi logic**, giữ lịch sử V1 và có đường lui V1. Phương án **B** đã được chủ dự án chốt (D-008).
| ID | Task | File dự kiến | Dependencies | Acceptance | Tests | Status |
|---|---|---|---|---|---|---|
| M9.2-T0 | Chủ dự án chọn phương án adapter và duyệt ngoại lệ pin | `DECISIONS.md` | M9.1 | D-P01 → D-008 APPROVED (B). **D-P02 (ngoại lệ pin) vẫn PROPOSED** | — | DONE một phần: adapter chốt; pin chưa duyệt |
| M9.2-T1 | Lõi cầu nối: chọn capability trước runtime, V1 mặc định, một nhánh chính, phân loại kết quả V2 (answered/partial/blocked/unavailable), SAFETY INVARIANT không fallback, không bịa metadata. **Chưa gắn vào route** | `backend/services/ai-service/src/services/coach-v2-bridge.ts` + `__tests__/coach-v2-bridge.test.ts` | T0 | mọi `status` V2 có ánh xạ; flag OFF ⇒ V1 | TEST FIXTURE: 13/13 pass; `tsc --noEmit` sạch; pin cô lập, V1 safety, endpoint policy xanh. **Đính chính (T2):** HR-27 trông xanh lúc chạy vì file khi đó chưa commit (`git diff` bỏ qua file untracked); sau khi commit nó fail cùng RI-2 → xem T5; commit `76ae18e1` | **DONE (PASS)** |
| M9.2-T2 | Hợp đồng liên tục: idempotency + lịch sử hội thoại cho bridge (ports tiêm được, **không** DB/Redis/mạng, chưa gắn route) | `services/coach-v2-continuity.ts` (+ chỉnh `coach-v2-bridge.ts`: V2 cần `clientRequestId` hợp lệ, tách `dispatchV2`) + `__tests__/coach-v2-continuity.test.ts` | T1, D-012, D-013 | xem "Kết quả T2" bên dưới | TEST FIXTURE: bridge 13/13 + continuity 19/19 pass; `tsc --noEmit` sạch; 4 đột biến (ghi cả turn bị chặn / cướp claim IN_PROGRESS / bỏ so khớp fingerprint / bỏ release) đều bị test bắt; commit `abdf2dd5` | **DONE (PASS, chỉ fixture)** |
| M9.2-T3 | Nối route `/ai/ask` + `V2Executor` thật (dynamic import `multi-agent-runtime`) + adapter thật cho `CoachIdempotencyStore`/`CoachHistoryPort`; V2 lỗi **sau khi đã xử lý** → KHÔNG về V1 (D-009); chỉ về V1 khi "chưa bắt đầu" | `routes/ai.routes.ts`/controller (chạm V1) + file adapter mới | T1, T2, D-P02, D-P11, D-P13 | cờ OFF ⇒ hành vi V1 **y hệt** (so sánh với `a6b517cd`); không fallback sau khi V2 đã xử lý | test hồi quy V1 + test route + **DB test cô lập** cho adapter | **NOT_STARTED — chưa mở** |
| M9.2-T4 | Tương thích SSE: phát `status` → một `token` → `done` từ kết quả JSON, hoặc để FE dùng đường JSON | như trên | T1 | FE hiện có parse được | test parser phía FE (fixture) | NOT_STARTED |
| M9.2-T5 | Cập nhật pin (isolation allowlist, RI-2, HR-27) theo phê duyệt | `agent-v2-isolation.test.ts`, `agent-v2-release-identity.test.ts`, `agent-v2-hybrid-router.test.ts` | T0 | mọi pin xanh sau cập nhật có ghi chú owner | các test pin | **PIN UPDATE REQUIRED** — **RI-2 và HR-27** hiện fail có chủ đích (thêm `services/coach-v2-bridge.ts`, `services/coach-v2-continuity.ts`; RI-2 còn đếm `CLAUDE.md`, `scripts/git/check-staged-test-artifacts*.mjs`). D-011: không cập nhật trong T2. Chờ chủ dự án duyệt (D-P02). Pin chưa bị sửa |
### Kết quả T2 (2026-11-16, chỉ FIXTURE)
**Đã làm (code + test):** (I1) khoá = (userId đã xác thực, `clientRequestId`) + dấu vân tay hành động (capability, câu hỏi đã trim, sessionId); không nối userId với key; user khác không với tới được bản ghi. (I2) key dừng ở boundary: input strict V2 chỉ có `question`/`userId`/`sessionId`. (I3) claim nguyên tử: trùng đồng thời → đúng 1 lần chạy V2, còn lại `IN_PROGRESS`; bản ghi đang chạy **không bao giờ bị cướp**. (I4) lỗi ném giữa lượt → `IN_DOUBT`, V2 không chạy lại. (I5) store hỏng/bản ghi hỏng → fail-closed, không V2, không V1. Cùng key khác nội dung/session → `KEY_CONFLICT` (như V1 409). Retry → trả kết quả đã lưu, không gọi V2 lần hai. (H1) lịch sử chỉ ghi `ANSWERED` (PARTIAL mặc định không, D-P12); bị chặn/không khả dụng/ném lỗi/chưa bắt đầu không ghi, và không để lại session rỗng. (H2) không bịa metadata (`structuredBlocks`, `routeIntent`, `responseLanguage`, `relevance`…); cột bắt buộc V2 không đo ghi `0`/mặc định (token = **chưa đo**); `modelUsed="multi-agent-v2"`, `traceId`=`supervisorTraceId` thật. (H3) liên kết: `ChatSession.id` = sessionId V2 dùng = `Conversation.sessionId`, luôn dưới userId đã xác thực; session không phải của mình/đã lưu trữ/không tồn tại → cùng một đáp `SESSION_NOT_FOUND`. (H4) ghi lịch sử idempotent theo (user, key); ghi hỏng → `HISTORY_UNAVAILABLE`, retry cùng key ghi lại đúng 1 lần mà không chạy lại V2. (H5) hội thoại đã có lượt V1 ở lại V1; chỉ-V2 tiếp tục V2. (H6) không memory, không SSE.
**Chỉ kiểm chứng bằng fixture (CHƯA có ở production):** mọi store/repository là fake trong test. Chưa có adapter thật cho idempotency (D-P11) hay lịch sử (cần `createSession` nhận `id` — hiện `conversationRepository.createSession` để DB tự sinh id — và ánh xạ `P2002`). Không có kiểm chứng đa instance/đa tiến trình. **`PRODUCTION NOT VERIFIED`.**
**Chưa triển khai:** route wiring, adapter thật, SSE (T4), frontend (M9.3), đo token V2, ghi PARTIAL, memory.
**Điều không đổi:** `rag.service.ts`, `request-identity.ts`, `conversation.repository.ts`, `ai.schemas.ts`, `ai.routes.ts`, `ai.controller.ts`, `session.routes.ts` không bị sửa (test pin bằng `git diff a6b517cd..HEAD`). Idempotency V1 khi bridge tắt giữ nguyên.
**Giới hạn cần biết:** V1 đọc `Conversation` làm ngữ cảnh, nên lượt V2 đã ghi sẽ vào ngữ cảnh V1 nếu hội thoại bị chuyển (affinity hiện chặn việc đó); chưa kiểm chứng `/ai/sessions/:id/messages` hiển thị lượt V2 trong UI (REAL BROWSER: không có).
Blockers: D-P02; P1 an toàn mở **không** chặn M9.2 vì cờ OFF, nhưng chặn bất kỳ phơi bày người dùng (M9.5).

---
## M9.3 — Tích hợp frontend (chỉ DEV/cờ)  `NOT_STARTED`
| ID | Task | File dự kiến | Dependencies | Acceptance | Tests | Status |
|---|---|---|---|---|---|---|
| M9.3-T1 | Công tắc capability trong `coachService`/`pendingAiTasks` (mặc định V1) | `frontend/web/src/app/services/api.ts`, `stores/pendingAiTasks.ts` | M9.2 | UI không đổi khi tắt; bật ⇒ dùng đường V2 | test ánh xạ + test store | NOT_STARTED |
| M9.3-T2 | Trạng thái V2 trong UI hiện có (PARTIAL, MINOR_PROTECTED, SESSION_UNAVAILABLE, thông báo ý định bị hoãn) | `AICoachPage.tsx` (thay đổi tối thiểu) | T1 | hiển thị đúng; không giả metadata | REAL BROWSER (launcher mock trước) | NOT_STARTED |
| M9.3-T3 | Đảm bảo loading/retry/phiên/đăng xuất-đổi tài khoản | như trên | T1 | cache gắn danh tính; retry có kiểm soát | test + REAL BROWSER | NOT_STARTED |
| M9.3-T4 | Hồi quy chat V1 | — | T1 | luồng stream, ảnh, xác nhận hành động không đổi | REAL BROWSER trên dev stack | NOT_STARTED |
Blockers: M9.2; mobile 360–412px chưa kiểm (demo M8-D mới desktop).

---
## M9.4 — Release blocker và kiểm chứng dữ liệu thật (hạ tầng dev, chưa AWS)  `NOT_STARTED`
| ID | Task | Dependencies | Acceptance | Tests | Status |
|---|---|---|---|---|---|
| M9.4-T1 | Đóng P1 "ký tự vô hình là dấu phân cách duy nhất" bằng thay đổi có đo vi sai | quyết định thiết kế (D-P05) | Codex không còn P1 cho phạm vi này | vi sai + suite `llm`/V2 | BLOCKED_ON_DECISION |
| M9.4-T2 | Store hạn chế vị thành niên bền vững, dùng chung nhiều instance | D-004 (đã duyệt chính sách), D-P06 | CAS, TTL không thành quyền bỏ qua, fail-closed | test trên Redis/DynamoDB **local** trước | NOT_STARTED |
| M9.4-T3 | Idempotency/`clientRequestId` cho V2 hoặc cầu nối | M9.2 | retry không chạy lại phần ghi | test | NOT_STARTED |
| M9.4-T4 | Đọc dữ liệu thật qua user/fitness-service (tài khoản test, DB test cô lập) | M9.2 | 4 agent đọc đúng dữ liệu của chính người dùng; không rò rỉ giữa tài khoản | BACKEND INTEGRATION | NOT_STARTED |
| M9.4-T5 | Xác minh độc lập (Codex chỉ đọc) cho phần an toàn/bảo mật | T1–T4 | không P0/P1 có reproducer | Codex | NOT_STARTED |

---
## M9.5 — Sẵn sàng phát hành nội bộ  `NOT_STARTED`
| ID | Task | Acceptance | Status |
|---|---|---|---|
| M9.5-T1 | Gateway: phủ `/ai/v2/ask` bằng limiter chi phí; kiểm route/`x-internal-token` | tương đương `/ai/ask` | NOT_STARTED |
| M9.5-T2 | Kiểm phơi bày AWS API Gateway/Lambda (chỉ đọc) | tài liệu hoá, không đổi hạ tầng | NOT_STARTED |
| M9.5-T3 | Quan sát được (log mã/đếm), runbook rollback, sinh lại candidate identity | runbook được xem xét | NOT_STARTED |
| M9.5-T4 | Cổng phê duyệt của chủ dự án; **không deploy** khi Multi-Agent chưa hoàn tất | D-001 | BLOCKED |

---
## Thứ tự và phụ thuộc
`M9.1 → M9.2 → M9.3` làm được hoàn toàn offline với cờ OFF/fixture. `M9.4` có thể song song một phần với M9.2–M9.3 nhưng **chặn mọi phơi bày người dùng**. `M9.5` cuối cùng. Chỉ một milestone ACTIVE; song song kỹ thuật bên trong cần chủ dự án cho phép.

## Task đầu tiên có thể làm sau M9.1
`M9.2-T3` (nối route + executor thật + adapter thật) — chỉ khi chủ dự án mở rõ ràng; chạm file V1 và cần chốt trước: D-P02 (pin RI-2/HR-27), D-P11 (store idempotency bền vững), D-P13 (schema). Không tự mở.
