import { normalizeAgentText } from "../services/fitness-agent-intent";
import type { SemanticAmbiguity, SemanticInterpretation, SemanticReference } from "./schema";

/**
 * V2.3A.7 phase 4/5 — TypeScript port of the offline, already-evaluated
 * deterministic reference-grounding guard
 * (training/semantic-qwen3-4b/scripts/reference_grounding_guard.py — see
 * docs/ai-training/qwen4b-v2-3a-deterministic-reference-grounding-guard.md
 * for the full design rationale and offline evaluation history). Pure,
 * synchronous, deterministic: no DB, no network, no LLM call, no mutable
 * global state. Frozen insertion point (V2.3A.6):
 * `interpretDeterministic()` in interpreter.ts, right after
 * `detectReferences()` computes `references`, before `ambiguities`/
 * `clarificationRequired`/the returned object are built.
 *
 * REFERENCE_REPRESENTATION_V1_OPTION_B (V2.3A.3/A.4, frozen): `references`
 * holds only grounded targets. An ungrounded reference becomes
 * `references: []`; the attempt is recorded only via `ambiguities` +
 * `clarificationRequired`.
 *
 * Guarded kinds: THIS_ITEM, PREVIOUS_STATE — the two kinds with no existing
 * grounding authority anywhere in the pipeline. ACCEPT_PROPOSAL/
 * LOWER_OPTION/HIGHER_OPTION/MIDDLE_OPTION already have a separate,
 * pre-existing authority in policy.ts (checked against `ctx.proposal`) that
 * this guard must not duplicate or conflict with. FIRST_ITEM/ORDINAL_ITEM
 * refer to a candidate list that is not visible text within one message
 * either (same single-turn constraint) — left untouched.
 */

export const GUARDED_REFERENCE_KINDS = ["THIS_ITEM", "PREVIOUS_STATE"] as const;

export type ReferenceDomain = "PT" | "PROGRAM" | "EXERCISE" | "NUMERIC";

export type GuardReason =
  | "REFERENCE_NOT_APPLICABLE"
  | "REFERENCE_GROUNDED_UNIQUE"
  | "REFERENCE_EXPLICIT_TARGET"
  | "REFERENCE_NO_VISIBLE_TARGET"
  | "REFERENCE_MULTIPLE_VISIBLE_TARGETS"
  | "REFERENCE_TYPE_MISMATCH";

export interface GuardDecision {
  referenceIndex: number;
  kind: string;
  sourceText: string;
  domain: ReferenceDomain | null;
  candidateCount: number;
  reason: GuardReason;
  invalidated: boolean;
}

export interface GuardResult {
  interpretation: SemanticInterpretation;
  decisions: GuardDecision[];
  changedFields: string[];
  activated: boolean;
}

interface Candidate {
  cls: ReferenceDomain;
  span: string;
}

// ── domain keywords (what KIND of thing is this reference asking about?) ──
const DOMAIN_PATTERNS: Record<ReferenceDomain, RegExp> = {
  PT: /\b(pt|huan luyen vien|hlv|coach)\b/,
  PROGRAM: /\b(chuong trinh|lich tap|thuc don|goi|plan)\b/,
  EXERCISE: /\b(bai tap|bai\b|exercise)\b/,
  NUMERIC: /\b(muc|so|level)\b/,
};

// ── candidate extraction patterns (what CONCRETE items are actually visible?) ──
const DEICTIC_TAIL = "(?!\\s*(?:nay|do|kia|day)\\b)";

const PT_CANDIDATE_RE = new RegExp(`\\b(?:pt|huan luyen vien|hlv|coach)\\s+${DEICTIC_TAIL}([a-z][a-z0-9]*)`, "g");

const PROGRAM_GOAL_WORDS = "(?:tang co|giam mo|giam can|tang can|giam beo|duy tri)";
const PROGRAM_CANDIDATE_RE = new RegExp(
  `\\b(?:chuong trinh|lich tap|thuc don|goi)\\s+${DEICTIC_TAIL}(\\d+|${PROGRAM_GOAL_WORDS})`,
  "g",
);

// Small, explicit exercise vocabulary — a lexical AID for candidate
// identification only; authority comes from the counting logic below, not
// from this list by itself.
const EXERCISE_VOCAB = [
  "squat", "deadlift", "bench", "leg press", "overhead press", "pull up", "push up",
  "row", "lunge", "plank", "curl", "shoulder press", "lat pulldown", "hip thrust",
];
const EXERCISE_CANDIDATE_RE = new RegExp(`\\b(${EXERCISE_VOCAB.join("|")})\\b`, "g");

// Ordinal markers consumed by the production ORDINAL_ITEM/FIRST_ITEM
// detectors are not themselves numeric "value" candidates for a
// NUMERIC-domain reference — stripped first.
const ORDINAL_MARKER_RE = /\bthu\s*(?:\d+|hai|ba|tu|nam|sau|bay)\b|\bso\s*\d+\b/g;
const NUMERIC_CANDIDATE_RE = /\b\d+(?:[.,]\d+)?\b/g;

const KEEP_DISAMBIGUATOR_RE = /\bgiu\s+([a-z0-9 ]{2,30}?)(?:[,.]|$| thi| nhung)/;

// An "explicit named target" (sourceText already names something concrete,
// e.g. "squat", "PT Lan") is self-grounded and must never be run through
// candidate counting — only a BARE deictic phrase (the demonstrative word
// with no identifying name attached, e.g. "cai do", "PT kia") genuinely
// needs an antecedent check.
const BARE_DEICTIC_SUFFIX_RE = /\b(nay|do|kia|day|cu|vua roi|luc nay|truoc)\s*$/;

function isBareDeictic(sourceTextNorm: string): boolean {
  return BARE_DEICTIC_SUFFIX_RE.test(sourceTextNorm.trim());
}

/** All concrete, nameable items visible in this one message, independent of
 * domain. Domain filtering happens separately so this stays one small
 * reusable extractor rather than one per domain. */
function extractCandidates(messageNorm: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of messageNorm.matchAll(PT_CANDIDATE_RE)) out.push({ cls: "PT", span: m[0] });
  for (const m of messageNorm.matchAll(PROGRAM_CANDIDATE_RE)) out.push({ cls: "PROGRAM", span: m[0] });
  const seenExercise = new Set<string>();
  for (const m of messageNorm.matchAll(EXERCISE_CANDIDATE_RE)) {
    const tok = m[1];
    if (!seenExercise.has(tok)) {
      seenExercise.add(tok);
      out.push({ cls: "EXERCISE", span: tok });
    }
  }
  const numericScan = messageNorm.replace(ORDINAL_MARKER_RE, " ");
  for (const m of numericScan.matchAll(NUMERIC_CANDIDATE_RE)) out.push({ cls: "NUMERIC", span: m[0] });
  return out;
}

/** The domain a reference is itself asking about (type compatibility),
 * checked ONLY against the reference's own sourceText — never against
 * unrelated words elsewhere in the message (an earlier offline-guard
 * iteration fell back to whole-message scanning and produced a false
 * NUMERIC-domain match on an unrelated word; see the Python guard's own
 * history). Returns null for GENERIC (any candidate class is compatible —
 * a bare "cái đó/kia" with no domain noun at all). */
function detectDomain(referenceSourceText: string): ReferenceDomain | null {
  const srcNorm = normalizeAgentText(referenceSourceText || "");
  for (const domain of Object.keys(DOMAIN_PATTERNS) as ReferenceDomain[]) {
    if (DOMAIN_PATTERNS[domain].test(srcNorm)) return domain;
  }
  return null;
}

/** "Giữa squat và leg press thì giữ squat, đổi bài kia": an explicit
 * "giữ <X>" clause removes X from the pool, which can collapse 2
 * candidates to 1 unique remaining target. A narrow, explicit rule — not a
 * general disambiguation NLU. */
function applyExplicitDisambiguation(messageNorm: string, candidates: Candidate[]): Candidate[] {
  const m = KEEP_DISAMBIGUATOR_RE.exec(messageNorm);
  if (!m) return candidates;
  const keptSpan = m[1].trim();
  return candidates.filter((c) => !keptSpan.includes(c.span) && !c.span.includes(keptSpan));
}

function compatibleCandidates(domain: ReferenceDomain | null, candidates: Candidate[]): Candidate[] {
  if (domain === null) return candidates;
  return candidates.filter((c) => c.cls === domain);
}

export interface GroundingOutcome {
  references: SemanticReference[];
  decisions: GuardDecision[];
  activated: boolean;
  /** Set only when `activated` — the one ambiguity entry to append (if the
   * interpretation doesn't already carry a "reference"-field one). */
  ambiguityEntry?: SemanticAmbiguity;
  /** Set only when `activated` — the confidence ceiling to apply (callers
   * take `Math.min(existingConfidence, confidenceFloor)`). */
  confidenceFloor?: number;
}

/**
 * The core guard, operating on the primitive `references` array rather than
 * a full SemanticInterpretation — this is what lets it run INSIDE
 * `interpretDeterministic()` at the frozen insertion point (right after
 * `detectReferences()`), before `primaryIntent`/`confidence` are computed
 * from `references.length`, so every downstream computation in that
 * function consistently sees only GROUNDED references, never a reference
 * the guard is about to invalidate anyway. Pure, deterministic, no
 * LLM/DB/network call.
 *
 * @param references the candidate references to validate (e.g.
 *   `detectReferences(s)`'s output).
 * @param messageText the single visible user utterance the parser actually
 *   received — visible-context only, no hidden state.
 */
export function groundReferences(references: SemanticReference[], messageText: string): GroundingOutcome {
  if (!Array.isArray(references) || references.length === 0) {
    return { references, decisions: [], activated: false };
  }

  const messageNorm = normalizeAgentText(messageText);
  const allCandidates = extractCandidates(messageNorm);

  const keptRefs: SemanticReference[] = [];
  const decisions: GuardDecision[] = [];
  let anyInvalidated = false;
  const invalidationReasons: GuardReason[] = [];

  references.forEach((ref, i) => {
    const kind = ref.kind;
    const sourceText = ref.sourceText ?? "";

    if (!(GUARDED_REFERENCE_KINDS as readonly string[]).includes(kind)) {
      keptRefs.push(ref);
      decisions.push({ referenceIndex: i, kind, sourceText, domain: null, candidateCount: -1, reason: "REFERENCE_NOT_APPLICABLE", invalidated: false });
      return;
    }

    const sourceNorm = normalizeAgentText(sourceText);
    if (!isBareDeictic(sourceNorm)) {
      // sourceText already names something concrete; self-grounded (task's
      // own "explicit named target" rule).
      keptRefs.push(ref);
      decisions.push({ referenceIndex: i, kind, sourceText, domain: null, candidateCount: -1, reason: "REFERENCE_EXPLICIT_TARGET", invalidated: false });
      return;
    }

    const domain = detectDomain(sourceText);
    const compatible = compatibleCandidates(domain, allCandidates);
    const n = compatible.length;

    if (n === 1) {
      keptRefs.push(ref);
      decisions.push({ referenceIndex: i, kind, sourceText, domain, candidateCount: n, reason: "REFERENCE_GROUNDED_UNIQUE", invalidated: false });
      return;
    }

    if (n >= 2) {
      const remaining = applyExplicitDisambiguation(messageNorm, compatible);
      if (remaining.length === 1) {
        keptRefs.push(ref);
        decisions.push({ referenceIndex: i, kind, sourceText, domain, candidateCount: n, reason: "REFERENCE_EXPLICIT_TARGET", invalidated: false });
        return;
      }
      anyInvalidated = true;
      invalidationReasons.push("REFERENCE_MULTIPLE_VISIBLE_TARGETS");
      decisions.push({ referenceIndex: i, kind, sourceText, domain, candidateCount: n, reason: "REFERENCE_MULTIPLE_VISIBLE_TARGETS", invalidated: true });
      return;
    }

    // n === 0
    let reason: GuardReason = "REFERENCE_NO_VISIBLE_TARGET";
    if (domain !== null && allCandidates.length > 0 && allCandidates.some((c) => c.cls !== domain)) {
      reason = "REFERENCE_TYPE_MISMATCH";
    }
    anyInvalidated = true;
    invalidationReasons.push(reason);
    decisions.push({ referenceIndex: i, kind, sourceText, domain, candidateCount: n, reason, invalidated: true });
  });

  if (!anyInvalidated) {
    return { references: keptRefs, decisions, activated: false };
  }

  // Bounded correction: callers touch only what's required to make the
  // interpretation safely unresolved (references/ambiguities/
  // clarificationRequired/confidence) — primaryIntent/entities/
  // requestedAction/workflowIntent are deliberately left to the caller,
  // untouched by this function.
  const isUnreachable = invalidationReasons.includes("REFERENCE_NO_VISIBLE_TARGET") || invalidationReasons.includes("REFERENCE_TYPE_MISMATCH");
  const reasonText = isUnreachable
    ? "deterministic grounding guard: no visible candidate matches this reference"
    : "deterministic grounding guard: multiple visible candidates, no explicit disambiguation";

  return {
    references: keptRefs,
    decisions,
    activated: true,
    ambiguityEntry: { field: "reference", reason: reasonText },
    confidenceFloor: isUnreachable ? 0.3 : 0.35,
  };
}

/**
 * Thin wrapper around `groundReferences()` for callers that already hold a
 * full `SemanticInterpretation` (e.g. an offline replay over a model's
 * already-fully-formed JSON output) and want the same bounded-correction
 * shape the original offline Python guard produced. Not used by
 * `interpretDeterministic()` itself — see `groundReferences()`'s own doc
 * comment for why that call site needs the lower-level function instead.
 */
export function validateReferenceGrounding(
  interpretation: SemanticInterpretation,
  messageText: string,
): GuardResult {
  const outcome = groundReferences(interpretation.references, messageText);
  if (!outcome.activated) {
    return { interpretation, decisions: outcome.decisions, changedFields: [], activated: false };
  }

  const ambiguities: SemanticAmbiguity[] = [...interpretation.ambiguities];
  if (!ambiguities.some((a) => a.field === "reference") && outcome.ambiguityEntry) {
    ambiguities.push(outcome.ambiguityEntry);
  }

  const newInterpretation: SemanticInterpretation = {
    ...interpretation,
    references: outcome.references,
    ambiguities,
    clarificationRequired: true,
    confidence: Math.min(interpretation.confidence, outcome.confidenceFloor ?? 1),
  };

  return {
    interpretation: newInterpretation,
    decisions: outcome.decisions,
    changedFields: ["references", "ambiguities", "clarificationRequired", "confidence"],
    activated: true,
  };
}
