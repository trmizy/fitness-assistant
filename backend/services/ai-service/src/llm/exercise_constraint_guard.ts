import { findExerciseMentions, findGenericExerciseMentions, type CatalogExercise } from "./exercise_name_normalizer";
import type { TurnFacts } from "./turn_facts";

/**
 * Deterministic post-LLM check of the exercises an answer recommends against what the user said (TurnFacts):
 *  - equipment: an exercise whose catalog equipment the user does not have ("ở nhà, không có tạ" → no Goblet Squat / machine);
 *  - difficulty: an `advanced` catalog exercise for someone who never trained or just started (B1-12: Nordic Ham Curl for a
 *    52-year-old who had never exercised).
 *
 * Design (P1-03 review, 2026-11-12):
 *  1. Every exercise is judged by ITS OWN catalog row (equipment is an "any of" list: doable if it lists bodyweight or any
 *     item the user has). There is no name-based exemption. Rows whose catalog label is known to be questionable are handled by
 *     CATALOG_EQUIPMENT_OVERRIDES — keyed by catalogId, each with a reason — so the data fix can later replace the override.
 *  2. Exercises are identified through the catalog resolver (canonical names, unambiguous aliases, generic names whose
 *     variants ALL violate) — never by free-text guessing. A name that is not in the catalog is invisible to this guard
 *     (limitation; the V2 path is structured recommendations → exercise-substitution on Exercise.id, which needs the
 *     fitness-service and is not reachable in the chat path).
 *  3. Missing / unusable metadata (empty equipment, unknown equipment token, missing difficulty, a generic name qualified by a
 *     non-catalog variant word) is reported as `unverified`: never removed, never silently treated as OK, counted in the result.
 *  4. Exercises mentioned as things to AVOID / alternatives not to do ("không nên", "tránh", "thay vì X", "avoid", "if you
 *     have …") are neither violations nor removed.
 *  5. The repair is non-destructive: only a pure list item / table row whose every exercise violates is removed (with its
 *     indented sub-bullets); a line that also recommends a doable exercise is kept; if removal would leave no recommended
 *     exercise or drop more than half of the answer, nothing is removed and only the warning note is appended.
 */

const ALWAYS_OK = new Set(["bodyweight", "foam_roller"]);
const NEEDS_EQUIPMENT = new Set(["barbell", "bench", "machine", "smith_machine", "cable", "landmine", "trap_bar", "sled", "treadmill", "bike", "rower", "battle_rope", "suspension_trainer", "pullup_bar", "dumbbell", "kettlebell", "box", "ab_wheel", "medicine_ball", "resistance_band"]);
const KNOWN_TOKENS = new Set([...ALWAYS_OK, ...NEEDS_EQUIPMENT]);
const MAX_REMOVED_SHARE = 0.5;

export interface ExerciseViolation { name: string; exercise: CatalogExercise; reason: "equipment" | "difficulty"; detail: string }
export interface ExerciseUnverified { name: string; exercise: CatalogExercise; reason: "equipment_metadata" | "difficulty_metadata" | "variant_not_in_catalog"; detail: string }
export type ExerciseAssessment =
  | { status: "ok" }
  | { status: "violation"; reason: ExerciseViolation["reason"]; detail: string }
  | { status: "unverified"; reason: ExerciseUnverified["reason"]; detail: string };

/** How prose / generic names are resolved to catalog rows. Injectable so tests can use hand-built rows; defaults to the catalog. */
export interface ExerciseResolver {
  exact(text: string): CatalogExercise[];
  generic(text: string): Array<{ term: string; index: number; variants: CatalogExercise[] }>;
}
const DEFAULT_RESOLVER: ExerciseResolver = { exact: findExerciseMentions, generic: findGenericExerciseMentions };

/**
 * Catalog rows whose equipment label is known to be questionable (data quality, MR1 2026-11-12). Keyed by catalogId and bound
 * to the row's English name (an id that now points at another exercise gets no exemption). `alsoDoableWith` is ADDED to the
 * row's own "any of" list. Keep this table small — the real fix is the catalog CSV; once a row is corrected, delete its entry.
 * NOT overridden although it looks mislabelled: EX00079 Walking Lunge (`dumbbell`, while Forward/Reverse Lunge are
 * `bodyweight`) — the review requires the catalog row to decide; fix the CSV if it should be bodyweight-capable.
 */
export const CATALOG_EQUIPMENT_OVERRIDES: Record<string, { nameEn: string; alsoDoableWith: string[]; reason: string }> = {
  EX00099: { nameEn: "Standing Calf Raise", alsoDoableWith: ["bodyweight"], reason: "Catalog lists `machine` only; a single/double-leg calf raise from a stair edge is the standard no-equipment variant." },
  EX00081: { nameEn: "Step-Up", alsoDoableWith: ["bodyweight"], reason: "Catalog lists `box`, a token users cannot state; a stair or a sturdy chair does the same job without any gym equipment." },
  EX00140: { nameEn: "Prone Y Raise", alsoDoableWith: ["bodyweight"], reason: "Catalog lists `dumbbell`; the Y raise is normally done unloaded (a scapular-control drill) and a light dumbbell is optional." },
};

function effectiveEquipment(ex: CatalogExercise): string[] {
  const o = CATALOG_EQUIPMENT_OVERRIDES[ex.catalogId];
  return o && o.nameEn === ex.nameEn ? [...ex.equipment, ...o.alsoDoableWith] : ex.equipment;
}

/** A fact constrains the answer unless it was explicitly NEGATED or is UNKNOWN (absent status = ASSERTED; HYPOTHETICAL applies). */
function active<T extends { status?: string }>(f: T | undefined): T | undefined {
  return f && f.status !== "NEGATED" && f.status !== "UNKNOWN" ? f : undefined;
}

/** Judges ONE catalog row against the stated constraints. */
export function assessExercise(ex: CatalogExercise, facts: TurnFacts): ExerciseAssessment {
  const fact = active(facts.equipment as { value: string[]; status?: string; scope?: string; excluded?: string[] } | undefined);
  const eq = fact?.value;
  // INCLUSIVE ("Tôi có tạ đơn", "không có máy"): only what the user DENIED rules an exercise out — unmentioned kit is unknown,
  // never absent (V1 stabilization 2026-11-12). An exercise is flagged only when EVERY way to do it needs a denied item.
  if (fact?.scope === "INCLUSIVE") {
    const denied = new Set(fact.excluded ?? []);
    const options = effectiveEquipment(ex);
    if (denied.size && options.length && !eq?.includes("gym") && options.every((e) => denied.has(e) && !ALWAYS_OK.has(e) && !eq?.includes(e))) {
      return { status: "violation", reason: "equipment", detail: options.join(",") };
    }
  } else if (eq && eq.length && !eq.includes("gym")) {
    const options = effectiveEquipment(ex);
    if (!options.length) return { status: "unverified", reason: "equipment_metadata", detail: "no equipment listed" };
    // "any of": one available option is enough.
    if (!options.some((e) => ALWAYS_OK.has(e) || eq.includes(e))) {
      const unknown = options.filter((e) => !KNOWN_TOKENS.has(e));
      if (unknown.length) return novice(facts) && ex.difficulty === "advanced"
        ? { status: "violation", reason: "difficulty", detail: ex.difficulty }
        : { status: "unverified", reason: "equipment_metadata", detail: `unknown equipment: ${unknown.join(",")}` };
      return { status: "violation", reason: "equipment", detail: options.filter((e) => NEEDS_EQUIPMENT.has(e)).join(",") };
    }
  }
  if (novice(facts)) {
    if (ex.difficulty === "advanced") return { status: "violation", reason: "difficulty", detail: ex.difficulty };
    if (ex.difficulty !== "beginner" && ex.difficulty !== "intermediate") return { status: "unverified", reason: "difficulty_metadata", detail: ex.difficulty || "no difficulty listed" };
  }
  return { status: "ok" };
}

function novice(facts: TurnFacts): boolean {
  const v = active(facts.experience as { value: string; status?: string } | undefined)?.value;
  return v === "never" || v === "beginner";
}

// A generic name right after one of these words is a qualified variant that is not a catalog row ("Side-Lying External
// Rotation"): the family's equipment says nothing about it → unverified, not a violation.
const VARIANT_QUALIFIER = /\b(side-?lying|bodyweight|floor|prone|towel|wall)\s*$/i;
// An equipment word right before a generic name NAMES the variant's equipment ("Resistance Band Chest Press", "Cable Chest
// Press"): that equipment — not the generic family's catalog rows — is what must be checked (Nova Pro recheck B4-09,
// 2026-11-12: a band chest press for a band-only user got "chưa nên chọn Chest Press (cần dụng cụ bạn chưa có)").
const EQUIPMENT_QUALIFIER: Array<[RegExp, string]> = [
  [/\b(resistance[\s-]band|mini[\s-]band|banded|band)\s*$/i, "resistance_band"],
  [/\b(dumbbell|db)\s*$/i, "dumbbell"],
  [/\b(kettlebell|kb)\s*$/i, "kettlebell"],
  [/\b(smith(?:\s+machine)?)\s*$/i, "smith_machine"],
  [/\b(barbell|ez[\s-]?bar|trap[\s-]?bar)\s*$/i, "barbell"],
  [/\b(cable)\s*$/i, "cable"],
  [/\b(machine)\s*$/i, "machine"],
];
function qualifierEquipment(prefix: string): string | null {
  for (const [re, token] of EQUIPMENT_QUALIFIER) if (re.test(prefix)) return token;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Recommended vs mentioned-to-avoid
// ---------------------------------------------------------------------------------------------------------------------

// The whole sentence / list item is about what NOT to do (or is conditional on equipment the user said they lack).
// ("cần máy" alone is deliberately NOT a cue: "Leg Press (cần máy)" is still a recommendation of a machine exercise.)
// "mình đã bỏ" / "chưa nên chọn" = the guard's OWN appended note: it names excluded exercises and must never be re-flagged
// (idempotency — a second pass over a repaired answer must not add a second note; Nova Pro recheck B1-12 / B4-09).
const AVOID_WHOLE = /(?<![\p{L}\p{N}])(?:mình\s+đã\s+bỏ|chưa\s+nên\s+chọn|không\s+nên|không\s+được|không\s+phù\s+hợp|không\s+khuyến\s+khích|tránh|đừng|chớ|bỏ\s+qua|nếu\s+có|nếu\s+bạn\s+có|avoid|don['’]?t|do\s+not|shouldn['’]?t|should\s+not|skip|not\s+recommended|if\s+you\s+have|if\s+you['’]?ve\s+got)(?![\p{L}\p{N}])/iu;
// "X thay vì Y" / "instead of Y": only Y (the text after the cue up to the next clause break) is the avoided exercise.
const AVOID_SPAN = /(?<![\p{L}\p{N}])(?:thay\s+vì|thay\s+cho|instead\s+of|rather\s+than|in\s+place\s+of)(?![\p{L}\p{N}])[^,;.:()\n—–]*/giu;
const LIST_OR_ROW = /^\s*(?:[-+•]|\*(?!\*)|\d+[.)]|\|)/; // "**bold**" is not a bullet
const HEADER_LIKE = /[:：]\s*\**\s*$|^\s*#{1,6}\s/;

const blank = (s: string) => s.replace(/[^\n]/g, " ");
const maskSpans = (s: string) => s.replace(AVOID_SPAN, blank);
/** Prose: sentence by sentence; a sentence with an avoidance cue is masked whole, otherwise only its "instead of …" span. */
function maskProse(raw: string): string {
  return raw.split(/(?<=[.!?])(\s+)/).map((p, i) => (i % 2 === 1 ? p : AVOID_WHOLE.test(p.normalize("NFC")) ? blank(p) : maskSpans(p))).join("");
}

type Mention = { key: string; name: string; exercise: CatalogExercise; assessment: ExerciseAssessment };
interface Line { raw: string; kind: "blank" | "list" | "row" | "prose"; indent: number; mentions: Mention[] }

function mentionsIn(text: string, facts: TurnFacts, resolver: ExerciseResolver): Mention[] {
  const out: Mention[] = [];
  if (!text.trim()) return out;
  for (const ex of resolver.exact(text)) out.push({ key: `id:${ex.catalogId}`, name: ex.nameEn, exercise: ex, assessment: assessExercise(ex, facts) });
  for (const g of resolver.generic(text)) {
    const results = g.variants.map((v) => assessExercise(v, facts));
    if (!results.length) continue;
    // A generic name violates only if EVERY variant violates; one doable variant clears it; otherwise unverified.
    let assessment: ExerciseAssessment;
    const qualifier = qualifierEquipment(text.slice(Math.max(0, g.index - 24), g.index));
    if (qualifier) {
      // judge the named variant by its named equipment (difficulty taken from the family's first row)
      assessment = assessExercise({ ...g.variants[0], catalogId: `${g.variants[0].catalogId}~${qualifier}`, equipment: [qualifier] }, facts);
      out.push({ key: `g:${qualifier}:${g.term.toLowerCase()}`, name: `${text.slice(Math.max(0, g.index - 24), g.index).match(/[\w-]+(?:\s+[\w-]+)?\s*$/)?.[0].trim() ?? qualifier} ${g.term}`.trim(), exercise: g.variants[0], assessment });
      continue;
    }
    if (results.some((r) => r.status === "ok")) assessment = { status: "ok" };
    else {
      const unv = results.find((r) => r.status === "unverified");
      if (unv) assessment = unv;
      else if (VARIANT_QUALIFIER.test(text.slice(Math.max(0, g.index - 20), g.index))) assessment = { status: "unverified", reason: "variant_not_in_catalog", detail: `${g.term} (qualified variant)` };
      else assessment = results[0];
    }
    out.push({ key: `g:${g.term.toLowerCase()}`, name: g.term, exercise: g.variants[0], assessment });
  }
  return out;
}

function analyse(answer: string, facts: TurnFacts, resolver: ExerciseResolver): Line[] {
  const lines: Line[] = [];
  let avoidFloor: number | null = null; // list/row lines deeper than this indent belong to an "avoid" heading
  for (const raw of answer.split("\n")) {
    const t = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    if (!t) { lines.push({ raw, kind: "blank", indent, mentions: [] }); continue; }
    const kind: Line["kind"] = LIST_OR_ROW.test(raw) ? (t.startsWith("|") ? "row" : "list") : "prose";
    const cue = AVOID_WHOLE.test(t.normalize("NFC"));
    const header = HEADER_LIKE.test(t);
    let scan: string;
    if (kind === "prose") {
      avoidFloor = header && cue ? -1 : null;
      scan = maskProse(raw);
    } else {
      if (avoidFloor !== null && indent <= avoidFloor) avoidFloor = null;
      const avoided = avoidFloor !== null || cue;
      if (kind === "list" && header && cue) avoidFloor = indent;
      scan = avoided ? blank(raw) : maskSpans(raw);
    }
    lines.push({ raw, kind, indent, mentions: mentionsIn(scan, facts, resolver) });
  }
  return lines;
}

function collect(lines: Line[]): { violations: ExerciseViolation[]; unverified: ExerciseUnverified[]; keys: Map<string, ExerciseViolation> } {
  const violations: ExerciseViolation[] = [], unverified: ExerciseUnverified[] = [], seenV = new Map<string, ExerciseViolation>(), seenU = new Set<string>();
  for (const l of lines) for (const m of l.mentions) {
    const a = m.assessment;
    if (a.status === "violation" && !seenV.has(m.key)) {
      const v: ExerciseViolation = { name: m.name, exercise: m.exercise, reason: a.reason, detail: a.detail };
      seenV.set(m.key, v); violations.push(v);
    } else if (a.status === "unverified" && !seenU.has(m.key)) {
      seenU.add(m.key); unverified.push({ name: m.name, exercise: m.exercise, reason: a.reason, detail: a.detail });
    }
  }
  return { violations, unverified, keys: seenV };
}

export function findExerciseViolations(answer: string, facts: TurnFacts, resolver: ExerciseResolver = DEFAULT_RESOLVER): ExerciseViolation[] {
  return collect(analyse(answer, facts, resolver)).violations;
}

/** Exercises the answer recommends whose catalog metadata is missing/unusable for the stated constraints (never removed). */
export function findUnverifiedExercises(answer: string, facts: TurnFacts, resolver: ExerciseResolver = DEFAULT_RESOLVER): ExerciseUnverified[] {
  return collect(analyse(answer, facts, resolver)).unverified;
}

const describe = (vs: ExerciseViolation[]): string => {
  const names = (r: ExerciseViolation["reason"]) => [...new Set(vs.filter((v) => v.reason === r).map((v) => v.name))];
  const eqNames = names("equipment"), diffNames = names("difficulty");
  return [
    eqNames.length ? `${eqNames.join(", ")} (cần dụng cụ bạn chưa có)` : "",
    diffNames.length ? `${diffNames.join(", ")} (quá khó cho người mới bắt đầu)` : "",
  ].filter(Boolean).join("; ");
};

export function enforceExerciseConstraints(
  answer: string,
  facts: TurnFacts,
  resolver: ExerciseResolver = DEFAULT_RESOLVER,
): { answer: string; violations: ExerciseViolation[]; removedLines: number; unverified: ExerciseUnverified[] } {
  const lines = analyse(answer, facts, resolver);
  const { violations, unverified, keys } = collect(lines);
  if (!violations.length) return { answer, violations, removedLines: 0, unverified };

  // Candidate removals: a pure list item / table row whose every exercise violates (+ its deeper-indented sub-lines).
  const onlyViolations = (l: Line) => l.mentions.every((m) => m.assessment.status === "violation");
  let remove = new Set<number>();
  lines.forEach((l, i) => {
    if ((l.kind !== "list" && l.kind !== "row") || !l.mentions.length || !onlyViolations(l)) return;
    const group = [i];
    if (l.kind === "list") {
      for (let j = i + 1; j < lines.length && lines[j].kind !== "blank" && lines[j].indent > l.indent; j++) group.push(j);
    }
    // a sub-line that recommends a doable (or unverified) exercise keeps the whole item
    if (group.every((j) => onlyViolations(lines[j]))) group.forEach((j) => remove.add(j));
  });
  // Safety valves: keep the text (and only append the note) when removal would leave no recommended exercise or too little text.
  const removedChars = [...remove].reduce((n, i) => n + lines[i].raw.length + 1, 0);
  const keepsARecommendation = lines.some((l, i) => !remove.has(i) && l.mentions.some((m) => m.assessment.status !== "violation"));
  if (!remove.size || !keepsARecommendation || removedChars > answer.length * MAX_REMOVED_SHARE) remove = new Set();

  const stillMentioned = new Set<string>();
  lines.forEach((l, i) => { if (!remove.has(i)) for (const m of l.mentions) if (m.assessment.status === "violation") stillMentioned.add(m.key); });
  const gone = [...keys].filter(([k]) => !stillMentioned.has(k)).map(([, v]) => v);
  const left = violations.filter((v) => !gone.includes(v));

  const kept = lines.filter((_, i) => !remove.has(i)).map((l) => l.raw);
  const body = remove.size ? kept.join("\n") : answer;
  const note = gone.length && left.length
    ? `Mình đã bỏ ${describe(gone)}; lưu ý: chưa nên chọn ${describe(left)}`
    : `${gone.length ? "Mình đã bỏ" : "Lưu ý: chưa nên chọn"} ${describe(violations)}`;
  return {
    answer: `${body.trimEnd()}\n\n⚠️ ${note} — hãy chọn bài cùng nhóm cơ phù hợp hơn.`,
    violations,
    removedLines: remove.size,
    unverified,
  };
}
