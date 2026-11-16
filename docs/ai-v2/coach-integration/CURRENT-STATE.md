# CURRENT-STATE — Checkpoint cho Agent hoặc phiên mới

Cập nhật lần cuối: **2026-11-16**, cuối M9.2-T2. Đọc theo thứ tự: `ARCHITECTURE.md` → `IMPLEMENTATION-PLAN.md` → file này → `DECISIONS.md`. Trước khi làm gì: chạy `git rev-parse HEAD`, `git status`, `git branch --show-current` và đối chiếu với §Worktree. **Không đoán milestone nào đã xong**: dùng bảng task trong `IMPLEMENTATION-PLAN.md` và bằng chứng ở dưới.

## Current objective
Tích hợp Multi-Agent V2 vào AI Coach hiện có (không làm chatbot độc lập), phương án B (D-008). Hiện ở **M9.2: T1 + T2 xong (chỉ fixture)**; T3 chưa mở. `AI COACH V2 INTEGRATION: NOT STARTED` cho người dùng (không có gì được bật hay gắn route). `PRODUCTION: BLOCKED`. `IDEMPOTENCY: FIXTURE ONLY`, `HISTORY: FIXTURE ONLY`, `PRODUCTION NOT VERIFIED`.

## Worktree / branch / commit của tài liệu này
- Worktree: `C:\D_Backup\project_personal\fitness-assistant-worktrees\ai-v2-coach-integration-plan`, branch `planning/ai-coach-v2-integration`, tách từ `a6b517cd`. Chưa push/merge (D-001).
- `37f3d99a` docs M9.1 + `CLAUDE.md` + ngoại lệ hẹp cho hook (D-010; không dùng `ALLOW_TEST_ARTIFACTS=1`).
- `76ae18e1` M9.2-T1: bridge core. `d1174a23` checkpoint T1.
- `abdf2dd5` M9.2-T2: `coach-v2-continuity.ts` + chỉnh bridge + test.
- Commit kế tiếp (checkpoint T2 — chứa chính file này): xem `git log -1`.
- Bản sao lưu M9.1 + SHA-256 (ngoài worktree): `C:\D_Backup\project_personal\fitness-assistant-backups\m9-architecture-docs-20261116\`.
- Tài liệu chỉ tồn tại trên branch này. Đừng `git clean`/`reset --hard`/`stash`/xoá worktree.

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

## Completed (M9.1, M9.2-T1)
- M9.1 (`37f3d99a`). M9.2-T0 một phần: adapter B (D-008); D-P02 chưa duyệt (D-011: hoãn).
- M9.2-T1 (`76ae18e1`): lõi bridge. M9.2-T2 (`abdf2dd5`): idempotency + lịch sử, ports + fake, xem IMPLEMENTATION-PLAN "Kết quả T2".

## Active task
Không còn task code đang mở. **M9.2-T3 chưa mở** (cần chủ dự án mở rõ ràng; trước đó cần D-P02, D-P11, D-P13). Không bắt đầu M9.3.

## Files changed (planning branch)
- `abdf2dd5`: `backend/services/ai-service/src/services/coach-v2-continuity.ts` (mới), `…/services/coach-v2-bridge.ts` (V2 cần `clientRequestId` hợp lệ; tách `dispatchV2`), `…/__tests__/coach-v2-continuity.test.ts` (mới), `…/__tests__/coach-v2-bridge.test.ts` (cập nhật theo quy tắc key).
- Checkpoint: ARCHITECTURE, IMPLEMENTATION-PLAN, DECISIONS, CURRENT-STATE.
Không sửa route, controller, frontend, Router, Supervisor, Safety Guard, Minor Gate, benchmark, pin, `rag.service.ts`, `request-identity.ts`, repository, schema.

## Đã kiểm chứng (do phiên lập kế hoạch / Lead tự chạy)
- **TEST EXECUTED** trên `a6b517cd` (worktree web demo): `offline-demo.ts` 45/45 PASS exit 0; `tsc --noEmit` backend sạch; smoke web demo 23/23; ánh xạ UI 8/8; `vite build` production 0 chuỗi demo.
- **TEST EXECUTED** trên `1eaa29a0`: `agent-v2-*` 1437 pass + 3 skip + 0 fail; `llm` 1712 pass + 3 todo; evaluator/pilot-ops/Unicode 86/86; V1 safety 61/61; demo exit 0; `tsc` sạch.
- **REAL BROWSER** (Chrome, desktop): web demo `dd07a5f6` hoạt động, kể cả đường lỗi/thử lại. Mobile 360–412px: NOT VERIFIED.
- **TEST EXECUTED (tái hiện):** P1 dấu phân cách duy nhất (`"Mình tự<ZWSP>ói"`, `"Mình nôn sau khi<ZWSP>ăn"` → `safe` ở V1 và V2, trên baseline lẫn candidate).
- **CODE AUDIT (phiên này, `a6b517cd`):** toàn bộ nhận định trong ARCHITECTURE/CAPABILITY-MAP.
- **TEST FIXTURE (M9.2-T2, `abdf2dd5`, fake store/history/executor; không network/DB/Redis/model):** `coach-v2-continuity.test.ts` 19/19 + `coach-v2-bridge.test.ts` 13/13 pass; `tsc --noEmit` (ai-service) sạch; kiểm đột biến thủ công 4/4 bị bắt; focused regression 142 test: 140 pass, **2 fail = RI-2 và HR-27 (PIN UPDATE REQUIRED)**. Suite đã chạy: bridge, continuity, agent-v2-isolation, agent-v2-release-identity, agent-v2-hybrid-router, agent-v2-safety-precedence-http, ai-endpoint-policy, safety-minor-weight-goal, safety-input-limits; `node --test scripts/git/check-staged-test-artifacts.test.mjs` 3/3. **Không** phải toàn bộ regression repo.
- **TEST FIXTURE (M9.2-T1, `76ae18e1`, fake executor, không network/DB/Redis/model):** `coach-v2-bridge.test.ts` 13/13 pass; `tsc --noEmit` (ai-service) sạch; focused regression 123 test: 122 pass, **1 fail = RI-2 (PIN UPDATE REQUIRED)**. Suite đã chạy: coach-v2-bridge, agent-v2-isolation, agent-v2-release-identity, agent-v2-hybrid-router, agent-v2-safety-precedence-http, ai-endpoint-policy, safety-minor-weight-goal, safety-input-limits. **Không** phải toàn bộ regression repo. Hook: `node --test scripts/git/check-staged-test-artifacts.test.mjs` 3/3.
- **Đính chính so với báo cáo T1:** báo cáo đó ghi HR-27 xanh. Lúc chạy file bridge chưa commit nên `git diff` không thấy; sau khi commit HR-27 fail. Đúng là cả RI-2 lẫn HR-27 đều PIN UPDATE REQUIRED.
- **Không có bằng chứng** (và không tuyên bố): idempotency/lịch sử với store/DB thật hoặc nhiều instance; hành vi `/ai/ask` thật khi flag bật (bridge chưa được gắn), REAL BROWSER, dữ liệu thật.

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
**PIN UPDATE REQUIRED (không cập nhật — D-011).** `RI-2` (`agent-v2-release-identity`) và `HR-27` (`agent-v2-hybrid-router`) fail có chủ đích vì thấy file V1-side mới: `services/coach-v2-bridge.ts`, `services/coach-v2-continuity.ts` (cả hai pin), và RI-2 còn thấy `CLAUDE.md`, `scripts/git/check-staged-test-artifacts*.mjs`. Tại `a6b517cd` cả hai xanh. Pin **không bị sửa**. Không tuyên bố release-ready. Pin cô lập (`agent-v2-isolation`) xanh vì cả hai file không import `agent-v2`. Candidate identity `5afb6854` đã cũ; phải sinh lại trước phát hành.

## Next exact action
Chờ chủ dự án: (1) có mở **M9.2-T3** không; nếu mở, trước tiên chốt D-P02 (cập nhật RI-2/HR-27 hay đặt bridge trong file đã được phép), D-P11 (store idempotency bền vững: DynamoDB/Redis/Postgres) và D-P13 (migration schema: engine/engine_turn_id/token nullable/completion_status); (2) D-P12 (lưu PARTIAL?). Lưu ý: adapter lịch sử thật cần `createSession` nhận `id` (V1 repository hiện để DB tự sinh) và dịch lỗi unique `P2002`; adapter thật phải được kiểm bằng DB test cô lập, không DB dev/prod.

## STOP conditions
Dừng và báo nếu: tài liệu mâu thuẫn với code; cần sửa production code ngoài task đang ACTIVE; cần chạm pin (isolation/RI-2/HR-27) mà chưa được duyệt; cần gọi AWS/Nova/Bedrock/DB thật; một P1 mới xuất hiện; phát hiện worktree/branch khác đang bị sửa đồng thời; ngữ cảnh gần hết (ghi checkpoint vào file này **trước** khi dừng).
