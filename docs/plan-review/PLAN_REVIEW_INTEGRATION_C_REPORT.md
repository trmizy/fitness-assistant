# Plan Review — Integration C: AI Workout Plan → WorkoutProgram → PT Review (2026-11-20)

**Mô hình là STUB, không phải chất lượng LLM thật.** Không có lệnh gọi LLM trả phí nào (63 lệnh gọi stub, ghi ở `integration-c/logs/stub-calls.jsonl`: 29 generate/ok, 22 delta/ok, 6 delta/truncated, 6 delta/timeout). **NO DEPLOY · NO CLOUD MUTATIONS · NO IAM CHANGES · NO COMMIT · NO PUSH · NO MERGE.**
Môi trường: Postgres test container (:55433: `revision_ai_test`, `pr3_fitness_test`, `pr3_user_test`, `pr3_auth_test`), Redis test (:56379), các tiến trình thật chạy bằng `tsx` (gateway 3000, auth 3001, fitness 3002, **ai-service 3003 + BullMQ worker thật**, user 3004) + Vite 5173 + Chromium. Duy nhất `llmService.callLLM` bị thay bằng stub có điều khiển (`integration-c/ai-stub-launcher.ts`). Gateway local chạy `RATE_LIMIT_MAX_REQUESTS=5000` (biến cấu hình có sẵn, chỉ cho lần test; giới hạn `/auth/*` 20/15 phút giữ nguyên, kịch bản dùng lại token). Toàn bộ bằng chứng: `docs/plan-review/integration-c/` (kịch bản, log, ảnh chụp).

## 0. C0 — xác minh bàn giao
- Git: nhánh `aws-deploy`, cây làm việc nhiều luồng chưa commit; không worktree/ownership mới; migration `20261120100000_workout_plan_revisions` đã áp trên `revision_ai_test`; migration plan-review (fitness) và `PLAN_REVIEW_*` (user) đã áp trên DB test. Symbol trong bàn giao (`commitPlanRevision`, `syncProgramContentFromAiPlan`, `REVISION_TARGET`…) có thật.
- Đối chiếu bàn giao ↔ code, **phát hiện 3 điểm lệch cần B/owner biết** (đã sửa tối thiểu, đều cộng thêm, có test):
  1. `schemas/plan.schemas.ts`: bàn giao nói tới 10 bài/buổi nhưng schema nội dung plan lưu chỉ cho `exercisesPerDay ≤ 8` ⇒ đường tạo-lại-cả-plan sẽ từ chối 9–10 bài. Nâng cap nội dung lên 10 (request tạo mới vẫn ≤ 8).
  2. `POST /plans/:id/save-to-workout-log` (controller ai-service) **lọc bỏ** `contentSynced / previousAiPlanVersion / programVersion` ⇒ web không bao giờ thấy cờ mà bàn giao nói "backend đã trả". Truyền thẳng 3 trường (additive).
  3. Xem C12-F11 (replay idempotent) và C13 (poll khi lệch phiên bản) bên dưới.

## 1. C1–C11
`node run-c.mjs main` → exit 0, **23 PASS, 0 FAIL, 1 BLOCKED** (`logs/run-c-main.log`). Trạng thái trước/sau (rút từ log, id rút gọn):

| # | Kết quả | Bằng chứng / bất biến |
|---|---|---|
| C1 | PASS | sinh Plan A 4×4 qua worker thật; plan v1 COMPLETED; 1 lệnh gọi stub |
| C2 | PASS | `save-to-workout-log` → program `0655f684` v1, `sourcePlanId`=A, `aiPlanVersion`=1, 4×4 |
| C3 | PASS | PT Review gửi bản v1 (`PENDING_REVIEW@v1`) |
| C4 | PASS | PT duyệt → `APPROVED_CURRENT` |
| C5 | PASS | `POST /plans/adjust` 4×4→4×8: 202, **cùng planId**, `expectedVersion:1`, `revisionJobId=jobId`; worker thật; **1** lệnh stub delta |
| C6 | PASS | plan **id không đổi**, v1→v2, 4×8, **một** plan row, **một** dòng lịch sử; **program vẫn v1 4×4** (sửa AI ≠ đã áp dụng); duyệt PT vẫn current |
| C7 | PASS | xác nhận áp dụng: **cùng program id** cập nhật tại chỗ, `contentSynced:true`, `programVersion:2`, `aiPlanVersion:2`; 4 bài gốc/buổi giữ nguyên row id; **lịch sử tập md5 y hệt** |
| C8 | PASS | duyệt cũ → `APPROVED_OUTDATED`, `isOutdated:true` |
| C9 | PASS | gửi lại bản hiện tại → request mới `@v2` (cũ giữ lại) |
| C10 | PASS | PT duyệt `@v2` → `APPROVED_CURRENT` |
| C11 | PASS (backend) / **BLOCKED (mobile native)** | hai phiên (header kiểu web và kiểu mobile) đọc **đúng cùng** `programVersion:2`, `planVersion:2`, danh sách review. Web: xem §5. **Mobile native: BLOCKED** — máy không có Android SDK/adb/emulator/thiết bị; jest-expo hỏng sẵn (thiếu plugin babel). Không dùng unit test thay thế E2E. |

Dòng trạng thái đầy đủ (`plan[...] program[...] reviews[...]` sau từng bước) nằm trong log.

## 2. C12 — lỗi & đồng thời
`node run-c.mjs fail` → exit 0, **37 PASS, 0 FAIL** (`logs/run-c-fail.log`).
- **F1 JSON bị cắt**: job FAILED với câu tiếng Việt "Kế hoạch cũ vẫn giữ nguyên"; hash nội dung, v1, 1 plan row, 0 history; đúng 2 lệnh stub (1 retry).
- **F2 timeout worker**: FAILED, plan nguyên vẹn; **yêu cầu mới ngay sau đó được nhận và thành công** (không bị khoá).
- **F3 job bị giao trùng**: hai message cùng operation đã xong được thêm vào queue ⇒ 0 lệnh model thêm, version/lịch sử không đổi; log worker "redelivery … acknowledged".
- **F4 revision đồng thời**: hai POST cùng lúc cùng nhận 202 (xem phát hiện bên dưới); **chỉ một được áp dụng** (v2, 1 history), job thua FAILED lúc commit với lý do tiếng Việt "đã được cập nhật"; stale `expectedVersion` → 409 `VERSION_CONFLICT` kèm gợi ý tải lại.
- **F5 xung đột cập nhật program**: `daysDelta` ("Thêm 1 buổi tập") 4→5 buổi hoạt động (đường tạo lại cả plan, cùng id, v2); lưu vào program → 409 "số buổi", program/duyệt **không đổi**.
- **F6 PT duyệt song song với đồng bộ program** (4 vòng): cả 4 an toàn — duyệt thắng thì request gắn đúng version cũ và **không bao giờ `APPROVED_CURRENT` cho program đã tiến**.
- **F7 đồng bộ liên dịch vụ lỗi**: fitness tắt ⇒ 5xx sạch, plan AI không đổi, program không đổi; sau khôi phục retry đồng bộ đúng một lần (`programVersion 2`), retry lần hai là no-op.
- **F8 thông báo**: user-service tắt ⇒ huỷ vẫn 200, sự kiện nằm pending trong outbox; sau khôi phục job quét giao hết, **số thông báo = số sự kiện**.
- **F9 hợp đồng bị thu hồi giữa review**: PT 403 (đọc & quyết định), request `ACCESS_REVOKED`, học viên không gửi được nữa.
- **F10 token hết hạn**: JWT **thật sự hết hạn** (ký bằng secret của stack, `exp` quá khứ) → 401 trên adjust/plan-review/save, không đổi trạng thái. **Pending action AI chat hết hạn** → `AC11` (409, không gửi gì, thẻ không thực thi, hỏi lại tạo thẻ mới).
- **F11 retry sau timeout gateway**: client huỷ request sau khi gửi rồi retry cùng `Idempotency-Key` ⇒ **một** operation/một revision/v2; plan-review submit tương tự ⇒ một request.
- **F12 A→B→A**: duyệt A; AI sửa B + áp dụng (program v2); `revert` trả nội dung A **vào cùng plan** (v3, version vẫn tăng); đồng bộ lại ⇒ **program v3** (không về v1); hash = hash của A nhưng là request mới `@v3`; **duyệt v1 vẫn `APPROVED_OUTDATED`**.

### Phát hiện thật trong C12 và xử lý
1. **F11 — lỗi ngữ nghĩa (đã sửa)**: retry cùng Idempotency-Key sau khi request đầu *đã thành công* nhận `409 VERSION_CONFLICT` (vì `expectedVersion` được kiểm trước khi xét idempotency). Sửa `queuePlanAdjustment`: retry cùng key được trả từ operation cũ (cùng nội dung → trả lại `revisionJobId`; khác nội dung → `409 IDEMPOTENCY_KEY_CONFLICT`). Có test mới trong `workout-plan-revision.pg.itest.ts`.
2. **F4 — chốt `REVISION_IN_PROGRESS` chỉ là best-effort (chưa sửa, rủi ro cho B)**: check-then-act không phải khoá nên hai request đồng thời vẫn có thể cùng được nhận; **tính đúng đắn do CAS version lúc commit đảm bảo** (một thắng, một FAILED sạch, không mất cập nhật/không nhân đôi) — hậu quả chỉ là có thể tốn thêm một lệnh model. Khoá nguyên tử cần đổi kiến trúc B nên không làm.

## 3. C13 — tương thích ngược
`node run-c.mjs compat market` → exit 0, **24 PASS** (`logs/run-c-compat-market.log`).
- K1 `POST /plans/adjust` không `expectedVersion` vẫn chạy, giữ `planId/jobId/version/status` (+`revisionJobId`, `expectedVersion`, `revision`). K2 poll bằng `jobId` cũ giữ đủ trường, COMPLETED cùng `planId`. K3 chi tiết plan + `/plans/current` bình thường, không có plan placeholder, cờ `_metadata.revision.previousPlanId` có. K4 `WorkoutProgram.sourcePlanId` = id plan AI. K5 job id **trước đây** (tra theo `Plan.jobId`) còn được phục vụ; poll người khác → 403. K6 plan kiểu thay-bằng-row-mới giữ nguyên endpoint revert cũ. K7 `expectedVersion` stale → 409. K8 yêu cầu mơ hồ → 422 câu hỏi tiếng Việt. `daysDelta` (F5) ✓.
- **K9 `AIPlansPage.tsx` — KHÔNG sửa (thuộc luồng khác)**. Yêu cầu tích hợp: sau `save-to-workout-log`, `saveMutation.onSuccess` (≈ dòng 861–885) phải đọc `result.contentSynced` và `result.programVersion`: nếu `alreadyExists && contentSynced` hiện "Đã cập nhật chương trình đang tập lên phiên bản {programVersion}", chỉ giữ "đã được lưu trước đó" khi `contentSynced === false`; kiểu `saveOutcome` thêm `contentSynced?/programVersion?`; `savePlanToWorkoutLog` ở `services/api.ts` nên trả thêm 3 trường. **Hiện trạng đã xác nhận bằng trình duyệt** (U2): chương trình ĐÃ cập nhật v2 nhưng UI vẫn nói "Kế hoạch này đã được lưu vào lịch tập trước đó".
- **Lệch phiên bản API/Worker (local)**:
  - *API cũ → worker MỚI*: message kiểu cũ (target `WORKOUT_PLAN`, không `baseVersion`) chạy đúng đường plan-row cũ và hoàn thành (test `VERSION SKEW (old API → NEW worker)`).
  - *API MỚI → worker CŨ (`git HEAD` thật trong worktree, `logs/skew-old-worker.log`)*: worker cũ thấy plan đã COMPLETED, **không chạy gì** và đánh dấu operation `COMPLETED`; plan giữ nguyên 4×4 v1, không có revision ⇒ trước đây UI sẽ báo "thành công giả". **Đã siết**: `describeRevisionJob` chỉ coi COMPLETED khi có bản ghi revision; operation COMPLETED mà không có revision ⇒ trả FAILED với thông điệp thân thiện (test `NEW API → old worker`). Không có hỏng dữ liệu, nhưng việc điều chỉnh lặng lẽ không được áp dụng ⇒ **vẫn phải phát hành cặp đồng bộ** (§8).

## 4. C14 — an toàn chợ kế hoạch (giữ nguyên quyết định 409)
Cùng lượt chạy compat/market: **PASS** cho cả `SUBMITTED` và `APPROVED`: sửa plan đang đăng ⇒ **409** với thông điệp "…đang được đăng trên chợ nên không thể điều chỉnh tại chỗ…"; plan (hash nội dung, version, 1 plan row — **không nhân bản, không "Plan A.1"**), listing (title/goal/status/source), số operation và số lệnh model, lịch sử revision, program đều **không đổi**; liên kết program↔plan nguồn (adoption) nguyên vẹn; listing `DRAFT` không chặn. Guard tại thời điểm commit được phủ bởi `workout-plan-revision.pg.itest.ts`. Không triển khai xuất bản revision/phiên bản sản phẩm mới.

## 5. Bằng chứng Web (Chromium thật)
`node browser-c.mjs` → exit 0, **14 PASS** (`logs/browser-c.log`, ảnh `logs/shots/`): đăng nhập form thật; **giao diện "Kế hoạch AI" điều chỉnh "Mỗi buổi 8 bài"** → `POST /plans/adjust` 202, toast "Đã điều chỉnh kế hoạch" (poll bằng jobId cũ), danh sách **vẫn một plan** (không "(v2)", không "Thất bại"), nhãn "bản 2/v2", "8 bài", nút "Quay lại bản trước" còn; program **chưa đổi** cho tới khi bấm "Lưu vào lịch tập" (POST save 200 → program v2); trang Tập luyện báo "Đã duyệt bản cũ — cần gửi lại"; gửi lại → request `@v2`; PT thấy snapshot **4 buổi × 8 bài = 32 dòng**, duyệt; client thấy "PT đã duyệt"; **Undo từ UI** → cùng plan id, v3, 4×4, **không** đụng program/duyệt cho tới khi áp dụng lại. Ngoại lệ ghi nhận: bước thiết lập program/hợp đồng PT bằng API (TEST FIXTURE) và khoảng trống K9 ở trên.

## 6. Mobile
**BLOCKED** (C11 native E2E): không có Android SDK/adb/emulator/thiết bị; jest-expo hỏng ở baseline. Chỉ có: unit logic + `tsc` (giai đoạn 3) và so sánh trạng thái backend (C11). Không báo PASS.

## 7. Test, hồi quy, so với HEAD
| Suite | Lệnh | Exit | Kết quả |
|---|---|---|---|
| C1–C11 | `node docs/plan-review/integration-c/run-c.mjs main` | 0 | 23 PASS / 1 BLOCKED |
| C12 | `… run-c.mjs fail` | 0 | 37 PASS |
| C13+C14 | `… run-c.mjs compat market` | 0 | 24 PASS |
| Web Chromium | `… browser-c.mjs` | 0 | 14 PASS |
| ai-service Postgres (lifecycle + worker + retry + skew + legacy) | `node node_modules/tsx/dist/cli.mjs --test src/__tests__/workout-plan-revision.pg.itest.ts src/__tests__/workout-revision-worker.pg.itest.ts` (DB `revision_ai_test`) | 0 | 28 pass (gồm 2 skew + retry replay) |
| AI chat | `tsx --test src/__tests__/fitness-agent-plan-review.test.ts` | 0 | 11/11 (AC11 hết hạn) |
| ai-service hồi quy (suite liên quan) | xem `logs/ai-regression-c.log` | 124* | 456 test: 450 pass; lỗi **trùng tập baseline HEAD** (3 persona thiết bị, GOLDEN, bundle-recovery, PG "FAILED+same payload" hết 60s) ⇒ **0 lỗi mới** |
| fitness-service | không đổi mã trong lượt này; lần chạy gần nhất 1095 test / 1070 pass / 21 lỗi = baseline HEAD | — | 0 lỗi mới |
\* `timeout` cắt khi một tiến trình treo sẵn (cùng hành vi ở HEAD); tóm tắt in trước khi cắt. User-service và gateway **không đổi mã** nên không chạy lại bộ test của chúng; chúng được dùng thật trong các kịch bản trên.

## 8. Yêu cầu phát hành phối hợp (API + Worker)
1. Migration additive `20261120100000_workout_plan_revisions` (ai-service) trước; `PLAN_REVIEW_*` + `dedupe_key` (user-service) và `plan_review_*` (fitness-service) cùng đợt.
2. **API ai-service và worker phải lên cùng lúc**, kèm fitness-service (đường sync) — API mới + worker cũ ⇒ điều chỉnh bị bỏ qua (nay hiện FAILED thay vì thành công giả); worker mới + message cũ ⇒ chạy đường legacy (an toàn).
3. Drain/để hết queue trước khi chuyển; không rollback code mà không để ý các operation `WORKOUT_PLAN_REVISION` còn dở.
4. Cần: route `/plan-reviews` trên API Gateway AWS, job quét outbox thông báo trên Lambda/EventBridge, route/IAM cho ai-service→fitness — **tất cả chưa làm (cấm trong lượt này)**. Quy tắc owner: không deploy cho tới khi Multi-Agent hoàn tất.

## 9. File đã sửa trong Integration C
- `backend/services/ai-service/src/schemas/plan.schemas.ts` (cap nội dung 10).
- `…/controllers/plan.controller.ts` (truyền `contentSynced/previousAiPlanVersion/programVersion`).
- `…/services/generation-operations.ts` (`findRevisionOperationByKey`; COMPLETED cần có revision).
- `…/services/conversation.service.ts` (replay idempotent trước kiểm tra version).
- Test: `__tests__/workout-plan-revision.pg.itest.ts` (+replay), `__tests__/workout-revision-worker.pg.itest.ts` (+2 skew), `__tests__/fitness-agent-plan-review.test.ts` (+AC11).
- Mới: `docs/plan-review/integration-c/` (`stack.sh`, `ai-stub-launcher.ts`, `run-c.mjs`, `browser-c.mjs`, `skew-*.ts`, `logs/`, ảnh), báo cáo này.
Không đụng: `AIPlansPage.tsx`, `services/api.ts` (web), mobile, hạ tầng/AWS.

## 10. Ownership chưa giải quyết
- `AIPlansPage.tsx`/web `api.ts`: luồng khác đang sửa dở (git status) — cần họ làm theo yêu cầu K9.
- Ba điểm tôi sửa trong code thuộc phạm vi B (schema cap, passthrough, replay) cần **B xác nhận**; chốt `REVISION_IN_PROGRESS` best-effort cần quyết định của B/owner (khoá nguyên tử = đổi kiến trúc).
- Cây làm việc chứa thay đổi chưa commit của nhiều luồng (AWS infra, ingest-lambda, RAG warm-up, tài liệu…) — không thuộc phạm vi này, không đụng.

## 11. Kết luận
- **READY / NOT READY FOR COMMIT**: **NOT READY** cho toàn bộ tính năng — thiếu mobile native E2E (BLOCKED), `AIPlansPage` còn hiển thị sai ngữ nghĩa, và cây làm việc trộn nhiều luồng. Các lát backend ai-service/fitness-service/user-service + web panel Plan Review **sẵn sàng để owner review diff** (test/E2E đều pass, 0 lỗi mới so với HEAD).
- **READY / NOT READY FOR RELEASE**: **NOT READY** — chất lượng model thật chưa kiểm (stub), phát hành phải đồng bộ API+worker+migration, thiếu route/job AWS, và đang giữ deploy theo quy tắc owner.
- Xác nhận: **model stub ≠ chất lượng LLM thật; không có lệnh gọi LLM trả phí; NO DEPLOY, NO CLOUD MUTATION, NO IAM CHANGE, NO COMMIT, NO PUSH, NO MERGE.**
