import * as fs from "fs";
import * as path from "path";

const CATALOG_PATH = "data/catalog/plans/gym_exercises.csv";

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
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
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

function resolveCatalogFile(): string | null {
  const envPath = process.env.EXERCISE_CATALOG_PATH;
  const candidates = [
    envPath ? path.resolve(process.cwd(), envPath) : null,
    path.resolve(process.cwd(), CATALOG_PATH),
    path.resolve(process.cwd(), "../../..", CATALOG_PATH),
    path.resolve(process.cwd(), "../../../..", CATALOG_PATH),
    path.resolve(__dirname, "../../../../../", CATALOG_PATH),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One catalog row, as far as answer post-processing and Layer-1 checks need it. */
export interface CatalogExercise {
  /** Catalog row id (data/catalog/plans/gym_exercises.csv `exercise_id`, e.g. EX00104) — NOT the fitness-service Exercise.id. */
  catalogId: string;
  nameEn: string;
  nameVi: string;
  equipment: string[];
  difficulty: "beginner" | "intermediate" | "advanced" | string;
}

type Term = { term: string; exercise: CatalogExercise; kind: "canonical" | "alias" };

/**
 * Builds the term table. Rules (eval 2026-11-11, "Seated Seated Cable Row" / "Overhead Press" → "Seated Smith Machine
 * Overhead Press"):
 *  - every canonical English name maps to ITSELF, so an already-correct name is matched whole and left untouched;
 *  - an alias shared by several exercises ("overhead press" = 8 variants, "đẩy ngực tạ đòn" = flat/incline/decline) is
 *    AMBIGUOUS and never rewritten — the old map kept whichever row came last;
 *  - an alias that is a proper substring of its own canonical name ("cable row" ⊂ "Seated Cable Row", "lateral raise" ⊂
 *    "Dumbbell Lateral Raise") is a generic movement name: rewriting it would turn a general exercise into one specific
 *    variant, and re-applying it grew the name on every pass — it is kept as written.
 */
export function buildExerciseTerms(rows: CatalogExercise[], aliasesByRow: Map<string, string[]>): Term[] {
  const canonical = new Map<string, CatalogExercise>();
  for (const row of rows) canonical.set(row.nameEn.toLowerCase(), row);

  const aliasTargets = new Map<string, Set<CatalogExercise>>();
  for (const row of rows) {
    for (const raw of [row.nameVi, ...(aliasesByRow.get(row.catalogId) ?? [])]) {
      const alias = raw.trim().toLowerCase();
      if (!alias || canonical.has(alias)) continue;
      if (!aliasTargets.has(alias)) aliasTargets.set(alias, new Set());
      aliasTargets.get(alias)!.add(row);
    }
  }

  const terms: Term[] = [...canonical].map(([term, exercise]) => ({ term, exercise, kind: "canonical" as const }));
  for (const [alias, targets] of aliasTargets) {
    if (targets.size !== 1) continue; // ambiguous
    const exercise = [...targets][0];
    const target = exercise.nameEn.toLowerCase();
    if (target.includes(alias)) continue; // generic name contained in the specific canonical
    terms.push({ term: alias, exercise, kind: "alias" });
  }
  return terms;
}

const GENERIC_MODIFIER = /^(wide-grip|close-grip|neutral-grip|reverse-grip|narrow-grip|seated|standing|kneeling|lying|incline|decline|flat|barbell|dumbbell|machine|smith|cable|one-arm|single-arm|single-leg|ez-bar|bent-over|half-kneeling|landmine|band|resistance-band|kettlebell|weighted|assisted)$/i;

/** Generic names that are NOT rewritten (ambiguous, or contained in a specific canonical) → every catalog variant they cover. */
export function buildGenericFamilies(rows: CatalogExercise[], aliasesByRow: Map<string, string[]>): Map<string, CatalogExercise[]> {
  const canonical = new Set(rows.map((r) => r.nameEn.toLowerCase()));
  const families = new Map<string, Set<CatalogExercise>>();
  for (const row of rows) {
    for (const raw of [row.nameVi, ...(aliasesByRow.get(row.catalogId) ?? [])]) {
      const alias = raw.trim().toLowerCase();
      if (!alias || canonical.has(alias)) continue;
      if (!families.has(alias)) families.set(alias, new Set());
      families.get(alias)!.add(row);
    }
  }
  // English generic names derived from canonical names by dropping leading variant modifiers:
  // "Wide-Grip Lat Pulldown" / "Close-Grip Lat Pulldown" → "lat pulldown"; "Flat Barbell Bench Press" → "barbell bench press",
  // "bench press". Only forms of ≥ 2 words that are not themselves a canonical name.
  for (const row of rows) {
    const words = row.nameEn.split(/\s+/);
    for (let i = 1; i < words.length - 1 && GENERIC_MODIFIER.test(words[i - 1]); i++) {
      const generic = words.slice(i).join(" ").toLowerCase();
      if (canonical.has(generic)) continue;
      if (!families.has(generic)) families.set(generic, new Set());
      families.get(generic)!.add(row);
    }
  }
  const out = new Map<string, CatalogExercise[]>();
  for (const [alias, set] of families) {
    const list = [...set];
    if (list.length > 1 || list[0].nameEn.toLowerCase().includes(alias)) out.set(alias, list);
  }
  return out;
}

function loadCatalog(): { rows: CatalogExercise[]; aliases: Map<string, string[]> } {
  const catalogFile = resolveCatalogFile();
  const rows: CatalogExercise[] = [];
  const aliases = new Map<string, string[]>();
  if (!catalogFile) return { rows, aliases };

  try {
    const rawLines = fs.readFileSync(catalogFile, "utf-8").split("\n").map((line) => line.replace(/\r$/, ""));
    const header = parseCSVLine(rawLines[0] ?? "");
    const col = (name: string, fallback: number) => {
      const i = header.indexOf(name);
      return i >= 0 ? i : fallback;
    };
    const iId = col("exercise_id", 0), iVi = col("exercise_name_vi", 1), iEn = col("exercise_name_en", 2), iAlias = col("aliases_vi", 3);
    const iEquip = col("equipment", -1), iDiff = col("difficulty", -1);
    for (const line of rawLines.slice(1)) {
      if (!line.trim()) continue;
      const c = parseCSVLine(line);
      const nameVi = c[iVi]?.trim(), nameEn = c[iEn]?.trim();
      if (!nameVi || !nameEn) continue;
      const catalogId = c[iId]?.trim() || nameEn;
      rows.push({
        catalogId,
        nameEn,
        nameVi,
        equipment: iEquip >= 0 ? (c[iEquip] ?? "").split("|").map((s) => s.trim()).filter(Boolean) : [],
        difficulty: iDiff >= 0 ? (c[iDiff] ?? "").trim() : "",
      });
      aliases.set(catalogId, (c[iAlias] ?? "").split(";").map((s) => s.trim()).filter(Boolean));
    }
  } catch {
    return { rows: [], aliases: new Map() };
  }
  return { rows, aliases };
}

const catalog = loadCatalog();
const terms = buildExerciseTerms(catalog.rows, catalog.aliases);
const termByLower = new Map(terms.map((t) => [t.term, t]));

// ONE alternation, longest term first, applied in a SINGLE pass: text produced by a replacement is never scanned again, and
// a canonical name (which maps to itself) wins over any shorter alias that starts at the same position. Unicode-aware
// boundaries: a term never matches inside a longer word ("row" in "throw", "đẩy" in a longer Vietnamese token).
const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}_-])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}_])";
const combined = terms.length
  ? new RegExp(
      `${BOUNDARY_BEFORE}(?:${[...terms].sort((a, b) => b.term.length - a.term.length).map((t) => escapeRegExp(t.term)).join("|")})${BOUNDARY_AFTER}`,
      "giu",
    )
  : null;

/** "Romanian Deadlift (Romanian Deadlift)" — an alias explained by its own canonical name collapses to the name once. */
function collapseSelfParentheticals(text: string): string {
  return text.replace(/(\p{L}[\p{L}\p{N} '’-]*?)\s*\(\s*([^()]+?)\s*\)/gu, (whole, before: string, inner: string) => {
    const name = inner.trim();
    return before.trim().toLowerCase().endsWith(name.toLowerCase()) && termByLower.get(name.toLowerCase())?.kind === "canonical"
      ? before
      : whole;
  });
}

/**
 * Rewrites Vietnamese / alias exercise names to the catalog's canonical English name. Same behaviour for Vietnamese and
 * English text (the old version only ran when the text had Vietnamese diacritics). Idempotent:
 * normalizeExerciseNames(normalizeExerciseNames(x)) === normalizeExerciseNames(x).
 */
export function normalizeExerciseNames(text: string): string {
  if (!combined || !text) return text;
  const replaced = text.replace(combined, (match) => {
    const term = termByLower.get(match.toLowerCase());
    if (!term) return match;
    return term.kind === "canonical" ? match : term.exercise.nameEn;
  });
  return collapseSelfParentheticals(replaced);
}

/**
 * Catalog exercises named in a text (canonical names and unambiguous aliases), in order of first appearance. Used by
 * deterministic answer checks (equipment / difficulty vs what the user said) — never as a persistence identity.
 */
export function findExerciseMentions(text: string): CatalogExercise[] {
  if (!combined || !text) return [];
  const seen = new Map<string, CatalogExercise>();
  for (const m of text.matchAll(combined)) {
    const term = termByLower.get(m[0].toLowerCase());
    if (term && !seen.has(term.exercise.catalogId)) seen.set(term.exercise.catalogId, term.exercise);
  }
  return [...seen.values()];
}

const families = buildGenericFamilies(catalog.rows, catalog.aliases);
const familyRegex = families.size
  ? new RegExp(`${BOUNDARY_BEFORE}(?:${[...families.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|")})${BOUNDARY_AFTER}`, "giu")
  : null;

/**
 * Generic exercise names in a text ("Lat Pulldown", "overhead press") with every catalog variant they may refer to. Spans
 * already covered by a specific canonical name are skipped. Used for constraint checks only — a generic name violates a
 * constraint only if ALL its variants do.
 */
export function findGenericExerciseMentions(text: string): Array<{ term: string; index: number; variants: CatalogExercise[] }> {
  if (!familyRegex || !combined || !text) return [];
  const covered: Array<[number, number]> = [];
  for (const m of text.matchAll(combined)) {
    if (termByLower.get(m[0].toLowerCase())?.kind === "canonical") covered.push([m.index!, m.index! + m[0].length]);
  }
  const seen = new Map<string, { term: string; index: number; variants: CatalogExercise[] }>();
  for (const m of text.matchAll(familyRegex)) {
    const start = m.index!, end = start + m[0].length;
    if (covered.some(([a, b]) => start >= a && end <= b)) continue;
    const key = m[0].toLowerCase();
    if (!seen.has(key)) seen.set(key, { term: m[0], index: start, variants: families.get(key) ?? [] });
  }
  return [...seen.values()];
}

/** Read-only view of the loaded catalog (tests and offline eval checks). */
export function exerciseCatalogRows(): readonly CatalogExercise[] {
  return catalog.rows;
}
