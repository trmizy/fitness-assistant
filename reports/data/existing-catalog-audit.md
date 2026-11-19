# Existing Catalog Audit

Generated: 2026-08-19T15:48:56.064Z
Environment: local dev (gymcoach_fitness via docker-compose)

**Read-only inventory. No data was modified to produce this report.**

## Exercises

| Metric | Value |
|---|---|
| Tổng số bài tập | 883 |
| Có tên tiếng Việt | 0 |
| Chỉ có tên tiếng Anh | 883 |
| Không có mô tả | 5 |
| Không có nhóm cơ | 0 |
| Không có equipment link (bảng ExerciseEquipment) | 0 |
| Không có video/ảnh URL | 10 |
| Có URL ngoài (external hotlink) | 873 |
| Ảnh lỗi | *Not checked in this pass — verifying 873 external image URLs live would require a real network crawl; flagged as a follow-up, not included in this snapshot to avoid an inaccurate zero.* |
| Primary/secondary muscle | *The live schema stores muscleGroupsActivated as a single flat string[] with NO primary/secondary distinction — that distinction only exists in the unimported gym_exercises.csv catalog (primary_muscles / secondary_muscles columns). Cannot be computed from the live DB as-is; a real gap for Gate 4's canonical schema.* |
| Đang được dùng trong workout log | 782 |
| Đang được dùng trong workout program template | 787 |
| Được tham chiếu (log HOẶC program) | 787 |
| Chưa từng được tham chiếu | 96 |
| Xuất hiện trong AI plan | *ai-service stores exerciseId inside JSON plan content (WorkoutPlan.content, PersonalizedServiceOrder.draftContent) — not queryable from fitness-service's own DB without a cross-service JSON scan; flagged as a follow-up requiring an ai-service-side script, not computed here.* |
| Exact duplicate (nhóm) | 0 |
| Near duplicate | *Deferred to Gate 3 (multi-signal duplicate detection design) — not computed in this inventory pass.* |
| ID/slug trùng | *Exercise has no slug field at all today (only Equipment does) — 'ID/slug duplicate' is structurally impossible to check because there is no slug to compare; a real Gate 4 schema gap (canonicalName/slug is in the task's own proposed model).* |
| Không rõ nguồn/license (DB-level) | 883 — *ALL 883 live rows — there is no ExerciseSource/source/license column on the live Exercise model at all. We know from reading seed_exercises_json.ts (file-level provenance, not DB-level) that all but ~10 rows trace to free-exercise-db (Unlicense, image rights undocumented) and ~10 to a hand-authored equipment-gap seed — but the DATABASE itself records none of this today. This is exactly the gap the task's proposed ExerciseSource table exists to close.* |
| Có movementPattern | 883 |
| Có mechanics | 795 |
| Có difficultyLevel | 882 |
| Có contraindications | 0 |

## Foods

| Metric | Value |
|---|---|
| Tổng số food | 13159 |
| Theo nguồn | [{"_count":{"_all":5403},"source":"survey_fndds"},{"_count":{"_all":7756},"source":"sr_legacy"}] |
| Branded food | *0 — no 'branded_food' source value present; only sr_legacy and survey_fndds were ever imported (both generic/ingredient-level USDA data, not manufacturer-branded products).* |
| Recipe | 0 — *No Recipe/RecipeIngredient table exists in the live schema at all — Phase 3's Vietnamese-dish-from-ingredients model has zero implementation today. A real Gate 4 gap, not a partial one.* |
| Có calories = 0 hoặc âm | 0 |
| Có micronutrient | 0 — *No FoodNutrient table — only flat calories/protein/carbs/fats columns exist. No fiber/sodium/sugar/vitamins/minerals stored anywhere for any of the 13,159 rows.* |
| Có serving info | 0 — *Food itself has no serving-size field (values are implicitly per-100g, USDA convention) — serving size only exists per-meal-item (NutritionProgramMealItem.quantity, default 100) not per-food-catalog-entry. No FoodServing-equivalent table.* |
| Có barcode | 0 — *No barcode/GTIN column exists on Food at all.* |
| Có ảnh | 14 (thiếu: 13145) |
| Macro âm | 0 |
| Macro phi thực tế (>100g/100g) | 0 |
| **Calories không khớp macro (Atwater ±50kcal)** | **231 (1.8%)** |
| Duplicate theo tên (nhóm) | 100 |
| Duplicate theo barcode | 0 — *N/A — no barcode field exists.* |
| Duplicate theo source ID (fdcId) | 0 — *fdcId has a DB-level @unique constraint — structurally 0 by construction, not just observed.* |
| Cùng tên, nutrient khác nhau | 35 |
| Đang được meal plan tham chiếu | 24 |
| Xuất hiện trong food log lịch sử | *Structurally 0 by design — NutritionLog stores foodName as free text with NO foodId column at all, so it can never reference the Food catalog by ID. This is itself a notable finding: the historical food-log domain and the catalog domain are already fully decoupled, which is GOOD for catalog-change safety but means food-log entries can never benefit from catalog enrichment (aliases, corrected macros) either.* |
| Đã phân loại foodForm (Part 6, phiên trước) | 2117 |
| Đánh dấu supplement | 249 |
| Tổng FoodAlias | 0 |

### Top 20 duplicate-by-name groups
- "honey" × 2
- "cheese, provolone, reduced fat" × 2
- "bread, oatmeal, toasted" × 2
- "cheese spread, american or cheddar cheese base, reduced fat" × 2
- "cream puff, eclair, custard or cream filled, iced" × 2
- "eggnog" × 2
- "cheese, parmesan, hard" × 2
- "cheese, american, nonfat or fat free" × 2
- "bread, potato" × 2
- "natto" × 2
- "miso" × 2
- "crackers, milk" × 2
- "cheese, cheddar, nonfat or fat free" × 2
- "bread, cinnamon" × 2
- "sour cream, fat free" × 2
- "cheese, cottage, with vegetables" × 2
- "cream, half and half, fat free" × 2
- "peppers, sweet, green, raw" × 2
- "broccoli, raw" × 2
- "cheese, brie" × 2
