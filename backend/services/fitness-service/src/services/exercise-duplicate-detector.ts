/**
 * Gate 3 — multi-signal exercise duplicate/variant detection.
 *
 * Root-cause requirement this exists to satisfy: name-only matching is
 * exactly what the task's own examples warn against — "Bench Press" and
 * "Dumbbell Bench Press" are NOT the same exercise and must never be
 * silently merged just because their names overlap. This module is a pure,
 * deterministic, fully unit-testable classifier — no LLM, no fuzzy
 * ML-similarity black box — so every decision is explainable and
 * reproducible. It NEVER writes to a database; callers decide what to do
 * with the returned decision (auto-link, queue for review, or leave
 * distinct).
 *
 * Match-key priority (per the task's own spec, checked in order):
 *   1. source + externalId               -> EXACT_SAME_SOURCE
 *   2. canonicalSlug                      -> EXACT_SAME_SOURCE (once slugs exist)
 *   3. normalizedName + equipment + movementPattern -> EXACT_CROSS_SOURCE (if no variant conflict)
 *   4. normalizedName + primaryMuscles + equipment   -> EXACT_CROSS_SOURCE (if no variant conflict)
 * Below that: token-overlap heuristics distinguishing LIKELY_DUPLICATE
 * (probably the same exercise, send to review) from POSSIBLE_VARIANT
 * (related but a real distinct exercise — the explicit non-merge list).
 *
 * Auto-link is only ever returned for EXACT_SAME_SOURCE or a conflict-free
 * EXACT_CROSS_SOURCE match — LIKELY_DUPLICATE and POSSIBLE_VARIANT always
 * go to a review queue, never auto-merged, per the task's explicit rule.
 */

export type DuplicateDecision =
  | "EXACT_SAME_SOURCE"
  | "EXACT_CROSS_SOURCE"
  | "LIKELY_DUPLICATE"
  | "POSSIBLE_VARIANT"
  | "DISTINCT"
  | "MANUAL_REVIEW";

export interface ExerciseMatchCandidate {
  id: string;
  name: string;
  source: string; // e.g. "free_exercise_db" | "curated_vi" | "wger"
  externalId?: string | null;
  canonicalSlug?: string | null;
  equipment: string[]; // normalized equipment tokens, e.g. ["barbell","bench"]
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  movementPattern?: string | null;
  mechanics?: "compound" | "isolation" | null;
  isUnilateral?: boolean | null;
}

export interface DuplicateMatchResult {
  decision: DuplicateDecision;
  confidence: number; // 0-1
  matchedFields: string[];
  conflictingFields: string[];
  proposedAction: string;
  affectedForeignKeys: string[]; // which of the two candidate ids would be affected if merged/linked
}

// ── Name normalization ───────────────────────────────────────────────────

const STOPWORDS = new Set(["a", "an", "the", "with", "on", "using", "and"]);

export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/đ/g, "d") // Vietnamese đ/Đ is a distinct precomposed character, NOT a base+combining-mark pair — NFD below does not decompose it, so it must be handled explicitly (same fix already applied in ai-service's nutrition_engine.ts).
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip remaining combining diacritics (Vietnamese tone marks, horn/breve, etc.)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((tok) => tok.length > 0 && !STOPWORDS.has(tok))
    .join(" ")
    .trim();
}

function tokenSet(name: string): Set<string> {
  return new Set(normalizeExerciseName(name).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Hard variant-distinguishing dimensions ───────────────────────────────
// Any name-token overlap between two exercises that differ on ONE of these
// groups is a real, distinct exercise — never auto-merge, never even
// silently classify as "likely duplicate". This directly encodes the
// task's explicit non-merge examples (bench vs dumbbell bench, flat vs
// incline, back vs front squat, conventional vs Romanian deadlift, cable
// row vs barbell row, left/right unilateral, machine vs free-weight).
const VARIANT_GROUPS: string[][] = [
  ["barbell", "dumbbell", "machine", "cable", "kettlebell", "bodyweight", "band", "smith", "trap", "ez", "bar"],
  ["incline", "decline", "flat"],
  ["front", "back", "box", "goblet", "hack", "split", "bulgarian", "sumo", "conventional", "romanian", "deficit", "stiff", "zercher"],
  ["left", "right", "unilateral", "single", "one", "alternating"],
  ["close", "wide", "underhand", "overhand", "neutral", "reverse", "supinated", "pronated"],
  ["seated", "standing", "lying", "kneeling"],
];

/** Checks BOTH exercises' name tokens AND their equipment arrays for a
 * hard variant-distinguishing conflict — a difference that shows up only
 * in structured equipment data (e.g. plain "Bench Press" vs "Dumbbell
 * Bench Press" where only the equipment field, not necessarily every
 * name, carries the distinguishing word) must be caught just as reliably
 * as one spelled out in both names. */
function variantConflicts(
  nameA: string,
  nameB: string,
  equipmentA: string[],
  equipmentB: string[],
): string[] {
  const tokensA = new Set([...tokenSet(nameA), ...equipmentA.map((e) => e.toLowerCase())]);
  const tokensB = new Set([...tokenSet(nameB), ...equipmentB.map((e) => e.toLowerCase())]);
  const conflicts: string[] = [];
  for (const group of VARIANT_GROUPS) {
    const inA = group.find((g) => tokensA.has(g));
    const inB = group.find((g) => tokensB.has(g));
    if (inA && inB && inA !== inB) {
      conflicts.push(`variant:${inA}!=${inB}`);
    }
  }
  return conflicts;
}

/** Name-token overlap computed AFTER stripping variant-distinguishing
 * words from both sides — "back squat" vs "front squat" share their real
 * base movement ("squat") once "back"/"front" are removed, but a plain
 * jaccard over the raw tokens undercounts that overlap precisely because
 * the distinguishing words themselves count against it. This is what lets
 * the conflict check below fire on a genuinely related pair instead of
 * two names that just happen to share no variant-group word at all. */
function baseNameOverlap(nameA: string, nameB: string): number {
  const variantWords = new Set(VARIANT_GROUPS.flat());
  const stripVariants = (tokens: Set<string>) => new Set([...tokens].filter((t) => !variantWords.has(t)));
  return jaccard(stripVariants(tokenSet(nameA)), stripVariants(tokenSet(nameB)));
}

function equipmentOverlap(a: string[], b: string[]): { overlap: number; matches: boolean } {
  const setA = new Set(a.map((e) => e.toLowerCase()));
  const setB = new Set(b.map((e) => e.toLowerCase()));
  const overlap = jaccard(setA, setB);
  return { overlap, matches: overlap >= 0.5 };
}

function muscleOverlap(a: string[], b: string[]): { overlap: number; matches: boolean } {
  const setA = new Set(a.map((m) => m.toLowerCase()));
  const setB = new Set(b.map((m) => m.toLowerCase()));
  const overlap = jaccard(setA, setB);
  return { overlap, matches: overlap >= 0.5 };
}

export function detectDuplicate(
  a: ExerciseMatchCandidate,
  b: ExerciseMatchCandidate,
): DuplicateMatchResult {
  const affectedForeignKeys = [a.id, b.id];

  // 1. source + externalId
  if (a.source === b.source && a.externalId && b.externalId && a.externalId === b.externalId) {
    return {
      decision: "EXACT_SAME_SOURCE",
      confidence: 1,
      matchedFields: ["source", "externalId"],
      conflictingFields: [],
      proposedAction: "Auto-link — identical source record, safe to treat as the same row.",
      affectedForeignKeys,
    };
  }

  // 2. canonicalSlug
  if (a.canonicalSlug && b.canonicalSlug && a.canonicalSlug === b.canonicalSlug) {
    return {
      decision: "EXACT_SAME_SOURCE",
      confidence: 1,
      matchedFields: ["canonicalSlug"],
      conflictingFields: [],
      proposedAction: "Auto-link — identical canonical slug.",
      affectedForeignKeys,
    };
  }

  const normA = normalizeExerciseName(a.name);
  const normB = normalizeExerciseName(b.name);
  const nameIdentical = normA === normB && normA.length > 0;
  const conflicts = variantConflicts(a.name, b.name, a.equipment, b.equipment);
  const equip = equipmentOverlap(a.equipment, b.equipment);
  const muscles = muscleOverlap(a.primaryMuscles, b.primaryMuscles);
  const movementMatches =
    a.movementPattern != null &&
    b.movementPattern != null &&
    a.movementPattern.toLowerCase() === b.movementPattern.toLowerCase();

  // A hard variant conflict (e.g. "incline" vs "flat", or "barbell" vs
  // "dumbbell" surfaced only via the equipment field) is decisive
  // regardless of everything else — this is precisely the case the task
  // says must never be auto-merged, even when the base movement otherwise
  // matches strongly. baseNameOverlap (computed AFTER stripping the very
  // variant words being compared) is the right relatedness signal here —
  // a plain raw-token jaccard would undercount "back squat"/"front squat"
  // precisely because the distinguishing words count against it.
  if (conflicts.length > 0 && (nameIdentical || baseNameOverlap(a.name, b.name) >= 0.5 || equip.overlap >= 0.5)) {
    return {
      decision: "POSSIBLE_VARIANT",
      confidence: 0.6,
      matchedFields: [
        ...(nameIdentical ? ["normalizedName"] : ["nameTokenOverlap"]),
        ...(equip.matches ? ["equipment"] : []),
        ...(muscles.matches ? ["primaryMuscles"] : []),
      ],
      conflictingFields: conflicts,
      proposedAction:
        "DO NOT MERGE — related movement but a distinguishing variant dimension differs (equipment/angle/unilaterality/grip/stance). Keep as distinct exercises; consider an explicit 'variant of' relationship if the canonical schema supports it, never a single merged row.",
      affectedForeignKeys,
    };
  }

  // 3. normalizedName + equipment + movementPattern
  if (nameIdentical && equip.matches && movementMatches) {
    return {
      decision: "EXACT_CROSS_SOURCE",
      confidence: 0.95,
      matchedFields: ["normalizedName", "equipment", "movementPattern"],
      conflictingFields: [],
      proposedAction:
        "Auto-link as the same exercise across sources — add the second source as an ExerciseSource/alias record on the canonical (older/higher-quality) row, never delete either row.",
      affectedForeignKeys,
    };
  }

  // 4. normalizedName + primaryMuscles + equipment
  if (nameIdentical && muscles.matches && equip.matches) {
    return {
      decision: "EXACT_CROSS_SOURCE",
      confidence: 0.9,
      matchedFields: ["normalizedName", "primaryMuscles", "equipment"],
      conflictingFields: [],
      proposedAction:
        "Auto-link as the same exercise across sources — add the second source as an ExerciseSource/alias record on the canonical row, never delete either row.",
      affectedForeignKeys,
    };
  }

  // Identical name but a real signal conflict (e.g. name matches but
  // movement pattern / muscles disagree) — ambiguous, needs a human.
  if (nameIdentical && !equip.matches) {
    return {
      decision: "MANUAL_REVIEW",
      confidence: 0.5,
      matchedFields: ["normalizedName"],
      conflictingFields: ["equipment"],
      proposedAction:
        "Same name but equipment signals disagree (e.g. a name-only catalog inconsistency, or two genuinely different exercises that happen to share a name) — needs human review, not an automatic decision either way.",
      affectedForeignKeys,
    };
  }

  const nameOverlap = jaccard(tokenSet(a.name), tokenSet(b.name));
  if (nameOverlap >= 0.6 && (equip.matches || muscles.matches) && conflicts.length === 0) {
    return {
      decision: "LIKELY_DUPLICATE",
      confidence: Math.round(((nameOverlap + (equip.matches ? 1 : 0) + (muscles.matches ? 1 : 0)) / 3) * 100) / 100,
      matchedFields: [
        "nameTokenOverlap",
        ...(equip.matches ? ["equipment"] : []),
        ...(muscles.matches ? ["primaryMuscles"] : []),
      ],
      conflictingFields: [],
      proposedAction:
        "Send to review queue — strong but not deterministic overlap. A human must confirm before any link/merge; never auto-merged.",
      affectedForeignKeys,
    };
  }

  if (nameOverlap >= 0.3 && conflicts.length === 0) {
    return {
      decision: "MANUAL_REVIEW",
      confidence: Math.round(nameOverlap * 100) / 100,
      matchedFields: nameOverlap > 0 ? ["partialNameOverlap"] : [],
      conflictingFields: [],
      proposedAction: "Some name overlap but insufficient corroborating signal — needs human judgment.",
      affectedForeignKeys,
    };
  }

  return {
    decision: "DISTINCT",
    confidence: 1 - nameOverlap,
    matchedFields: [],
    conflictingFields: conflicts,
    proposedAction: "No meaningful overlap — treat as unrelated exercises.",
    affectedForeignKeys,
  };
}
