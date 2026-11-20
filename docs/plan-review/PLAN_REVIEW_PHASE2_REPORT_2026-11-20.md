# Plan Review — báo cáo giai đoạn 2 (2026-11-20)

Phạm vi: chạy thật trên Postgres local, version đơn điệu của `WorkoutProgram`, tích hợp web / AI chat / mobile / thông báo, hồi quy.
**NO DEPLOY · NO CLOUD MUTATIONS · NO IAM CHANGES · NO COMMIT · NO PUSH.** Mọi DB dùng là Postgres 15 test container local (`gymcoach-test-postgres-test-1`, cổng 55433) với DB dùng-một-lần: `gymcoach_planreview_test` (fitness), `gymcoach_planreview_user_test` (user-service); ai-service dùng `gymcoach_ai_test` sẵn có theo quy ước repo. Không dùng Aurora DEV. Docker Desktop được bật (đang tắt) để chạy container test; dev stack/Ollama/knowledge-worker vẫn tắt.

## 1. Ownership (git/worktree)
File của luồng khác, **không đụng**: `ai-service` `plan.controller.ts`, `plan.routes.ts`, `conversation.repository.ts`, `conversation.service.ts`, `workout-adjustment-constraints(.test).ts`, `ingest-lambda.ts`; web `AIPlansPage.tsx`, `services/api.ts`; `infra/*`, `scripts/aws/*`. File sạch trong git mà mình sửa (additive): `workout.service.ts`, `server.ts`, `notification.client.ts`, `fitness-agent{,-intent,-tools}`, `ai.worker.ts`, `proposed-change-validator.ts`, `shared/src/fitness-agent.ts`, `WorkoutLogPage.tsx`, mobile `programs/index.tsx`, `pt/_layout.tsx`, `pt/dashboard.tsx`, user-service notification files.
Worktree `HEAD` tạm dùng để lập baseline đã gỡ (gỡ junction trước, `node_modules` thật nguyên vẹn). Không reset/stash/clean.

## 2. Phase 1 — Postgres (BACKEND INTEGRATION)
- `prisma migrate deploy` áp toàn bộ migration (gồm `20261119100000_add_plan_review`) lên DB local: thành công. Index từng phần `plan_review_requests_one_open_per_subject … WHERE status IN ('PENDING_REVIEW','IN_REVIEW')` có thật trong DB.
- DB01–DB04: **4/4 pass, skipped 0** (unique index dưới race thật, unique idempotency, 2 quyết định đồng thời ⇒ 1 người thắng + 1 event + revision +1, supersede+create cùng transaction).

## 3. Phase 2 — version đơn điệu (root cause + fix)
Root cause (CODE AUDIT, `workout.service.ts`): `WorkoutProgram.version` mặc định 1 và **không đường ghi nào tăng nó** (`updateProgram`, `updateProgramDay`, `addProgramExercise`, `updateProgramExercise` kể cả set-prescriptions, `deleteProgramExercise`, `createExerciseGroup` (đổi `order`), `updateExerciseGroup`, `ungroupExercises`). Import AI / tạo thủ công luôn tạo **program mới** (id mới, version 1); nhánh "program đã tồn tại" của `importAiPlanToSchedule` chỉ đổi status/aiPlanVersion, không đổi nội dung. `services/patch.js` là bản cũ không ai import.
Fix:
1. `bumpProgramVersion(tx, programId)` gọi **trong cùng transaction** với mỗi thay đổi nội dung (đổi tên/mục tiêu thật sự, tên buổi, bài tập, hiệp/lần/nghỉ, set-prescription, thêm/xoá bài, superset). Không bump với: mô tả, thời lượng buổi, status/archive, lịch, log; gán lại giá trị giống hệt không bump.
2. "Bản duyệt còn hiệu lực" yêu cầu **cả `version` và `contentHash` khớp** (`fingerprintMatches`). A→B→A (hash giống, version mới) ⇒ `APPROVED_OUTDATED`, gửi lại tạo request mới gắn version mới; request đang mở bị supersede chứ không "replay".
3. Phê duyệt có guard nguyên tử: trong cùng transaction `SELECT … FOR SHARE` hàng `workout_programs` và so version; sửa kế hoạch đồng thời hoặc commit trước (⇒ từ chối) hoặc chờ approval commit xong (⇒ approval đọc là outdated). Không còn cửa sổ check-then-act.
Bằng chứng (`plan-review.program-version.integration.test.ts`, 5/5): PV01 từng mutator bump đúng 1 lần / không bump với thay đổi phi nội dung; PV02 mutation lỗi giữa transaction rollback cả bump; PV03 A→B→A trên Postgres thật; PV04 **xác định**: giữ khoá hàng của một edit chưa commit, approval phải *đợi* rồi bị từ chối 409 `REVISION_OUTDATED`, không có event APPROVED; PV05 stress 15 lần approve×edit. **Phản chứng**: tắt guard ⇒ PV04 đỏ; đã khôi phục (diff giống hệt bản lưu).
Snapshot review gồm `programId`, `subjectVersion`, `contentHash`, snapshot bất biến, `ptUserId`, trạng thái + `revision`. Không đụng log lịch sử. Giới hạn: snapshot chưa chứa cấu trúc superset (bump version vẫn có), PT chưa thấy superset.

## 4. Phase 3 — Web
`PlanReviewPanel` gắn vào thẻ "Chương trình" của `WorkoutLogPage.tsx` (query key chứa `programVersion` ⇒ sửa kế hoạch tự làm mới trạng thái). Có: gửi PT, xem feedback, gửi lại, huỷ, loading/error, chống double-submit (idempotency key mỗi lần xác nhận), mã lỗi stale/401/mạng. **REAL BUILD**: `vite build` thành công (58s, ra thư mục tạm, không đè `dist`). Typecheck: repo web **không có tsconfig/script typecheck**; chạy tsc ad-hoc: 0 lỗi trong 3 file mới và tại chỗ sửa (15 lỗi sẵn có ở `WorkoutLogPage.tsx`/`api.ts` ở dòng khác). **UI tests / REAL BROWSER: CHƯA CHẠY** (cần dev stack + web chạy; không tự khởi động).

## 5. Phase 4 — AI chat (BACKEND INTEGRATION, tool service stub)
Kind mới `SEND_PLAN_TO_PT_REVIEW` (shared enum, rủi ro MEDIUM). Câu "gửi plan hiện tại cho PT xem": đúng chiều học viên→PT (câu "PT gửi plan cho tôi" không khớp), câu hỏi thuần là advisory. Preview: xác định program (id+version) và PT từ **hợp đồng ACTIVE (user-service)**; không có plan / không có hợp đồng / nhiều PT / lỗi tra cứu ⇒ không tạo thẻ (fail-closed, không tự chọn PT). Chỉ khi bấm Xác nhận mới gọi `POST /plan-reviews` bằng token của user, `Idempotency-Key = agent-action-<id>`, `expectedVersion` = version đã xem (server mới trả 409 nếu plan đã đổi). Lỗi tạm thời ⇒ action trả về PENDING (retry cùng key); 409/403 ⇒ thông báo "chưa gửi" không retry; không bao giờ báo thành công khi API lỗi. Agent không duyệt, không tạo/đổi hợp đồng. `fitness-agent-plan-review.test.ts` AC01–AC10: **10/10**. Không tạo plan A.1 (chỉ gửi review của program hiện tại). Chưa đưa phản hồi PT vào AI Plan Revision (cần file của luồng khác).

## 6. Phase 5 — Mobile & thông báo
Mobile (Expo): `PlanReviewCard` ở màn "Chương trình của tôi", `app/pt/plan-reviews.tsx` (inbox + chi tiết một màn, route ẩn + ô ở dashboard PT), cùng API/hợp đồng với web; query key chứa user id (đổi tài khoản không lộ dữ liệu cũ). `tsc --noEmit`: **1 lỗi, giống hệt trước khi sửa** (`global.css`). Unit test logic thuần 7/7. Đã tra tài liệu Expo SDK 57 (router API không đổi). **Chưa chạy trên thiết bị / jest component / Maestro; offline queue cố ý KHÔNG làm** (duyệt/gửi cần xác nhận trực tuyến; offline ⇒ báo "chưa gửi").
Thông báo: user-service thêm `PLAN_REVIEW_REQUESTED` (PT, không bị tắt bởi preference), `PLAN_REVIEW_DECIDED` (client, theo `ptFeedbackEnabled`), entity `PLAN_REVIEW`, cột `dedupe_key` UNIQUE nullable (migration `20261119110000`, additive, đã áp trên DB user test). fitness-service giao qua outbox: `deliverPlanReviewNotification` **ném lỗi khi thất bại** (event còn pending), kick sau mutation + job quét 60s trong `server.ts` (không chạy trên Lambda); `dedupeKey = plan-review-event:<eventId>` ⇒ gửi lại/crash giữa chừng không tạo trùng. Nội dung là câu cố định, không có dữ liệu sức khoẻ/kế hoạch. Test: user-service PN01–PN05 + 10 test thông báo sẵn có **15/15**; fitness S29/S30 + NC01/NC02. **Chưa chạy end-to-end hai service sống**; EventBridge/Lambda job cho sweep chưa có (cần cấu hình AWS sau).

## 7. Phase 6 — Gateway & hồi quy
- `/plan-reviews` ở gateway local dùng đúng khuôn của các route fitness khác (CODE AUDIT; chưa có test gateway riêng). Không đụng API Gateway AWS (`infra/` là của luồng khác).
- Redis ECONNREFUSED :6379 = **thiếu Redis cho BullMQ trong test setup** (không phải bug code). Dùng `redis-test` (56379) với `REDIS_HOST/REDIS_PORT`.
- Hồi quy fitness-service: xem §9.
- ai-service (các suite intent/agent liên quan, 194 test): 188 pass, 6 fail — **4 lỗi + 2 file treo giống hệt ở `HEAD` sạch** (worktree baseline: cần user-service/LLM sống). Không có lỗi mới.

## 8. Phase 7 — AI plan (root cause, file:line)
- Mỗi lần "điều chỉnh" tạo `WorkoutPlan` mới ⇒ id mới ("Plan A.1"): `ai-service/src/repositories/conversation.repository.ts:625` (`prisma.workoutPlan.create`, `version`), khởi từ `plan.controller.ts:694` (`adjustPlan`). **File thuộc luồng khác đang sửa dở** (có `plan-adjust-revision.pg.itest.ts` + revert `restoredPlanId` — nhiều khả năng đang giải quyết đúng vấn đề này) ⇒ không sửa, cần phối hợp. Hợp đồng đề xuất: ai-service giữ `logicalPlanId` ổn định; fitness-service đã neo review vào `WorkoutProgram.id` + version.
- "lên 7 bài", token budget động, chunking, không lưu partial JSON: nằm ở `workout-adjustment-constraints.ts` (luồng khác) và `estimatePlanNumPredict` trong `ai.worker.ts` — chưa sửa phần này (cần quyết định ownership).
- **Đã sửa (file độc lập, có test):** (a) `proposed-change-validator.ts`: đọc đúng "3x10"=30 và khoảng "8-10"=9 (trước đây chỉ đọc số đầu: "3x8→3x12" +50% lọt thành 0%); (b) `ai.worker.ts`: nhãn buổi tập tiếng Việt có dấu (trước là không dấu/chữ Anh trộn) **và** `parseDayFocusMuscleGroups` giờ bỏ dấu — trước đó nhãn có dấu (LLM sinh theo schema) mất nhóm cơ (`Ngực`/`Lưng`/`Chân`/`Mông`), đây là nguyên nhân thật khiến chọn bài sai.
- Active-cycle 409: chưa điều tra local (không đụng DB/AWS); chưa có fixture.

## 9. Kết quả hồi quy fitness-service
Lệnh: `tsx --test --test-concurrency=2 src/__tests__/*.test.ts` trên Postgres test + Redis test, sau khi seed catalog bằng script của repo (`seedTestExerciseCatalog.ts`). **Chỉ là hồi quy fitness-service, không phải toàn repo.**
- Kết quả cuối: **1088 test, 1062 pass, 22 fail, 4 skip** (4 skip có sẵn từ các lần chạy trước, không thuộc plan-review). Toàn bộ 50+ test plan-review (S01–S30, H01–H09, DB01–DB04, PV01–PV05, NC01–NC02, engine) **pass, skipped 0**.
- 22 lỗi còn lại **trùng khớp từng tên với 22 lỗi khi chạy cùng các file trên `HEAD` sạch** (git worktree; 0 lỗi mới): 7 test cần service sống ở :3002 / DB khác ở :5433 (môi trường), 15 test cần dữ liệu seed thực phẩm/phân loại đầy đủ (food form, powder/isolate, NO_CANDIDATE…). Chưa seed các phần đó nên chưa chứng minh được chúng pass — chỉ chứng minh không do thay đổi này.
- Lần chạy trước (concurrency 4) có 1 lỗi `every exercise has a movementPattern` là race với test khác đang seed bài tập tạm; chạy riêng 2 lần đều pass.
- Lần đầu (chưa seed catalog) 64 lỗi; sau seed còn 23 → 22.

## 10. Còn blocked / chưa làm
IAM `lambda:InvokeFunction` (bị classifier chặn, không bypass); AI plan identity & "7 bài" (file luồng khác); web UI test thật + mobile trên thiết bị; end-to-end hai service sống cho thông báo; route AWS API Gateway `/plan-reviews`, job sweep trên Lambda, migration lên AWS (user-service + fitness-service) — **tất cả cấm trong lần này**.

## 11. Verdict
**Backend slice (plan-review + version + guard + notifications + AI chat confirmation): READY FOR REVIEW sau khi owner xem diff — KHÔNG phải "READY FOR COMMIT" cho tính năng đầy đủ** (UI web/mobile chưa kiểm thử thật, chưa có E2E liên dịch vụ, AI plan identity chưa phối hợp). NO DEPLOY · NO CLOUD MUTATIONS · NO IAM CHANGES · NO COMMIT · NO PUSH.
