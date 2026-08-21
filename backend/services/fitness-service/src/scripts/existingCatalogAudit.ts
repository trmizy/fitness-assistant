/**
 * Gate 2 deliverable — read-only inventory audit of the EXISTING exercise
 * and nutrition catalogs. Writes reports/data/existing-catalog-audit.json
 * and .md at the repo root. Does not write to the database in any way.
 *
 * Run inside the fitness-service container (cwd
 * /app/backend/services/fitness-service):
 *   npx tsx src/scripts/existingCatalogAudit.ts
 *
 * Re-run anytime — purely a read-only snapshot, safe to run repeatedly and
 * safe to run against a DB that has since changed (e.g. after Gate 5+
 * imports, to compare before/after).
 */
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../repositories/prisma";

const VN_DIACRITIC_RE = /[À-ỹ]/;
const ATWATER = { protein: 4, carb: 4, fat: 9 };
const CALORIE_TOLERANCE_KCAL = 50; // same convention as ai-service's nutrition_engine.ts

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function auditExercises() {
  const all = await prisma.exercise.findMany({
    select: {
      id: true,
      exerciseName: true,
      instructions: true,
      muscleGroupsActivated: true,
      typeOfEquipment: true,
      videoUrl: true,
      movementPattern: true,
      mechanics: true,
      difficultyLevel: true,
      contraindications: true,
    },
  });

  const total = all.length;
  const withVietnameseName = all.filter((e) => VN_DIACRITIC_RE.test(e.exerciseName)).length;
  const withEnglishOnlyName = total - withVietnameseName;
  const withNoDescription = all.filter((e) => !e.instructions || e.instructions.trim().length === 0).length;
  const withNoMuscleGroups = all.filter((e) => e.muscleGroupsActivated.length === 0).length;
  const withVideoUrl = all.filter((e) => e.videoUrl != null).length;
  const withNoVideoUrl = total - withVideoUrl;
  const withExternalUrl = all.filter((e) => e.videoUrl && /^https?:\/\//.test(e.videoUrl)).length;
  const withMovementPattern = all.filter((e) => e.movementPattern != null).length;
  const withMechanics = all.filter((e) => e.mechanics != null).length;
  const withDifficulty = all.filter((e) => e.difficultyLevel != null).length;
  const withContraindications = all.filter((e) => e.contraindications.length > 0).length;

  // Exact duplicate detection (case/whitespace-insensitive name match) —
  // near-duplicate/variant detection is Gate 3's job (multi-signal, must
  // not auto-merge), this is deliberately the narrow exact-match case only.
  const byName = new Map<string, string[]>();
  for (const e of all) {
    const key = normalizeName(e.exerciseName);
    const arr = byName.get(key) ?? [];
    arr.push(e.id);
    byName.set(key, arr);
  }
  const exactDuplicateGroups = [...byName.entries()].filter(([, ids]) => ids.length > 1);

  // Referenced-by-history / referenced-by-program-template, computed
  // separately (the impact map combined them; this report keeps them
  // distinct per the task's explicit ask).
  const workoutExerciseRefs = await prisma.workoutExercise.groupBy({ by: ["exerciseId"] });
  const programExerciseRefs = await prisma.workoutProgramExercise.groupBy({ by: ["exerciseId"] });
  const referencedInWorkoutLog = new Set(workoutExerciseRefs.map((r) => r.exerciseId));
  const referencedInProgram = new Set(programExerciseRefs.map((r) => r.exerciseId));

  // Equipment linkage via the granular ExerciseEquipment table (distinct
  // from the coarse typeOfEquipment enum column, which is always
  // populated by construction and therefore not a useful "missing
  // equipment" signal on its own).
  const equipmentLinkRefs = await prisma.exerciseEquipment.groupBy({ by: ["exerciseId"] });
  const withEquipmentLink = new Set(equipmentLinkRefs.map((r) => r.exerciseId));
  const withNoEquipmentLink = total - withEquipmentLink.size;

  return {
    totalExercises: total,
    withVietnameseName,
    withEnglishOnlyName,
    withNoDescription,
    withNoMuscleGroups,
    withNoEquipmentLink,
    withNoVideoUrl,
    withVideoErrorsNote:
      "Not checked in this pass — verifying 873 external image URLs live would require a real network crawl; flagged as a follow-up, not included in this snapshot to avoid an inaccurate zero.",
    withExternalUrl,
    primaryVsSecondaryMuscleNote:
      "The live schema stores muscleGroupsActivated as a single flat string[] with NO primary/secondary distinction — that distinction only exists in the unimported gym_exercises.csv catalog (primary_muscles / secondary_muscles columns). Cannot be computed from the live DB as-is; a real gap for Gate 4's canonical schema.",
    referencedInWorkoutLog: referencedInWorkoutLog.size,
    referencedInProgramTemplate: referencedInProgram.size,
    referencedInEitherWorkoutOrProgram: new Set([...referencedInWorkoutLog, ...referencedInProgram]).size,
    neverReferenced: total - new Set([...referencedInWorkoutLog, ...referencedInProgram]).size,
    referencedInAiPlanNote:
      "ai-service stores exerciseId inside JSON plan content (WorkoutPlan.content, PersonalizedServiceOrder.draftContent) — not queryable from fitness-service's own DB without a cross-service JSON scan; flagged as a follow-up requiring an ai-service-side script, not computed here.",
    exactDuplicateNameGroups: exactDuplicateGroups.length,
    exactDuplicateNameSamples: exactDuplicateGroups.slice(0, 20).map(([name, ids]) => ({ name, ids })),
    nearDuplicateNote: "Deferred to Gate 3 (multi-signal duplicate detection design) — not computed in this inventory pass.",
    idOrSlugDuplicateNote:
      "Exercise has no slug field at all today (only Equipment does) — 'ID/slug duplicate' is structurally impossible to check because there is no slug to compare; a real Gate 4 schema gap (canonicalName/slug is in the task's own proposed model).",
    unknownSourceOrLicense: total,
    unknownSourceOrLicenseNote:
      "ALL 883 live rows — there is no ExerciseSource/source/license column on the live Exercise model at all. We know from reading seed_exercises_json.ts (file-level provenance, not DB-level) that all but ~10 rows trace to free-exercise-db (Unlicense, image rights undocumented) and ~10 to a hand-authored equipment-gap seed — but the DATABASE itself records none of this today. This is exactly the gap the task's proposed ExerciseSource table exists to close.",
    withMovementPattern,
    withMechanics,
    withDifficultyLevel: withDifficulty,
    withContraindications,
  };
}

async function auditFoods() {
  const total = await prisma.food.count();
  const bySource = await prisma.food.groupBy({ by: ["source"], _count: { _all: true } });
  const withImage = await prisma.food.count({ where: { imageUrl: { not: null } } });
  const withZeroOrNegativeCalories = await prisma.food.count({ where: { calories: { lte: 0 } } });
  const withNegativeMacro = await prisma.food.count({
    where: { OR: [{ protein: { lt: 0 } }, { carbs: { lt: 0 } }, { fats: { lt: 0 } }] },
  });
  // "Phi thực tế" (unrealistic) macro sanity bound: no macro should exceed
  // 100g per 100g of food (a physical impossibility for a single macro
  // alone, though a food can rightly be ~100% one macro, e.g. pure sugar
  // or oil — the bound is intentionally >=100 not >100 to allow that).
  const withUnrealisticMacro = await prisma.food.count({
    where: { OR: [{ protein: { gt: 100 } }, { carbs: { gt: 100 } }, { fats: { gt: 100 } }] },
  });

  const foodsWithForm = await prisma.food.count({ where: { foodForm: { not: null } } });
  const supplementFoods = await prisma.food.count({ where: { isSupplement: true } });
  const totalAliases = await prisma.foodAlias.count();

  const referencedMealItemRefs = await prisma.nutritionProgramMealItem.groupBy({
    by: ["foodId"],
    where: { foodId: { not: null } },
  });

  // Macro/calorie consistency (Atwater 4/4/9), same tolerance convention as
  // ai-service's nutrition_engine.ts checkMacroCalorieConsistency — run
  // directly against all 13k+ rows via SQL for speed rather than pulling
  // every row into node.
  const inconsistentRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    SELECT COUNT(*)::bigint AS count FROM foods
    WHERE ABS((protein * ${ATWATER.protein} + carbs * ${ATWATER.carb} + fats * ${ATWATER.fat}) - calories) > ${CALORIE_TOLERANCE_KCAL}
  `);
  const macroCalorieInconsistentCount = Number(inconsistentRows[0]?.count ?? 0);

  // Duplicate-by-exact-name (case-insensitive) — a real signal given no
  // FoodAlias-driven canonicalization exists yet for the base catalog.
  const dupeByNameRows = await prisma.$queryRawUnsafe<{ name: string; cnt: bigint }[]>(`
    SELECT LOWER(TRIM(name)) AS name, COUNT(*)::bigint AS cnt
    FROM foods GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) > 1
    ORDER BY cnt DESC LIMIT 20
  `);
  const dupeByNameTotalRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT LOWER(TRIM(name)) AS name FROM foods GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) > 1
    ) t
  `);

  // Same name, different macros — a stricter and more actionable signal
  // than plain name duplication (a same-name-same-macro pair is a much
  // more obvious "just the same row twice" case).
  const sameNameDifferentMacroRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT LOWER(TRIM(name)) AS name
      FROM foods
      GROUP BY LOWER(TRIM(name))
      HAVING COUNT(*) > 1 AND COUNT(DISTINCT (calories, protein, carbs, fats)) > 1
    ) t
  `);

  return {
    totalFoods: total,
    genericFoodsBySourceType: bySource,
    brandedFoodsNote: "0 — no 'branded_food' source value present; only sr_legacy and survey_fndds were ever imported (both generic/ingredient-level USDA data, not manufacturer-branded products).",
    recipeCount: 0,
    recipeNote: "No Recipe/RecipeIngredient table exists in the live schema at all — Phase 3's Vietnamese-dish-from-ingredients model has zero implementation today. A real Gate 4 gap, not a partial one.",
    withCalories: total, // calories is a non-nullable Float column — always "has" a value; zero/negative tracked separately below
    withZeroOrNegativeCalories,
    withMacroColumns: total, // protein/carbs/fats default to 0, always technically "present" — see calorie/macro consistency check for the real signal
    withMicronutrients: 0,
    micronutrientNote: "No FoodNutrient table — only flat calories/protein/carbs/fats columns exist. No fiber/sodium/sugar/vitamins/minerals stored anywhere for any of the 13,159 rows.",
    withServingInfo: 0,
    servingNote: "Food itself has no serving-size field (values are implicitly per-100g, USDA convention) — serving size only exists per-meal-item (NutritionProgramMealItem.quantity, default 100) not per-food-catalog-entry. No FoodServing-equivalent table.",
    withBarcode: 0,
    barcodeNote: "No barcode/GTIN column exists on Food at all.",
    withSource: total, // source is non-nullable
    withImage,
    withNoImage: total - withImage,
    withNegativeMacro,
    withUnrealisticMacro,
    macroCalorieInconsistentCount,
    macroCalorieInconsistentPct: Math.round((macroCalorieInconsistentCount / total) * 1000) / 10,
    servingSizeZeroNote: "N/A — Food has no per-catalog-entry serving-size field to be zero (see servingNote above).",
    duplicateByNameGroups: Number(dupeByNameTotalRows[0]?.count ?? 0),
    duplicateByNameSamples: dupeByNameRows.map((r) => ({ name: r.name, count: Number(r.cnt) })),
    duplicateByBarcode: 0,
    duplicateByBarcodeNote: "N/A — no barcode field exists.",
    duplicateBySourceId: 0,
    duplicateBySourceIdNote: "fdcId has a DB-level @unique constraint — structurally 0 by construction, not just observed.",
    sameNameDifferentNutrientGroups: Number(sameNameDifferentMacroRows[0]?.count ?? 0),
    referencedInMealPlans: referencedMealItemRefs.length,
    referencedInFoodLogHistoryNote:
      "Structurally 0 by design — NutritionLog stores foodName as free text with NO foodId column at all, so it can never reference the Food catalog by ID. This is itself a notable finding: the historical food-log domain and the catalog domain are already fully decoupled, which is GOOD for catalog-change safety but means food-log entries can never benefit from catalog enrichment (aliases, corrected macros) either.",
    foodsWithFoodFormClassified: foodsWithForm,
    foodsMarkedSupplement: supplementFoods,
    totalFoodAliases: totalAliases,
  };
}

async function main() {
  const [exercises, foods] = await Promise.all([auditExercises(), auditFoods()]);

  const report = {
    generatedAt: new Date().toISOString(),
    environment: "local dev (gymcoach_fitness via docker-compose)",
    exercises,
    foods,
  };

  const outDir = path.resolve(process.cwd(), "../../../reports/data");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "existing-catalog-audit.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const md = renderMarkdown(report);
  const mdPath = path.join(outDir, "existing-catalog-audit.md");
  fs.writeFileSync(mdPath, md);

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(JSON.stringify(report, null, 2));
}

function renderMarkdown(report: any): string {
  const ex = report.exercises;
  const fd = report.foods;
  return `# Existing Catalog Audit

Generated: ${report.generatedAt}
Environment: ${report.environment}

**Read-only inventory. No data was modified to produce this report.**

## Exercises

| Metric | Value |
|---|---|
| Tổng số bài tập | ${ex.totalExercises} |
| Có tên tiếng Việt | ${ex.withVietnameseName} |
| Chỉ có tên tiếng Anh | ${ex.withEnglishOnlyName} |
| Không có mô tả | ${ex.withNoDescription} |
| Không có nhóm cơ | ${ex.withNoMuscleGroups} |
| Không có equipment link (bảng ExerciseEquipment) | ${ex.withNoEquipmentLink} |
| Không có video/ảnh URL | ${ex.withNoVideoUrl} |
| Có URL ngoài (external hotlink) | ${ex.withExternalUrl} |
| Ảnh lỗi | *${ex.withVideoErrorsNote}* |
| Primary/secondary muscle | *${ex.primaryVsSecondaryMuscleNote}* |
| Đang được dùng trong workout log | ${ex.referencedInWorkoutLog} |
| Đang được dùng trong workout program template | ${ex.referencedInProgramTemplate} |
| Được tham chiếu (log HOẶC program) | ${ex.referencedInEitherWorkoutOrProgram} |
| Chưa từng được tham chiếu | ${ex.neverReferenced} |
| Xuất hiện trong AI plan | *${ex.referencedInAiPlanNote}* |
| Exact duplicate (nhóm) | ${ex.exactDuplicateNameGroups} |
| Near duplicate | *${ex.nearDuplicateNote}* |
| ID/slug trùng | *${ex.idOrSlugDuplicateNote}* |
| Không rõ nguồn/license (DB-level) | ${ex.unknownSourceOrLicense} — *${ex.unknownSourceOrLicenseNote}* |
| Có movementPattern | ${ex.withMovementPattern} |
| Có mechanics | ${ex.withMechanics} |
| Có difficultyLevel | ${ex.withDifficultyLevel} |
| Có contraindications | ${ex.withContraindications} |

## Foods

| Metric | Value |
|---|---|
| Tổng số food | ${fd.totalFoods} |
| Theo nguồn | ${JSON.stringify(fd.genericFoodsBySourceType)} |
| Branded food | *${fd.brandedFoodsNote}* |
| Recipe | ${fd.recipeCount} — *${fd.recipeNote}* |
| Có calories = 0 hoặc âm | ${fd.withZeroOrNegativeCalories} |
| Có micronutrient | ${fd.withMicronutrients} — *${fd.micronutrientNote}* |
| Có serving info | ${fd.withServingInfo} — *${fd.servingNote}* |
| Có barcode | ${fd.withBarcode} — *${fd.barcodeNote}* |
| Có ảnh | ${fd.withImage} (thiếu: ${fd.withNoImage}) |
| Macro âm | ${fd.withNegativeMacro} |
| Macro phi thực tế (>100g/100g) | ${fd.withUnrealisticMacro} |
| **Calories không khớp macro (Atwater ±${CALORIE_TOLERANCE_KCAL}kcal)** | **${fd.macroCalorieInconsistentCount} (${fd.macroCalorieInconsistentPct}%)** |
| Duplicate theo tên (nhóm) | ${fd.duplicateByNameGroups} |
| Duplicate theo barcode | ${fd.duplicateByBarcode} — *${fd.duplicateByBarcodeNote}* |
| Duplicate theo source ID (fdcId) | ${fd.duplicateBySourceId} — *${fd.duplicateBySourceIdNote}* |
| Cùng tên, nutrient khác nhau | ${fd.sameNameDifferentNutrientGroups} |
| Đang được meal plan tham chiếu | ${fd.referencedInMealPlans} |
| Xuất hiện trong food log lịch sử | *${fd.referencedInFoodLogHistoryNote}* |
| Đã phân loại foodForm (Part 6, phiên trước) | ${fd.foodsWithFoodFormClassified} |
| Đánh dấu supplement | ${fd.foodsMarkedSupplement} |
| Tổng FoodAlias | ${fd.totalFoodAliases} |

### Top 20 duplicate-by-name groups
${fd.duplicateByNameSamples.map((s: any) => `- "${s.name}" × ${s.count}`).join("\n")}
`;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
