# Plan Review — P0 Commit Gate Closure Report — 2026-11-20

Giữ nguyên ràng buộc: không deploy, không đổi cloud/IAM, không gọi LLM trả phí (model = stub), không commit/push/merge, không reset/stash, chỉ Postgres/Redis test cục bộ (`*_test`).
Nhãn bằng chứng: `REAL BROWSER` · `REAL HTTP/API` · `BACKEND INTEGRATION` · `TEST FIXTURE` · `CODE AUDIT`.

**Kết luận:** **NOT READY FOR COMMIT** — còn 2 điều kiện chặn (§10). **NOT READY FOR RELEASE** (§11). Dừng tại cổng phê duyệt.
B1, C1, C3/C4, A1 đã triển khai và kiểm thử; **K9 vẫn chưa tích hợp** vì không có owner xác nhận.

---

## 1. Ownership và bàn giao

| Hạng mục | Chủ | Trạng thái |
|---|---|---|
| `AIPlansPage.tsx`, `services/api.ts` (web) | luồng khác, `M` từ 17–18/11 (mtime 17/11 16:34, 18/11 23:38), không worktree/báo cáo nhận; 3 phiên khác đang rảnh, không rõ phiên nào là owner | **Chưa bàn giao ⇒ không sửa.** Bàn giao theo file: `aiplanspage-sync/K9_FILE_HANDOFF.md`; patch: `aiplanspage-sync/aiplanspage-sync.patch` (đã xuất lại, kèm Idempotency-Key; `git apply --check` sạch). |
| B1 (fitness-service: `workout.service.ts`, `workout.controller.ts`), C1/C3/C4/A1 (ai-service) | phần việc của lượt B/C đã giao cho phiên này | Triển khai trong phạm vi sở hữu; các file trộn hunk của luồng khác (`plan.controller.ts`, `conversation.repository.ts`, `conversation.service.ts`, `plan.routes.ts`) chỉ thêm, không hoàn nguyên |
| Mobile `frontend/mobile/src/services/api.ts`, `app/client/plans/wizard.tsx` | sạch trong git (không có thay đổi dang dở của ai) | Sửa nhỏ để gửi Idempotency-Key (C4); xem §6 |
| Reviewer độc lập | subagent mới (cùng họ model, **không phải Codex/người**), 2 vòng | §7 |

**Tiến trình (Task 8):** kiểm tra read-only: PID 35628 (fitness :3002) và 28004 (user :3004) xuất hiện trong chính log pino `integration-c/logs/fitness.log`/`user.log`, do `run-c.mjs` của tôi khởi động lại lúc 16:49 (nhóm `fail` tự dừng/khởi động lại theo cổng); hai Vite (:5173, :5174) do `sh.exe` tạo cùng giây với stack của tôi và ghi vào `web.log`/`web-patched.log`. Lệnh dừng trước đó bị hệ thống chặn nên **tôi hỏi bạn**; bạn cho phép dừng đúng 4 PID; tôi xác minh lại từng PID còn đúng cổng rồi `Stop-Process -Id` (không theo tên). Stack lượt này (17:48→18:04) cũng được dừng theo PID đã ghi, đối chiếu log pino (gateway 30212, auth 27612, fitness 26520, ai 35632, user 31336, Vite 33052/30472). Không động tới tiến trình của phiên khác.

## 2. K9 — **KHÔNG ĐÓNG** (chờ owner)

Không tích hợp vào source chính. **Không dùng kết quả của bản sao cô lập làm bằng chứng đóng K9.**
- Trên **source thật (chưa patch)**: `browser-c.mjs` `REAL BROWSER` **14/14** (`logs/p0-browser-c.log`) — các luồng AI/Undo/PT hoạt động sau các sửa backend, **K9 vẫn hiện hữu** (UI vẫn báo "đã lưu trước đó").
- Trên **bản sao cô lập** (patch đã áp; chỉ để giảm rủi ro, KHÔNG phải bằng chứng đóng): `vite build` xanh; `browser-sync.mjs` `REAL BROWSER` **41/41** (`logs/p0-browser-sync.log`): 5 trạng thái, thông điệp đúng từng `kind`, 1 program cùng id, Undo v2→v3 cùng planId, lỗi đồng bộ + retry, reload, **viewport 360/375/390/412**, **phản hồi muộn** (không vẽ banner version cũ), **401**, **Idempotency-Key** (mất mạng ⇒ dùng lại key; 409 dứt khoát ⇒ key mới).
- **Owner cần làm:** áp patch, `vite build`, rồi chạy `browser-sync.mjs <web>` và `browser-b1.mjs <web>` trên source thật (hướng dẫn trong handoff). Web không có tsconfig/script typecheck ⇒ chuẩn repo = `vite build`.

## 3. B1 — số buổi/tuần (đã triển khai)

**Audit mapping** `WorkoutPlan → WorkoutProgram → WorkoutProgramDay → Exercises/SetPrescriptions → WorkoutSchedule`: ngày i của plan = `dayNumber` i của chương trình (cùng quy tắc tạo lịch); `WorkoutSchedule.programDayId` là `ON DELETE SET NULL`; `WorkoutExercise.programExerciseId` là tham chiếu thường (không FK).

**Cách làm** (`workout.service.ts`, một `prisma.$transaction`):
1. Khoá dòng chương trình `SELECT … FOR UPDATE`, đọc lại **bản mới** trong transaction; `applyRevision` tính từ bản mới (retry/đua không áp lại).
2. Chặn nếu có buổi **IN_PROGRESS** (hôm nay/hôm qua) thuộc chương trình — `409 PROGRAM_SYNC_SESSION_IN_PROGRESS` (trước mọi thao tác xoá).
3. Thêm ngày mới (append) / bỏ ngày cuối (cascade bài tập + prescriptions); đối chiếu bài theo `exerciseId` giữ id dòng; giảm số set ⇒ cắt `setPrescriptions` vượt số set.
4. Bỏ ngày còn buổi **tương lai chưa tập** mà người dùng **không** chọn "thay lịch" ⇒ `409 PROGRAM_SYNC_SCHEDULE_CONFLICT` có cấu trúc (`daysFrom/daysTo/futureScheduleCount/removedDays/resolution`), **không ghi gì**; có `replaceExisting` thì xoá buổi chưa tập theo luật hiện có. Buổi đã hoàn tất/nhật ký **không bị xoá** (chỉ tách khỏi ngày bị bỏ).
5. Cập nhật có điều kiện `updateMany where version = bản đọc`; `version +1` đúng một lần, `aiPlanVersion` **chỉ tăng** (`max`), `daysPerWeek` theo plan. Hook test `programSyncTestHooks.afterContentSync` (seam chỉ cho test).
6. ai-service chuyển tiếp `daysChange` và conflict có cấu trúc (`error.code/details`) tới client.

**Test** (`BACKEND INTEGRATION`, DB clone riêng) — `ai-plan-days-sync.integration.test.ts` + `ai-plan-revision-program-sync.integration.test.ts`: **13/13 PASS**.

| Mã | Phủ bởi |
|---|---|
| B1-01 4→5 ngày; B1-10 cùng planId/programId | test "B1-01 + B1-10" |
| B1-02 5→3 ngày; B1-04 lịch sử không đổi (log + buổi hoàn tất còn, chỉ tách ngày) | "B1-02 + B1-04" |
| B1-03 đổi thứ tự ngày; B1-06 PT approval cũ stale | "B1-03" (+ B1-11, B12–B15) |
| B1-05 xung đột lịch tương lai (409 có cấu trúc, không ghi; có replace thì áp) | "B1-05" |
| B1-07 đồng thời (cùng bản ×2 ⇒ version +1 một lần; hai bản khác nhau ⇒ bản mới thắng, dayNumber duy nhất) | "B1-07" |
| B1-08 giao dịch lỗi ⇒ không ghi dở; B1-09 retry không trùng ngày/bài | "B1-08" |
| B1-11 Undo rồi đồng bộ lại (A→B→A không hồi sinh duyệt) | "B1-11" |
| B1-12 UI phản ánh số buổi mới | `browser-b1.mjs` `REAL BROWSER` **8/8** trên **source thật** :5173: 4→5→(Undo)→4 buổi/tuần trên trang Workout, cùng program id, version 2→3 |
| (review) marker không hạ; buổi đang tập chặn; prescriptions | 3 test "review …" |
`REAL HTTP/API` qua gateway (run-c **F5/F5b**, cập nhật theo hành vi mới): 4→5 áp dụng (200, `daysChange`); 5→3 không replace ⇒ 409 `PROGRAM_SYNC_SCHEDULE_CONFLICT` xuyên ai-service+gateway, không ghi; có replace ⇒ 200 — **41/41** nhóm `fail`.

## 4. C1 — admission nguyên tử

- Migration additive `20261120110000_revision_single_active_operation`: partial **unique index** `(target_id) WHERE target_type='WORKOUT_PLAN_REVISION' AND status IN ('ADMITTED','PUBLISHED','RUNNING')`.
- `admitRevision`: va chạm unique tại `markAdmitted` ⇒ xoá reservation của request thua, **409 REVISION_IN_PROGRESS**, không publish ⇒ không có message queue/lệnh model. Operation kẹt > `AI_REVISION_STALE_SECONDS` (900s) bị `settleStranded` rồi thử lại một lần (không settle worker còn sống: chỉ khi lease hết hạn). CAS ở commit không đổi.
- Test `workout-plan-revision.pg.itest.ts` **26/26**: C1-01/02 (5 vòng × 3 request đồng thời khác key ⇒ đúng 1 admission), C1-03 (loser: 0 message, không rò reservation), C1-04 (giao lại cùng message ⇒ 1 job), C1-05 (kẹt ⇒ giải phóng; publish lỗi ⇒ plan sửa lại được sau cửa sổ), C1-06 (plan luôn COMPLETED), CAS còn nguyên. **Kiểm đột biến:** bỏ index thì test C1 lỗi ("got 3"), có index ⇒ 1.
- Rủi ro đã biết: request thua đã qua cổng quota ⇒ tốn 1 đơn vị rate-limit; DB chưa chạy migration ⇒ mất tính nguyên tử (còn pre-check) nhưng không hỏng dữ liệu.

## 5. C3/C4 — idempotency & retry

`adjustmentActionFingerprint` = user + plan + `expectedVersion` + tham số tường minh + nghĩa chuẩn hoá của text (NFC/lowercase/gộp khoảng trắng + kết quả `parseWorkoutAdjustment`), tính **từ request** (không từ nội dung plan lúc retry). `findAdjustmentReplay` chạy trong controller **trước** `resolveExerciseSwap` và `ensureLlmAvailable`.
- Cùng key + cùng hành động ⇒ operation **gốc** với trạng thái thật; **FAILED không tự chạy lại** (không reopen epoch); key mới = hành động mới, **kiểm lại version** (`VERSION_CONFLICT` nếu cũ).
- Khác hành động (text/expectedVersion/exercisesPerDay/daysPerWeek/plan) ⇒ `409 IDEMPOTENCY_KEY_CONFLICT`; key theo actor + plan; op còn `RESERVING` (double-tap) không bị báo conflict giả.
- Test (`workout-plan-revision.pg.itest.ts`): C3 (FAILED), C4 theo từng loại — "Đổi bài X thành Y", "Tăng mỗi buổi lên 7 bài", "Thêm 2 bài mỗi buổi", "Giảm còn 3 bài", "Mỗi buổi 9 bài, bỏ squat" — replay sau thành công + conflict khi đổi; **controller**: swap retry sau thành công **không** bị 422; RESERVING; cô lập user/plan.
- **Client:** mobile (`api.ts`, `wizard.tsx`): gửi `Idempotency-Key` + `expectedVersion`, dùng lại key khi không có phản hồi hoặc 408/502/503/504, đổi key khi phản hồi dứt khoát; nút gửi bị khoá khi đang chạy (có sẵn). Kiểm bằng **`tsc` (chỉ 1 lỗi có sẵn: import CSS)**, **không** phải E2E native. Web: trong patch K9 (Chromium trên bản sao).

## 6. A1 — guard token

`fullRegenerationCheck(tổng bài)` (planner) dùng đúng ước lượng của lời gọi (600 + 140/bài hosted, **không** headroom); worker dùng nó.
- Unit (`workout-revision-planner.test.ts` **20/20**): 25/28/30/31 bài ⇒ 4100/4520/4800/4940 ≤ 5000 (không bị từ chối), 32 ⇒ 5080 (từ chối); giới hạn local/override; chunk 31 bài (4,4,4,4,5,5,5) lên 10/ngày ⇒ nhiều chunk ≤ 5000, phủ đủ 7 ngày, mỗi ngày đúng 10.
- Worker (`workout-revision-worker.pg.itest.ts` **19/19**, stub xác định, `LLM_PROVIDER=bedrock` chỉ để chọn cấu hình): 5×5, 4×7, 5×6 đi đường tạo lại toàn bộ **không bị từ chối**, lưu tại chỗ; 4×8=32 bị từ chối **trước** khi gọi model, plan nguyên vẹn; output cắt cụt ⇒ **không ghi dở**; plan 31 bài chia chunk, ≤10/ngày, đúng schema. **Kiểm đột biến:** khôi phục headroom 1.25 ⇒ 7 test A1 lỗi.

## 7. Review độc lập

Hai vòng (subagent mới, chỉ đọc, DB riêng `review_*`; **không phải review của Codex/người**).

| Mục | Vòng 1 | Vòng 2 (sau sửa) |
|---|---|---|
| B1 | NEEDS_CHANGE: F1 (marker hạ ⇒ ghi đè sửa tay, reproduced), F2 (buổi IN_PROGRESS), F3–F8 | F1, F2 **ACCEPT** (đã chạy lại + thử phá) |
| C1 | **ACCEPT** (chỉ P3; thử đua worker sống: không settle được) | C1-F1/F4 ACCEPT |
| C3/C4 | NEEDS_CHANGE: F1 (RESERVING báo conflict giả, reproduced) | F1 **ACCEPT** (probe thật) |
| A1 | NEEDS_CHANGE: F1 (guard từ chối ≥32 bài hosted mà HEAD vẫn gọi), F2/F3 | **Không sửa** — xem mở |
| D | **ACCEPT** (worker HEAD không làm hỏng plan COMPLETED; khuyến nghị migration → worker → API) | — |
| Client C4 | P3: 5xx gateway là kết quả không xác định | ACCEPT (key giữ với 408/502/503/504) |
Vòng 2 không phát hiện hồi quy P0–P2 mới. Reviewer vòng 2 không chạy lại `run-c` (ngoài quyền): F5 mới được tôi chạy (`REAL HTTP/API`, `logs/p0-run-c-fail.log` 41/41).

**Finding còn mở (đã biết, không sửa):** B1-F3 (buổi quá khứ chưa tập của ngày bị bỏ ⇒ dòng mồ côi khi giữ lịch cũ), B1-F4 (`daysPerWeek` ≠ độ dài `weeklySchedule` được chấp nhận, có từ HEAD), B1-F5 (PATCH sửa tay đọc `existing` trước tx), B1-F6 (sync không cập nhật prescriptions khi reps/rest đổi, không sync `description`; xoá bài làm nhóm superset còn ≤1), B1-F7 (hai import đồng thời của hai program khác nhau ⇒ deadlock 40P01 → 500), B1-F8 (seam test export ở module production); C1-F2 (quota bị trừ cho request bị từ chối khi blocker >15'), C1-F3 (op ADMITTED giữ index tới recovery/900s), C1-F5; C3-F2/F3 (op kiểu HEAD, parser đổi giữa chừng ⇒ conflict giả trong cửa sổ deploy); **A1-F1** (hosted từ chối plan ≥32 bài khi đi đường tạo lại toàn bộ — vd swap trên plan 5–7 buổi/tuần — trong khi HEAD cố gọi và có thể bị cắt; cần **quyết định owner**: đưa swap/exclude sang đường xác định/delta hoặc hiệu chỉnh ngưỡng theo số đo thực ~131 token/bài), A1-F2 (non-hosted 600 vs 430 của HEAD), A1-F3 (hai nguồn giới hạn). Điểm P3 mới: lỗi 503 của chính ai-service (hết ngân sách publish) giữ key ⇒ thêm một lần bấm mới ra key mới; buổi tập bắt đầu đúng lúc commit sync lọt cửa sổ mili-giây.

## 8. Regression và so sánh baseline HEAD

Mọi lượt dùng DB riêng; HEAD dùng kết quả worktree sạch đã chạy lượt trước (`final-ai-fail-HEAD.txt`, `p4-head-c1-fail.txt`; mã HEAD không đổi).

| Phạm vi | Kết quả |
|---|---|
| ai-service `*.test.ts`+`llm/*.test.ts` (cùng lệnh với HEAD) | 2551 test / 2494 pass / 52 lỗi; **0 tên lỗi ngoài tập lỗi HEAD** (HEAD: 2484 / 2421 / 56) |
| ai-service pg-itest | `workout-plan-revision` **26/26**, `workout-revision-worker` **19/19**, `plan-adjust-revision` **4/4**, `generation-operations` **24/24**; `workout-revision-planner` **20/20** |
| fitness-service (`--test-concurrency=1`, DB clone `p5_fitness_test`) | **1106 test / 1080 pass / 22 lỗi; 0 tên lỗi ngoài tập lỗi HEAD** (HEAD cùng lệnh: 1030 / 1004 / 22; +76 test mới). Không có lỗi nào ở B12, B1-*, `plan-review.*`, hay 3 test catalog trong lượt này (`logs/p0-fitness-c1.log`, `p0-fitness-fail.txt`). Lỗi còn lại = baseline (Adaptive Training Cycle, substitute 401, nhóm thực phẩm/persona…). |
| Plan Review (Postgres) + program mutation | nằm trong lượt fitness ở trên (`plan-review.*`, `ai-plan-*`, `training-cycle-active-409`…) |
| user-service notification/outbox (`DB_ISOLATION=accepted`, `pr3_user_test`) | **15/15** (`notification-plan-review-dedupe` + 3 file notification khác) — lần đầu chạy bị SKIP vì thiếu cờ cô lập, đã chạy lại đúng |
| C1–C14 `REAL HTTP/API` qua gateway (stack local, stub) | main **23** (C11 mobile = BLOCKED), fail **41**, compat **12**, market **12** PASS, 0 FAIL (F5/F5b cập nhật theo B1); gồm outbox/notification + `/plan-reviews` qua gateway |
| Chromium Web | `browser-c` (UI owner) **14/14**; `browser-b1` (UI owner, B1-12) **8/8**; `browser-sync` (bản sao cô lập) **41/41** |
| Mobile | `tsc` các file đã sửa sạch (1 lỗi CSS có sẵn). **Native E2E: BLOCKED** |

**3 test catalog chưa rõ nguyên nhân — GIỮ NGUYÊN "UNRESOLVED":** `every exercise has a movementPattern`, `cross-validate isExerciseAvailable`, `every ACTIVE equipment has a mapped exercise`. Chúng lỗi trên DB dùng chung đã tích luỹ dữ liệu khi chạy song song, **không tái hiện** trên DB clone sạch và đều PASS ở `--test-concurrency=1`; giả thuyết nhiễm dữ liệu chéo **chưa được chứng minh**. Không sửa test để làm xanh.

## 9. Chưa đóng

1. **K9** (chờ owner). 2. **Review độc lập chưa phải Codex/người** — cùng họ model. 3. A1-F1 (cần quyết định). 4. Các finding P3 ở §7. 5. 3 test catalog UNRESOLVED. 6. Native mobile E2E, LLM thật, AWS (dưới đây). 7. `REVISION_IN_PROGRESS` quota (C1-F2).

## 10. READY / NOT READY FOR COMMIT — **NOT READY**
Chặn: (a) **K9 chưa được owner tích hợp và kiểm trên source thật**; (b) **A1-F1 cần quyết định** (hồi quy tiềm tàng so với HEAD với swap/exclude trên plan ≥32 bài trên provider hosted) — hoặc chấp nhận như hạn chế ghi rõ.
Điều kiện còn lại như báo cáo cổng trước: tách file trộn hunk với luồng khác; xử lý `logs1.json`/`logs2.json`/`cors-before.json` ở gốc repo; quyết định về generated prisma client; không gộp thay đổi của luồng khác (`infra/`, `scripts/`, `data/eval`, `test/*`, `ingest-lambda.ts`…). Nếu owner chấp nhận (a)(b) thì backend A+B+B1+C1+C3/C4 có thể commit riêng theo module.

## 11. READY / NOT READY FOR RELEASE — **NOT READY**
Release gate (không phải quyền deploy): **Native Mobile E2E** (BLOCKED: không Android SDK/emulator); **đánh giá Bedrock Nova thật** (chưa làm, cần duyệt chi phí); **AWS Gateway routing** (`/plan-reviews`, chưa kiểm); **Lambda notification sweep** (chưa kiểm); **phát hành phối hợp API/Worker/Migration**; **Multi-Agent chưa hoàn tất** (quy tắc owner: không deploy trước đó).

## 12. Phụ thuộc phát hành

```
Migrations (additive):  ai 20261120100000 → ai 20261120110000 (unique index)
                        fitness 20261119100000 (+ workout_programs.version)   user 20261119110000
   ▼
Worker ai MỚI  (nhận cả message cũ và mới; worker HEAD KHÔNG biết revision ⇒ op COMPLETED không revision, hiển thị FAILED)
   ▼
fitness-service MỚI (B1: sync số buổi, structured 409)  ──►  API ai MỚI (replay/idempotency, admission, daysChange)
   ▼
Gateway (+/plan-reviews)  ──►  Web (patch K9, owner)  /  Mobile (Idempotency-Key)
AWS: route API Gateway /plan-reviews + Lambda notification sweep — cần kiểm, ngoài phạm vi lượt này
```
- Thứ tự khuyến nghị (reviewer D + tôi): **migration → worker → API** (không bao giờ API trước worker; API mới + worker cũ ⇒ mọi adjust FAILED và đã trừ quota). Migration additive nên mã HEAD chạy được trên schema mới.
- Chạy migration index **sau khi kiểm không có 2 operation in-flight trùng plan** (DB dev từng chạy bản nháp).
- Rollback mã không cần rollback index; rollback API khi còn op mới ⇒ HEAD có thể báo COMPLETED khi plan chưa đổi.

## 13. File thay đổi/tạo trong lượt này
- **fitness-service:** `services/workout.service.ts`, `controllers/workout.controller.ts`; test `ai-plan-days-sync.integration.test.ts` (mới), `ai-plan-revision-program-sync.integration.test.ts` (cập nhật).
- **ai-service:** `services/generation-operations.ts`, `services/conversation.service.ts`, `controllers/plan.controller.ts`, `workers/ai.worker.ts`, `services/revision/workout-revision-planner.ts`; migration `20261120110000_revision_single_active_operation`; test `workout-plan-revision.pg.itest.ts`, `workout-revision-worker.pg.itest.ts`, `workout-revision-planner.test.ts`.
- **mobile:** `src/services/api.ts`, `app/client/plans/wizard.tsx`.
- **harness/docs:** `integration-c/{run-c.mjs (F5), browser-sync.mjs, browser-b1.mjs}`, `aiplanspage-sync/{K9_FILE_HANDOFF.md, aiplanspage-sync.patch}`, báo cáo này.
- **Không đụng:** `AIPlansPage.tsx`, `services/api.ts` (web), DEV AutoStop (chỉ đọc).
- DB clone còn trong Postgres test: `p3_review_ai_test`, `p4_*`, `p5_fitness_test`, `review_*_test`.
