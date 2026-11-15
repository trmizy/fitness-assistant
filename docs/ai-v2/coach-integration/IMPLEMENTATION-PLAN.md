# IMPLEMENTATION-PLAN — Tích hợp Multi-Agent V2 vào AI Coach (M9.1–M9.5)

Soạn 2026-11-16 (baseline `a6b517cd`). **Mỗi lúc chỉ MỘT milestone ACTIVE.** Milestone kế tiếp chỉ bắt đầu khi chủ dự án nói rõ, và `CURRENT-STATE.md` được cập nhật. Đây là kế hoạch của AI: nó **không** phải quyết định đã được duyệt; các lựa chọn thiết kế nằm ở `DECISIONS.md` với trạng thái `PROPOSED` cho tới khi chủ dự án phê duyệt.

Quy ước trạng thái task: `DONE` · `ACTIVE` · `READY` (đủ điều kiện) · `BLOCKED_ON_DECISION` · `BLOCKED` · `NOT_STARTED`. Không đoán task đã xong: chỉ `DONE` khi có bằng chứng ghi ở cột Tests.

Ràng buộc chung cho mọi milestone: V1 phải còn chạy; không deploy (D-001); không gọi AWS/Nova/Bedrock/DB thật khi chưa có phê duyệt riêng; không sửa benchmark để tăng điểm; không vượt release blocker (CURRENT-STATE §Known); thay đổi phía V1 chạm `agent-v2` cần phê duyệt pin.

---
## M9.1 — Audit, bản đồ chức năng và hạ tầng tiếp nối  `ACTIVE → COMPLETE khi §Verify của CURRENT-STATE đạt`
Phạm vi: chỉ tài liệu + `CLAUDE.md` ở worktree `ai-v2-coach-integration-plan`. Không đụng runtime.
| ID | Task | File | Dependencies | Acceptance | Tests / bằng chứng | Status |
|---|---|---|---|---|---|---|
| M9.1-T1 | Kiểm kê chức năng AI hiện có và đường dữ liệu | `CAPABILITY-MAP.md` | — | Mỗi dòng có file thật và nhãn trạng thái | CODE AUDIT | DONE |
| M9.1-T2 | Kiến trúc mục tiêu, adapter, invariants | `ARCHITECTURE.md` | T1 | Nguồn file/commit cho nhận định chính | CODE AUDIT | DONE |
| M9.1-T3 | Nhật ký quyết định tách APPROVED/PROPOSED | `DECISIONS.md` | T2 | Không có đề xuất AI nào ở APPROVED | rà soát | DONE |
| M9.1-T4 | Kế hoạch và checkpoint | `IMPLEMENTATION-PLAN.md`, `CURRENT-STATE.md` | T1–T3 | Next action chính xác, STOP conditions | rà soát | DONE |
| M9.1-T5 | `CLAUDE.md` bootstrap | `CLAUDE.md` | T4 | Một mục ngắn, không trùng quy tắc cũ | diff | DONE |
| M9.1-T6 | Verify tài liệu (commit local nếu được phép) | — | T1–T5 | Đường dẫn tồn tại; chỉ file tài liệu thay đổi | script kiểm tra: 50 tên file + đường dẫn đều resolve; scan secret sạch | DONE (verify); **commit bị hook chặn, không vượt hook** |
Blockers: hook pre-commit chặn `docs/` và `.md` (chính sách dự án). **Dừng sau M9.1.**

---
## M9.2 — Cầu nối AI Coach ↔ V2 phía server (cờ OFF, chỉ fake)  `NOT_STARTED / BLOCKED_ON_DECISION`
Mục tiêu: một lớp tích hợp mỏng, **không nhân đôi logic**, giữ lịch sử V1 và có đường lui V1. Giả thiết thiết kế **B** (ARCHITECTURE §3) — chỉ làm khi D-P01 được duyệt.
| ID | Task | File dự kiến | Dependencies | Acceptance | Tests | Status |
|---|---|---|---|---|---|---|
| M9.2-T0 | Chủ dự án chọn phương án adapter và duyệt ngoại lệ pin | `DECISIONS.md` | M9.1 | D-P01, D-P02 chuyển APPROVED | — | BLOCKED_ON_DECISION |
| M9.2-T1 | Ánh xạ kết quả V2 → payload AI Coach (`answer`, `sessionId`, `safetyNotes`; không bịa `structuredBlocks`/`evidenceUsed`) | file mới phía ai-service (tên do T0 quyết) | T0 | hàm thuần, mọi `status` V2 có ánh xạ | unit (fixture) | NOT_STARTED |
| M9.2-T2 | Ghi lượt V2 vào lịch sử V1 (`ChatSession`/`Conversation`) | như trên + `repositories/conversation.repository.ts` (dùng, không sửa) | T1 | `/ai/sessions` thấy lượt V2; không ghi khi V2 bị chặn trước routing nếu chính sách V1 yêu cầu | integration với **DB test cô lập** hoặc repository giả | NOT_STARTED |
| M9.2-T3 | Chọn V1/V2 theo cờ + danh sách người dùng; V2 lỗi/404/503 → V1 | như trên + `agent-v2/flag.ts` (đọc) | T1 | cờ OFF ⇒ hành vi V1 **y hệt**; V2 lỗi ⇒ trả lời bằng V1, không đổi danh tính | test hồi quy V1 (`ai-endpoint-policy`, `safety-*`) + test fallback | NOT_STARTED |
| M9.2-T4 | Tương thích SSE: phát `status` → một `token` → `done` từ kết quả JSON, hoặc để FE dùng đường JSON | như trên | T1 | FE hiện có parse được | test parser phía FE (fixture) | NOT_STARTED |
| M9.2-T5 | Cập nhật pin (isolation allowlist, RI-2, HR-27) theo phê duyệt | `agent-v2-isolation.test.ts`, `agent-v2-release-identity.test.ts`, `agent-v2-hybrid-router.test.ts` | T0 | mọi pin xanh sau cập nhật có ghi chú owner | các test pin | BLOCKED_ON_DECISION |
Blockers: D-P01, D-P02; P1 an toàn mở **không** chặn M9.2 vì cờ OFF, nhưng chặn bất kỳ phơi bày người dùng (M9.5).

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
`M9.2-T0` — quyết định của chủ dự án (không phải việc code). Nếu D-P01 chọn B: `M9.2-T1`.
