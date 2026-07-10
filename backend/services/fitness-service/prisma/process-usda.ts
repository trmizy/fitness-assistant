/**
 * One-time script: process raw USDA FoodData Central CSVs → foods_seed.csv
 *
 * Run from project root:
 *   pnpm --filter @gym-coach/fitness-service db:process-usda
 *
 * Input:  data/nutrition/{food,food_nutrient,sr_legacy_food,survey_fndds_food}.csv
 * Output: data/nutrition/foods_seed.csv  (~13K rows, safe to commit)
 */

import * as fs from "fs";
import * as readline from "readline";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "../../../../data/nutrition");
const OUTPUT = path.join(DATA_DIR, "foods_seed.csv");

// USDA nutrient IDs we need
const NID_CALORIES = 1008;
const NID_PROTEIN = 1003;
const NID_FAT = 1004;
const NID_CARBS = 1005;
const TARGET_NUTRIENTS = new Set([
  NID_CALORIES,
  NID_PROTEIN,
  NID_FAT,
  NID_CARBS,
]);

// USDA CSV: every field is double-quoted, separated by commas
// "value1","value2","value3"  →  ['value1','value2','value3']
function splitCSV(line: string): string[] {
  const trimmed = line.startsWith('"') ? line.slice(1, -1) : line;
  return trimmed.split('","');
}

async function streamLines(
  filePath: string,
  onLine: (cols: string[]) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    let header = true;
    rl.on("line", (line) => {
      if (header) {
        header = false;
        return;
      }
      if (line.trim()) onLine(splitCSV(line));
    });
    rl.on("close", resolve);
    rl.on("error", reject);
  });
}

async function main() {
  // ── Step 1: collect target fdc_ids ──────────────────────────────
  console.log("Step 1/4  Loading SR Legacy + Survey FNDDS food IDs...");
  const targetIds = new Map<number, string>(); // fdcId → source label

  await streamLines(path.join(DATA_DIR, "sr_legacy_food.csv"), (cols) => {
    const id = parseInt(cols[0], 10);
    if (!isNaN(id)) targetIds.set(id, "sr_legacy");
  });

  await streamLines(path.join(DATA_DIR, "survey_fndds_food.csv"), (cols) => {
    const id = parseInt(cols[0], 10);
    if (!isNaN(id)) targetIds.set(id, "survey_fndds");
  });

  console.log(`  → ${targetIds.size} target foods`);

  // ── Step 2: collect food names ───────────────────────────────────
  console.log("Step 2/4  Loading food names from food.csv...");
  const foods = new Map<number, { name: string; source: string }>();

  await streamLines(path.join(DATA_DIR, "food.csv"), (cols) => {
    // fdc_id(0), data_type(1), description(2), ...
    const id = parseInt(cols[0], 10);
    if (targetIds.has(id)) {
      foods.set(id, { name: cols[2], source: targetIds.get(id)! });
    }
  });

  console.log(`  → ${foods.size} names loaded`);

  // ── Step 3: stream food_nutrient.csv (27M rows) ──────────────────
  console.log("Step 3/4  Streaming food_nutrient.csv (may take ~1 min)...");

  interface Nutrients {
    calories: number;
    protein: number;
    fats: number;
    carbs: number;
  }
  const nutrients = new Map<number, Nutrients>();

  let rowsRead = 0;
  await streamLines(path.join(DATA_DIR, "food_nutrient.csv"), (cols) => {
    // id(0), fdc_id(1), nutrient_id(2), amount(3), ...
    rowsRead++;
    if (rowsRead % 2_000_000 === 0)
      process.stdout.write(`  ${rowsRead / 1_000_000}M rows...\r`);

    const fdcId = parseInt(cols[1], 10);
    const nutrientId = parseInt(cols[2], 10);
    const amount = parseFloat(cols[3]);

    if (!foods.has(fdcId) || !TARGET_NUTRIENTS.has(nutrientId) || isNaN(amount))
      return;

    if (!nutrients.has(fdcId)) {
      nutrients.set(fdcId, { calories: 0, protein: 0, fats: 0, carbs: 0 });
    }
    const n = nutrients.get(fdcId)!;
    if (nutrientId === NID_CALORIES) n.calories = amount;
    else if (nutrientId === NID_PROTEIN) n.protein = amount;
    else if (nutrientId === NID_FAT) n.fats = amount;
    else if (nutrientId === NID_CARBS) n.carbs = amount;
  });

  console.log(`\n  → processed ${rowsRead.toLocaleString()} nutrient rows`);

  // ── Step 4: write output CSV ─────────────────────────────────────
  console.log("Step 4/4  Writing foods_seed.csv...");

  const lines = ["fdc_id,name,calories,protein,carbs,fats,source"];
  let count = 0;

  for (const [fdcId, food] of foods) {
    const n = nutrients.get(fdcId);
    if (!n || n.calories === 0) continue; // skip foods with no calorie data

    const safeName = food.name.replace(/"/g, '""');
    lines.push(
      `${fdcId},"${safeName}",${n.calories.toFixed(1)},${n.protein.toFixed(1)},${n.carbs.toFixed(1)},${n.fats.toFixed(1)},${food.source}`,
    );
    count++;
  }

  fs.writeFileSync(OUTPUT, lines.join("\n"), "utf8");
  const kb = Math.round(fs.statSync(OUTPUT).size / 1024);
  console.log(
    `\n✅  Done — ${count} foods written to foods_seed.csv (${kb} KB)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
