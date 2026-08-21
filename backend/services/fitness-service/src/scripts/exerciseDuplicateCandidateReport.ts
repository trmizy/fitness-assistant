/**
 * Gate 3 deliverable — runs the Gate 3 duplicate detector
 * (exercise-duplicate-detector.ts) for real, comparing:
 *   - the 883 LIVE `exercises` rows (free-exercise-db-derived, English)
 *   - against the 205 CURATED, NOT-YET-IMPORTED
 *     data/catalog/plans/gym_exercises.csv entries (Vietnamese/English)
 * — the only two real exercise sources that exist in this repo today (no
 * external source, e.g. wger, has been fetched in this pass). Writes
 * reports/data/duplicate-candidate-report.md. Read-only: does not write
 * to the database, does not modify either source file.
 *
 * Run inside the fitness-service container:
 *   npx tsx src/scripts/exerciseDuplicateCandidateReport.ts
 */
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../repositories/prisma";
import {
  detectDuplicate,
  type ExerciseMatchCandidate,
  type DuplicateDecision,
} from "../services/exercise-duplicate-detector";

/** Local, lightweight tiebreak only — the real matching logic (and the
 * decision it returns) still comes entirely from detectDuplicate() in
 * exercise-duplicate-detector.ts; this just picks which of several
 * equal-confidence live matches to SHOW as the representative. */
function rawNameJaccard(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
  const setA = tok(a);
  const setB = tok(b);
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

interface CatalogRow {
  externalId: string;
  nameVi: string;
  nameEn: string;
  movementPattern: string;
  primaryMuscles: string[];
  equipment: string[];
  isCompound: boolean;
}

function loadCatalog(): CatalogRow[] {
  const csvPath = path.resolve(process.cwd(), "../../../data/catalog/plans/gym_exercises.csv");
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = parseCSVLine(lines[0]);
  const idx = (col: string) => header.indexOf(col);

  const rows: CatalogRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < header.length) continue;
    rows.push({
      externalId: fields[idx("exercise_id")],
      nameVi: fields[idx("exercise_name_vi")],
      nameEn: fields[idx("exercise_name_en")],
      movementPattern: fields[idx("movement_pattern")],
      primaryMuscles: fields[idx("primary_muscles")].split("|").filter(Boolean),
      equipment: fields[idx("equipment")].split("|").filter(Boolean),
      isCompound: fields[idx("is_compound")].trim().toLowerCase() === "true",
    });
  }
  return rows;
}

async function loadLiveExercises(): Promise<ExerciseMatchCandidate[]> {
  const rows = await prisma.exercise.findMany({
    select: {
      id: true,
      exerciseName: true,
      typeOfEquipment: true,
      muscleGroupsActivated: true,
      movementPattern: true,
      mechanics: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.exerciseName,
    source: "free_exercise_db_live",
    equipment: [r.typeOfEquipment.toLowerCase()],
    primaryMuscles: r.muscleGroupsActivated.map((m) => m.toLowerCase()),
    movementPattern: r.movementPattern,
    mechanics: r.mechanics === "compound" || r.mechanics === "isolation" ? (r.mechanics as "compound" | "isolation") : null,
  }));
}

async function main() {
  const catalog = loadCatalog();
  const live = await loadLiveExercises();

  console.log(`Comparing ${live.length} live exercises against ${catalog.length} curated catalog entries (${live.length * catalog.length} pairs)...`);

  // Consumer-reference lookup, so the report can show real impact per row.
  const workoutRefs = await prisma.workoutExercise.groupBy({ by: ["exerciseId"], _count: { _all: true } });
  const programRefs = await prisma.workoutProgramExercise.groupBy({ by: ["exerciseId"], _count: { _all: true } });
  const refCount = new Map<string, number>();
  for (const r of workoutRefs) refCount.set(r.exerciseId, (refCount.get(r.exerciseId) ?? 0) + r._count._all);
  for (const r of programRefs) refCount.set(r.exerciseId, (refCount.get(r.exerciseId) ?? 0) + r._count._all);

  type ReportRow = {
    catalogId: string;
    catalogNameEn: string;
    catalogNameVi: string;
    liveId: string;
    liveName: string;
    decision: DuplicateDecision;
    confidence: number;
    matchedFields: string[];
    conflictingFields: string[];
    proposedAction: string;
    liveReferenceCount: number;
  };

  const byDecision: Record<DuplicateDecision, ReportRow[]> = {
    EXACT_SAME_SOURCE: [],
    EXACT_CROSS_SOURCE: [],
    LIKELY_DUPLICATE: [],
    POSSIBLE_VARIANT: [],
    MANUAL_REVIEW: [],
    DISTINCT: [],
  };

  for (const catalogRow of catalog) {
    const catalogCandidate: ExerciseMatchCandidate = {
      id: catalogRow.externalId,
      name: catalogRow.nameEn,
      source: "curated_vi_catalog",
      externalId: catalogRow.externalId,
      equipment: catalogRow.equipment,
      primaryMuscles: catalogRow.primaryMuscles,
      movementPattern: catalogRow.movementPattern,
      mechanics: catalogRow.isCompound ? "compound" : "isolation",
    };

    // Keep only the single BEST match per catalog row (highest-confidence
    // non-DISTINCT decision) — reporting every one of 883 comparisons per
    // catalog row would be noise; what matters is "does this catalog
    // entry already exist live, and if so as what kind of match."
    // Several decision tiers (POSSIBLE_VARIANT especially) return a FIXED
    // confidence score for every match in that tier, so a plain ">"
    // comparison keeps whichever live row was iterated first — not
    // necessarily the most relevant one for a human reviewer. Break ties
    // with raw name-token overlap so e.g. a "Flat Barbell Bench Press"
    // catalog row surfaces a bench-press-family live exercise as its
    // representative, not an unrelated press that merely shares one word.
    let best: { candidate: ExerciseMatchCandidate; result: ReturnType<typeof detectDuplicate>; tiebreak: number } | null = null;
    for (const liveCandidate of live) {
      const result = detectDuplicate(catalogCandidate, liveCandidate);
      if (result.decision === "DISTINCT") continue;
      const tiebreak = rawNameJaccard(catalogCandidate.name, liveCandidate.name);
      if (
        !best ||
        result.confidence > best.result.confidence ||
        (result.confidence === best.result.confidence && tiebreak > best.tiebreak)
      ) {
        best = { candidate: liveCandidate, result, tiebreak };
      }
    }

    if (!best) {
      byDecision.DISTINCT.push({
        catalogId: catalogRow.externalId,
        catalogNameEn: catalogRow.nameEn,
        catalogNameVi: catalogRow.nameVi,
        liveId: "—",
        liveName: "(no match found)",
        decision: "DISTINCT",
        confidence: 0,
        matchedFields: [],
        conflictingFields: [],
        proposedAction: "No corresponding live exercise found — this catalog entry would be a genuinely NEW exercise if imported.",
        liveReferenceCount: 0,
      });
      continue;
    }

    const row: ReportRow = {
      catalogId: catalogRow.externalId,
      catalogNameEn: catalogRow.nameEn,
      catalogNameVi: catalogRow.nameVi,
      liveId: best.candidate.id,
      liveName: best.candidate.name,
      decision: best.result.decision,
      confidence: best.result.confidence,
      matchedFields: best.result.matchedFields,
      conflictingFields: best.result.conflictingFields,
      proposedAction: best.result.proposedAction,
      liveReferenceCount: refCount.get(best.candidate.id) ?? 0,
    };
    byDecision[best.result.decision].push(row);
  }

  const outDir = path.resolve(process.cwd(), "../../../reports/data");
  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, "duplicate-candidate-report.md");

  const section = (title: string, rows: ReportRow[], guidance: string) => `
## ${title} (${rows.length})

${guidance}

| Bản ghi cũ (live) | Bản ghi mới (catalog) | Điểm giống | Điểm khác | Consumer tham chiếu | Đề xuất |
|---|---|---|---|---|---|
${rows
  .map(
    (r) =>
      `| ${r.liveName} (\`${r.liveId.slice(0, 8)}\`) | ${r.catalogNameEn} / ${r.catalogNameVi} (\`${r.catalogId}\`) | ${r.matchedFields.join(", ") || "—"} | ${r.conflictingFields.join(", ") || "—"} | ${r.liveReferenceCount} workout/program rows | ${r.proposedAction} |`,
  )
  .join("\n")}
`;

  const md = `# Duplicate Candidate Report — Live Exercises vs Curated Catalog

Generated: ${new Date().toISOString()}
Compared: ${live.length} live \`exercises\` rows × ${catalog.length} curated \`gym_exercises.csv\` entries.

**Read-only. No auto-merge was performed. Every row below is a proposal for
human review, not an executed action**, except where explicitly marked
EXACT_SAME_SOURCE/EXACT_CROSS_SOURCE (which this report still only
*reports*, it does not act on them either — Gate 5 is where any real
linking would actually run, gated on this report being reviewed first).

## Summary

| Decision | Count |
|---|---|
| EXACT_SAME_SOURCE | ${byDecision.EXACT_SAME_SOURCE.length} |
| EXACT_CROSS_SOURCE (safe to auto-link once reviewed) | ${byDecision.EXACT_CROSS_SOURCE.length} |
| LIKELY_DUPLICATE (review queue) | ${byDecision.LIKELY_DUPLICATE.length} |
| POSSIBLE_VARIANT (keep distinct, never merge) | ${byDecision.POSSIBLE_VARIANT.length} |
| MANUAL_REVIEW (ambiguous) | ${byDecision.MANUAL_REVIEW.length} |
| No match / genuinely new | ${byDecision.DISTINCT.length} |

${section("EXACT_CROSS_SOURCE — same exercise, different source (safe to alias/link)", byDecision.EXACT_CROSS_SOURCE, "These catalog entries appear to already exist live under the free-exercise-db seed, just without a Vietnamese name. The safe action (Gate 5+, not executed here) is: add the catalog's Vietnamese name/instructions as an ADDITIVE localization on the EXISTING live row (new ExerciseAlias / canonical enrichment), never replace the live row's id or delete either source.")}

${section("LIKELY_DUPLICATE — needs human confirmation before any link", byDecision.LIKELY_DUPLICATE, "Strong overlap but not deterministic. A human reviewer should confirm these are really the same exercise before any alias/link is created.")}

${section("POSSIBLE_VARIANT — related but must stay distinct", byDecision.POSSIBLE_VARIANT, "These share a base movement/name with a live exercise but differ on a real distinguishing dimension (equipment/angle/unilaterality/grip/stance). Per the task's explicit rule, these must NEVER be merged — if imported, they should become their own new exercise row, optionally cross-referenced as a 'variant of' relationship if the schema supports it.")}

${section("MANUAL_REVIEW — ambiguous, conflicting, or partial signal", byDecision.MANUAL_REVIEW, "Neither a confident match nor a confident distinct — needs a human to look at the actual two records side by side.")}

${section("No live match found — genuinely new content", byDecision.DISTINCT, "These 205-catalog entries have no meaningful match among the 883 live exercises at all — importing them would add real new exercises, not enrich existing ones.")}
`;

  fs.writeFileSync(mdPath, md);
  console.log(`Wrote ${mdPath}`);
  console.log(JSON.stringify({ summary: Object.fromEntries(Object.entries(byDecision).map(([k, v]) => [k, v.length])) }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
