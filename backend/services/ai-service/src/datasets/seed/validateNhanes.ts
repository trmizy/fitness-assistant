/**
 * validateNhanes.ts
 * ─────────────────
 * Data quality checks for processed NHANES CSV files before vector ingestion.
 *
 * Checks:
 *  - Required columns present
 *  - Numeric range validity (height, weight, BMI, body fat %)
 *  - Row rejection counts logged
 *
 * Usage:
 *   npm run data:validate
 *   npm run data:validate -- --strict   # exit 1 if any check fails
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..", "..", "..", "data");
const NHANES = path.join(ROOT, "processed", "nhanes");
const STRICT = process.argv.includes("--strict");

interface ColRange {
  min: number;
  max: number;
  nullable?: boolean;
}
interface ValidationSpec {
  file: string;
  required: string[];
  ranges: Record<string, ColRange>;
}

const SPECS: ValidationSpec[] = [
  {
    file: "BMX_L.csv",
    required: ["SEQN", "weight_kg", "height_cm", "bmi"],
    ranges: {
      weight_kg: { min: 20, max: 300 },
      height_cm: { min: 80, max: 250 },
      bmi: { min: 10, max: 80 },
      waist_cm: { min: 30, max: 200, nullable: true },
    },
  },
  {
    file: "BMX_J.csv",
    required: ["SEQN", "weight_kg", "height_cm", "bmi"],
    ranges: {
      weight_kg: { min: 20, max: 300 },
      height_cm: { min: 80, max: 250 },
      bmi: { min: 10, max: 80 },
      waist_cm: { min: 30, max: 200, nullable: true },
    },
  },
  {
    file: "DXX_J.csv",
    required: ["SEQN", "body_fat_pct", "lean_mass_kg"],
    ranges: {
      body_fat_pct: { min: 0, max: 70, nullable: true },
      lean_mass_kg: { min: 10, max: 200, nullable: true },
      fat_mass_kg: { min: 0, max: 200, nullable: true },
    },
  },
  {
    file: "DEMO_J.csv",
    required: ["SEQN", "age_years"],
    ranges: {
      age_years: { min: 0, max: 150, nullable: false },
    },
  },
];

type Report = { ok: number; rejected: number; issues: string[] };

function parseCSV(filePath: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = vals[i] ?? "";
      });
      return row;
    });
  return { headers, rows };
}

function validateSpec(spec: ValidationSpec): Report {
  const filePath = path.join(NHANES, spec.file);
  const report: Report = { ok: 0, rejected: 0, issues: [] };

  if (!fs.existsSync(filePath)) {
    report.issues.push(`FILE NOT FOUND: ${spec.file}`);
    return report;
  }

  const { headers, rows } = parseCSV(filePath);

  // Check required columns
  for (const req of spec.required) {
    if (!headers.includes(req)) {
      report.issues.push(`MISSING COLUMN: ${req} in ${spec.file}`);
    }
  }

  let nullCounts: Record<string, number> = {};
  let rangeFails: Record<string, number> = {};

  for (const row of rows) {
    let rowOk = true;

    for (const [col, range] of Object.entries(spec.ranges)) {
      const raw = row[col];
      if (!raw || raw === "" || raw === "null") {
        if (!range.nullable) {
          rangeFails[col] = (rangeFails[col] ?? 0) + 1;
          rowOk = false;
        } else {
          nullCounts[col] = (nullCounts[col] ?? 0) + 1;
        }
        continue;
      }
      const val = parseFloat(raw);
      if (isNaN(val) || val < range.min || val > range.max) {
        rangeFails[col] = (rangeFails[col] ?? 0) + 1;
        rowOk = false;
      }
    }

    if (rowOk) report.ok++;
    else report.rejected++;
  }

  // Summarise range failures
  for (const [col, count] of Object.entries(rangeFails)) {
    if (count > 0) {
      report.issues.push(
        `OUT_OF_RANGE: ${col} failed on ${count} rows in ${spec.file}`,
      );
    }
  }

  // Log null counts as info (not errors)
  for (const [col, count] of Object.entries(nullCounts)) {
    if (count > rows.length * 0.3) {
      // Warn only if >30% null
      report.issues.push(
        `HIGH_NULL_RATE: ${col} is null in ${count}/${rows.length} rows (${((count / rows.length) * 100).toFixed(0)}%) in ${spec.file} — may indicate non-DXA cohort`,
      );
    }
  }

  return report;
}

function validateMerged(): Report {
  const filePath = path.join(NHANES, "merged_2017.jsonl");
  const report: Report = { ok: 0, rejected: 0, issues: [] };

  if (!fs.existsSync(filePath)) {
    report.issues.push("FILE NOT FOUND: merged_2017.jsonl");
    return report;
  }

  const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      // Must have SEQN
      if (!row.SEQN) {
        report.rejected++;
        continue;
      }
      // Weight if present must be sane
      if (row.weight_kg !== undefined && row.weight_kg !== null) {
        const w = Number(row.weight_kg);
        if (w < 20 || w > 300) {
          report.rejected++;
          continue;
        }
      }
      report.ok++;
    } catch {
      report.rejected++;
      report.issues.push(`JSON parse error in merged_2017.jsonl`);
    }
  }

  return report;
}

function validateEvidenceJsonl(): Report {
  const evidenceDir = path.join(ROOT, "processed", "evidence");
  const report: Report = { ok: 0, rejected: 0, issues: [] };

  if (!fs.existsSync(evidenceDir)) {
    report.issues.push("MISSING DIR: data/processed/evidence");
    return report;
  }

  const files = fs.readdirSync(evidenceDir).filter((f) => f.endsWith(".jsonl"));
  for (const file of files) {
    const lines = fs
      .readFileSync(path.join(evidenceDir, file), "utf-8")
      .split("\n")
      .filter(Boolean);
    for (const line of lines) {
      try {
        const chunk = JSON.parse(line);
        const required = [
          "id",
          "title",
          "source_type",
          "category",
          "content",
          "evidence_level",
        ];
        const missing = required.filter((k) => !chunk[k]);
        if (missing.length > 0) {
          report.rejected++;
          report.issues.push(
            `MISSING FIELDS [${missing.join(",")}] in ${file}`,
          );
        } else if (!chunk.content || chunk.content.length < 20) {
          report.rejected++;
          report.issues.push(`SHORT CONTENT in ${file}: chunk ${chunk.id}`);
        } else {
          report.ok++;
        }
      } catch {
        report.rejected++;
        report.issues.push(`JSON parse error in ${file}`);
      }
    }
  }

  return report;
}

async function main() {
  console.log("🔍  NHANES + Evidence Validation");
  console.log(`    NHANES dir: ${NHANES}`);
  console.log("");

  let totalIssues = 0;
  let totalOk = 0;
  let totalBad = 0;

  // Validate each NHANES CSV
  for (const spec of SPECS) {
    const r = validateSpec(spec);
    const status = r.issues.length === 0 ? "✅" : "⚠";
    console.log(`${status}  ${spec.file}: ${r.ok} ok / ${r.rejected} rejected`);
    for (const iss of r.issues) console.log(`      ↳ ${iss}`);
    totalOk += r.ok;
    totalBad += r.rejected;
    totalIssues += r.issues.filter(
      (i) =>
        i.startsWith("FILE NOT FOUND") ||
        i.startsWith("MISSING COLUMN") ||
        i.startsWith("OUT_OF_RANGE"),
    ).length;
  }

  // Validate merged
  console.log("");
  const merged = validateMerged();
  const mStatus = merged.issues.length === 0 ? "✅" : "⚠";
  console.log(
    `${mStatus}  merged_2017.jsonl: ${merged.ok} ok / ${merged.rejected} rejected`,
  );
  for (const iss of merged.issues) console.log(`      ↳ ${iss}`);
  totalIssues += merged.issues.filter((i) => i.startsWith("FILE")).length;

  // Validate evidence JSONL
  console.log("");
  const evidence = validateEvidenceJsonl();
  const eStatus = evidence.rejected === 0 ? "✅" : "⚠";
  console.log(
    `${eStatus}  evidence/*.jsonl: ${evidence.ok} ok / ${evidence.rejected} rejected`,
  );
  for (const iss of evidence.issues) console.log(`      ↳ ${iss}`);
  totalIssues += evidence.rejected;

  console.log("");
  console.log(
    `📊  Total: ${totalOk + merged.ok + evidence.ok} valid rows/chunks | ${totalBad + merged.rejected + evidence.rejected} rejected`,
  );

  if (totalIssues > 0) {
    console.warn(`⚠   ${totalIssues} blocking issues found`);
    if (STRICT) {
      console.error("Strict mode: exiting 1");
      process.exit(1);
    }
  } else {
    console.log("✅  All critical checks passed — data ready for ingestion");
  }
}

main().catch((err) => {
  console.error("❌  Fatal:", err.message);
  process.exit(1);
});
