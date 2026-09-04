/**
 * processNhanes.ts
 * ────────────────
 * Converts NHANES XPT files (SAS Transport Format) to:
 *   • data/processed/nhanes/<name>.csv    (one file per XPT)
 *   • data/processed/nhanes/merged.jsonl  (joined BMX + DXA + DEMO)
 *
 * Only keeps columns relevant to body-composition AI Plan:
 *   SEQN (respondent ID), age, gender, height, weight, BMI, waist,
 *   lean mass, fat mass, body-fat %, bone mineral density.
 *
 * Usage:
 *   npm run data:process:nhanes
 *   npm run data:process:nhanes -- --force
 */

import fs from "node:fs";
import path from "node:path";
import { parseXpt } from "./lib/xptParser";

const ROOT = path.resolve(process.cwd(), "..", "..", "..", "data");
const RAW_NHANES = path.join(ROOT, "raw", "nhanes");
const OUT_NHANES = path.join(ROOT, "processed", "nhanes");
const SOURCES_FILE = path.join(ROOT, "sources.json");
const FORCE = process.argv.includes("--force");

// ── Column keep-lists ─────────────────────────────────────────────────────────

const BMX_COLS = [
  "SEQN",
  "BMXWT",
  "BMXHT",
  "BMXBMI",
  "BMXWAIST",
  "BMXHIP",
  "BMXLEG",
  "BMXARMC",
];
const DXX_COLS = [
  "SEQN",
  "DXDTOTOT",
  "DXDLEAN",
  "DXDFAT",
  "DXDBFAT",
  "DXDTOBJ",
  "DXDLIMB",
];
const DXXAG_COLS = [
  "SEQN",
  "DXDAGFAT",
  "DXDANFAT",
  "DXDGYFAT",
  "DXXAGBFP",
  "DXXANFAT",
  "DXXGYFAT",
];
const DEMO_COLS = ["SEQN", "RIDAGEYR", "RIAGENDR", "RIDRETH3", "DMDHHSIZ"];

// Human-readable column rename map
const RENAME: Record<string, string> = {
  // BMX
  BMXWT: "weight_kg",
  BMXHT: "height_cm",
  BMXBMI: "bmi",
  BMXWAIST: "waist_cm",
  BMXHIP: "hip_cm",
  BMXLEG: "leg_cm",
  BMXARMC: "arm_circ_cm",
  // DXX
  DXDTOTOT: "total_mass_kg",
  DXDLEAN: "lean_mass_kg",
  DXDFAT: "fat_mass_kg",
  DXDBFAT: "body_fat_pct",
  DXDTOBJ: "bone_mineral_kg",
  // DXXAG
  DXDAGFAT: "android_fat_kg",
  DXDANFAT: "android_fat2_kg",
  DXDGYFAT: "gynoid_fat_kg",
  DXXAGBFP: "android_bfp",
  DXXANFAT: "android_total_fat_kg",
  DXXGYFAT: "gynoid_total_fat_kg",
  // DEMO
  RIDAGEYR: "age_years",
  RIAGENDR: "gender_code",
  RIDRETH3: "race_code",
  DMDHHSIZ: "household_size",
};

function renameRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    // SEQN is the join key — keep it uppercase for reliable cross-file merging
    if (k === "SEQN") {
      out["SEQN"] = v;
      continue;
    }
    out[RENAME[k] ?? k.toLowerCase()] = v;
  }
  // Decode gender: 1=Male 2=Female
  if (out.gender_code != null) {
    out.gender =
      out.gender_code === 1 ? "M" : out.gender_code === 2 ? "F" : null;
  }
  return out;
}

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(
      cols
        .map((c) => {
          const v = row[c];
          if (v === null || v === undefined) return "";
          return String(v).includes(",")
            ? `"${String(v).replace(/"/g, '""')}"`
            : String(v);
        })
        .join(","),
    );
  }
  return lines.join("\n");
}

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── Per-file processing ───────────────────────────────────────────────────────

interface FileSpec {
  id: string;
  file: string;
  keepCols: string[];
  year: string;
}
const FILES: FileSpec[] = [
  {
    id: "nhanes-2021-bmx",
    file: "BMX_L.xpt",
    keepCols: BMX_COLS,
    year: "2021",
  },
  {
    id: "nhanes-2017-bmx",
    file: "BMX_J.xpt",
    keepCols: BMX_COLS,
    year: "2017",
  },
  {
    id: "nhanes-2017-dxx",
    file: "DXX_J.xpt",
    keepCols: DXX_COLS,
    year: "2017",
  },
  {
    id: "nhanes-2017-dxxag",
    file: "DXXAG_J.xpt",
    keepCols: DXXAG_COLS,
    year: "2017",
  },
  {
    id: "nhanes-2017-demo",
    file: "DEMO_J.xpt",
    keepCols: DEMO_COLS,
    year: "2017",
  },
];

async function processFile(
  spec: FileSpec,
): Promise<Map<string, Record<string, any>>> {
  const xptPath = path.join(RAW_NHANES, spec.file);
  if (!fs.existsSync(xptPath)) {
    console.warn(`  ⚠  ${spec.file} not found — run data:download first`);
    return new Map();
  }

  const outCsv = path.join(OUT_NHANES, spec.file.replace(".xpt", ".csv"));
  if (fs.existsSync(outCsv) && !FORCE) {
    console.log(`  ⏭  ${spec.file} already processed — skipping`);
    // Load existing CSV to build index
    const lines = fs.readFileSync(outCsv, "utf-8").split("\n").filter(Boolean);
    const headers = lines[0].split(",");
    const seqnIdx = headers.indexOf("SEQN");
    const idx = new Map<string, Record<string, any>>();
    for (const line of lines.slice(1)) {
      const vals = line.split(",");
      const row: Record<string, any> = {};
      headers.forEach((h, i) => {
        row[h] = vals[i] ?? null;
      });
      if (seqnIdx >= 0 && vals[seqnIdx])
        idx.set(String(Math.round(Number(vals[seqnIdx]))), row);
    }
    return idx;
  }

  console.log(`  🔄  Parsing ${spec.file}…`);
  const buf = fs.readFileSync(xptPath);
  let result;
  try {
    result = parseXpt(buf, spec.keepCols);
  } catch (err: any) {
    console.error(`  ❌  Parse failed for ${spec.file}: ${err.message}`);
    return new Map();
  }

  const renamed = result.rows.map(renameRow);
  fs.writeFileSync(outCsv, toCsv(renamed), "utf-8");
  console.log(
    `  ✅  ${spec.file} → ${renamed.length} rows → ${path.basename(outCsv)}`,
  );

  // Index by SEQN for merge (use string key for reliable Map lookups across CSV parse)
  const idx = new Map<string, Record<string, any>>();
  for (const row of renamed) {
    if (row.SEQN != null) idx.set(String(Math.round(Number(row.SEQN))), row);
  }
  return idx;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔬  NHANES XPT Processor");
  ensureDir(OUT_NHANES);

  const indexes = new Map<string, Map<string, Record<string, any>>>();
  for (const spec of FILES) {
    const idx = await processFile(spec);
    indexes.set(spec.id, idx);
  }

  // ── Merged 2017 JSONL (BMX + DXX + DXXAG + DEMO joined by SEQN) ──────────
  const mergedPath = path.join(OUT_NHANES, "merged_2017.jsonl");
  if (!fs.existsSync(mergedPath) || FORCE) {
    const bmx = indexes.get("nhanes-2017-bmx") ?? new Map();
    const dxx = indexes.get("nhanes-2017-dxx") ?? new Map();
    const ag = indexes.get("nhanes-2017-dxxag") ?? new Map();
    const demo = indexes.get("nhanes-2017-demo") ?? new Map();
    const allSeqn = new Set([...bmx.keys(), ...dxx.keys(), ...demo.keys()]);

    const lines: string[] = [];
    for (const seqn of allSeqn) {
      const merged = {
        SEQN: seqn,
        survey_year: 2017,
        ...(demo.get(seqn) ?? {}),
        ...(bmx.get(seqn) ?? {}),
        ...(dxx.get(seqn) ?? {}),
        ...(ag.get(seqn) ?? {}),
      };
      delete merged.SEQN; // already in object
      merged.SEQN = seqn;
      lines.push(JSON.stringify(merged));
    }
    fs.writeFileSync(mergedPath, lines.join("\n") + "\n", "utf-8");
    console.log(`  ✅  merged_2017.jsonl → ${lines.length} rows`);
  } else {
    console.log(`  ⏭  merged_2017.jsonl exists — skipping`);
  }

  // ── README ────────────────────────────────────────────────────────────────
  const readmePath = path.join(OUT_NHANES, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      `# NHANES Body Composition Data

## Source
National Health and Nutrition Examination Survey (CDC NHANES)
https://www.cdc.gov/nchs/nhanes/

## Files
| File | Survey | Description |
|------|--------|-------------|
| BMX_L.csv | 2021-23 | Body measurements (weight, height, BMI, waist) |
| BMX_J.csv | 2017-18 | Body measurements |
| DXX_J.csv | 2017-18 | DXA total body composition (lean, fat mass, BF%) |
| DXXAG_J.csv | 2017-18 | DXA android/gynoid fat distribution |
| DEMO_J.csv | 2017-18 | Demographics (age, gender, race) |
| merged_2017.jsonl | 2017-18 | Joined BMX + DXA + DEMO by SEQN |

## Key Columns
- \`weight_kg\` / \`height_cm\` / \`bmi\` — anthropometric measurements
- \`lean_mass_kg\` / \`fat_mass_kg\` / \`body_fat_pct\` — DXA body composition
- \`age_years\` / \`gender\` (M/F) — demographics
- \`android_fat_kg\` / \`gynoid_fat_kg\` — regional fat distribution

## Usage Constraints
⚠️ **This data is for ANALYTICS / NORMATIVE REFERENCE ONLY.**
- Do NOT use as authoritative nutrition or medical advice.
- Population norms differ by age, sex, race, and health status.
- NHANES is designed for statistical analysis of US populations, not individual diagnosis.
- Public domain (US Government work).

## Citation
CDC NHANES. (2021). National Health and Nutrition Examination Survey Data.
Hyattsville, MD: U.S. Department of Health and Human Services, CDC.
https://www.cdc.gov/nchs/nhanes/
`,
      "utf-8",
    );
    console.log("  ✅  README.md written");
  }

  // Update sources.json processed paths
  if (fs.existsSync(SOURCES_FILE)) {
    const registry = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf-8"));
    for (const spec of FILES) {
      const csvFile = spec.file.replace(".xpt", ".csv");
      if (registry[spec.id]) {
        registry[spec.id].processedPath = path.join(
          "data",
          "processed",
          "nhanes",
          csvFile,
        );
        registry[spec.id].processedAt = new Date().toISOString();
      }
    }
    fs.writeFileSync(SOURCES_FILE, JSON.stringify(registry, null, 2), "utf-8");
  }

  console.log("\n✅  NHANES processing complete");
  console.log(`    Output: ${OUT_NHANES}`);
}

main().catch((err) => {
  console.error("❌  Fatal:", err.message);
  process.exit(1);
});
