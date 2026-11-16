# CURRENT-STATE — Checkpoint cho Agent hoặc phiên mới

Cập nhật lần cuối: **2026-11-16**, cuối M9.3-T1. Đọc theo thứ tự: `ARCHITECTURE.md` → `IMPLEMENTATION-PLAN.md` → file này → `DECISIONS.md`. Trước khi làm gì: chạy `git rev-parse HEAD`, `git status`, `git branch --show-current` và đối chiếu với §Worktree. **Không đoán milestone nào đã xong**: dùng bảng task trong `IMPLEMENTATION-PLAN.md` và bằng chứng ở dưới.

## Current objective
Tích hợp Multi-Agent V2 vào AI Coach hiện có (không chatbot độc lập), phương án B (D-008). Hiện: **M9.2 T1–T3 xong (offline)** và **M9.3-T1 xong (DEV-only, mock)**: trang AI Coach hiện có hiển thị lượt V2 và 409, có công tắc DEV mặc định TẮT; đã chạy trong Chrome với launcher loopback (bridge + runtime V2 thật, model/dữ liệu/auth/store giả). `AI COACH V2 INTEGRATION: NOT STARTED` cho người dùng thật (không gì bật; production không có store/history → luôn V1). `PRODUCTION: BLOCKED`. M9.3-T2 / M9.4 chưa mở.

## Worktree / branch / commit của tài liệu này
- Worktree: `C:\D_Backup\project_personal\fitness-assistant-worktrees\ai-v2-coach-integration-plan`, branch `planning/ai-coach-v2-integration`, tách từ `a6b517cd`. Chưa push/merge/tag (D-001).
- `37f3d99a` docs M9.1 + hook (D-010). `76ae18e1` T1. `abdf2dd5` T2. `687d2653` T3. Checkpoints: `d1174a23`, `b2b0f837`, `3751e375`.
- `3d75d17e` launcher DEV (`__tests__/m9-coach-harness/*`). `fe4c9e95` frontend M9.3-T1.
- Commit kế tiếp (checkpoint M9.3-T1 — chứa chính file này): xem `git log -1`.
- Sao lưu M9.1 + SHA-256 (ngoài worktree): `C:\D_Backup\project_personal\fitness-assistant-backups\m9-architecture-docs-20261116\`.
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

## Completed (M9.1, M9.2-T1..T3, M9.3-T1)
- M9.1; M9.2-T1..T3 (xem IMPLEMENTATION-PLAN); **M9.3-T1 (`3d75d17e`, `fe4c9e95`)** — chi tiết "Kết quả M9.3-T1".

## Active task
Không còn task code đang mở. **M9.3-T2 và M9.4 chưa mở** (cần chủ dự án mở rõ ràng).

## Files changed (planning branch)
- `3d75d17e`: `backend/services/ai-service/src/__tests__/m9-coach-harness/{coach-dev-server.ts,coach-dev-harness.test.ts}` (chỉ test/harness, không import bởi production).
- `fe4c9e95` (frontend/web): `src/app/services/coachV2Response.ts` (+`.test.ts`), `src/app/dev/coachV2Dev.ts`, `src/app/components/coach/CoachV2Badge.tsx`, `src/app/components/dev/AiCoachV2DevPanel.tsx`, sửa `src/app/services/api.ts` (`CoachRequestError`), `src/app/stores/pendingAiTasks.ts`, `src/app/pages/client/AICoachPage.tsx`.
- Checkpoint: ARCHITECTURE, IMPLEMENTATION-PLAN, DECISIONS, CURRENT-STATE.
Không sửa: backend production code (route/controller/bridge), Router, Supervisor, Safety Guard, Minor Gate, benchmark, pin, schema, gateway, luồng ảnh/InBody/macro/memory/workflow ghi.

## Đã kiểm chứng (do phiên lập kế hoạch / Lead tự chạy)
- **TEST EXECUTED** trên `a6b517cd` (worktree web demo): `offline-demo.ts` 45/45 PASS exit 0; `tsc --noEmit` backend sạch; smoke web demo 23/23; ánh xạ UI 8/8; `vite build` production 0 chuỗi demo.
- **TEST EXECUTED** trên `1eaa29a0`: `agent-v2-*` 1437 pass + 3 skip + 0 fail; `llm` 1712 pass + 3 todo; evaluator/pilot-ops/Unicode 86/86; V1 safety 61/61; demo exit 0; `tsc` sạch.
- **REAL BROWSER** (Chrome, desktop): web demo `dd07a5f6` hoạt động, kể cả đường lỗi/thử lại. Mobile 360–412px: NOT VERIFIED.
- **TEST EXECUTED (tái hiện):** P1 dấu phân cách duy nhất (`"Mình tự<ZWSP>ói"`, `"Mình nôn sau khi<ZWSP>ăn"` → `safe` ở V1 và V2, trên baseline lẫn candidate).
- **CODE AUDIT (phiên này, `a6b517cd`):** toàn bộ nhận định trong ARCHITECTURE/CAPABILITY-MAP.
- **REAL BROWSER (M9.3-T1, Chrome desktop 1528×730, `127.0.0.1`, launcher mock):** xem IMPLEMENTATION-PLAN "Kết quả M9.3-T1" (V1 mặc định, V2 ANSWERED/PARTIAL/SAFETY_BLOCKED, 409 thật, replay, 404 phiên, launcher dừng không tự chuyển V1). **Không** phải môi trường thật; mobile NOT VERIFIED.
- **CONTROLLER INTEGRATION / TEST FIXTURE (M9.3-T1):** launcher `coach-dev-harness.test.ts` 9/9; adapter frontend `coachV2Response.test.ts` 6/6. Focused cuối: **167 test, 165 pass, 2 fail = RI-2 và HR-27**; `tsc --noEmit` backend sạch; kiểm kiểu frontend bằng tsconfig tạm: 16 lỗi sẵn có, 0 lỗi ở code mới/sửa. Production bundle: quét 295 file, không có dấu vết panel/fixture (ghi chú env object ở IMPLEMENTATION-PLAN).
- **CONTROLLER INTEGRATION / TEST FIXTURE (M9.2-T3, `687d2653`):** `coach-v2-route-http.test.ts` 17/17 (supertest in-process, loopback, trên `app` thật: requireAuth + limiter + validate + bridge + continuity + executor + Supervisor/Router/Agents/registries/profile reader thật; giả: token verify, transport axios, model, dữ liệu domain, idempotency store, history repo, controller V1 chỉ để đếm); bridge 13/13; continuity 19/19; `tsc --noEmit` sạch; isolation xanh; ai-endpoint-policy và agent-v2 http-integration / safety-precedence-http xanh. Focused regression cuối (bridge, continuity, HTTP T3, agent-v2-isolation, release-identity, hybrid-router, agent-v2-http-integration, safety-precedence-http, ai-endpoint-policy): **152 test, 150 pass, 2 fail = RI-2 và HR-27**. Đây **không** phải REAL HTTP/BROWSER và không phải toàn bộ regression repo.
- **TEST FIXTURE (M9.2-T2, `abdf2dd5`, fake store/history/executor; không network/DB/Redis/model):** `coach-v2-continuity.test.ts` 19/19 + `coach-v2-bridge.test.ts` 13/13 pass; `tsc --noEmit` (ai-service) sạch; kiểm đột biến thủ công 4/4 bị bắt; focused regression 142 test: 140 pass, **2 fail = RI-2 và HR-27 (PIN UPDATE REQUIRED)**. Suite đã chạy: bridge, continuity, agent-v2-isolation, agent-v2-release-identity, agent-v2-hybrid-router, agent-v2-safety-precedence-http, ai-endpoint-policy, safety-minor-weight-goal, safety-input-limits; `node --test scripts/git/check-staged-test-artifacts.test.mjs` 3/3. **Không** phải toàn bộ regression repo.
- **TEST FIXTURE (M9.2-T1, `76ae18e1`, fake executor, không network/DB/Redis/model):** `coach-v2-bridge.test.ts` 13/13 pass; `tsc --noEmit` (ai-service) sạch; focused regression 123 test: 122 pass, **1 fail = RI-2 (PIN UPDATE REQUIRED)**. Suite đã chạy: coach-v2-bridge, agent-v2-isolation, agent-v2-release-identity, agent-v2-hybrid-router, agent-v2-safety-precedence-http, ai-endpoint-policy, safety-minor-weight-goal, safety-input-limits. **Không** phải toàn bộ regression repo. Hook: `node --test scripts/git/check-staged-test-artifacts.test.mjs` 3/3.
- **Lỗi của chính tôi trong T3, đã sửa:** một comment trong `multi-agent-runtime.ts` chứa tên cờ V2 làm pin "nothing outside agent-v2 reads …" fail (chỉ là chuỗi, không đọc cờ); đã sửa lời comment, pin xanh lại.
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
**P2 (mới ở M9.3-T1):** (f) tải lại lịch sử từ server mất badge V2 (D-P18); (g) lượt V2 FAILED do hold dài được replay nguyên trạng, người dùng phải gửi tin mới; (h) V1 thật chưa kiểm cùng trang (launcher dùng stub V1); (i) mobile chưa kiểm; (j) tên/giá trị `VITE_AI_COACH_V2_DEV` có thể nằm trong object env của bundle nếu bị đặt lúc build (không kích hoạt được gì).
**P2 (mới ở T3, chưa duyệt xử lý):** (a) bộ chọn capability là bộ phân loại V1 — thiên về V1 (an toàn) nhưng chưa được chứng minh không bỏ lọt hành động ghi; (b) lỗi tạo runtime → 503 + key `IN_DOUBT` (D-P16); (c) chi phí lượt V2 dùng chung bucket `askRateLimiter` của V1; (d) FE chưa biết 409/`data.v2` (D-P15); (e) production không có store/repository nên V2 không thể phục vụ — đúng chủ ý nhưng là blocker thật cho M9.5.
**P2:** lời khai giả định ("nếu tôi 16 tuổi…") vẫn lưu thành hạn chế (`agent-v2/minor-gate.ts:8,92`) và không có đường gỡ — **mâu thuẫn với D-004**; bản ghi hạn chế chứa `userId` thô; V2-only false positive với U+FEFF (đưa vào ở `540675fd`); lượt khai tuổi đơn thuần trả `OUT_OF_SCOPE`; annotation G2 chỉ sửa một phần, Codex BLOCKED 2 P2; limiter gateway không phủ `/ai/v2/ask`; V2 không `clientRequestId`, không SSE, không ghi lịch sử; G7/G8 **NOT VERIFIED**, chưa có kiểm chứng của con người.

## Release identity
**RI-2 và HR-27 FAIL (không cập nhật — D-011).** Phân loại bằng `git diff` so với M6 RC `b8e595dd`:
- *Vi phạm phạm vi dự kiến:* file V1-side mới/đổi đã nêu ở T1–T3 (`coach-v2-bridge.ts`, `coach-v2-continuity.ts`, `coach-bridge.middleware.ts`, `routes/ai.routes.ts`); ngoài ai-service: `CLAUDE.md`, `scripts/git/check-staged-test-artifacts*.mjs` (D-010) và **mới ở M9.3-T1: 8 file `frontend/web/src/**`** (RI-2 assertion thứ 2 "nothing outside ai-service changed" — hiện bị che vì assertion 1 dừng trước). Harness `__tests__/m9-coach-harness/*` không bị liệt kê.
- *Hồi quy hành vi thật:* **không phát hiện** (bằng chứng ở trên; V1 backend không bị sửa trong M9.3-T1).
- *Chưa kiểm chứng:* assertion 2 và 3 của RI-2 chưa được chạy sau assertion 1. Pin cô lập xanh. Không cập nhật pin, không bỏ assertion. Không release-ready. Candidate identity `5afb6854` đã cũ.

## Next exact action
Chờ chủ dự án: (1) có mở **M9.3-T2** (mobile 360–412, chạy trang với V1 thật, a11y badge) hoặc **M9.4** (P1 an toàn, store minor bền vững, đọc dữ liệu thật) không; (2) D-P02 (pin RI-2/HR-27, giờ gồm cả frontend), D-P11, D-P12, D-P13, D-P14, D-P16, D-P17, D-P18; (3) trước mọi phơi bày người dùng: M9.4, M9.5. Không tự mở.

## STOP conditions
Dừng và báo nếu: tài liệu mâu thuẫn với code; cần sửa production code ngoài task đang ACTIVE; cần chạm pin (isolation/RI-2/HR-27) mà chưa được duyệt; cần gọi AWS/Nova/Bedrock/DB thật; một P1 mới xuất hiện; phát hiện worktree/branch khác đang bị sửa đồng thời; ngữ cảnh gần hết (ghi checkpoint vào file này **trước** khi dừng).
