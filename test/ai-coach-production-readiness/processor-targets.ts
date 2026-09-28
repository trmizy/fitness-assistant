// Deterministic diagnosis (NO LLM): does the real processor expansion + invariant accept the AUTHORITATIVE target
// (1992/128/246/55) over the REAL food catalog, with and without user exclusions?
// Run from repo root: npx tsx test/ai-coach-production-readiness/processor-targets.ts
import { spawn } from "node:child_process";
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
    const res = await fetch("http://localhost:4302/internal/foods/for-ai-nutrition", { headers: { "x-internal-token": SECRET, "x-user-id": "diag" } });
    const foods: any[] = (await res.json() as any).data.foods;
    const { buildNutritionPlanFromTemplate } = await import("../../backend/services/ai-service/src/services/nutrition.processor");
    const { validateNutritionPlanInvariants } = await import("../../backend/services/ai-service/src/services/nutrition-plan-invariant.service");
    const { filterFoodsByExclusions } = await import("../../backend/services/ai-service/src/services/nutrition-food-constraints");
    console.log(JSON.stringify({ foodCount: foods.length, sample: foods.slice(0, 3).map((f) => f.name) }));
    const pick = (re: RegExp, n = 1) => foods.filter((f) => re.test(f.name)).slice(0, n);
    const template = (ids: string[]) => ({ meals: ["BREAKFAST", "LUNCH", "SNACK", "DINNER"].map((t, i) => ({ mealType: t, title: t, items: [{ foodId: ids[i % ids.length], quantity: 150 }] })) });
    for (const [label, keys] of [["no exclusion", [] as string[]], ["fish", ["fish"]], ["fish+beef", ["fish", "beef"]]] as const) {
      for (const [tLabel, t] of [["default", {}], ["authoritative 1992/128/246/55", { dailyCaloriesTarget: 1992, proteinTargetG: 128, carbTargetG: 246, fatTargetG: 55 }]] as const) {
        const pool = filterFoodsByExclusions(foods, [...keys]);
        const ids = (process.env.LEAN ? [...pick(/^chicken.*breast.*(skinless|meat only).*roasted/i), ...pick(/^rice.*white.*cooked/i), ...pick(/^oats/i), ...pick(/^apple.*raw/i)] : [...pick(/chicken/i), ...pick(/rice/i), ...pick(/egg/i), ...pick(/apple|banana/i)]).map((f) => f.id).filter((id) => pool.some((p) => p.id === id));
        const content = buildNutritionPlanFromTemplate({ goal: "WEIGHT_LOSS", mealsPerDay: 4, template: template(ids.length ? ids : [pool[0].id]), allowedFoods: pool, ...(t as object) } as any);
        const inv = validateNutritionPlanInvariants({ content, mealsPerDay: 4, allowedFoodIds: new Set(pool.map((f) => String(f.id))) });
        const d0 = content.weeklySchedule[0];
        console.log(JSON.stringify({ exclusion: label, target: tLabel, poolSize: pool.length, ok: inv.ok, violations: inv.ok ? [] : [...new Set(inv.violations.map((v: any) => v.code))], day1: { kcal: d0.totalCalories, p: d0.protein, c: d0.carbs, f: d0.fat }, planTargets: [content.dailyCaloriesTarget, content.proteinTargetGrams, content.carbTargetGrams, content.fatTargetGrams] }));
      }
    }
  } finally { fit.kill(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
