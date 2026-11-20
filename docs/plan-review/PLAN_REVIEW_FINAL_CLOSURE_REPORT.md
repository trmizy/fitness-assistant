# Plan Review — Final Closure Report (Workstream C) — 2026-11-20

Ràng buộc đã giữ suốt lượt này: không deploy AWS, không đổi IAM/DB cloud, không gọi LLM trả phí (model = stub cục bộ), không commit/push/merge, không reset/stash/ghi đè thay đổi của agent khác, chỉ Postgres/Redis test cục bộ (`*_test`).
Nhãn bằng chứng: `REAL BROWSER` · `REAL HTTP/API` · `BACKEND INTEGRATION` · `TEST FIXTURE` · `CODE AUDIT`.

**Kết luận ngắn:** READY FOR COMMIT (phần code backend + Workstream C, kèm điều kiện nêu ở §10). **NOT READY FOR RELEASE** (§11).

---

## 1. Ownership sign-off theo agent

| Hạng mục | Ai nắm | Trạng thái | Ghi chú |
|---|---|---|---|
| Workstream A (Plan Review: fitness-service/user-service/gateway/web+mobile UI của plan review) | phiên này (Plan Review agent) | **Tự ký** | Mã của mình. |
| Workstream B (in-place revision, ai-service, program sync) | owner giao cho phiên này ở lượt B | **Tự ký — không độc lập** | Task 2 hôm nay là review của chính mình ⇒ **không phải review độc lập**. Khuyến nghị một người khác đọc lại 4 bản vá (§3) trước khi release. |
| Workstream C (tích hợp, kịch bản C1–C14) | phiên này | **Tự ký** | Bằng chứng ở §4–§6. |
| `AIPlansPage.tsx`, `services/api.ts` (Web) | luồng khác, `M` chưa commit từ 17–18/11, không worktree/báo cáo nhận | **KHÔNG được bàn giao ⇒ không sửa** | Chỉ giao patch + đặc tả (§2). `git status` xác nhận hai file vẫn ở trạng thái của owner. |
| `proxy.routes.ts` (gateway) | chung | Sửa tối thiểu, additive (+11 dòng: route `/plan-reviews`) | Không đụng phần khác. |

## 2. Task 1 — Web UI sync semantics (K9)

**Trạng thái: PATCH ĐỘC LẬP ĐÃ THỬ, CHƯA ÁP DỤNG vào cây chính (đúng quy tắc ownership).**

- Đặc tả component state: `docs/plan-review/aiplanspage-sync/AIPLANSPAGE_SYNC_PATCH_SPEC.md`.
- Patch sẵn dùng: `docs/plan-review/aiplanspage-sync/aiplanspage-sync.patch` (`git apply --check` sạch trên cây hiện tại).
- Lỗi gốc đã tái hiện trên UI hiện tại của owner — `REAL BROWSER` (`browser-c.mjs` U2): sau khi áp dụng revision thành công UI vẫn báo *"Kế hoạch này đã được lưu vào lịch tập trước đó."* (`logs/final-browser-c.log`).
- Thử patch trong **bản sao cô lập** (`.tmp-stack/web-sync-patch`, Vite :5174 → gateway :3000): `vite build` **xanh**; `browser-sync.mjs` — `REAL BROWSER` (Chromium, đăng nhập thật, click thật): **26/26 PASS** (`logs/final-browser-sync.log`, ảnh `logs/shots/sync-*.png`):
  - Phân biệt đủ: chưa lưu / đã đồng bộ / có bản mới chờ đồng bộ / đang đồng bộ / đồng bộ xong / đồng bộ lỗi.
  - Lưu lần đầu: "Đã lưu kế hoạch vào lịch tập."; áp dụng revision: "Đã cập nhật chương trình tập theo phiên bản 2…"; lưu lại không đổi gì: "…đã khớp với phiên bản 2 — không có gì thay đổi."; không còn chuỗi "đã lưu trước đó".
  - **Một** WorkoutProgram, cùng id qua toàn bộ chu trình (kiểm bằng SQL).
  - Undo v2→v3: **cùng planId**, version tiến v3, trạng thái tính lại `pending_sync` (plan v3 vs program ai2), program không bị Undo đụng tới.
  - Lỗi đồng bộ (route chặn trả 500 — `TEST FIXTURE` cho lỗi) hiện `sync_failed`, không có banner thành công, program không đổi; retry thành công → v3.
  - Reload toàn trang: trạng thái suy từ server, không từ cờ cục bộ.
- Chưa phủ: viewport 360/375/390/412; `tsc` cho web; đồng bộ liên-tab. (Nêu trong spec §4.)
- **Việc owner phải làm:** áp patch (hoặc tự cài theo spec), chạy `vite build` + kiểm mobile rồi mới đóng K9.

## 3. Task 2 — Review 4 bản vá tích hợp (Workstream B)

Tự review (không độc lập). Diff thực tế đã xem; thay đổi của luồng khác trong cùng file được giữ nguyên.

| Vá | Phán quyết | Bằng chứng |
|---|---|---|
| **A** — `PlanContentSchema.exercisesPerDay` max 8→10 (request sinh plan vẫn ≤8) | **ACCEPT** | `BACKEND INTEGRATION`: test mới worker 4×9 và 4×10 end-to-end (giữ 4 bài gốc đứng đầu, id duy nhất, thuộc catalog, nội dung lưu qua `PlanContentSchema`; 11 vẫn bị từ chối) — `workout-revision-worker.pg.itest.ts` **13/13**. |
| **B** — `save-to-workout-log` chuyển tiếp `contentSynced/previousAiPlanVersion/programVersion` | **ACCEPT** | `REAL HTTP/API` C7 (`contentSynced:true`, `programVersion:2`) + `REAL BROWSER` (§2). Chỉ thêm khóa khi có giá trị ⇒ lần lưu đầu giữ nguyên hình dạng cũ; client cũ bỏ qua khóa lạ (UI hiện tại của owner vẫn chạy: `browser-c` 14/14). |
| **C** — Idempotency-Key replay trả operation gốc | **NEEDS_CHANGE → đã sửa trong lượt này → ACCEPT** | Review phát hiện 2 lỗ: (1) replay cả khi op đã `FAILED` (báo thành công sai), (2) không so `expectedVersion`/`daysPerWeek`/`exercisesPerDay` với op cũ. Đã sửa `conversation.service.ts`: chỉ replay khi `status≠FAILED` **và** plan đã đi qua version cơ sở (`base≠current`); lệch nội dung/expectedVersion/tham số tường minh ⇒ `409 IDEMPOTENCY_KEY_CONFLICT`; op `FAILED` rơi về đường chuẩn (mở epoch mới, tính phí lại theo chính sách cũ). `workout-plan-revision.pg.itest.ts` **18/18** (thêm test: lệch expectedVersion/exercisesPerDay; retry op FAILED không bao giờ là "replay"; plan đã đi tiếp thì không thành công giả). Cùng key + khác nội dung khi plan *chưa* đổi: do fingerprint của `submitGeneration` chặn (`CODE AUDIT`, có sẵn từ trước, chưa có test riêng). **Rủi ro còn lại:** `REVISION_IN_PROGRESS` là best-effort (hai request song song có thể cùng 202); CAS ở commit đảm bảo chỉ một thắng. |
| **D** — op `COMPLETED` mà không có revision ⇒ báo `FAILED` | **ACCEPT, có điều kiện phát hành** | Xem ma trận worker cũ bên dưới. Đây là **phát hiện sau sự kiện**, không phải ngăn chặn. |

### Worker cũ (HEAD) có làm hỏng plan gốc không? — `BACKEND INTEGRATION` + `TEST FIXTURE`
Chạy mã worker/recovery **của HEAD** (worktree sạch, Postgres test) trên message do API mới tạo (`logs/skew-matrix-old-worker.log`, `logs/skew-matrix.result.json`):

| Kịch bản | Kết quả plan gốc | Model | Ghi chú |
|---|---|---|---|
| S1 message mới ở trạng thái PUBLISHED | **nguyên vẹn** (v1, 4×4, 1 row) | 0 lệnh | op → COMPLETED (không có revision ⇒ API mới báo FAILED) |
| S2 RUNNING hết lease + `recoverPendingGenerations` cũ | **nguyên vẹn** | 0 | op → COMPLETED |
| S3 đã hết lượt attempt | **nguyên vẹn** | 0 | op → COMPLETED |
| S4 op FAILED + `repairFailedTarget` cũ | **nguyên vẹn** | 0 | |
| S5 plan **không** ở COMPLETED khi worker cũ chạy | **BỊ GHI ĐÈ** (4→8 bài/buổi, version vẫn 1) | 1 | **Không đạt được qua API mới**: `PLAN_NOT_COMPLETED` chặn lúc xếp hàng, và plan COMPLETED không quay lại trạng thái khác. Chỉ xảy ra nếu DB bị sửa tay/đường ghi khác. |

Kết luận: worker cũ **không** làm hỏng plan trong mọi trạng thái mà API mới có thể tạo ra; S5 là rủi ro dư (thấp, không bằng 0). Worker HEAD **không có cổng theo tên job** (job lạ rơi vào đường sinh plan) nên không thể chặn S5 bằng message.

**Đề xuất compatibility gate (chưa triển khai, không cần đổi kiến trúc):**
1. **Cổng thật = thứ tự phát hành: worker mới → migration → API mới** (không bao giờ API trước worker). Worker mới xử lý được cả message cũ và mới (đã có test skew: old API → new worker hoàn tất theo đường legacy).
2. Tuỳ chọn, nếu cần cứng hơn: heartbeat năng lực worker (Redis/DB) + API từ chối xếp hàng revision khi không thấy worker có năng lực; hoặc cờ `AI_PLAN_REVISION_IN_PLACE` mặc định tắt, bật sau khi worker mới đã chạy. **Chưa thử bằng fixture** vì mình đánh giá không bắt buộc; nếu owner chọn, cần làm và test riêng.

## 4. Task 3 — Chạy lại C1–C14 (`REAL HTTP/API`, stack cục bộ, DB `*_test`, model stub)

| Nhóm | Lệnh | Kết quả |
|---|---|---|
| C1–C11 | `run-c.mjs main` | **23 PASS**, 0 FAIL (C11 mobile native = BLOCKED, §6) |
| C12 (lỗi/đồng thời) | `run-c.mjs fail` | **37 PASS**, 0 FAIL |
| C13 (tương thích) | `run-c.mjs compat` | **12 PASS**, 0 FAIL |
| C14 (chợ kế hoạch) | `run-c.mjs market` | **12 PASS**, 0 FAIL |
| Web hiện tại của owner | `browser-c.mjs` — `REAL BROWSER` | **14 PASS**, 0 FAIL |
| Web + patch sync | `browser-sync.mjs` — `REAL BROWSER` | **26 PASS**, 0 FAIL |

Log: `integration-c/logs/final-run-c-*.log`, `final-browser-c.log`, `final-browser-sync.log`.
Đã chứng minh lại: Undo v2→v3 giữ cùng planId; duyệt PT cũ thành `APPROVED_OUTDATED` khi nội dung đổi (kể cả A→B→A không sống lại); gửi lại → request mới, cũ được giữ; outbox/notification (dedupe) và route `/plan-reviews` qua **gateway**; hai phiên (header web/mobile) đọc cùng `programVersion/planVersion`.

## 5. Hồi quy so với baseline HEAD

Chỉ nói đúng phạm vi đã chạy:

**fitness-service** (`src/__tests__/*.test.ts`, DB `pr3_fitness_test`, `--test-force-exit`): 1096 test, 1066 pass, 26 lỗi; baseline HEAD = 22 tên lỗi (`evidence-b-2026-11-20/head-baseline-fail-fitness.txt`).
- Không thuộc baseline: B12–B15 (test của mình) và 3 test catalog (`movementPattern`, `isExerciseAvailable`, equipment ACTIVE) + file `internal-exercise-muscle-profiles`. **Chạy riêng từng file: `ai-plan-revision-program-sync` 3/3, `equipment-data-integrity` 24/24, `equipment-invariants` 8/8, `movement-pattern` 4/4, `manual-program-calendar` 5/5** ⇒ lỗi do **nhiễm dữ liệu chéo giữa các file chạy song song trên cùng một DB** (B12 gặp exercise id `advlog-it-…` của test khác; equipment có slug uuid của test khác), không phải mã. `internal-exercise-muscle-profiles`: 2/2 test thật PASS, file bị `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` của libuv trên Windows (teardown do `--test-force-exit`). 1 lỗi baseline (`runUpcomingReminderSweep`) lần này pass (flaky).
- Còn lại = tập baseline (vd. Adaptive Training Cycle, substitute 401). **Không có hồi quy mã được xác định**, nhưng đây là kết luận từ chạy-riêng, không phải một lần chạy sạch hoàn toàn.

**ai-service** (`src/__tests__/*.test.ts` + `src/llm/__tests__/*.test.ts`, DB `revision_ai_test`, Redis test :56379): cùng một lệnh chạy trên **cây làm việc** và trên **worktree HEAD sạch** (`BACKEND INTEGRATION`, `logs/final-ai-regression2.log` / `final-ai-regression-HEAD.log`).
- HEAD: 2484 test, 2421 pass, 56 lỗi (57 dòng tên). Cây hiện tại: 2548 test (+64 test mới), 2491 pass, 52 lỗi (53 dòng tên).
- Đối chiếu tên lỗi: **0 lỗi mới** (tập lỗi hiện tại ⊂ tập lỗi HEAD). 4 lỗi chỉ có ở HEAD (`4.7R6A.1/.2`, `advisory-progress*`) không còn ở cây hiện tại — không điều tra, không do thay đổi của mình.
- Phần lớn lỗi là nhóm test "(real DB)" của fitness-agent/agent-workflow, lỗi y hệt trên HEAD (chạy riêng 2 file đại diện: cả hai 9/23 và 2/4 lỗi ở cả hai cây) ⇒ lỗi môi trường/test có sẵn, **chưa được sửa và không thuộc phạm vi**. Lần chạy đầu (`final-ai-regression.log`) bị cắt giữa chừng vì thiếu `REDIS_HOST/PORT` (kết nối :6379); đã chạy lại đúng env và dùng lần sau.

Ngoài ra (chạy riêng, `BACKEND INTEGRATION`): `workout-plan-revision.pg.itest` 18/18, `workout-revision-worker.pg.itest` 13/13, `workout-revision-planner.test` + `fitness-agent-plan-review.test` 28/28.

## 6. Mobile native — vẫn BLOCKED

Không có Android SDK/adb/emulator/thiết bị; `jest-expo` hỏng sẵn ở baseline (thiếu plugin Babel). Không thay thế bằng unit/API test và **không báo PASS**. Chỉ có: C11 phía backend (hai phiên đọc cùng trạng thái), `tsc` ở giai đoạn trước.
**Đề xuất dựng môi trường (không làm lượt này):** Android Studio + SDK platform-tools, AVD API 34, `adb` trong PATH, `expo run:android` / dev-client; sửa `jest-expo` bằng cách cài plugin Babel còn thiếu theo lỗi báo; chạy lại luồng: đăng nhập → Program → gửi PT review → PT duyệt → sửa AI → xác nhận outdated.

## 7. Bug chưa đóng / rủi ro còn lại

1. **K9** — UI `AIPlansPage` vẫn nói sai trong cây chính (patch chờ owner).
2. `REVISION_IN_PROGRESS` không nguyên tử (CAS ở commit bảo đảm 1 người thắng; request thua chỉ tốn một lệnh model).
3. Rủi ro dư S5 của worker cũ (§3).
4. Plan đang đăng chợ (SUBMITTED/APPROVED) bị chặn sửa tại chỗ theo quyết định đã chốt; chưa có luồng "phiên bản sản phẩm mới" (cố ý không làm).
5. Route/job AWS còn thiếu (đã ghi ở audit trước) — không thể xử lý khi cấm AWS.
6. 1 lần chạy fitness có 5 lỗi chéo do chạy song song cùng DB (§5) — nên chạy `--test-concurrency=1` hoặc DB riêng cho CI.
7. Review Task 2 là tự review.

## 8. Quality gate với LLM thật — CHƯA LÀM

Toàn bộ chạy bằng model stub. Chất lượng bản sửa thật (delta, chunk theo ngày, giữ bài gốc, ngôn ngữ) chưa được đo với Bedrock Nova Pro. Cần owner duyệt chi phí; không được tính là đã xác minh.

## 9. Yêu cầu phát hành phối hợp (API + Worker)

- Thứ tự: **worker mới → migration (`20261120100000_workout_plan_revisions`, `20261119110000` dedupe_key, fitness migrations plan review/`workout_programs.version`) → API (ai/fitness/user/gateway) → web.** Không bao giờ API mới trước worker mới.
- Rollback: code rollback không hoàn tác migration; bảng/cột mới đều additive (expand) nên V1 cũ vẫn đọc được; cần snapshot DB trước migrate.
- Gateway phải có route `/plan-reviews` (đã thêm) **và trên API Gateway AWS** (chưa kiểm/chưa làm — cấm AWS lượt này).
- Quy tắc owner: không deploy cho tới khi Multi-Agent hoàn tất.

## 10. READY FOR COMMIT?

**READY** cho phạm vi backend + Workstream C + test, với điều kiện: (a) owner xem lại thay đổi chưa commit của luồng khác chung file (`plan.controller.ts`, `conversation.repository.ts`, `workout-adjustment-constraints.ts`, `plan.routes.ts`, `conversation.service.ts` — đã giữ nguyên phần của họ); (b) **không** gộp `AIPlansPage.tsx`/`api.ts` của owner khác mà không có sự đồng ý; (c) `docs/*.md` chỉ ở local (quy tắc không push .md). Không có commit nào được tạo.

## 11. READY FOR RELEASE?

**NOT READY.** Lý do: chưa có quality gate LLM thật (§8); mobile native BLOCKED (§6); K9 chưa áp dụng ở cây chính (§2); phát hành phải phối hợp worker→migration→API và route AWS chưa kiểm (§9); quy tắc "không deploy cho đến khi Multi-Agent xong"; review Task 2 chưa độc lập.

## 12. File thay đổi / tạo trong lượt đóng này

- Sửa: `backend/services/ai-service/src/services/conversation.service.ts` (vá C), `.../__tests__/workout-plan-revision.pg.itest.ts`, `.../__tests__/workout-revision-worker.pg.itest.ts` (test mới).
- Tạo: `docs/plan-review/integration-c/{browser-sync.mjs,skew-matrix-produce.ts,skew-matrix-old-worker.ts}`, logs `final-*`, `docs/plan-review/aiplanspage-sync/{AIPLANSPAGE_SYNC_PATCH_SPEC.md,aiplanspage-sync.patch}`, báo cáo này.
- Cô lập (gitignored): `.tmp-stack/web-sync-patch`, `.tmp-stack/web-sync-patch-dist`.
- Lịch: dời tác vụ `Gymini-DEV-AutoStop` sang 18:00 hôm nay theo yêu cầu (chỉ trigger cục bộ).
