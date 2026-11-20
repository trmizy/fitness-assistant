# Workstream B — AI Workout Plan: identity, revision, constraints, token budget (HANDOFF)

Ngày 2026-11-20 · Người nhận ownership: Workstream B (theo yêu cầu của owner) · **NO DEPLOY · NO AWS MUTATIONS · NO IAM CHANGES · NO COMMIT · NO PUSH · NO MERGE**.
Bằng chứng gốc: `docs/plan-review/evidence-b-2026-11-20/`. Môi trường: Postgres test container local (`revision_ai_test`, `pr3_fitness_test`, `gymcoach_planreview_test`), **không dùng Aurora/cloud, không gọi LLM trả phí** (model là stub).

## 0. Ownership & audit (B0)
- `plan.controller.ts`, `conversation.repository.ts`, `workout-adjustment-constraints.ts` (+ `plan.routes.ts`, `conversation.service.ts`) có thay đổi **chưa commit từ 17/11** của một luồng khác (giữ tên plan bỏ "(v2)", endpoint `POST /plans/:id/revert`, `daysDelta`, ẩn bản nháp lỗi, test `plan-adjust-revision.pg.itest.ts`). Không worktree/báo cáo nào nhận chúng; owner giao Workstream B cho mình ⇒ mình **chỉ thêm, không ghi đè/hoàn nguyên**; test của luồng kia vẫn pass (4/4).
- Mô hình của luồng kia = "tạo plan MỚI, archive plan cũ, chỉ hiện 1 plan". Nó **vẫn đổi `WorkoutPlan.id`** mỗi lần sửa ⇒ chưa đạt yêu cầu B1. Mô hình đó nay chỉ còn dành cho dữ liệu cũ (legacy), không còn được tạo mới.

## 1. Root cause (có file:line trên bản trước khi sửa)
1. Mỗi lần điều chỉnh tạo `WorkoutPlan` mới: `controllers/plan.controller.ts` `adjustPlan` → `services/conversation.service.ts` `queuePlanAdjustment` → `submitGeneration` → `generation-operations.ts` `ensurePlanRow` (`createAdjustedPlan`, ~418) và `markAdmitted` với `randomUUID()` làm `targetId` (~538). Plan mới đóng vai placeholder QUEUED/PROCESSING/FAILED của job.
2. Số bài bị giữ ở giá trị cũ: `conversation.service.ts` lấy `parsedText.exercisesPerDay ?? originalPlanContent.exercisesPerDay ?? 4` nhưng parser **không hiểu "lên 7 bài"**; rồi `ai.worker.ts` `repairExerciseCountAndDayGoals` **cắt/độn** nội dung về `exercisesPerDay` cũ ⇒ 7 bị hạ về 4.
3. Ngân sách token (`ai.worker.ts` `estimatePlanNumPredict`) tính từ số bài cũ (16 thay vì 28) và bị kẹp cứng ở 5000, không báo khi vượt ⇒ cắt cụt JSON → thông báo lỗi chung.
4. `ADJUSTMENT_FAILED_MESSAGE_VI`/fail không phân biệt được lý do; plan "FAILED" ở dòng riêng.
5. Hệ quả mới khi đổi sang id ổn định (đã xử lý, mục 6): import `from-ai-plan` bỏ qua nội dung khi `sourcePlanId` đã có; marketplace đọc nội dung plan trực tiếp.

## 2. File thay đổi theo nhóm
**ai-service (code)**: `prisma/schema.prisma` (+model `WorkoutPlanRevision`), `prisma/migrations/20261120100000_workout_plan_revisions/`, `src/generated/prisma/*` (tái sinh), `repositories/conversation.repository.ts` (`commitPlanRevision`, `findRevisionByOperation`, `listPlanRevisions`, `revertPlanRevisionInPlace`, `countActiveListings`; legacy revert thêm chốt `previousId===planId`), `services/generation-operations.ts` (đích `WORKOUT_PLAN_REVISION`, `describeRevisionJob`, `findActiveRevisionOperation`, settle/repair/planStatusOf cho revision), `services/generation-lease-context.ts` (`failReason`), `services/conversation.service.ts` (`queuePlanAdjustment`), `controllers/plan.controller.ts` (`expectedVersion`, `resolveOrdinalReplacement`, revert in-place), `schemas/plan.schemas.ts`, `errors/api-error.ts`, `workers/ai.worker.ts` (sink revision, kiểm tra version sớm, nhánh delta, chốt ngân sách), `services/revision/workout-adjustment-constraints.ts` (parser + `resolveExercisesPerDay`), **mới** `services/revision/workout-revision-planner.ts`.
**fitness-service**: `services/workout.service.ts` (`mapAiPlanDays` tách dùng chung, `syncProgramContentFromAiPlan`, nhánh program-đã-có của `importAiPlanToSchedule`).
**Test (mới)**: ai-service `workout-revision-planner.test.ts`, `workout-plan-revision.pg.itest.ts`, `workout-revision-worker.pg.itest.ts`; fitness-service `ai-plan-revision-program-sync.integration.test.ts`, `training-cycle-active-409.integration.test.ts` (giai đoạn trước).
Đã làm ở giai đoạn trước và dùng lại: `proposed-change-validator` (parse "tuần 4: 38225 kg" = +17,73%), nhãn buổi tập có dấu + `parseDayFocusMuscleGroups`.

## 3. API contract (tương thích ngược)
`POST /plans/adjust`
```
req : { planId, adjustments, daysPerWeek?, exercisesPerDay? (1..10), expectedVersion? }   // expectedVersion mới, tuỳ chọn
202 : { planId /* LUÔN LÀ planId đã gửi */, jobId, revisionJobId /* = jobId */, version /* = expectedVersion+1 */,
        expectedVersion /* version của plan lúc xếp hàng */, status: "QUEUED", revision: true }
```
Lỗi mới: `409 VERSION_CONFLICT` (expectedVersion lệch, không xếp hàng) · `409 REVISION_IN_PROGRESS` (đang có revision khác của plan; cùng Idempotency-Key thì không tính) · `409` plan đang đăng trên chợ (SUBMITTED/APPROVED) · `422 NEEDS_CLARIFICATION` (mơ hồ: "tăng số bài", "buổi 1 và 3 lên 6 bài", >10 bài; "đổi bài thứ N của buổi X" khớp 0/nhiều buổi) · `422 VALIDATION_ERROR` (ngoài 1..10).
`GET /plans/job/:jobId` (poller hiện có) — giữ `jobId, planId, status(QUEUED|PROCESSING|COMPLETED|FAILED), plan, failReason, createdAt, updatedAt, kind:"WORKOUT_PLAN"`; thêm `revision:true, revisionJobId, version, expectedVersion, resultVersion`. **Status suy ra từ operation, không từ plan row**; COMPLETED trả `plan` = nội dung mới và `version` mới.
`POST /plans/:planId/revert` — hoàn nội dung trước đó **vào chính plan** (version vẫn tăng, ghi revision `REVERT`); trả `{ planId, revertedFrom, version }`. Plan legacy (mô hình cũ) vẫn dùng đường revert cũ.
Lịch sử revision: có ở `conversationRepository.listPlanRevisions` — **chưa mở thành endpoint** (quyết định thiết kế, xem rủi ro).

## 4. Revision job lifecycle
`submit` → (quota) → `ADMITTED` (target = plan **hiện có**, không tạo row) → publish → worker `claim` (lease fence) → [kiểm tra plan còn đúng `baseVersion`, chưa ẩn, COMPLETED — nếu không: fail **trước** khi tốn lệnh gọi model] → lấy catalog → **delta** (chỉ khi thay đổi thuần số bài; ngược lại đường tạo lại cả plan có chốt ngân sách) → `completePlan` (invariant + equipment) → `commitPlanRevision` (1 transaction, fenced) → `finish COMPLETED`.
Thất bại bất kỳ bước nào: `failReason` ghi vào **operation**; plan giữ nguyên nội dung + version + COMPLETED; không row mới; không history. Redelivery: operation đã có revision ⇒ không chạy lại. Hết lượt/stranded ⇒ `settleStranded` (FAILED, hoặc COMPLETED nếu revision đã commit); poll hiện thông điệp thân thiện thay vì chuỗi kỹ thuật.

## 5. Bất biến Plan/version
- `WorkoutPlan.id` không đổi; `version` +1 **đúng một lần** mỗi revision áp dụng; không bao giờ tái dùng số cũ (revert cũng tiến lên).
- Commit có CAS: `updateMany where id, version=expected, status=COMPLETED, archivedAt=null`; `UNIQUE(operation_id)` (idempotent) và `UNIQUE(plan_id, result_version)` (không hai writer cùng version).
- `ptReviewStatus` legacy bị reset về PENDING khi nội dung đổi (duyệt cũ không chuyển sang bản mới).
- Cờ tương thích: nội dung plan sau revision có `_metadata.revision.previousPlanId = <chính planId>` (web dùng làm cờ hiện nút "Quay lại bản trước"; không bị coi là bản nháp vì status COMPLETED).

## 6. Quy tắc tích hợp WorkoutProgram (B5) — **hợp đồng cho Plan Review agent**
1. AI Plan được sửa ≠ Program đã áp dụng. Sửa plan **không** động tới Program. Chỉ khi người dùng bấm lưu/áp dụng lại (`POST /plans/:id/save-to-workout-log` → fitness `/workouts/from-ai-plan` với `sourcePlanId + sourcePlanVersion + weeklySchedule`, hoặc thẻ xác nhận của AI chat) thì Program mới được đồng bộ.
2. Nếu `sourcePlanId` đã có Program và `sourcePlanVersion > program.aiPlanVersion` ⇒ **đồng bộ tại chỗ**: cùng `WorkoutProgram.id`, cùng day row & lịch; exercise khớp theo `exerciseId` giữ nguyên row id; thêm/xoá phần còn lại; `WorkoutProgram.version` +1 **trong cùng transaction** (chỉ khi nội dung thực sự đổi). Re-save cùng nội dung ⇒ không bump (không làm mất duyệt PT vô cớ). Phiên bản plan cũ hơn ⇒ không rollback Program.
3. Phản hồi thêm: `contentSynced`, `previousAiPlanVersion`, `programVersion`.
4. Đổi số buổi/tuần ⇒ `409` (không đồng bộ im lặng; áp dụng thành chương trình mới). Exercise không map được ⇒ `400`, không ghi gì.
5. Lịch sử tập (`Workout`/`WorkoutExercise`) không bị sửa (`programExerciseId` chỉ là tham chiếu thường).
6. PT Review: gắn với `programId + version + hash`; sau sync, duyệt cũ là `APPROVED_OUTDATED`; A→B→A không hồi sinh (đã có test với Postgres).
**Kịch bản C1–C11**: C1/C5 dùng `conversationService.queuePlanAdjustment` + `processAiTaskJob` (mẫu: `workout-revision-worker.pg.itest.ts`, model stub); C2/C9 `importAiPlanToSchedule`; C3/C4/C8/C10 `planReviewService`; C6 so `planId`; C7 `WorkoutProgram.version`. Với model thật cần owner duyệt gọi Bedrock Nova (đang chỉ cho phép Nova Pro).

## 7. Tương thích ngược & dữ liệu cũ
- Poller web/mobile theo `jobId` + `planId`: hoạt động nguyên vẹn (cùng planId; web sau COMPLETED invalidate danh sách → thấy nội dung mới). Web `revertPlanAdjustment` trả `{planId}` như cũ.
- Plan/operation tạo trước đây (target `WORKOUT_PLAN`, job không có `baseVersion`) chạy đường legacy y như cũ; không migrate dữ liệu cloud.
- **Điều kiện triển khai** (chưa deploy): migration additive; **API ai-service và worker phải triển khai cùng lúc** — worker cũ + API mới sẽ ghi PROCESSING/COMPLETED lên plan gốc và không tăng version (nguy hiểm); không có đường khôi phục dữ liệu tự động cho tình huống đó.
- Consumer đã kiểm: web `AIPlansPage` + `api.ts`, mobile `plans/wizard.tsx` + `api.ts` (UI giới hạn 8 bài, hẹp hơn server), AI chat (thao tác trên bản nháp, không gọi adjust), Roadmap/TrainingCycle (tham chiếu program/cycle, không phải plan id), schedule `sourcePlanId` (cùng id).

## 8. Migration local
`prisma/migrations/20261120100000_workout_plan_revisions` (tạo bảng `workout_plan_revisions`, 4 chỉ mục). Áp bằng `prisma migrate deploy` lên `revision_ai_test` — **không** áp lên AWS.

## 9. Test + bằng chứng
| Suite | Lệnh (cwd ai-service) | Kết quả |
|---|---|---|
| Planner/parser (B2,B03–B06,B16,B18) | `NODE_ENV=test tsx --test src/__tests__/workout-revision-planner.test.ts` | 17/17 |
| Lifecycle Postgres (B01,B02,B07–B11,B13 legacy PT reset, revert, listing guard, cờ Undo, stranded, polling) | `NODE_ENV=test DATABASE_URL=…/revision_ai_test LLM_PROVIDER=mock node node_modules/tsx/dist/cli.mjs --test src/__tests__/workout-plan-revision.pg.itest.ts` | 16/16 |
| Worker thật + model stub + fitness giả (B01,B02,B05,B06,B07,B09,B18) | `…workout-revision-worker.pg.itest.ts` | 9/9 |
| Test của luồng kia | `…plan-adjust-revision.pg.itest.ts` | 4/4 |
| Program sync (B12–B15) (cwd fitness) | `tsx --test src/__tests__/ai-plan-revision-program-sync.integration.test.ts` (DB `pr3_fitness_test`) | 3/3 |
| Validator + nhãn + 409 (bổ sung) | xem báo cáo giai đoạn 3 | 20/20, 4/4, 3/3 |
- **Phản chứng**: tắt kiểm tra `expectedVersion` trong `commitPlanRevision` ⇒ test "stale commit" đỏ; đã khôi phục (diff giống bản lưu).
- Hồi quy fitness-service: 1095 test, 1070 pass, **21 fail = đúng tập baseline HEAD (0 mới)**. ai-service (452 test các suite liên quan): 446 pass, **6 fail giống hệt HEAD sạch** (3 persona thiết bị cần fitness-service sống, GOLDEN cờ ON, bundle-recovery, PG "FAILED + same payload" hết 60s; `generation-operations.redis.itest` cần Redis). Chỉ là hồi quy ai-service/fitness-service nêu trên, không phải toàn repo; không chạy được web/mobile typecheck cho phần này vì **không sửa frontend**.
- Nhãn bằng chứng: BACKEND INTEGRATION (Postgres thật, model/fitness stub); unit; **không có REAL BROWSER/REAL HTTP** cho luồng adjust mới.

## 10. Rủi ro còn lại / blocker
1. **Chất lượng model thật chưa kiểm** (không gọi LLM trả phí). Delta chỉ chọn trong ứng viên catalog và được deterministic-merge/verify, nhưng việc "bài thêm có hợp lý" chưa đo.
2. Chỉ delta khi thay đổi **thuần số bài** (không kèm loại bài/thiết bị/đổi buổi/đổi cường độ/cardio); các thay đổi khác đi đường tạo lại cả plan (đã có chốt ngân sách + chốt conflict, **chưa chia chunk theo buổi cho đường này**).
3. Số bài cho **một số buổi** ("buổi 1 và 3 lên 6 bài") bị từ chối bằng câu hỏi lại (invariant worker dùng số bài scalar). Giảm số bài cắt từ đuôi theo thứ tự tập (xác định, không qua model).
4. Plan đang đăng trên chợ không được sửa tại chỗ (quyết định bảo vệ nội dung đã kiểm duyệt; cần owner xác nhận hoặc thiết kế "nhân bản rồi sửa").
5. Web hiện thông điệp "đã được lưu vào lịch tập trước đó" kể cả khi `contentSynced=true` (file `AIPlansPage.tsx` thuộc luồng khác, chưa sửa) — nên đổi thành "đã cập nhật chương trình" dựa vào `contentSynced`.
6. Ước lượng thời lượng buổi tập là heuristic (trần 120 phút, cấu hình `AI_PLAN_MAX_SESSION_MINUTES`), chưa phải kiểm tra an toàn sinh lý.
7. Endpoint lịch sử revision chưa mở; polling `kind` vẫn `WORKOUT_PLAN` (không có cờ phân biệt ngoài `revision:true`).
8. Hạn chế deploy: quy tắc owner "chỉ deploy khi Multi-Agent hoàn tất"; cần cặp API+worker đồng bộ (mục 7).

## 11. Kết luận
**READY FOR INTEGRATION C ở mức hợp đồng + lưu trữ (model stub)**: C1–C4, C6–C11 chạy được ngay trên local; **C5 với model thật chưa được kiểm**. **NOT READY** cho khẳng định chất lượng/production.
NO DEPLOY · NO AWS MUTATIONS · NO IAM CHANGES · NO COMMIT · NO PUSH · NO MERGE.
