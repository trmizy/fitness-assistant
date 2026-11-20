/**
 * Imports Vietnamese guidance from the project's own curated catalog (data/catalog/plans/gym_exercises.csv, first-party, original content) onto the EXISTING
 * exercises that Gate 5 already linked to it (exercise_sources.source_name = 'curated_vi_exercise_catalog', external_id = the CSV exercise_id).
 * It never creates or renames an Exercise and never touches exercise ids. Verification is 'CURATED' (project-authored), never 'REVIEWED' and never machine-made.
 *
 *   npx tsx src/importers/exerciseGuidanceImporter.ts            (dry run, prints the plan)
 *   npx tsx src/importers/exerciseGuidanceImporter.ts --apply     (writes exercise_guidance rows; idempotent)
 */
import * as fs from "fs";
import * as path from "path";
import { parseCsv } from "../utils/csv-parser.util";

export interface CuratedGuidance { externalId: string; nameVi: string | null; instructionsVi: string | null; commonMistakesVi: string[]; safetyNotesVi: string[] }

const split = (v: string | undefined): string[] => String(v ?? "").split(/;|\n/).map((x) => x.trim()).filter(Boolean);

/** Pure: one CSV row (header -> value) to the guidance fields. Empty sections stay empty (null / []), never invented. */
export function buildGuidanceFromRow(row: Record<string, string>): CuratedGuidance | null {
  const externalId = String(row.exercise_id ?? "").trim();
  if (!externalId) return null;
  const parts = [row.setup, row.execution_steps, row.breathing && `Nhịp thở: ${row.breathing}`].map((x) => String(x ?? "").trim()).filter(Boolean);
  return {
    externalId,
    nameVi: String(row.exercise_name_vi ?? "").trim() || null,
    instructionsVi: parts.length ? parts.join("\n") : null,
    commonMistakesVi: split(row.common_errors),
    safetyNotesVi: split(row.contraindications),
  };
}

export function readCuratedCatalog(csvPath: string): CuratedGuidance[] {
  const { headers, rows } = parseCsv(fs.readFileSync(csvPath, "utf8"));
  return rows.map((cells) => buildGuidanceFromRow(Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""])))).filter((g): g is CuratedGuidance => g !== null);
}

export async function importGuidance(apply: boolean, csvPath = path.resolve(__dirname, "../../../../../data/catalog/plans/gym_exercises.csv")) {
  const { prisma } = await import("../repositories/prisma");
  const items = readCuratedCatalog(csvPath);
  const sources = await prisma.exerciseSource.findMany({ where: { sourceName: "curated_vi_exercise_catalog" }, select: { exerciseId: true, externalId: true } });
  const byExternal = new Map(sources.map((s: any) => [s.externalId, s.exerciseId as string]));
  let linked = 0, written = 0;
  for (const it of items) {
    const exerciseId = byExternal.get(it.externalId);
    if (!exerciseId) continue;
    linked++;
    if (!apply) continue;
    await prisma.exerciseGuidance.upsert({
      where: { exerciseId_language: { exerciseId, language: "vi" } },
      create: { exerciseId, language: "vi", nameVi: it.nameVi, instructionsVi: it.instructionsVi, commonMistakesVi: it.commonMistakesVi, safetyNotesVi: it.safetyNotesVi, source: `curated_vi_exercise_catalog:${it.externalId}`, verification: "CURATED" },
      update: { nameVi: it.nameVi, instructionsVi: it.instructionsVi, commonMistakesVi: it.commonMistakesVi, safetyNotesVi: it.safetyNotesVi, source: `curated_vi_exercise_catalog:${it.externalId}` },
    });
    written++;
  }
  return { csvRows: items.length, linkedToLiveExercises: linked, written, apply };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("exerciseGuidanceImporter.ts")) {
  importGuidance(process.argv.includes("--apply")).then((r) => { console.log(JSON.stringify(r)); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
}
