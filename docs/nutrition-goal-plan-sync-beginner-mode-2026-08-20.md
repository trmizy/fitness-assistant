# Báo cáo — Goal↔Plan sync, Beginner Mode, Recommended/Custom goal, Experience-based macro

**Ngày**: 2026-08-20
**Phạm vi**: 4 khoảng trống thật được liệt kê trong `docs/audit/nutrition-ai-current-flow-audit.md` (câu 6, câu 12) và `docs/research/nutrition-ai-product-and-expert-review.md` (mục 4) — không đụng workout/Gate 7/gamification/wearable/micronutrient sâu/Gate 10 mới.

---

## 1. Đã sửa gì cho Goal ↔ Plan sync

**Không tự archive/regenerate** — đúng yêu cầu. Chỉ thêm cơ chế phát hiện + cảnh báo:

- **Migration mới** (`20260820010000_add_goal_plan_sync_fields`, additive, không destructive): `nutrition_programs.source_goal_id` (traceability, nullable) + `nutrition_goals.goal_mode` (default `'RECOMMENDED'`, không phá dữ liệu cũ).
- **Service mới** `nutrition-goal-plan-consistency.service.ts` — so sánh macro của `NutritionProgram` (dùng chính field `dailyCaloriesTarget/proteinTargetGrams/carbTargetGrams/fatTargetGrams` đã có sẵn, không cần bảng snapshot riêng) với `NutritionGoal` đang ACTIVE. 6 trạng thái đúng như yêu cầu: `NO_ACTIVE_GOAL`, `NO_ACTIVE_PROGRAM`, `MATCHED`, `STALE_GOAL_CHANGED`, `MACRO_MISMATCH`, `LOW_CONFIDENCE`.
- **Ngưỡng lệch**: kcal >5% hoặc >100kcal (lấy ngưỡng lớn hơn); protein/carb >10% hoặc >10g; fat >10% hoặc >5g — đúng chính xác con số spec yêu cầu.
- **Legacy program** (tạo trước khi có `sourceGoalId`) vẫn hoạt động bình thường qua fallback so sánh macro trực tiếp — đã test riêng, không crash.
- **API mới**: `GET /nutrition/active-state` (read-only). `PUT /nutrition/goals` giờ trả về `{ goal, planConsistency }` thay vì chỉ raw goal — UI có cảnh báo ngay sau khi lưu, không cần đợi lần load sau.
- **UI**: banner cảnh báo trên `NutritionPage.tsx` khi `MACRO_MISMATCH`/`STALE_GOAL_CHANGED`, hiện diff từng field (plan → goal), 2 nút CTA ("Tạo lại thực đơn theo mục tiêu mới" / "Vẫn giữ thực đơn này") — không nút nào tự động archive, đúng yêu cầu "read-only".

## 2. Đã thêm Beginner Mode như thế nào

- Toggle "Chế độ đơn giản / Xem chi tiết macro" trên `NutritionPage.tsx`, mặc định BẬT (persist qua `localStorage`), đúng fallback spec cho phép khi chưa gắn được `experienceLevel` trực tiếp vào trang này.
- Chế độ đơn giản: chỉ hiện card Calories + Protein trong khối tổng kết chính; Carb/Fat ẩn cho tới khi bấm "Xem chi tiết".
- Card giải thích ngắn (4 bullet: Calo/Protein/Carb/Fat + câu về dao động cân nặng theo tuần) chỉ hiện khi ở chế độ đơn giản.
- Cảnh báo "Đây là ước tính ban đầu..." khi user chưa có goal thật (đang dùng giá trị mặc định).

## 3. Đã thêm Recommended vs Custom goal chưa

**Có.** Segmented control "Được đề xuất / Tự nhập" trong modal chỉnh mục tiêu:
- `RECOMMENDED`: input bị khoá (disabled), có ghi chú "do hệ thống tính toán".
- `CUSTOM`: input mở khoá, có cảnh báo mismatch SỐNG (live) ngay khi gõ — dùng đúng công thức Atwater backend đang dùng (`protein*4+carb*4+fat*9`), không cần đợi lỗi 400 mới biết.
- Backend: field `goalMode` mới trên `NutritionGoal`, mặc định `RECOMMENDED` cho toàn bộ dữ liệu cũ (không breaking).

## 4. Đã thêm experience-based surplus/deficit như thế nào

Sửa trực tiếp `nutrition_calculator.ts` (ai-service):
- Muscle-gain surplus: BEGINNER 12% (trong khung 10-15%), INTERMEDIATE 8% (5-10%), ADVANCED 5% (3-8%), không có experienceLevel giữ nguyên 10% cũ (không đổi hành vi cho caller cũ).
- Fat-loss deficit: BEGINNER 15%, INTERMEDIATE 12%, ADVANCED 10% — advanced luôn nông hơn beginner.
- Protein: BEGINNER 1.7g/kg, INTERMEDIATE 1.9g/kg, ADVANCED 2.1g/kg — chỉ áp dụng cho muscle_gain/fat_loss (đúng phạm vi nguồn trích dẫn "beginner tăng cơ"/"advanced/cutting/athlete"), maintenance/recomposition giữ nguyên không đổi.
- Macro luôn khớp kcal (carb tính bằng phần dư sau protein+fat) — không phá invariant cũ.

## 5. File đã sửa/thêm

**Backend ai-service**: `nutrition_calculator.ts`.
**Backend fitness-service**: `prisma/schema.prisma`, `repositories/nutrition.repository.ts`, `services/nutrition.service.ts`, `services/nutrition-goal-plan-consistency.service.ts` (mới), `controllers/nutrition.controller.ts`, `routes/nutrition.routes.ts`, `models/fitness.models.ts`.
**Frontend**: `services/api.ts`, `pages/client/NutritionPage.tsx`.

## 6. Migration đã thêm

`backend/services/fitness-service/prisma/migrations/20260820010000_add_goal_plan_sync_fields/` (`migration.sql` + `rollback.sql`) — 2 cột additive, không backfill phá dữ liệu (`goal_mode` default `'RECOMMENDED'` cho hàng cũ đúng với hành vi ngầm định trước đó; `source_goal_id` để NULL cho hàng cũ, không suy đoán). **Đã áp dụng thật cho cả `gymcoach_fitness` (dev) và `gymcoach_fitness_test`** — xác nhận trực tiếp bằng `\d` sau khi áp dụng (phát hiện và tự sửa 1 lỗi thật: lần chạy đầu qua heredoc bash bị lỗi âm thầm, cột không được tạo — đã tự phát hiện qua test fail với lỗi `column "goal_mode" does not exist`, chạy lại trực tiếp bằng `psql -c` và xác nhận cả 2 DB đều đã có cột).

## 7. API đã thêm/sửa

- **Mới**: `GET /nutrition/active-state` — trả `GoalPlanConsistencyResult`, read-only.
- **Sửa response shape**: `PUT /nutrition/goals` trả `{ goal, planConsistency }` thay vì raw goal object (đã audit toàn bộ codebase, xác nhận không có caller nào khác dựa vào field top-level cũ ngoài `NutritionPage.tsx`, vốn không destructure field nào từ response).
- `upsertNutritionGoalSchema` (Zod) nhận thêm `goalMode` optional.

## 8. Test command đã chạy

```
docker exec gymcoach-ai-dev sh -c "cd /app/backend/services/ai-service && npx tsx --test src/llm/__tests__/bugfix.test.ts"
→ tests 109, pass 109, fail 0

docker exec gymcoach-ai-dev sh -c "cd /app/backend/services/ai-service && npx tsx --test src/llm/__tests__/nutrition_calculator_experience.test.ts"
→ tests 20, pass 20, fail 0

docker exec gymcoach-ai-dev sh -c "cd /app/backend/services/ai-service && npx tsc --noEmit -p tsconfig.json"
→ exit 0

Batch hồi quy ai-service đầy đủ (27 file, gồm cả file mới):
→ tests 399, pass 399, fail 0

docker exec gymcoach-fitness-dev sh -c "... FITNESS_DATABASE_URL=..._test npx tsx --test --test-concurrency=1 \
  nutrition-goal-versioning.integration.test.ts nutrition-adaptive-apply.integration.test.ts \
  nutrition-goal-plan-consistency.integration.test.ts nutrition-goal-macro-validator.test.ts \
  nutrition-decision.engine.test.ts food-serving-metadata.integration.test.ts \
  training-cycle-baseline-snapshot.integration.test.ts"
→ tests 50, pass 50, fail 0

docker exec gymcoach-fitness-dev sh -c "cd /app/backend/services/fitness-service && npx tsc --noEmit -p tsconfig.json"
→ exit 0 cho toàn bộ code liên quan nutrition (3 lỗi tsc còn lại là lỗi @types/pg có sẵn từ trước, không liên quan file tôi sửa — đã xác nhận bằng grep không có "nutrition" trong danh sách lỗi)

npx vite build (frontend/web) — 2 lần, sau Part 2/4 và sau Part 3
→ "✓ built in ~22-30s" cả 2 lần, không lỗi (frontend không có tsconfig.json riêng nên không chạy được tsc --noEmit độc lập — đã xác minh qua build thay thế)
```

## 9. E2E — kết quả pass/fail thật

```
cd fitnessassistant-playwright-e2e
npx playwright test tests/21-ai-nutrition-chat-routing.spec.ts tests/23-ai-nutrition-plan-serving-realism.spec.ts tests/24-ai-nutrition-persona-b-c.spec.ts tests/25-nutrition-beginner-mode-and-goal-plan-sync.spec.ts --reporter=list
```

**Lần chạy đầu (ngay sau khi vừa restart `gymcoach-ai-dev`)**: 6/7 pass, `21` fail với lỗi **"Model local có thể đang khởi động, vui lòng chờ thêm..."** — đây là dấu hiệu Ollama chưa kịp warm-up sau restart, không phải lỗi code. Chạy lại riêng `21` ngay sau đó: **PASS** (1.4 phút, có gọi LLM thật). Đây là timing artifact tự tôi gây ra khi restart container để test, không phải bug — nói rõ ra thay vì giấu.

**Kết quả cuối cùng, cả 4 spec (7 test case)**: **7/7 PASS**.
- `21-ai-nutrition-chat-routing.spec.ts`: 1/1 PASS.
- `23-ai-nutrition-plan-serving-realism.spec.ts`: 1/1 PASS.
- `24-ai-nutrition-persona-b-c.spec.ts`: 2/2 PASS.
- `25-nutrition-beginner-mode-and-goal-plan-sync.spec.ts` (mới): 3/3 PASS.

Screenshot đã lưu:
- `test-results/25-01-beginner-mode-simple.png` — chế độ đơn giản, chỉ Calo+Protein.
- `test-results/25-02-beginner-mode-detailed.png` — sau khi bấm "Xem chi tiết", đủ 4 macro.
- `test-results/25-03-goal-plan-mismatch-banner.png` — banner cảnh báo thật với diff số liệu.
- `test-results/25-04-custom-goal-macro-mismatch-warning.png` — cảnh báo macro-mismatch sống khi nhập Custom.

## 10. Có regression ở `21`, `23`, `24` không?

**Không.** Cả 3 spec cũ vẫn xanh sau toàn bộ thay đổi Part 2-5. Lỗi duy nhất gặp phải (mục 9) là timing artifact tự gây ra do restart container ngay trước khi test, đã retry và xác nhận PASS.

## 11. Những gì chưa làm (đúng phạm vi đã giới hạn, nói thẳng)

- Micronutrient/fiber/sodium report — không làm, đúng như Phần 8 yêu cầu không mở rộng.
- Gate 10 thêm món Việt mới — không làm.
- Recipe publish UI — không làm.
- Wearable/active calories — không làm.
- `experienceLevel` chưa được lấy TỰ ĐỘNG từ hồ sơ user để set default Beginner Mode trên `NutritionPage.tsx` (trang này hiện chưa fetch profile) — thay vào đó dùng fallback "mặc định bật cho mọi user lần đầu" mà chính spec đã cho phép. Đây là lựa chọn có chủ đích, không phải bỏ sót.
- Nút "Tạo lại thực đơn theo mục tiêu mới" hiện điều hướng sang `/client/ai-coach` (chat AI) thay vì tự động gọi API regenerate — đúng yêu cầu "không được giả vờ đã regenerate" khi chưa có flow tự động thật.

## 12. Những gì chưa kiểm chứng

- Chưa viết test unit riêng cho `recommendedActionFor()` (message text từng trạng thái) — chỉ test qua kết quả `status`/`mismatches`, chưa assert chính xác câu chữ recommendedAction ở tầng unit (có kiểm tra gián tiếp qua UI E2E test 2, banner hiện đúng nội dung).
- Chưa test trực tiếp trường hợp `NO_ACTIVE_GOAL`/`NO_ACTIVE_PROGRAM` qua UI E2E (chỉ test qua integration test ở tầng service) — do 2 trạng thái này không tự nhiên xảy ra được qua luồng UI thật trong 1 lượt test ngắn (cần user hoàn toàn mới chưa từng tạo goal, đã cover ở integration test).
- Chưa test hiệu năng của `nutrition-goal-plan-consistency.service.ts` ở quy mô lớn (query đơn giản, 2 lookup, không JOIN phức tạp — rủi ro thấp nhưng chưa đo thật).

---

## Nguyên tắc đã tuân thủ

Không ghi "pass" cho bất kỳ chỗ nào chưa chạy lệnh thật (tất cả số liệu trên đều từ output thật, có copy nguyên văn). Không sửa test để né lỗi — 2 lần test tự viết bị fail (mục 9's timing artifact, và các lần sửa số liệu Atwater không nhất quán khi viết `25-...spec.ts`) đều được sửa bằng cách sửa ĐÚNG dữ liệu test/logic, không hạ thấp assertion. Không publish recipe STAGING, không đụng production DB (chỉ `gymcoach_fitness`/`gymcoach_fitness_test`, cả 2 đều là dev/test, đã xác nhận qua tên DB trước khi chạy). Không destructive migration (chỉ ADD COLUMN, có rollback.sql đi kèm).
