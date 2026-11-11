# Phase 4.3 — Normalized nutrition target vs actual + `CoachStateV0.nutrition`

Nhãn bằng chứng: `CODE AUDIT` (ngữ nghĩa nguồn dữ liệu) · `TEST FIXTURE` (unit/dựng tay) · `BACKEND INTEGRATION` (đường ghi thật của `nutritionService` trên Postgres `*_test` cô lập) · `REAL HTTP/API` (ai-service reader → fitness-service thật → auth-service thật, cục bộ, DB test). Không có `REAL BROWSER`. 0 LLM call. Chưa nối vào hội thoại.

## 1. Starting data problem
Audit Phase 4: adherence hiện có (`computeNutritionConsistencyScore`) chỉ đọc `NutritionMealCompletion.consumedCalories`, bỏ qua `NutritionLog`, chỉ calories. `getDailyConsumptionHistory` (7 ngày, AI chat context) tái dùng `getDailyTask.dailySummary`, trong đó bữa chưa xác nhận được tính **tạm thời bằng món trong kế hoạch** — tức "kế hoạch" bị đọc như "đã ăn". Cần một biểu diễn thật sự: mục tiêu ≠ thực tế.

## 2. Nutrition source semantics (CODE AUDIT)
**NutritionGoal** (`nutrition_goals`): versioned; một dòng `ACTIVE` mỗi user (partial unique index); phiên bản cũ `SUPERSEDED` với `validFrom/supersededAt`; migration backfill `validFrom = created_at`. Current target = `nutritionRepository.findGoalByUserId` (chỉ `status='ACTIVE'`). Không có dòng ⇒ không có target (placeholder DEFAULT của `GET /nutrition/goals` không phải dòng DB, không dùng).

**NutritionLog** (`nutrition_logs`): nhật ký tự do. Ghi: `POST /nutrition`, `applyFoodSuggestion`, meal-log từ chat. Trường: `date` (timestamp, thường date-only UTC), `mealType` (chuỗi thường: breakfast/lunch/dinner/snack), `foodName`, `calories` (Int, bắt buộc), `protein/carbs/fats` (**nullable**), `createdAt`. Không có `mealId`/`programId`. Sửa: `PATCH /nutrition/:id` (mealType/foodName/calories/macro/notes; không sửa `date`); xoá: `DELETE /nutrition/:id` (hard delete).

**NutritionMealCompletion** (`nutrition_meal_completions`): gắn `mealId` (kế hoạch) + `logDate` (date-only UTC), unique `(userId, mealId, logDate)`. `status` PENDING/COMPLETED/PARTIAL/SKIPPED, `percentConsumed`, `consumed*` (nullable cột nhưng luôn được ghi số). Ghi: `upsertMealCompletion`; xoá: `deleteMealCompletion`. Chỉ tồn tại khi user có chương trình dinh dưỡng.

## 3. Target vs actual boundary
Target = `NutritionGoal` (và target của chương trình chỉ là phái sinh). Actual = chỉ những gì user xác nhận đã ăn: completion COMPLETED/PARTIAL (số tiêu thụ), SKIPPED (số 0 tường minh), hoặc một dòng NutritionLog. **Món trong kế hoạch, PENDING, hoặc bữa chưa có completion không bao giờ là actual** (khác với dashboard, vốn hiển thị tạm thời).

## 4. MealCompletion vs NutritionLog — có biểu diễn cùng một bữa ăn ở cả hai nguồn không? **CÓ**
`upsertMealCompletion` tính `consumed*` bằng `plan items + NutritionLog cùng mealType cùng ngày` (chế độ phần trăm, nhân hệ số) ⇒ snapshot **đã chứa** các log tồn tại lúc đó. Chế độ override: snapshot = số user nhập, không cộng log. Log tạo sau đó không nằm trong snapshot. Không có khoá nối log↔completion ngoài `(ngày, mealType)`.

## 5. Deduplication policy (deterministic, theo luật sẵn có của dashboard)
Theo từng `(ngày UTC, mealType key)`:
| Trạng thái | Actual |
|---|---|
| completion SKIPPED | 0 tường minh; log cùng mealType bị bỏ qua (luật sản phẩm) |
| COMPLETED / PARTIAL | snapshot `consumed*` **+** log `createdAt > max(completion.updatedAt)` (log trước đó đã nằm trong snapshot hoặc bị override thay thế) |
| PENDING / không có completion | chỉ NutritionLog |
| log mealType không có trong kế hoạch ngày đó | NutritionLog |
Không dedupe theo tên món. Giới hạn đã biết: hai bữa kế hoạch cùng `mealType` trong một ngày cùng chứa log trong snapshot (hành vi hiện có của upsert); log sửa sau snapshot (chế độ phần trăm) vẫn mang giá trị cũ trong snapshot.

## 6. Window semantics
Mặc định 28 ngày, 7–90, số nguyên (ngoài khoảng ⇒ 400). `from` = 00:00Z của ngày UTC cách `asOf` `days-1` ngày (bao gồm), `to` = `asOf`; bản ghi sau `asOf` bị loại; ngày nhóm theo ngày UTC của `date`/`logDate`; ngày trống là `NO_DATA` (có mặt trong danh sách ngày). **Giới hạn: UTC, chưa có timezone người dùng** (giống Phase 4.1).

## 7. Data completeness
Mỗi ngày: `state` LOGGED/NO_DATA; `coverage` theo chiều (calories/protein/carbs/fat) COMPLETE/PARTIAL/NONE (PARTIAL = tổng là cận dưới); `completeness` COMPLETE (mọi bữa của ngày kế hoạch có bản ghi) / PARTIAL / COVERAGE_UNKNOWN (chỉ nhật ký — không có ngày kế hoạch để đối chiếu) / NO_DATA. Macro thiếu **không** thành 0: log `null` = thiếu; completion có `calories>0` mà cả ba macro = 0 được coi "không cung cấp" (đó chính xác là thứ `upsertMealCompletion` ghi khi user chỉ nhập calo) — heuristic có ghi chú, nhãn `PRODUCT_HEURISTIC`.

## 8. DataQuality
Dùng chung tập trạng thái với training: `SUFFICIENT | PARTIAL | INSUFFICIENT_HISTORY | NO_DATA | STALE`.
- `NO_DATA`: không có actual trong cửa sổ, không có trước đó. `STALE`: không có trong cửa sổ nhưng có log/completion trước cửa sổ.
- `INSUFFICIENT_HISTORY`: < 2 ngày có dữ liệu (cấu trúc: chưa thể lấy trung bình).
- `SUFFICIENT`: cửa sổ ≥ `minimumCycleDays` (28) **và** ngày có dữ liệu / ngày cửa sổ ≥ `nutritionAdaptive.minAdherenceForAdjustment` (0,7) **và** ≥ 2 ngày calo đầy đủ — cổng sẵn có của engine adaptive; không phải ngưỡng khoa học.
- `PARTIAL`: còn lại.

## 9. Calorie analytics
`actual.summary.calories` = trung bình trên các ngày coverage COMPLETE. `adherence.calories` = `comparedDays, averageTarget, averageActual, averageDelta (actual−target, có dấu), averageAbsoluteDelta`. Mỗi ngày so với **phiên bản target có hiệu lực ngày đó** (target đổi trong cửa sổ ⇒ `targetChangedInWindow`). Không có nhãn tốt/xấu hay "trong dung sai" vì không có dung sai thẩm quyền cho calo-vs-target (chỉ có dung sai kcal cho macro-vs-calo và gate 0,7 cho điều chỉnh).

## 10. Protein analytics
Trung bình chỉ trên ngày protein COMPLETE; `partialDays` đếm ngày thiếu một phần; `adherence.protein` cùng dạng. Không suy protein từ calo.

## 11. Carb / fat
Cùng cơ chế; trả `null` khi không ngày nào đủ coverage (smoke: carbs/fat đủ dữ liệu ⇒ có; trong test thiếu fat ⇒ `averageG: null`, `adherence.fat: null`).

## 12. Endpoint architecture
fitness-service sở hữu toàn bộ chuẩn hoá: `GET /nutrition/analytics/window?days=` (authMiddleware, không tham số userId, chỉ đọc, không migration). ai-service không join bảng, không tự tính.

## 13. Enterprise Data integration
`nutritionAnalyticsReader.getNutritionAnalytics(identity, {days})` → `AuthoritativeRead<NutritionAnalyticsWindow>`: `ok` (kể cả cửa sổ NO_DATA — đó là câu trả lời đúng), `absent` (404), `error` (mạng/HTTP/shape sai). Có guard cấu trúc.

## 14. `CoachStateV0.nutrition`
```ts
CoachStateV0 = { asOf; goal?; training?; nutrition? }
nutrition = { period; activeTarget /* ACTIVE_TARGET{goalId,calories,protein,carbs,fat,validFrom,triggeredBy} | NO_ACTIVE_TARGET */;
              targetChangedInWindow; actual /* summary */; adherence; dataQuality }
```
`training` chuyển sang optional (`TrainingCoachState` = có training; đường trả lời Phase 4.2 dùng kiểu này). Không placeholder body/sleep/HRV; không signal kê đơn (`CALORIES_TOO_HIGH`… không tồn tại).

## 15. Demand-driven context
`ContextNeed` mới `NUTRITION_COACH_STATE`. `getCoachStateV0` nhận `includeTraining` (mặc định true — giữ hành vi 4.1), `includeNutrition` (mặc định false), `includeGoal`. Training-only không gọi nutrition; nutrition-only không gọi training; cả hai ⇒ mỗi endpoint một lần. Slice được yêu cầu mà lỗi ⇒ cả read là `error` (không bỏ lẻ slice).

## 16. Cross-user isolation
Danh tính chỉ từ token. Test: B không thấy `goalId`/số của A (unit ai-service + DB integration + smoke với hai user thật).

## 17. HTTP smoke — REAL HTTP/API (cục bộ)
auth-service (3991) + fitness-service (3992) trên `gymcoach_*_test`, JWT thật. Qua `getCoachStateV0({includeNutrition})` của ai-service:
- A (target 2000/150 + 24 ngày × 2 log; protein ở 20 ngày): `SUFFICIENT`, 24 ngày, TB 2000 kcal, Δ 0, |Δ| 100; protein TB 140 g trên 20 ngày, Δ −10.
- B (chỉ target): `NO_DATA`, `NOT_AVAILABLE_NO_ACTUAL`. C (không gì): `NO_ACTIVE_TARGET`, `NO_DATA`. D (token sai): `error`.
Seed/user đã xoá; tiến trình dừng; `postgres-test` dừng. (Lưu ý vận hành: tiến trình smoke của Phase 4.2 còn sót chiếm cổng 3992 và làm lượt đầu trả 404 — đã phát hiện và dừng; không ảnh hưởng kết quả cuối.)

## 18. Query / performance
Mỗi request: completions (1 `findMany` + quan hệ lồng gom theo batch của Prisma), logs 1, goals 1 (song song), thêm tối đa 2 `findFirst` khi cửa sổ trống (STALE). Không theo ngày/bữa/món. Smoke: 48 log/24 ngày ⇒ ~190 ms (lượt đầu, lạnh); window 28 ngày trong thiết kế tối đa vài trăm bản ghi. Không cache.

## 19. Focused tests
- `fitness-service/.../nutrition-analytics-window.test.ts` 14/14 (target-only, actual-without-target, calo đủ, protein + thiếu protein, macro một phần, overlap snapshot/log, SKIPPED, PENDING không là actual, override calo-only, completeness, STALE/NO_DATA/INSUFFICIENT/PARTIAL/SUFFICIENT, cửa sổ, đổi phiên bản target).
- `...nutrition-analytics-window.integration.test.ts` 2/2 (đường ghi thật: override + log trước/sau, xoá log, đổi phần trăm, huỷ completion, sửa/xoá log, biên cửa sổ trước/sau, cross-user, STALE).
- `ai-service/.../coach-state-nutrition.test.ts` 11/11 (reader, demand-driven, target/actual tách biệt, NO_DATA/STALE, upstream failure, cross-user, 0 LLM).

## 20. Regression tests (scoped)
fitness-service: 18 file `*nutrition*` ⇒ 147/156; 9 fail đều ở `nutrition-food-substitution.engine` và `nutrition-agent.service.integration` (kết quả `NO_CANDIDATE` — liên quan catalog thực phẩm/engine thay thế trong DB test, không phải code Phase 4.3). Phase 4.1 `training-analytics-window` unit + integration pass. ai-service: coach-state 4.1/4.2/4.3, enterprise-data-layer, context-assembler 64/64; CI-V2 global/unified/bounded-turn/revision/phase3-r1/readers 84/84. `tsc --noEmit` sạch cả hai service.

## 21. Intentional behavior changes
Không có thay đổi hiển thị với người dùng. Route mới read-only; type `CoachStateV0.training` thành optional (đường training giữ nguyên hành vi). Không đổi nutrition conversation, sinh kế hoạch, ghi NutritionGoal, workflow xác nhận; không đổi `computeNutritionConsistencyScore` hay `daily-history`.

## 22. Remaining gaps
- `computeNutritionConsistencyScore` (engine cycle) và `daily-history` vẫn dùng nguồn/luật cũ (provisional) — chưa chuyển sang biểu diễn chuẩn hoá để tránh đổi quyết định cycle.
- UTC thay vì timezone người dùng.
- Chưa đo tần suất/tin cậy của "ghi đủ cả ngày" ngoài kế hoạch (diary-only ⇒ `COVERAGE_UNKNOWN`).
- Không có serving/foodId trong NutritionLog nên không đối chiếu theo món; log sửa sau snapshot phần trăm chưa phản ánh.
- Chưa có dung sai thẩm quyền cho calo-vs-target; chưa có tín hiệu kê đơn (cố ý).
- Chưa nối vào hội thoại; chưa kết hợp cân nặng/InBody để phản hồi năng lượng.

## 23. Recommended Phase 4.4
Goal/gap/trajectory (audit §28 bước 4): ghép `CoachStateV0.nutrition` với xu hướng cân nặng/InBody có chất lượng dữ liệu sẵn có (`weight-trend.util`, `inbody-quality.evaluator`) thành một slice `goal/body` descriptive, trước khi có bất kỳ phản hồi kê đơn nào. Song song (độc lập, rủi ro thấp): đọc `nutrition` qua `READ_STATE` giống cách Phase 4.2 đã làm cho training.
