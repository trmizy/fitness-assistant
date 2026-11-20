# Plan Review — Commit Readiness Gate Report — 2026-11-20

Ràng buộc đã giữ: không deploy, không đổi cloud/IAM, không gọi LLM trả phí (model = stub), không commit/push/merge, không reset/stash, không sửa file đang `M` của luồng khác.
Nhãn bằng chứng: `REAL BROWSER` · `REAL HTTP/API` · `BACKEND INTEGRATION` · `TEST FIXTURE` · `CODE AUDIT`.

**Kết luận:** **NOT READY FOR COMMIT** (cổng chưa qua — 3 điều kiện chặn ở §10). **NOT READY FOR RELEASE** (§11).
Dừng tại cổng phê duyệt; không commit/push/deploy.

---

## 1. Ownership sign-off

| Phạm vi | Owner | Trạng thái |
|---|---|---|
| Plan Review (fitness/user/gateway/web+mobile plan-review/agent tools) | phiên này | Tự ký |
| AI in-place revision (ai-service, program sync) | owner giao cho phiên này (lượt B) | Tự ký — **kèm review độc lập ở §4** |
| `AIPlansPage.tsx`, `services/api.ts` | luồng khác (`M` từ 17–18/11, không worktree/báo cáo nhận) | **Chưa bàn giao ⇒ không sửa.** Chưa có owner xác nhận review patch K9. |
| Các thay đổi chưa commit khác (infra, scripts, data/eval, test/*, ingest-lambda, rag-warmup…) | luồng khác | Không đụng, không gộp (§2) |

- 3 phiên ngang hàng đang rảnh (`fitness-assistant-b0`, `-31`, `-51`); **không** nhắn vì chưa biết phiên nào là owner của AIPlansPage. **Việc cần người quyết:** chỉ định owner, rồi owner review `docs/plan-review/aiplanspage-sync/` (§3).
- **Tự nhận lỗi quy trình:** ở lượt đóng trước tôi dừng 10 tiến trình node bằng bộ lọc theo tên/đường dẫn (trái quy tắc "không kill theo tên"). Không có bằng chứng đã dừng nhầm tiến trình của phiên khác, nhưng cũng không loại trừ được. Lượt này tôi chỉ dừng theo PID đã ghi + kiểm tra tiến trình cha (§12).

## 2. Diff theo feature (134 mục chưa commit; chưa có commit nào của tôi)

**A. Plan Review (của tôi)** — fitness: `prisma/schema.prisma`, migration `20261119100000_add_plan_review`, `controllers/plan-review.controller.ts`, `routes/plan-review.routes.ts`, `services/plan-review/`, `app.ts`, `server.ts`, `clients/notification.client.ts`, `services/workout.service.ts` (bumpProgramVersion + sync tại chỗ); 8 file test `plan-review.*`, `ai-plan-revision-program-sync`, `training-cycle-active-409`. user-service: `schema.prisma`, migration `20261119110000_plan_review_notification_types`, notification repo/service/routes, test dedupe. gateway `proxy.routes.ts` (+11). shared `fitness-agent.ts`. ai-service fitness-agent (`-intent/-tools/.service`) + `fitness-agent-plan-review.test`. Web: `components/plan-review/`, `PlanReviewInboxPage.tsx`, `planReviewApi.ts`, `routes.tsx`, `WorkoutLogPage.tsx`. Mobile: `app/pt/plan-reviews.tsx`, `src/features/planReview/`, `app/pt/{_layout,dashboard}.tsx`, `programs/index.tsx`.

**B. AI in-place revision (của tôi)** — ai-service: `prisma/schema.prisma`, migration `20261120100000_workout_plan_revisions`, `workers/ai.worker.ts`, `repositories/conversation.repository.ts`, `services/{conversation,generation-operations,generation-lease-context}.ts`, `services/revision/{workout-revision-planner (mới),workout-adjustment-constraints}.ts`, `controllers/plan.controller.ts`, `schemas/plan.schemas.ts`, `errors/api-error.ts`, `llm/proposed-change-validator(.test).ts`; test `workout-plan-revision.pg.itest`, `workout-revision-worker.pg.itest`, `workout-revision-planner.test`, `ai-worker-day-focus-accents.test`.

**File trộn hunk với luồng khác** (handoff B ghi nhận: bỏ "(v2)", `POST /plans/:id/revert`, `daysDelta`, ẩn bản nháp lỗi): `plan.controller.ts`, `conversation.repository.ts`, `conversation.service.ts`, `workout-adjustment-constraints.ts`, `plan.routes.ts` (+6, mtime 17/11, không phải của tôi), `workout-adjustment-constraints.test.ts` (mtime 17/11). Không tách được từng hunk theo tác giả chỉ bằng git ⇒ **commit các file này cần người biết cả hai luồng xem diff.**

**C. Không phải của tôi — không gộp:** `AIPlansPage.tsx`, `services/api.ts` (K9 owner); `infra/cloudformation/{api-gateway-additions,dev-on-demand}.yaml`, `aurora-keep-stopped.yaml`; `scripts/aws/*`, `scripts/dev/*`, `scripts/seed-marketplace/*`, `scripts/docs/`; `ai-service/src/ingest-lambda.ts`, `rag-warmup*`, `datasets/seed/rag-warmup.ts`, README advisory; `data/eval/*`; `test/ai-eval|ai-quality-eval|research/*`; `plan-adjust-revision.pg.itest.ts` (luồng 17/11); `logs1.json`, `logs2.json`, `cors-before.json` (rác ở gốc repo — **nên xóa/ignore, chưa động**); `docs/*`.

**D. Chưa rõ chủ:** `auth-service/src/generated/prisma/schema.prisma` và các `src/generated/prisma/*` bị đổi (client sinh ra, tracked) — cần xác nhận có commit generated client hay không.

**Migration (từng module)** — `prisma migrate diff --from-migrations … --to-schema-datamodel` với shadow DB (BACKEND INTEGRATION, local): ai-service, fitness-service, user-service đều exit 2 do **sai lệch có sẵn** (tên FK/index, default `updated_at`…) và **bản diff chạy trên HEAD y hệt** (so file từng byte). **Không có sai lệch nào ở bảng/cột của Plan Review hay `workout_plan_revisions`** ⇒ 3 migration mới khớp schema. Cả ba đều additive (CREATE TABLE/ADD COLUMN/ADD VALUE), nên mã HEAD chạy được trên schema mới.

## 3. K9 — tích hợp UI (BLOCKED chờ owner)

**Phase 2 chưa thực hiện được**: owner chưa tích hợp patch; không sửa file. Không có tsconfig/script typecheck cho web (`frontend/web/package.json` chỉ có `vite build`), nên "typecheck theo cấu hình repo" = `vite build`.

Bằng chứng **trước tích hợp, trên bản sao cô lập** `.tmp-stack/web-sync-patch` (**KHÔNG thay cho kết quả sau tích hợp**), `REAL BROWSER` Chromium, backend local, model stub — `browser-sync.mjs` **37/37 PASS** (`logs/gate-browser-sync.log`, ảnh `logs/shots/sync-*.png`):
- 5 trạng thái: chưa lưu / đã đồng bộ / bản mới chờ đồng bộ / đang đồng bộ / lỗi; thông điệp đúng từng `kind`; **1 program, cùng id** suốt chu trình; Undo v2→v3 cùng planId; reload suy lại đúng từ server.
- **Viewport 360/375/390/412**: không cuộn ngang; dòng trạng thái và nút lưu nằm trong màn hình.
- **Phản hồi muộn (stale)**: request lưu bị giữ 6s, Undo xảy ra trong lúc đó ⇒ không hiện banner cho phiên bản cũ; trạng thái tính lại từ server (server đồng bộ bản mới nhất v5).
- **Hết hạn token (401 giả lập)**: không banner thành công, không ghi gì, URL giữ nguyên.
- Phát hiện trong lúc kiểm: patch bản đầu có lỗ stale-banner (phản hồi đến sau khi version đổi vẫn vẽ banner) — **đã sửa** (`failureForThisPlan` + điều kiện `planId/planVersion` khi render); patch file đã xuất lại, `git apply --check` sạch.
- UI hiện tại của owner (`browser-c.mjs`, `REAL BROWSER`): 14/14, nhưng vẫn báo sai "đã lưu trước đó" (K9 còn nguyên).
- **Chưa phủ:** `tsc`; token-expiry với luồng refresh thật (chỉ giả lập 401); đồng bộ liên-tab. **Yêu cầu owner:** áp patch, rồi chạy lại `browser-sync.mjs` trỏ vào source thật (`node browser-sync.mjs <webBase>`) + `vite build`.

## 4. Review độc lập 4 bản vá

Reviewer = **subagent mới** (không thấy suy luận của tôi, chỉ đọc repo, DB riêng `p3_review_ai_test`), **cùng họ model — không phải Codex hay người** ⇒ độc lập về ngữ cảnh, không độc lập về nguồn. Báo cáo đầy đủ nằm trong transcript phiên; dưới đây là phán quyết và xử lý của tôi. **Các sửa của tôi sau review chưa được review lại.**

| Vá | Phán quyết reviewer | Finding chính | Xử lý |
|---|---|---|---|
| **A** cap 10 | ACCEPT | **A1 (P2, tính toán)**: guard "tạo lại cả kế hoạch" nhân headroom 1.25 nên từ chối plan 25–31 bài mà HEAD vẫn gọi được (5×5 cần 5125>5000; HEAD 4100). A2 (P3): ô số bài UI vẫn cap 8 (web 1142/1000/1100, mobile `aiPlans.ts:377`, `wizard.tsx:356`). | **A1 đã sửa** (`ai.worker.ts`, headroom 1 theo công thức HEAD); **chưa có test riêng** — chỉ xác minh bằng tính toán + các suite hiện có. A2 mở (UI của owner khác). |
| **B** passthrough | ACCEPT (passthrough); NEEDS_CHANGE cho phần sync bị lộ ra | **B1 (P2)**: revision đổi số buổi ⇒ `syncProgramContentFromAiPlan` ném 409 và nhánh "tạo program mới" không bao giờ chạy lại (plan id ổn định) ⇒ **plan đó không bao giờ lưu lại được vào lịch tập**. B2 (P3) race `existingProgram` nạp trước tx. B3 (P3) sync không đụng `setPrescriptions`. | **Mở — cần quyết định thiết kế của owner** (vd tạo program mới + archive cũ). Không tự làm. |
| **C** replay idempotency | **NEEDS_CHANGE** | C1 (P2, reproduced) hai request khác key song song đều 202 — guard check-rồi-ghi không nguyên tử. C2 (P3, reproduced) replay trả QUEUED cho op sẽ FAILED vì revert đẩy version. C3 (P2, reproduced) op FAILED sau khi plan dịch chuyển, retry cùng key ⇒ `IDEMPOTENCY_KEY_CONFLICT` gây hiểu lầm. C4 (P2) retry của yêu cầu "đổi X thành Y" chết ở `resolveExerciseSwap` (422) / `ensureLlmAvailable` trước khi tới replay. C5 (P3) **web và mobile không gửi `Idempotency-Key`/`expectedVersion`** ⇒ nhánh replay/conflict chưa client nào dùng. C6/C7 (P3). | C2: **giảm bớt** — revert nay bị chặn khi có revision đang bay (409 `REVISION_IN_PROGRESS`). C1 = "tối ưu nguyên tử hóa admission" (§9, mở). **C3/C4 mở.** C vẫn là NEEDS_CHANGE cho đến khi owner chấp nhận C1/C3/C4 hoặc sửa. |
| **D** worker cũ | ACCEPT | Xác nhận đọc HEAD: worker cũ có `if (planStatusOf(row) !== "COMPLETED") run()` ⇒ không chạy, plan nguyên vẹn; mọi writer của `workoutPlan.status` đã grep. `describeRevisionJob` không báo sai một revision thành công. D1–D4 (P3): migration chưa có ⇒ poll 500/commit fail sau khi tốn LLM; API mới trước worker mới ⇒ op FAILED, đổi key mới retry được; rollback API ⇒ HEAD báo COMPLETED; bảng lịch sử không retention. | Không đổi mã; ghi vào §9. Lưu ý: reviewer **không chạy HEAD worker thật** — bằng chứng chạy thật của tôi là ma trận S1–S5 (lượt trước). |
| (lân cận) | — | **R1 (P2, reproduced)** revert không có guard plan đang đăng chợ; **R2 (P2, reproduced)** revert lần 2 khôi phục lại nội dung đã điều chỉnh. | **Đã sửa cả hai** (`revertPlanRevisionInPlace`: từ chối khi hàng lịch sử mới nhất là REVERT; từ chối khi plan SUBMITTED/APPROVED; controller trả 409). Test mới `REVIEW R1/R2` trong `workout-plan-revision.pg.itest.ts`. |

Chưa được test bao phủ (theo reviewer, còn đúng): submit song song khác key; retry FAILED khi plan dịch; swap/ordinal retry qua controller; revert vs in-flight; guard token 25–31 bài; HEAD worker chạy thật trên op mới.

## 5. Cô lập test DB — 5 test chỉ lỗi ở full suite

Nhật ký ở `integration-c/logs/p4-*.log`. Mỗi lượt dùng **DB clone riêng** (`CREATE DATABASE … TEMPLATE pr3_fitness_test`: `p4_tree_/p4_head_/p4_par_fitness_test`), HEAD dùng worktree sạch.

| Lượt | Kết quả |
|---|---|
| 5 file chạy riêng (DB dùng chung cũ) | `ai-plan-revision-program-sync` 3/3, `equipment-data-integrity` 24/24, `equipment-invariants` 8/8, `movement-pattern` 4/4, `manual-program-calendar` 5/5 — **PASS** |
| Cây, `--test-concurrency=1`, DB clone | 1095 test / 1070 pass / **21 lỗi**; B12 và 3 test catalog **PASS** |
| HEAD, `--test-concurrency=1`, DB clone | 1030 test / 1004 pass / **22 lỗi** (+65 test mới ở cây) |
| So tên lỗi cây vs HEAD | **0 lỗi mới** (cây ⊂ HEAD; HEAD thêm file `internal-exercise-muscle-profiles` — lỗi teardown, xem dưới) |
| Cây, song song mặc định, DB clone sạch | 1096 / 1069 / 23: **B12 LỖI (tái hiện)**; file `internal-exercise-muscle-profiles` lỗi; **3 test catalog KHÔNG lỗi** |

**Nguyên nhân thực tế:**
1. **B12 (đã chứng minh)** — lỗi trong **test của tôi**: lấy 40 bài tập `PUBLISHED` đầu theo tên từ catalog dùng chung; `advanced-set-logging` chèn bài tạm `advlog-it-add-…` (không có `movementPattern`) rồi xóa ⇒ `Unable to map … (not_found)`. Sửa: chỉ chọn bài có `movementPattern` (bài catalog thật luôn có — `movement-pattern.test.ts`). Chạy song song cùng các file tạo-bài-tạm 3 lần: B12 **3/3 PASS**. (Đây là sửa hygiene có lý do, không nới timeout/assert.)
2. **`internal-exercise-muscle-profiles`** — cả 2 test thật PASS; file bị `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` của libuv (Windows, `--test-force-exit`); xuất hiện ở HEAD, không ổn định. **Artefact môi trường, không phải mã.**
3. **3 test catalog** (`every exercise has a movementPattern`, `isExerciseAvailable cross-validate`, `every ACTIVE equipment has a mapped exercise`) — **nguyên nhân CHƯA được chứng minh.** Lượt đầu chúng lỗi trên DB dùng chung đã tích lũy dữ liệu (equipment `lat-pulldown-<uuid>`/`cable-<uuid>` do `agent-program-equipment-semantics` seed không kèm exercise; bài không có movementPattern) — phù hợp giả thuyết nhiễm dữ liệu nhưng **không tái hiện được trên DB clone sạch**. Không nên coi là đã giải thích.
**Khuyến nghị (không làm):** DB/schema riêng cho mỗi file hoặc `--test-concurrency=1` + DB sạch trong CI; test không nên đọc "N bài đầu của catalog chung".

## 6. So sánh hồi quy với baseline HEAD

- **fitness-service** (c=1, DB clone): cây 21 lỗi ⊂ HEAD 22 lỗi — **0 lỗi mới**. Sau lượt c=1 tôi chỉ sửa 1 test (B12) và đã chạy lại 3 lần song song.
- **ai-service** (cùng lệnh, cây vs HEAD sạch): chạy **sau** các sửa của lượt này (`src/__tests__/*.test.ts` + `src/llm/__tests__/*.test.ts`, DB `revision_ai_test`, Redis :56379): 2548 test, 2491 pass, 52 lỗi (53 dòng tên) — **0 tên lỗi ngoài tập lỗi HEAD** (HEAD sạch cùng lệnh: 2484 test / 2421 pass / 56 lỗi; `final-ai-fail-HEAD.txt` vs `gate-ai-fail.txt`). Phần lớn là test "(real DB)" của fitness-agent, lỗi y hệt trên HEAD. Lưu ý: glob `*.test.ts` **không** gồm các `*.pg.itest.ts` (chạy riêng bên dưới).
- Suite liên quan chạy riêng sau các sửa của lượt này (`BACKEND INTEGRATION`): `workout-plan-revision.pg.itest` 19/19, `workout-revision-worker.pg.itest` 13/13, `plan-adjust-revision.pg.itest` 4/4, `workout-revision-planner`+`workout-adjustment-constraints`+`fitness-agent-plan-review` 38/38.
- C1–C14 chạy lại **sau** các sửa (`REAL HTTP/API`, `logs/gate-run-c-*.log`): main **23**, fail **37**, compat **12**, market **12** PASS, 0 FAIL. `browser-c.mjs` (UI của owner, `REAL BROWSER`): **14/14**.

## 7. Mobile native — BLOCKED
Không Android SDK/adb/emulator/thiết bị; `jest-expo` hỏng sẵn (thiếu plugin Babel). Không thay bằng unit/API test; không báo PASS. Cần: Android Studio + platform-tools, AVD API 34, `adb` trong PATH, dev-client; sửa jest-expo; chạy luồng Program → gửi PT → PT duyệt → sửa AI → xác nhận outdated. Ngoài ra reviewer ghi nhận mobile chưa gửi `Idempotency-Key`/`expectedVersion` và chip số bài vẫn 1–8.

## 8. Chất lượng với LLM thật — CHƯA LÀM
Toàn bộ dùng model stub. Chưa đo delta/chunk/giữ bài gốc/ngôn ngữ với Bedrock Nova Pro; cần owner duyệt chi phí.

## 9. Phụ thuộc phát hành (RELEASE GATE — không phải quyền deploy)

```
Migration ai (20261120100000) ─┐
Migration fitness (20261119100000) ─┼─► Worker ai MỚI ─► API ai MỚI ─► Gateway(+/plan-reviews) ─► Web/Mobile
Migration user (20261119110000) ─┘                     ▲
                                  fitness-service MỚI ─┘ (API ai gọi import/sync)
Route AWS API Gateway /plan-reviews + notification sweep Lambda  ── cần cho AWS, chưa kiểm
```
Mục chưa làm (liệt kê, không tự thực hiện):
1. Mobile native E2E (§7). 2. Bedrock Nova real-model eval (§8). 3. **AWS Gateway routing** (`/plan-reviews`; `api-gateway-additions.yaml` đang là thay đổi chưa commit của luồng khác). 4. **Notification Lambda sweep** (sweep nhắc review/outbox chạy trên Lambda — chưa kiểm). 5. **Phát hành phối hợp API+worker**: migration → worker mới → API mới; API mới trước worker mới làm mọi revision FAILED (đã trừ quota); rollback API khi còn op mới ⇒ HEAD báo COMPLETED nhầm. 6. Migration compat: additive, HEAD chạy được trên schema mới; migration chưa chạy mà mã mới chạy ⇒ lỗi sau khi tốn LLM. 7. Tối ưu nguyên tử hóa admission revision (C1) + hai tiêu chí C3/C4.
Quy tắc owner: không deploy cho tới khi Multi-Agent hoàn tất.

## 10. READY / NOT READY FOR COMMIT — **NOT READY**
Điều kiện chặn (cần quyết định/đầu vào của người, không tự giải được):
1. **K9** chưa được owner tích hợp/kiểm trên source thật (§3).
2. **B1**: revision đổi số buổi không thể lưu lại vào lịch tập — cần quyết định thiết kế (hoặc chấp nhận ghi rõ là hạn chế đã biết).
3. Patch **C** vẫn NEEDS_CHANGE (C1/C3/C4) và các sửa sau review (A1, R1, R2, C2-guard) **chưa được review lại**; A1 chưa có test riêng.
Ngoài ra trước khi commit: tách file trộn hunk (§2), xử lý `logs*.json`/`cors-before.json`, quyết định generated prisma client.
Nếu owner chấp nhận các mục trên như hạn chế đã biết, phạm vi A+B backend có thể commit riêng theo từng module (không gồm mục C của §2).

## 11. READY / NOT READY FOR RELEASE — **NOT READY**
Chưa có quality gate LLM thật; mobile BLOCKED; K9 chưa ở cây chính; route AWS + notification sweep chưa kiểm; phối hợp worker→API chưa diễn tập; quy tắc "không deploy tới khi Multi-Agent xong".

## 12. Dọn dẹp (Phase 6) và file đổi trong cổng này
- Đã dừng theo PID đã ghi: gateway :3000, auth :3001, ai :3003. Worktree HEAD của tôi đã gỡ (bỏ junction trước), `node_modules` thật còn nguyên; junction của bản sao web đã bỏ.
- **CÒN CHẠY — để chủ quyết định:** :3002 (pid 35628), :3004 (pid 28004), :5173 (pid 25344), :5174 (pid 24200). Do `sh.exe` tạo lúc 16:46–16:49 trong cửa sổ chạy stack/`run-c.mjs` của tôi nên rất có thể là của tôi, nhưng lệnh dừng bị hệ thống chặn và tôi không chứng minh được 100% ⇒ **không dừng, không vòng**.
- DB clone (`p3_review_ai_test`, `p4_*_fitness_test`) còn trong Postgres test; shadow DB đã xóa. Không đụng DEV AutoStop (đã dời 18:00 theo yêu cầu ở lượt trước; chỉ đọc).
- File sửa: `ai.worker.ts` (A1), `conversation.repository.ts` + `plan.controller.ts` (R1/R2/C2-guard), `workout-plan-revision.pg.itest.ts` (test R1/R2), `ai-plan-revision-program-sync.integration.test.ts` (B12), `integration-c/browser-sync.mjs` (viewport/stale/401), patch+spec K9 cập nhật.
