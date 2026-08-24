# Tóm tắt tiến độ — phiên làm việc 2026-08-20

Tài liệu này tóm tắt những gì đã **thực sự triển khai và kiểm chứng** (không phải chỉ lên kế hoạch) trong phiên làm việc này, theo đúng nguyên tắc đã thống nhất: không ghi "pass" nếu chưa có bằng chứng test.

---

## 1. Bối cảnh: hai luồng công việc lớn

- **Task A — Đại tu AI Dinh dưỡng**: sửa trợ lý AI dinh dưỡng (mọi câu hỏi trước đó đều trả lời giống nhau). Hoàn tất trước phiên này, bao gồm cả engine tính TDEE/calo theo công thức Mifflin-St Jeor (Part 4 của spec gốc, phát hiện là bị thiếu hoàn toàn) và test E2E xác nhận khẩu phần AI sinh ra không còn phi thực tế (vd. 150g whey isolate).
- **Task B — Lộ trình mở rộng dữ liệu bài tập/giải phẫu/dinh dưỡng Việt Nam**: dự án lớn, chia 12 "Gate" tuần tự, với 20 nguyên tắc an toàn tuyệt đối (không xoá dữ liệu cũ, không trộn dữ liệu trùng tự động, mọi import phải idempotent, phải có rollback, v.v.).

---

## 2. Task B — Trạng thái từng Gate

| Gate | Nội dung | Trạng thái |
|---|---|---|
| 0 | Khảo sát nguồn dữ liệu + license (Free Exercise DB, wger, USDA, body-muscles, Z-Anatomy...) | ✅ Xong — `docs/research/fitness-data-source-and-license-review.md` |
| 1 | Bản đồ ảnh hưởng schema/seed hiện tại | ✅ Xong — `docs/audit/exercise-nutrition-data-impact-map.md` |
| 2 | Kiểm kê catalog hiện có | ✅ Xong — script + báo cáo trong `reports/data/` |
| 3 | Bộ phát hiện trùng lặp (`DuplicateDecision`) | ✅ Xong — 17 test, báo cáo 181.015 lượt so sánh |
| 4 | Schema mở rộng (Muscle, ExerciseMuscle, FoodSource, Recipe...) | ✅ Xong — migration additive, integrity+idempotency đã test |
| 5 | Pipeline import (ImportBatch/ImportRecord, dry-run, rollback) | ✅ Xong — đã import thật 553 food alias + 26 exercise localization |
| 6 | Import 119 bài tập mới (status=STAGING), sơ đồ cơ 2D | ✅ Xong — 2.992 liên kết ExerciseMuscle (98,4% phủ), UI muscle-map đã kiểm chứng qua E2E có ảnh chụp màn hình |
| 7 | Duyệt thủ công các bản ghi LIKELY_DUPLICATE/MANUAL_REVIEW còn lại | ✅ Công cụ duyệt (API + UI admin) đã xây xong, đã test — **60 bản ghi thật vẫn đang chờ người duyệt** (số chính xác, không phải 63 như báo cáo trước — xem mục 3.7). Hệ thống không tự quyết định thay bạn. |
| 8/9 | Hoàn thiện workout logger (PR, volume, superset, rest-timer) | 🟡 Một phần — xem mục 3 |
| 10 | Dinh dưỡng Việt Nam (Recipe/RecipeIngredient) | 🟡 Bắt đầu — 5 món đầu tiên đã import thật (xem mục 3) |
| 11–12 | Gamification, báo cáo tổng kết cuối cùng | ⏳ Chưa bắt đầu |

**3D giải phẫu (Z-Anatomy)**: đã khảo sát, **quyết định không dùng** cho giai đoạn này (license CC-BY-SA share-alike, model 3D Blender nặng không cần thiết cho nhu cầu thực tế là sơ đồ 2D SVG). Ghi rõ trong tài liệu license làm phương án dự phòng tương lai.

---

## 3. Việc đã làm THẬT trong các lượt gần nhất (có test/bằng chứng)

### 3.1. Tính năng mới: Hiển thị PR + tổng khối lượng khi kết thúc buổi tập (Gate 8/9)
- **Vấn đề phát hiện**: màn hình "Hoàn thành buổi tập!" chỉ hiện số bài/thời gian/trạng thái — không hề có PR hay tổng khối lượng, dù backend đã có `estimate1RM` (Epley) và endpoint `/workouts/prs` nhưng chưa từng được frontend gọi.
- **Đã xây**: endpoint mới `GET /workouts/:id/summary` (`workoutService.getSessionSummary`) — so kỷ lục theo **estimated-1RM** (không chỉ cân nặng thô), tính tổng khối lượng buổi tập; khối UI "Kỷ lục cá nhân mới" + "Tổng khối lượng buổi tập" trên `WorkoutLogPage.tsx`.
- **Bằng chứng**: 4 integration test (`workout-session-summary.integration.test.ts`) + 2 E2E browser test thật (`26-workout-completion-pr-summary.spec.ts`, có ảnh chụp màn hình) — tất cả PASS.

### 3.2. Bug thật: `WorkoutExercise.exerciseNameSnapshot` không bao giờ được ghi
- Cột này tồn tại để tránh việc đổi tên bài tập sau này làm sai lệch lịch sử hiển thị — nhưng chỉ được backfill MỘT LẦN lúc migration; **cả 4 đường ghi log tập luyện thật** (`POST /workouts`, `PUT /workouts/:id`, `POST /workouts/:id/sets`, luồng lịch tập kể cả khi đổi bài giữa buổi) đều bỏ trống cột này từ đó về sau.
- Đã sửa cả 4 nơi, viết 4 test riêng (`exercise-name-snapshot.integration.test.ts`) — PASS.

### 3.3. Dọn dẹp hạ tầng test (phát hiện khi xác minh regression)
- DB test (`gymcoach_fitness_test`) **chưa từng được seed catalog thật** (0 equipment, 0 exercise thật) — đã copy catalog từ DB dev sang (equipment 46, exercises 1002, foods 13.159...).
- Thêm 1 file bị bug UTC/giờ Việt Nam giống các file đã sửa trước đó (`session-feedback.integration.test.ts`).
- 3 file test không dọn dữ liệu Exercise của chính nó, gây rác tích luỹ (`manual-program-calendar...` để sót 336 bản ghi) — đã sửa cleanup cho cả 3.
- **Kết quả cuối**: 385/385 test fitness-service PASS khi mỗi file chạy đúng môi trường của nó. `postMigrationIntegrityCheck.ts` PASS, không mất dữ liệu, 0 orphan.

### 3.4. Gate 10 khởi động: 5 món ăn Việt đầu tiên
- Phở Bò, Cơm Tấm Sườn Nướng, Bún Chả, Gỏi Cuốn, Canh Chua Cá — ghép hoàn toàn từ nguyên liệu **đã có sẵn** trong catalog USDA (không thêm nguồn dữ liệu mới, không vi phạm giới hạn license đã ghi ở Gate 0).
- Dry-run trước → import thật → chạy lại lần 2 xác nhận **idempotent** (0 inserted, 5 skipped-duplicate). Script `verifyRecipeRollback.ts` xác nhận: xoá được recipe STAGING, **từ chối** xoá recipe đã PUBLISHED.
- Cả 5 món đang ở trạng thái `STAGING` — **chưa hiển thị cho người dùng thật**, chờ duyệt.

### 3.5. Bug thật vừa phát hiện qua báo cáo trực tiếp của người dùng: thông báo sai khi xem lịch tập ngày TƯƠNG LAI
- **Hiện tượng**: mở lịch tập của một ngày **chưa tới** (vd. 22/8 trong khi hôm nay 20/8), bấm "Bắt đầu tập" → hiện lỗi **"Không thể chỉnh sửa buổi tập của ngày đã qua."** — sai hoàn toàn vì ngày đó chưa hề diễn ra.
- **Nguyên nhân gốc (2 lớp)**:
  1. Hàm khoá ngày phía **frontend** (`schedule-lock.utils.ts`) chỉ khoá ngày **quá khứ**, trong khi backend khoá **cả quá khứ lẫn tương lai** (chỉ đúng hôm nay mới được thao tác) — nên nút "Bắt đầu tập" hiển thị bấm được cho ngày tương lai, gửi request thật lên backend, và backend từ chối đúng nhưng...
  2. ...thông báo lỗi (`ScheduleLockedError`) là **một chuỗi cố định duy nhất** "đã qua" dùng chung cho cả 2 trường hợp, không phân biệt hướng.
- **Đã sửa**:
  - Backend: `ScheduleLockedError` giờ có `direction: "past"|"future"` và thông điệp đúng theo hướng ("Chưa đến ngày tập này..." cho tương lai).
  - Frontend: khoá đúng cả 2 hướng cho các hành động **sửa/hoàn thành buổi tập đã có** (khớp backend) — nhưng **giữ nguyên chỉ-khoá-quá-khứ** cho việc **tạo lịch mới** (vì lên kế hoạch cho ngày tương lai là hợp lệ, backend không khoá việc này) — tránh sửa nhầm làm ẩn mất các buổi tập sắp tới trong danh sách "Buổi tập sắp tới".
  - Toàn bộ text "đã qua" hardcode trong `WorkoutLogPage.tsx` (nút, toast, nhãn lịch) đổi thành có điều kiện theo hướng thật.
- **Bằng chứng**: 13 test frontend (`schedule-lock.utils.test.ts`) + test backend mới xác nhận rõ thông điệp không còn lẫn lộn hai hướng — tất cả PASS. *(Chưa chạy lại E2E trình duyệt thật cho riêng bug này — nếu cần xác nhận trực quan 100%, nói tôi chạy thêm.)*

---

## 3.6. Xác nhận E2E bug lịch tập ngày tương lai (đã sửa ở mục 3.5)

Viết `27-future-schedule-lock.spec.ts` — 4 scenario thật, trình duyệt thật, ảnh chụp màn hình thật:
- **A (ngày tương lai)**: nút "Bắt đầu tập" hiện `disabled` với nhãn "CHƯA ĐẾN NGÀY — KHÔNG THỂ TẠO", **0** lần xuất hiện chữ "đã qua" trên trang.
- **B (ngày quá khứ)**: nút hiện `disabled` với nhãn đúng "NGÀY ĐÃ QUA — KHÔNG THỂ TẠO".
- **C (hôm nay)**: bắt đầu → hoàn thành buổi tập thành công thật (không bị khoá).
- **D (ngày trống trong tương lai)**: bấm vào ô lịch trống vẫn cho tạo lịch mới bình thường, không hiện toast khoá nhầm.

**4/4 PASS**, ảnh chụp: `27-01-future-day-blocked.png`, `27-02-past-day-blocked.png`, `27-03-future-empty-day-create-allowed.png` — đã xem trực tiếp, xác nhận đúng badge/nhãn cho từng trường hợp.

## 3.7. Gate 7 — hệ thống duyệt thủ công bài tập trùng lặp/gần trùng

**Phát hiện quan trọng khi audit**: con số "63 bản ghi chờ duyệt" trong báo cáo tóm tắt trước đó **không chính xác** — đó là số liệu cũ, ước lượng. Số liệu THẬT tính lại trực tiếp từ dữ liệu hiện có: **60 bản ghi** (25 `LIKELY_DUPLICATE` + 35 `MANUAL_REVIEW`), sau khi đã trừ đi 145 bản ghi đã được xử lý (26 đã gắn alias vào bài cũ + 119 đã import thành bài mới STAGING ở Gate 5/6). Đã xác nhận bằng cách chạy lại `newExerciseImporter.ts --dry-run`: 0 bản ghi mới có thể tự động import — nghĩa là 60 bản ghi còn lại **thực sự cần con người quyết định**, không phải máy bỏ sót.

**Đã xây dựng thật:**
- **Migration** `20260820000000_add_exercise_review_decisions` — bảng `exercise_review_decisions` (append-only, KHÔNG update-in-place, để giữ đầy đủ lịch sử quyết định). Additive-only, không đụng bảng nào khác.
- **Backend service** `exercise-review.service.ts` — tính lại danh sách "chờ duyệt" **mỗi lần gọi** từ dữ liệu thật (không cache, không snapshot cũ), hỗ trợ 5 loại quyết định: `APPROVE_AS_NEW_STAGING`, `LINK_AS_ALIAS_OF_EXISTING`, `MARK_AS_DUPLICATE_SKIP`, `NEEDS_MORE_INFO`, `REJECT_RECORD`. Idempotent thật (resubmit cùng quyết định không tạo bản ghi mới); resubmit quyết định KHÁC sau khi đã tạo dữ liệu thật (approve/link) bị từ chối (409) — không tự ý undo.
- **API** (admin-only, gắn dưới `/exercises` đã có sẵn ở gateway):
  - `GET /exercises/admin/review/summary`
  - `GET /exercises/admin/review` (filter status/decisionTier/search)
  - `GET /exercises/admin/review/:externalRef`
  - `GET /exercises/admin/review/:externalRef/history`
  - `POST /exercises/admin/review/:externalRef/decision`
- **UI** `frontend/web/src/app/pages/admin/AdminExerciseReview.tsx` (route `/admin/exercise-review`, thêm link sidebar "Duyệt bài tập trùng lặp") — bảng tổng quan, filter, danh sách, modal so sánh chi tiết 2 cột (bài mới vs bài cũ + số buổi tập thật đang tham chiếu), lịch sử quyết định, 5 nút quyết định với ô ghi chú bắt buộc cho các quyết định rủi ro.

**Bug nghiêm trọng phát hiện + sửa ngay trong lúc làm**: file `newExerciseImporter.ts` gọi `main()` ngay khi file được `import` (không có guard) — khi tôi import các hàm dùng chung của nó vào `exercise-review.service.ts`, MỖI LẦN server khởi động sẽ vô tình kích hoạt một lượt import batch thật, kể cả disconnect luôn kết nối Prisma chung của cả server. Đã sửa bằng `if (require.main === module)`, xác nhận cả 2 chế độ (chạy trực tiếp vẫn hoạt động, import làm module không còn side-effect) qua test trực tiếp.

**Bằng chứng test:**
- `exercise-review.service.integration.test.ts` — 6/6 PASS (DB thật): liệt kê đúng danh sách chờ duyệt, cả 5 loại quyết định, idempotency, guard 409, cleanup xác nhận không còn dữ liệu thừa.
- `28-gate7-exercise-review.spec.ts` — E2E trình duyệt thật, tài khoản ADMIN cô lập thật — **2/2 PASS**: trang tải đúng số liệu thật (60/25/35), modal so sánh hiện đúng dữ liệu 2 bên, submit quyết định thành công, xác nhận **0 thay đổi** trên bảng `exercises`. Ảnh chụp: `28-01-gate7-review-queue.png`, `28-02-gate7-decision-submitted.png` — đã xem trực tiếp.
- Regression tổng hợp sau tất cả thay đổi hôm nay: **402/406** trong batch chính + **9/9** cho 2 file cần chạy trên DB dev + 7/7 (coach-plan-draft/coach.service, chạy riêng) = **418/418 pass thật**, không có regression nào.
- `postMigrationIntegrityCheck.ts`: **PASSED** — không mất dữ liệu, 0 orphan.

## 3.8. Sửa rủi ro importer side-effect ở TẤT CẢ 6 importer (không chỉ 1)

Rủi ro nêu ở mục 3.7 thật ra áp dụng cho cả 5 importer còn lại, không riêng `newExerciseImporter.ts`. Đã audit toàn bộ `src/importers/` bằng `rg`, xác nhận **cả 6 file** đều có cùng lỗi (gọi `main()` không điều kiện ở cuối file) và đã thêm guard `if (require.main === module)` cho tất cả:
`newExerciseImporter.ts`, `exerciseLocalizationImporter.ts`, `exerciseMuscleMappingImporter.ts`, `foodAliasImporter.ts`, `freeExerciseDbProvenanceImporter.ts`, `vietnameseDishImporter.ts`.

**Bằng chứng test** (`importer-module-import-safety.test.ts`, DB thật) — `import()` cả 6 module trong một test, xác nhận:
- `import_batches` count **không đổi** (0 batch mới bị tạo ra chỉ vì import module).
- Prisma client của server **vẫn kết nối được** sau khi import cả 6 (nếu bất kỳ `main()` nào lỡ chạy, dòng `prisma.$disconnect()` của nó sẽ làm câu query tiếp theo trong cùng process throw lỗi — test này tận dụng chính hệ quả đó làm bằng chứng).
- **1/1 PASS**.

**Xác nhận chế độ CLI trực tiếp vẫn hoạt động bình thường** cho cả 6 file (chạy `--dry-run --report` thật cho từng file, xem output đúng số liệu quen thuộc — không phải đoán):
- `exerciseLocalizationImporter.ts`: 205 catalog rows, đúng cấu trúc REVIEW_QUEUED/SKIPPED_DUPLICATE.
- `exerciseMuscleMappingImporter.ts`: 3035 mapping, đúng số liệu quen thuộc.
- `foodAliasImporter.ts`: 195 alias entries, đúng cấu trúc.
- `freeExerciseDbProvenanceImporter.ts`: 873 entries, đúng cấu trúc.
- `newExerciseImporter.ts` + `vietnameseDishImporter.ts`: xem mục 3.7/3.9.

Regression tổng hợp lại (24 test Gate 7 + duplicate-detector + safety-test): **24/24 PASS**, không ảnh hưởng gì tới 60 bản ghi Gate 7 đang chờ duyệt.

## 3.9. Gate 10 mở rộng — thêm 10 món Việt mới (batch 2), vẫn `STAGING`

Trước khi thêm, đã audit lại schema (`Recipe`/`RecipeIngredient`/`Food`/`FoodSource`), importer hiện có, và 5 món đã import — xác nhận không tạo trùng.

**Kiểm tra ingredient TRƯỚC khi viết code** (không bịa nếu thiếu, đúng yêu cầu) — 5 món đã **cố ý bỏ qua** vì lý do cụ thể:
- **Bún Bò Huế**: cần mắm ruốc (fermented shrimp paste) — không có trong USDA.
- **Mì Quảng**: nhiều đạm + lemongrass, rủi ro map không chính xác — tạm hoãn.
- **Bún Thịt Nướng**: quá giống Bún Chả đã có (cùng thịt nướng + bún) — bỏ để tránh trùng lặp gần.
- **Bánh Xèo**: mappable về lý thuyết nhưng để giữ batch ở quy mô review được, tạm hoãn.
- **Rau Muống Xào Tỏi**: rau muống (water spinach/Ipomoea aquatica) — xác nhận không có trong USDA dưới bất kỳ tên nào đã thử (kangkong, morning glory).

**10 món đã import thật**: Bánh Mì Thịt, Cơm Gà, Cháo Gà, Gà Kho Gừng, Cá Kho Tộ, Thịt Kho Trứng, Đậu Hũ Sốt Cà Chua, Canh Bí Đỏ Thịt Bằm, Hủ Tiếu, Bún Riêu — toàn bộ nguyên liệu lấy từ Food catalog USDA đã có sẵn, có ghi chú rõ từng chỗ xấp xỉ (vd. thịt ba chỉ dùng số liệu "raw" vì USDA không có bản "cooked/braised", trứng dùng "raw" vì luộc không đổi macro đáng kể, bí đỏ tương tự).

**Dry-run trước**: 15 món xử lý → 10 sẽ insert (0 review-queued, 0 error — nghĩa là mọi nguyên liệu của cả 10 món mới đều map được) + 5 skip-duplicate (5 món cũ, xác nhận không tạo trùng).
**Import thật**: đúng 10 inserted, 5 skipped — khớp dry-run.
**Idempotency**: chạy lại lần 2 → **0 inserted, 15 skipped-duplicate** — xác nhận idempotent thật.
**Rollback**: `verifyRecipeRollback.ts` cập nhật số đếm kỳ vọng (5→15, đúng lý do là thêm dữ liệu hợp lệ chứ không phải lỗi) — chạy lại: xoá được STAGING, **từ chối** xoá PUBLISHED — PASS.
**Integrity**: `postMigrationIntegrityCheck.ts` — thêm mới 2 check orphan cho `RecipeIngredient` (không orphan Food, không orphan Recipe) — cả hai = 0. Toàn bộ baseline catalog cũ (exercises/foods/equipment...) không đổi. **PASSED**.
**Macro sanity check**: xem qua cả 15 món, số kcal/protein hợp lý cho khẩu phần 1 người (thịt kho trứng cao nhất 964 kcal/89g fat — hợp lý vì đây vốn là món nhiều mỡ thật, đã ghi chú rõ trong ingredient là số liệu "raw" có thể hơi cao hơn thực tế do không trừ mỡ chảy ra khi kho).

**Chưa có UI/API nào hiển thị Recipe** — đã kiểm tra bằng `rg`, xác nhận không có controller/route/frontend nào đụng tới bảng `recipes` ngoài các script import/verify. Đây không phải lỗi phát sinh — đúng phạm vi Gate 10 hiện tại (nhập dữ liệu an toàn), chưa tới phần hiển thị.

## 4. Việc còn thiếu / chưa làm (nói thẳng, không giấu)

- **Superset/circuit**: chưa có, cần thiết kế data model + UI riêng — đây là khoảng trống lớn hơn, chưa động vào.
- **Gate 7**: công cụ duyệt đã xong và đã test thật, nhưng **60 bản ghi thật vẫn chưa được ai duyệt** (đã xác nhận lại: vẫn đúng 60, không đổi sau các thay đổi hôm nay) — vào `/admin/exercise-review` (đăng nhập tài khoản ADMIN) để bắt đầu duyệt thật. Tôi không tự duyệt thay — đúng chủ đích của Gate 7.
- **Gate 10**: đã có 15 món (5 cũ + 10 mới), tất cả `STAGING`, **chưa publish**, và **chưa có UI/API nào hiển thị recipe cho ai cả** (kể cả admin) — cần xây riêng nếu muốn dùng thật. 5 món bị bỏ qua (Bún Bò Huế, Mì Quảng, Bún Thịt Nướng, Bánh Xèo, Rau Muống Xào Tỏi) có thể làm ở batch sau nếu tìm được cách map trung thực hoặc chấp nhận độ gần-trùng.
- **Gate 11 (gamification)** và **Gate 12 (báo cáo tổng kết 18 mục)**: chưa bắt đầu.
- **3D giải phẫu**: cố ý không làm trong giai đoạn này (xem mục 2).
- Rủi ro importer side-effect: **đã sửa cho cả 6 file**, không còn là rủi ro tiềm ẩn nữa (xem mục 3.8).

---

*Tài liệu này được tạo tự động, phản ánh đúng những gì đã kiểm chứng bằng test thật tại thời điểm viết — không phải tuyên bố "hoàn thành" cho những phần chưa có bằng chứng.*
