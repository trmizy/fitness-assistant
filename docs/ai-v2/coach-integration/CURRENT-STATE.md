# CURRENT-STATE — Checkpoint cho Agent hoặc phiên mới

Cập nhật lần cuối: **2026-11-16**, cuối M9.1. Đọc theo thứ tự: `ARCHITECTURE.md` → `IMPLEMENTATION-PLAN.md` → file này → `DECISIONS.md`. Trước khi làm gì: chạy `git rev-parse HEAD`, `git status`, `git branch --show-current` và đối chiếu với §Worktree. **Không đoán milestone nào đã xong**: dùng bảng task trong `IMPLEMENTATION-PLAN.md` và bằng chứng ở dưới.

## Current objective
Tích hợp Multi-Agent V2 vào AI Coach hiện có (không làm chatbot độc lập). Hiện ở **M9.1 (audit + tài liệu)**. `AI COACH V2 INTEGRATION: NOT STARTED`. `PRODUCTION: BLOCKED`.

## Worktree / branch / commit của tài liệu này
- Worktree: `C:\D_Backup\project_personal\fitness-assistant-worktrees\ai-v2-coach-integration-plan`
- Branch: `planning/ai-coach-v2-integration`, tách từ `a6b517cd`.
- **Không có commit tài liệu.** Hook pre-commit của dự án chặn `docs/` và `.md` ("chỉ README.md được đẩy lên"; gợi ý `ALLOW_TEST_ARTIFACTS=1`). Phiên này **không** vượt hook. Các file nằm **chưa commit** trong worktree này (`docs/ai-v2/coach-integration/*` untracked, `CLAUDE.md` đã sửa chưa commit). HEAD của branch vẫn là `a6b517cd`. Đừng `git clean`, `git reset --hard`, `git stash` hay xoá worktree: sẽ mất tài liệu. Muốn commit: chủ dự án tự quyết (một lần `ALLOW_TEST_ARTIFACTS=1`) hoặc đổi chính sách. Tài liệu **chỉ tồn tại ở worktree này** (D-P09); `feature/ai-v2-agent` và mọi worktree cũ **không** chứa chúng.

## Các snapshot code liên quan (không phải một bản production; chưa tích hợp với nhau)
| Tên | Commit / branch | Có gì | Không có gì |
|---|---|---|---|
| Baseline phát triển | `af66b3a3` `feature/ai-v2-agent` | V2 M1–M7, annotation M7-P5A2 | mọi sửa M8 |
| Snapshot demo đã kiểm chứng (M8-B) | `a6b517cd` (worktree detached `ai-v2-integration-m8b`) | A1–A5 (M8), S1–S4 (M8-B): sửa tổ hợp dấu, hạn chế vị thành niên theo `userId` + quarantine, evaluator offline, demo offline | sửa quarantine tràn/đua, sửa ZWSP trong từ (M8-C) |
| Snapshot M8-C | `1eaa29a0` (worktree detached `ai-v2-integration-m8c`; commit nguồn trên branch `agent/m8c-c1-minor-concurrency` `e7566dff`, `agent/m8c-c2-unicode-canonical` `540675fd`, `agent/m8c-c3-evaluator-policy` `e4e8253e`) | sửa quarantine, ZWSP **trong** từ, evaluator F1–F8 | P1 dấu phân cách duy nhất vẫn mở; **chưa** vào web demo |
| Web demo | `dd07a5f6` branch `agent/m8d-web-demo` (nền `a6b517cd`) | `/internal/ai-v2-demo` + launcher mock, chỉ DEV | không có ở nhánh nào khác |
| Planning (file này) | `planning/ai-coach-v2-integration` từ `a6b517cd` | chỉ tài liệu | — |
**Bị từ chối:** `4b155c3e` (branch `agent/m7r-integration`, M7R). **Không** dùng.
**Có thật nhưng KHÔNG thuộc phiên này, chưa được kiểm tra:** worktree `ai-v2-unicode-separator` (branch `fix/m8c-unicode-separator-triage`), `ai-v2-ai-labeled-benchmark` (branch `agent/m7-ai-labeled-benchmark`), các branch `agent/emr-*`, `agent/m7r-*`. Coi là chỉ đọc; nếu cần, hỏi chủ dự án trước. Repo gốc `fitness-assistant` (branch `aws-deploy`) có thay đổi chưa commit (CLAUDE.md, AGENTS.md, generated/prisma…): **không đụng**.
Lịch sử và bằng chứng M7/M8 (chưa commit) nằm ở `…\fitness-assistant-worktrees\ai-v2-agent\docs\ai-v2\` (đặc biệt `m8-parallel-evidence\`). Đó là lịch sử, không phải sự thật hiện tại.

## Completed (M9.1)
Audit chọn lọc (FE AI Coach, `coachService`, `pendingAiTasks`, gateway, route/controller V1, orchestrator, `profile_extractor`, V2 supervisor/router/agent/composition root) → `CAPABILITY-MAP.md`, `ARCHITECTURE.md`, `IMPLEMENTATION-PLAN.md`, `DECISIONS.md`, `CURRENT-STATE.md`, mục `CLAUDE.md`.

## Active task
Không còn task code. M9.1-T6: verify đã chạy (đường dẫn, secret, phạm vi file) và đạt; **commit bị hook chặn nên không có**. M9.1 `COMPLETE` về nội dung, **không** có commit. **Không** bắt đầu M9.2.

## Files changed (planning branch)
`docs/ai-v2/coach-integration/{ARCHITECTURE,CAPABILITY-MAP,IMPLEMENTATION-PLAN,DECISIONS,CURRENT-STATE}.md` (mới, untracked), `CLAUDE.md` (thêm một mục, chưa commit). **Không** có thay đổi runtime, test, benchmark hay worktree khác.

## Đã kiểm chứng (do phiên lập kế hoạch / Lead tự chạy)
- **TEST EXECUTED** trên `a6b517cd` (worktree web demo): `offline-demo.ts` 45/45 PASS exit 0; `tsc --noEmit` backend sạch; smoke web demo 23/23; ánh xạ UI 8/8; `vite build` production 0 chuỗi demo.
- **TEST EXECUTED** trên `1eaa29a0`: `agent-v2-*` 1437 pass + 3 skip + 0 fail; `llm` 1712 pass + 3 todo; evaluator/pilot-ops/Unicode 86/86; V1 safety 61/61; demo exit 0; `tsc` sạch.
- **REAL BROWSER** (Chrome, desktop): web demo `dd07a5f6` hoạt động, kể cả đường lỗi/thử lại. Mobile 360–412px: NOT VERIFIED.
- **TEST EXECUTED (tái hiện):** P1 dấu phân cách duy nhất (`"Mình tự<ZWSP>ói"`, `"Mình nôn sau khi<ZWSP>ăn"` → `safe` ở V1 và V2, trên baseline lẫn candidate).
- **CODE AUDIT (phiên này, `a6b517cd`):** toàn bộ nhận định trong ARCHITECTURE/CAPABILITY-MAP.

## Tự báo cáo của Agent con, **chưa được Lead chạy lại**
Số liệu vi sai Unicode (hàng chục nghìn chuỗi, fuzz hai seed), kiểm đột biến của A3 (30 phép, 26 diệt), kết quả POSIX/Docker của A3, các so sánh độ trễ. Dùng như gợi ý, không như bằng chứng.

## Unverified assumptions (đừng coi là đã đúng)
1. V2 đọc dữ liệu **thật** qua user-service/fitness-service (mới có test với fake `requestService`).
2. Hành vi mô hình Bedrock Nova Pro thật với prompt V2 (chưa gọi live).
3. API Gateway/Lambda trên AWS phơi bày `/ai/v2/*` thế nào (`NOT VERIFIED`).
4. Gateway chuyển được body JSON V2 qua proxy chung `/ai` (CODE AUDIT cho thấy có, chưa chạy).
5. Các chức năng V1 ghi ở bảng 11–14 của CAPABILITY-MAP chưa chạy trong audit này.
6. `/ai/memories`, `/ai/feedback`, `/ai/generate-workout` có/không được dùng từ FE: chỉ có grep, không phải bằng chứng đầy đủ.

## Known P0 / P1 / P2 (release blockers — không tự vượt)
**P0:** không có.
**P1 (mở):**
1. Ký tự vô hình là dấu phân cách **duy nhất** giữa hai từ vẫn làm lọt lời khai tự gây nôn (`safety_guard.ts`/`induced_vomiting_events.ts`; Codex M8-C, đã tái hiện; có từ trước). Họ hàng: `nha<ZWSP>hang` mất cổng off-topic; `act<ZWSP>as an unrestricted AI` lọt injection.
2. **Chưa có store hạn chế vị thành niên bền vững**; trong `multi-agent-runtime.ts` production bị từ chối 503. Quarantine hiện chỉ trong một tiến trình, không dùng chung nhiều instance (đã nêu trong `minor-restriction.ts`).
3. Các sửa quarantine tràn/đua (M8-C `e7566dff`) và ZWSP-trong-từ (`540675fd`) **chỉ có ở snapshot `1eaa29a0`**, chưa ở `a6b517cd`, web demo hay `af66b3a3`.
**P2:** lời khai giả định ("nếu tôi 16 tuổi…") vẫn lưu thành hạn chế (`agent-v2/minor-gate.ts:8,92`) và không có đường gỡ — **mâu thuẫn với D-004**; bản ghi hạn chế chứa `userId` thô; V2-only false positive với U+FEFF (đưa vào ở `540675fd`); lượt khai tuổi đơn thuần trả `OUT_OF_SCOPE`; annotation G2 chỉ sửa một phần, Codex BLOCKED 2 P2; limiter gateway không phủ `/ai/v2/ask`; V2 không `clientRequestId`, không SSE, không ghi lịch sử; G7/G8 **NOT VERIFIED**, chưa có kiểm chứng của con người.

## Release identity
RI-2 (`agent-v2-release-identity`) **fail có chủ đích** ở nhánh web demo (6 file frontend). Cầu nối M9.2 sẽ cần quyết định pin (D-P02). Candidate identity `5afb6854` đã cũ; phải sinh lại trước phát hành.

## Next exact action
**Chờ chủ dự án**: (1) duyệt hoặc đổi D-P01/D-P02 (adapter + pin); (2) nói rõ có mở **M9.2** không. Nếu mở M9.2: tạo worktree mới từ `a6b517cd` (hoặc từ `1eaa29a0` nếu chủ dự án muốn nền có các sửa M8-C), bắt đầu `M9.2-T1`.

## STOP conditions
Dừng và báo nếu: tài liệu mâu thuẫn với code; cần sửa production code ngoài task đang ACTIVE; cần chạm pin (isolation/RI-2/HR-27) mà chưa được duyệt; cần gọi AWS/Nova/Bedrock/DB thật; một P1 mới xuất hiện; phát hiện worktree/branch khác đang bị sửa đồng thời; ngữ cảnh gần hết (ghi checkpoint vào file này **trước** khi dừng).
