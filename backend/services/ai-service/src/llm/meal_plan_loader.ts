import * as fs from 'fs';
import * as path from 'path';
import type { MealItem, MealPlanTemplate } from './types';

// Path: src/llm/ → src/ → ai-service/ → services/ → backend/ → project root / data/
const NUTRITION_DIR = path.resolve(
  __dirname, '..', '..', '..', '..', '..', 'data', 'catalog', 'nutrition',
);

// ─── CSV parser ────────────────────────────────────────────────────────────────

function parseCSV(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));

  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let inQuote = false;
    let cur = '';
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    values.push(cur.trim());
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => { rec[h] = (values[i] ?? '').replace(/^"|"$/g, ''); });
    return rec;
  });
}

// ─── Lazy-loaded cache ─────────────────────────────────────────────────────────

let _plans: Record<string, string>[] | null = null;
let _items: Record<string, string>[] | null = null;
let _foods: Map<string, string> | null = null;  // food_id → "name serving_size"

function getPlans(): Record<string, string>[] {
  if (!_plans) _plans = parseCSV(path.join(NUTRITION_DIR, 'gym_meal_plans.csv'));
  return _plans;
}

function getItems(): Record<string, string>[] {
  if (!_items) _items = parseCSV(path.join(NUTRITION_DIR, 'gym_meal_plan_items.csv'));
  return _items;
}

function getFoods(): Map<string, string> {
  if (!_foods) {
    _foods = new Map();
    const rows = parseCSV(path.join(NUTRITION_DIR, 'gym_foods.csv'));
    for (const r of rows) {
      _foods.set(r['food_id'], `${r['food_name_vi']} (${r['serving_size']})`);
    }
  }
  return _foods;
}

// ─── Goal code mapping ─────────────────────────────────────────────────────────

function toGoalCode(objective: string): string {
  if (objective === 'fat_loss') return 'fat_loss';
  if (objective === 'muscle_gain') return 'muscle_gain';
  if (objective === 'maintenance') return 'general_fitness';
  return 'body_recomposition';
}

// ─── Select best matching plan ─────────────────────────────────────────────────

function selectPlan(
  goalCode: string,
  targetKcal: number,
  mealsPerDay: number,
  preference?: string,
): Record<string, string> | null {
  const plans = getPlans();

  let candidates = plans.filter(
    (p) => p['goal_code'] === goalCode && Number(p['meals_per_day']) === mealsPerDay,
  );

  // If no exact meal count match, relax the constraint
  if (candidates.length === 0) {
    candidates = plans.filter((p) => p['goal_code'] === goalCode);
  }

  // Filter by preference if specified
  if (preference) {
    const prefMap: Record<string, string> = {
      vegan: 'ăn chay',
      vegetarian: 'ăn chay',
      meal_prep: 'meal prep',
      low_carb: 'giàu protein',
    };
    const prefKey = prefMap[preference];
    if (prefKey) {
      const prefMatches = candidates.filter((p) =>
        p['style_name_vi']?.includes(prefKey),
      );
      if (prefMatches.length > 0) candidates = prefMatches;
    }
  }

  if (candidates.length === 0) return null;

  // Pick plan whose target_kcal is closest to requested
  const safeKcal = targetKcal > 0 ? targetKcal : 2000;
  return candidates.reduce((best, curr) => {
    const bDiff = Math.abs(Number(best['target_kcal']) - safeKcal);
    const cDiff = Math.abs(Number(curr['target_kcal']) - safeKcal);
    return cDiff < bDiff ? curr : best;
  });
}

// ─── Build meal items from plan id ────────────────────────────────────────────

function buildMeals(planId: string): MealItem[] {
  const items = getItems().filter((it) => it['meal_plan_id'] === planId);
  const foods = getFoods();

  // Group by meal_number (keeping order)
  const mealMap = new Map<string, { name: string; foods: string[] }>();
  for (const it of items) {
    const mealNum = it['meal_number'];
    if (!mealMap.has(mealNum)) {
      mealMap.set(mealNum, { name: it['meal_name_vi'], foods: [] });
    }
    const foodLabel = foods.get(it['food_id']) ?? it['food_id'];
    const factor = parseFloat(it['portion_factor'] || '1');
    const portion = factor !== 1 ? ` ×${factor}` : '';
    mealMap.get(mealNum)!.foods.push(`${foodLabel}${portion}`);
  }

  return Array.from(mealMap.values()).map((m) => ({
    mealName: m.name,
    foods: m.foods,
  }));
}

// ─── Public API ────────────────────────────────────────────────────────────────

export const mealPlanLoader = {
  load(
    objective: string,
    targetKcal: number,
    proteinGrams: number,
    carbsGrams: number,
    fatGrams: number,
    mealsPerDay: number,
    preference?: string,
  ): MealPlanTemplate | null {
    const goalCode = toGoalCode(objective);
    const plan = selectPlan(goalCode, targetKcal, mealsPerDay, preference);
    if (!plan) return null;

    const meals = buildMeals(plan['meal_plan_id']);
    if (meals.length === 0) return null;

    const planKcal = Number(plan['target_kcal']) || targetKcal;
    const planProtein = Number(plan['protein_target_g']) || proteinGrams;
    const planCarbs = Number(plan['carb_target_g']) || carbsGrams;
    const planFat = Number(plan['fat_target_g']) || fatGrams;

    return {
      isDefaultTemplate: false,
      kcal: planKcal,
      proteinGrams: planProtein,
      carbsGrams: planCarbs,
      fatGrams: planFat,
      meals,
      substitutions: [
        'Đổi nguồn protein: ức gà ↔ cá hồi ↔ đậu hũ (giữ nguyên gram protein).',
        'Đổi tinh bột: cơm trắng ↔ khoai lang ↔ bánh mì nguyên cám (giữ nguyên gram carb).',
        'Đổi chất béo: bơ đậu phộng ↔ bơ trái ↔ dầu ô liu (giữ nguyên gram fat).',
        `Có thể lặp lại thực đơn này 2–3 ngày rồi xoay sang plan ${plan['style_name_vi']} khác để đa dạng.`,
      ],
    };
  },
};
