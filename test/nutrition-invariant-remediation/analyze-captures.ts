// Offline reproduction of nutrition invariant failures from CAPTURED real LLM answers (no LLM call here).
// Input: JSONL written by test/ai-coach-production-readiness/live-nutrition.ts (LIVE_CAPTURE_FILE).
// Rebuilds each plan with the REAL exported builder + REAL food catalog (fitness test server) and prints the numbers.
// Run from repo root: npx tsx test/nutrition-invariant-remediation/analyze-captures.ts .tmp-live/capture.jsonl [--json out.json]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const SECRET = "test_internal_service_secret_32_chars_minimum";
const FIT_DB = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_fitness_test?schema=public";
Object.assign(process.env, { NODE_ENV: "test", DATABASE_URL: FIT_DB, INTERNAL_SERVICE_SECRET: SECRET });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const file = process.argv[2];
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : undefined;

async function main() {
  const root = process.cwd();
  const fit = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/scripts/startTestHttpServer.ts"], {
    cwd: path.join(root, "backend/services/fitness-service"), env: { ...process.env, PORT: "4302", FITNESS_DISABLE_REDIS: "true" }, stdio: "ignore",
  });
  try {
    for (let i = 0; i < 60; i += 1) { try { if ((await fetch("http://localhost:4302/health")).ok) break; } catch { /* wait */ } await sleep(500); }
    const res = await fetch("http://localhost:4302/internal/foods/for-ai-nutrition", { headers: { "x-internal-token": SECRET, "x-user-id": "diag" } });
    const allFoods: any[] = ((await res.json()) as any).data.foods;
    const proc = await import("../../backend/services/ai-service/src/services/nutrition.processor");
    const { validateNutritionPlanInvariants } = await import("../../backend/services/ai-service/src/services/nutrition-plan-invariant.service");
    const { filterFoodsByExclusions } = await import("../../backend/services/ai-service/src/services/nutrition-food-constraints");
    const { repairNutritionPlanQuantities } = await import("../../backend/services/ai-service/src/services/nutrition-plan-repair");
    const foods = filterFoodsByExclusions(allFoods, ["fish", "beef"]);
    const byId = new Map(foods.map((f: any) => [f.id, f]));
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const report: any[] = [];
    lines.forEach((cap, idx) => {
      const meals = Number(/Số bữa trong ngày: (\d+)/.exec(cap.prompt)?.[1]);
      const parsed = proc.parseNutritionTemplate(cap.answer);
      if (!parsed.ok) { console.log(JSON.stringify({ idx, meals, parse: "FAILED" })); return; }
      const content = proc.buildNutritionPlanFromTemplate({
        goal: "MAINTENANCE", mealsPerDay: meals, dailyCaloriesTarget: 1992, template: parsed.template, allowedFoods: foods,
        proteinTargetG: 128, carbTargetG: 246, fatTargetG: 55,
      });
      const inv = validateNutritionPlanInvariants({ content, mealsPerDay: meals, allowedFoodIds: new Set(foods.map((f: any) => String(f.id))) });
      const days = content.weeklySchedule.map((d: any) => ({ kcal: d.totalCalories, p: d.protein, c: d.carbs, f: d.fat }));
      const primaries = parsed.template.meals.map((m: any) => { const f: any = byId.get(m.items?.[0]?.foodId); return f ? `${f.name} (P${f.protein} C${f.carbs} F${f.fat ?? f.fats} cap${proc.realisticServingCapG(f.name, f.realisticServingMaxG)})` : "(unknown/absent)"; });
      const violations = inv.ok ? [] : [...new Set(inv.violations.map((v: any) => v.code))];
      console.log(JSON.stringify({ idx, meals, ok: inv.ok, violations, llmPrimaries: primaries, day1: days[0], worstFat: Math.max(...days.map((d: any) => d.f)), minFat: Math.min(...days.map((d: any) => d.f)), maxKcal: Math.max(...days.map((d: any) => d.kcal)), minKcal: Math.min(...days.map((d: any) => d.kcal)) }));
      if (!inv.ok && idx < 2 + 8) {
        const d0 = content.weeklySchedule[0];
        console.log("   day1 items:", d0.meals.map((m: any) => m.items.map((i: any) => `${i.name.slice(0, 34)} ${i.quantity}g[k${i.calories} P${i.protein} C${i.carbs} F${i.fat}]`).join(" + ")).join("  ||  "));
      }
      let repaired: any = undefined;
      if (!inv.ok) {
        const fb = new Map(foods.map((f: any) => [String(f.id), f]));
        const opts = { foodById: fb as any, capG: (f: any) => proc.realisticServingCapG(f.name, f.realisticServingMaxG) };
        const r1 = repairNutritionPlanQuantities(content, opts);
        const r2 = repairNutritionPlanQuantities(content, opts);
        const inv2 = validateNutritionPlanInvariants({ content: r1.content, mealsPerDay: meals, allowedFoodIds: new Set(foods.map((f: any) => String(f.id))) });
        const excl = r1.content.weeklySchedule.flatMap((d: any) => d.meals.flatMap((m: any) => m.items.map((i: any) => i.foodId))).filter((id: string) => !byId.has(id));
        repaired = {
          invariantOk: inv2.ok, repairedDays: r1.report.repairedDays.length, failedDays: r1.report.failedDays.length, ms: +r1.report.ms.toFixed(2),
          deterministic: JSON.stringify(r1.content) === JSON.stringify(r2.content), unknownOrExcludedFoodIds: excl.length,
          mealCount: r1.content.weeklySchedule.every((d: any) => d.meals.length === meals),
          day1Before: days[0], day1After: r1.report.after[0],
          rangeAfter: { kcal: [Math.min(...r1.report.after.map((d: any) => d.kcal)), Math.max(...r1.report.after.map((d: any) => d.kcal))], fat: [Math.min(...r1.report.after.map((d: any) => d.fat)), Math.max(...r1.report.after.map((d: any) => d.fat))], protein: [Math.min(...r1.report.after.map((d: any) => d.protein)), Math.max(...r1.report.after.map((d: any) => d.protein))], carbs: [Math.min(...r1.report.after.map((d: any) => d.carbs)), Math.max(...r1.report.after.map((d: any) => d.carbs))] },
        };
        console.log("   REPAIR:", JSON.stringify(repaired));
        console.log("   day1 after:", r1.content.weeklySchedule[0].meals.map((m: any) => m.items.map((i: any) => i.name.slice(0, 30) + " " + i.quantity + "g").join(" + ")).join("  ||  "));
      }
      report.push({ idx, meals, ok: inv.ok, violations, days, primaries, repaired });
    });
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
  } finally { fit.kill(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
