// Builds sanitized golden fixtures from REAL captured qwen3:30b answers (see analyze-captures.ts).
// Output (committed test data, no prompts/user ids/provider metadata):
//   backend/services/ai-service/src/__tests__/fixtures/nutrition-30b-3meal-failed.json   (fails the invariant before repair)
//   backend/services/ai-service/src/__tests__/fixtures/nutrition-30b-4meal-valid.json    (already valid: repair must be a no-op)
// Run from repo root: npx tsx test/nutrition-invariant-remediation/make-golden-fixture.ts .tmp-live/capture.jsonl
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const SECRET = "test_internal_service_secret_32_chars_minimum";
const FIT_DB = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test?schema=public";
Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: FIT_DB, INTERNAL_SERVICE_SECRET: SECRET });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const root = process.cwd();
  const fit = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/scripts/startTestHttpServer.ts"], {
    cwd: path.join(root, "backend/services/fitness-service"), env: { ...process.env, PORT: "4302", FITNESS_DISABLE_REDIS: "true" }, stdio: "ignore",
  });
  try {
    for (let i = 0; i < 60; i += 1) { try { if ((await fetch("http://localhost:4302/health")).ok) break; } catch { /* wait */ } await sleep(500); }
    const all: any[] = (((await (await fetch("http://localhost:4302/internal/foods/for-ai-nutrition", { headers: { "x-internal-token": SECRET, "x-user-id": "diag" } })).json()) as any).data.foods);
    const proc = await import("../../backend/services/ai-service/src/services/nutrition.processor");
    const { validateNutritionPlanInvariants } = await import("../../backend/services/ai-service/src/services/nutrition-plan-invariant.service");
    const { filterFoodsByExclusions } = await import("../../backend/services/ai-service/src/services/nutrition-food-constraints");
    const foods = filterFoodsByExclusions(all, ["fish", "beef"]);
    const caps = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const outDir = path.join(root, "backend/services/ai-service/src/__tests__/fixtures");
    fs.mkdirSync(outDir, { recursive: true });
    const make = (cap: any, wantOk: boolean, name: string) => {
      const meals = Number(/Số bữa trong ngày: (\d+)/.exec(cap.prompt)?.[1]);
      const parsed = proc.parseNutritionTemplate(cap.answer);
      if (!parsed.ok) throw new Error("parse");
      const build = (catalog: any[]) => proc.buildNutritionPlanFromTemplate({ goal: "WEIGHT_LOSS", mealsPerDay: meals, dailyCaloriesTarget: 1992, template: parsed.template, allowedFoods: catalog, proteinTargetG: 128, carbTargetG: 246, fatTargetG: 55 });
      const full = build(foods);
      const ids = new Set<string>(); full.weeklySchedule.forEach((d: any) => d.meals.forEach((m: any) => m.items.forEach((i: any) => ids.add(i.foodId))));
      parsed.template.meals.forEach((m: any) => m.items?.forEach((i: any) => i.foodId && ids.add(i.foodId)));
      const subset = foods.filter((f: any) => ids.has(f.id)).map((f: any) => ({ id: f.id, name: f.name, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat ?? f.fats ?? 0, foodForm: f.foodForm ?? null, realisticServingMaxG: f.realisticServingMaxG ?? null }));
      const rebuilt = build(subset);
      const same = JSON.stringify(rebuilt) === JSON.stringify(full);
      const ok = validateNutritionPlanInvariants({ content: full, mealsPerDay: meals, allowedFoodIds: new Set(foods.map((f: any) => String(f.id))) }).ok;
      if (ok !== wantOk) throw new Error(`${name}: expected ok=${wantOk}, got ${ok}`);
      if (!same) throw new Error(`${name}: subset catalog does not reproduce the full-catalog plan`);
      fs.writeFileSync(path.join(outDir, name), JSON.stringify({
        description: name.includes("failed") ? "Real qwen3:30b template that yields an invariant-failing 3-meal plan (fat_target_mismatch + calorie_target_mismatch) before repair" : "Real qwen3:30b template that yields an already-valid 4-meal plan (repair must be a no-op)",
        mealsPerDay: meals, dailyCaloriesTarget: 1992, proteinTargetG: 128, carbTargetG: 246, fatTargetG: 55, excludedFoodKeys: ["fish", "beef"],
        llmTemplateAnswer: cap.answer, foods: subset,
      }, null, 1));
      console.log("wrote", name, "foods:", subset.length, "meals:", meals, "ok-before:", ok);
    };
    make(caps[1], false, "nutrition-30b-3meal-failed.json");
    make(caps[0], true, "nutrition-30b-4meal-valid.json");
  } finally { fit.kill(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
