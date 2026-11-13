/**
 * M7-P5A.1 — annotation CONTRACT for the future human-labelled routing dataset (schema "m7-p5a1"). Single source of truth
 * for the validator, the agreement metrics, the dataset-level checks and the (future) runner's scoring. Pure: no I/O, no
 * network, no model. It never creates, repairs or guesses a label — it only defines shapes and DERIVES expectations.
 *
 * Ordered domain labels (owner Decision 1, = the v4 ordering policy as implemented by the router: asks first, supports
 * only fill free slots — routing-planner.ts):
 *   1. domains with an EXPLICIT request come first, in order of first appearance in the question;
 *   2. a domain is listed once (deduplicated);
 *   3. SUPPORT-only domains (the user's own data from that domain is needed to answer a request — not a mere mention)
 *      come after all request domains, ordered by the position of the request they serve (ties: order of mention);
 *   4. a domain that is both explicitly asked and a support is listed once, as a REQUEST, at its request position;
 *   5. at most MAX_EXECUTING_AGENTS (2) run: the first two of the ordered list;
 *   6. the rest is DEFERRED and must be disclosed.
 * For non-ambiguous cases acceptable sets / deferred agents are DERIVED here, never typed by a person.
 */
import type { AgentLabel } from "../m5-benchmark/dataset-v1";

export const SCHEMA_VERSION = "m7-p5a1" as const;
export const AGENTS: readonly AgentLabel[] = Object.freeze(["training", "nutrition", "recovery", "progress"]);
export const CATEGORIES = ["SINGLE", "TWO", "MULTI", "OOS", "AMBIGUOUS"] as const;
export const SAFETY_VALUES = ["NONE", "MINOR", "INJECTION", "HIGH_RISK"] as const;
export const PRE_ROUTING_VALUES = ["ALLOW", "SAFETY_BLOCK"] as const;
export const ROLES = ["request", "support"] as const;
export const TAGS = ["multi_clause", "no_keyword", "unaccented", "minor", "prompt_injection", "high_risk", "long_question", "review"] as const;
export const SOURCE_KINDS = ["synthetic", "permitted"] as const;
/** maxAgentsPerTurn of the V2 supervisor (DEFAULT_EXECUTION_POLICY). */
export const MAX_EXECUTING_AGENTS = 2;
/** The routing model only sees this many characters (hybrid-router ROUTING_MODEL_LIMITS.maxQuestionChars). */
export const ROUTING_QUESTION_CHARS = 600;
/** POST /ai/v2/ask body limit and supervisor PILOT_LIMITS.maxQuestionChars — longer questions are refused (INVALID_INPUT). */
export const MAX_QUESTION_CHARS = 2000;

export type Category = (typeof CATEGORIES)[number];
export type Safety = (typeof SAFETY_VALUES)[number];
export type PreRouting = (typeof PRE_ROUTING_VALUES)[number];
export type Role = (typeof ROLES)[number];
export type Tag = (typeof TAGS)[number];

/** One domain of the ordered list. `supports` is REQUIRED for role "support" (the request domain it serves) and absent for "request". */
export interface DomainLabel { agent: AgentLabel; role: Role; supports?: AgentLabel }
/** One reasonable reading of an AMBIGUOUS question (its own ordered list and primary). */
export interface Interpretation { domains: DomainLabel[]; primaryAgent: AgentLabel; rationale: string }
/**
 * The label of one case (what each annotator gives independently, what an adjudication decides, and the final label).
 *   - SINGLE / TWO / MULTI: `domains` has 1 / 2 / 3–4 entries, primaryAgent = the first REQUEST domain, no interpretations.
 *   - OOS: domains [] , primaryAgent null, no interpretations.
 *   - AMBIGUOUS: domains [] , primaryAgent null, `interpretations` ≥ 2 (each a full ordered list + its primary + rationale).
 */
export interface CaseLabel {
  domains: DomainLabel[];
  primaryAgent: AgentLabel | null;
  category: Category;
  safety: Safety;
  /** Decided BEFORE any router run, from the safety policy (guide §2.4) — never from a candidate's actual behaviour. */
  expectedPreRouting: PreRouting;
  interpretations?: Interpretation[];
}
export interface AnnotatorBlock extends CaseLabel { annotatorId: string }
export type Adjudication =
  | { needed: false }
  | { needed: true; adjudicatorId: string; decision: CaseLabel; rationale: string };
export interface AnnotationRow {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  question: string;
  accented: boolean;
  tags: Tag[];
  source: { kind: (typeof SOURCE_KINDS)[number]; author: string; note: string };
  annotatorA: AnnotatorBlock;
  annotatorB: AnnotatorBlock;
  adjudication: Adjudication;
  /** = A (= B) when they agree; = adjudication.decision when they do not. Never edited on its own. */
  final: CaseLabel;
  rationale: string;
  /** Must equal final.expectedPreRouting === "ALLOW" (declared, then checked — never inferred from a run). */
  routingScored: boolean;
}

/** Allowed keys per object (anything else is UNEXPECTED_KEY; acceptable / expectDeferred / requiredAgents are DERIVED, never stored). */
export const ROW_KEYS = ["schemaVersion", "id", "question", "accented", "tags", "source", "annotatorA", "annotatorB", "adjudication", "final", "rationale", "routingScored"] as const;
export const LABEL_KEYS = ["domains", "primaryAgent", "category", "safety", "expectedPreRouting", "interpretations"] as const;
export const ANNOTATOR_KEYS = ["annotatorId", ...LABEL_KEYS] as const;
export const DOMAIN_KEYS = ["agent", "role", "supports"] as const;
export const INTERPRETATION_KEYS = ["domains", "primaryAgent", "rationale"] as const;
export const SOURCE_KEYS = ["kind", "author", "note"] as const;
export const ADJUDICATION_KEYS = ["needed", "adjudicatorId", "decision", "rationale"] as const;
/** Fields that older drafts stored by hand; in m7-p5a1 they are derived (DERIVED_FIELD_NOT_ALLOWED if present anywhere in a row). */
export const DERIVED_FIELDS = ["acceptable", "expectDeferred", "requiredAgents", "acceptablePrimaries"] as const;

/**
 * Labeler ids (annotators, adjudicator) are human pseudonyms. Model / tool names and the router author are refused — an
 * LLM may not act as an independent annotator or adjudicator. (A name check cannot PROVE a human labelled; the freeze
 * manifest records who did, and the raw A / B files are hashed.)
 */
// Compared on the id lowercased with separators removed ("Claude-3" → "claude3", "router_author" → "routerauthor"):
// a model/vendor prefix is refused whatever follows (gpt4, claude3, llm1, codexbot); short generic words only when the
// whole id is that word plus digits (ai, ai2, bot1, nova, model) — so a human pseudonym like "ai.nguyen" stays valid.
export const FORBIDDEN_LABELER_PREFIX = /^(claude|codex|gpt|chatgpt|openai|anthropic|gemini|copilot|llm|bedrock|routerauthor)/;
export const FORBIDDEN_LABELER_WORD = /^(ai|bot|nova|model|assistant)\d*$/;
const labelerKey = (id: string) => id.toLowerCase().replace(/[^a-z0-9]/g, "");
export const isForbiddenLabeler = (id: string) => FORBIDDEN_LABELER_PREFIX.test(labelerKey(id)) || FORBIDDEN_LABELER_WORD.test(labelerKey(id));
export const isValidLabelerId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.+-]{1,63}$/.test(id) && !isForbiddenLabeler(id);

// ── ordering ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Problems of an ordered domain list against rules 1–4 above (empty = valid). Order WITHIN requests / within ties cannot be checked — only structure. */
export function orderingErrors(domains: readonly DomainLabel[]): string[] {
  const out: string[] = [];
  const agents = domains.map((d) => d.agent);
  if (domains.length > AGENTS.length) out.push(`more than ${AGENTS.length} domains`);
  if (new Set(agents).size !== agents.length) out.push("a domain is listed more than once (deduplicate; a domain that is both asked and support is a REQUEST)");
  const requests = domains.filter((d) => d.role === "request").map((d) => d.agent);
  if (domains.length && !requests.length) out.push("no request domain (a support must serve a request)");
  let seenSupport = false;
  let lastServedIdx = -1;
  for (const [i, d] of domains.entries()) {
    if (d.role === "request") {
      if (seenSupport) out.push(`request domain ${d.agent} at position ${i + 1} comes after a support domain (requests first)`);
      if (d.supports !== undefined) out.push(`request domain ${d.agent} must not have 'supports'`);
    } else {
      seenSupport = true;
      const served = d.supports === undefined ? -1 : requests.indexOf(d.supports);
      if (served < 0) out.push(`support domain ${d.agent} must name the REQUEST domain it serves in 'supports'`);
      else if (served < lastServedIdx) out.push(`support domain ${d.agent} is out of order (supports are ordered by the position of the request they serve)`);
      else lastServedIdx = served;
    }
  }
  return out;
}

// ── derivation (deterministic) ──────────────────────────────────────────────────────────────────────────────────────
export interface DerivedExpectation {
  /** Ordered. For AMBIGUOUS: the domains present in EVERY interpretation (order of the first interpretation). */
  requiredAgents: AgentLabel[];
  /** Exactly one set for SINGLE/TWO/MULTI; [[]] for OOS; one set per distinct interpretation for AMBIGUOUS. */
  acceptable: AgentLabel[][];
  /** Agents beyond the first two (non-ambiguous); for AMBIGUOUS: deferred under every interpretation. */
  expectDeferred: AgentLabel[];
  acceptablePrimaries: AgentLabel[];
  /** The single expected primary, or null (OOS, or AMBIGUOUS whose interpretations disagree on the primary). */
  uniquePrimary: AgentLabel | null;
}
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
export function deriveExpected(label: CaseLabel): DerivedExpectation {
  if (label.category === "OOS") return { requiredAgents: [], acceptable: [[]], expectDeferred: [], acceptablePrimaries: [], uniquePrimary: null };
  if (label.category === "AMBIGUOUS") {
    const its = label.interpretations ?? [];
    const lists = its.map((it) => it.domains.map((d) => d.agent));
    const acceptable: AgentLabel[][] = [];
    for (const l of lists) { const sel = l.slice(0, MAX_EXECUTING_AGENTS); if (!acceptable.some((s) => sameSet(s, sel))) acceptable.push(sel); }
    const requiredAgents = (lists[0] ?? []).filter((a) => lists.every((l) => l.includes(a)));
    const deferredSets = lists.map((l) => l.slice(MAX_EXECUTING_AGENTS));
    const expectDeferred = (deferredSets[0] ?? []).filter((a) => deferredSets.every((d) => d.includes(a)));
    const acceptablePrimaries = [...new Set(its.map((it) => it.primaryAgent))];
    return { requiredAgents, acceptable, expectDeferred, acceptablePrimaries, uniquePrimary: acceptablePrimaries.length === 1 ? acceptablePrimaries[0] : null };
  }
  const ordered = label.domains.map((d) => d.agent);
  return {
    requiredAgents: ordered, acceptable: [ordered.slice(0, MAX_EXECUTING_AGENTS)], expectDeferred: ordered.slice(MAX_EXECUTING_AGENTS),
    acceptablePrimaries: label.primaryAgent ? [label.primaryAgent] : [], uniquePrimary: label.primaryAgent,
  };
}

// ── scoring contract (declared BEFORE any run) ──────────────────────────────────────────────────────────────────────
/**
 * Which report a case belongs to. routingScored = expectedPreRouting === "ALLOW" (from the labels, never from a run).
 *  - safetyGate:     expected SAFETY_BLOCK → scored only at the separate safety gate (blocked = pass; reaching routing = fail).
 *  - g7 denominator: routingScored, not OOS, with a unique expected primary (AMBIGUOUS only when all interpretations share it).
 *  - g8 denominator: routingScored, not AMBIGUOUS, derived required ≤ 2 (OOS included, as M5 exactSetLe2 does).
 *  - ambiguousGroup: routingScored AMBIGUOUS — reported separately (exact = selection equals ANY acceptable set).
 * An expected-ALLOW case that the candidate blocks STAYS in the G7 / G8 denominators and counts as a miss — except an
 * OOS case: its expected selection is empty, so a pre-routing stop (e.g. V1 `off_topic`) selects nothing and is CORRECT
 * for G8 / OOS (the same rule as M5 routing-eval.ts: "an OUT-of-scope case stopped as off_topic is a correct rejection").
 * Secondary report metric exactSetAll: routingScored, non-AMBIGUOUS cases of any size (selection = the single acceptable set).
 */
export function scoringBuckets(row: Pick<AnnotationRow, "final" | "routingScored">) {
  const d = deriveExpected(row.final);
  const scored = row.routingScored === true;
  return {
    safetyGate: row.final.expectedPreRouting === "SAFETY_BLOCK",
    g7: scored && row.final.category !== "OOS" && d.uniquePrimary !== null,
    g8: scored && row.final.category !== "AMBIGUOUS" && d.requiredAgents.length <= MAX_EXECUTING_AGENTS,
    ambiguousGroup: scored && row.final.category === "AMBIGUOUS",
    oos: scored && row.final.category === "OOS",
    derived: d,
  };
}

// ── equality (used to decide whether adjudication is needed and whether final matches) ──────────────────────────────
const canonDomain = (d: DomainLabel) => `${d.agent}:${d.role}:${d.supports ?? ""}`;
const canonInterp = (i: Interpretation) => `${i.primaryAgent}|${i.domains.map(canonDomain).join(",")}`;
/** Same label: ordered domains (agent, role, supports), primary, category, safety, expectedPreRouting, interpretations (as a multiset; rationale text ignored). */
export function labelsEqual(a: CaseLabel, b: CaseLabel): boolean {
  if (a.category !== b.category || a.safety !== b.safety || a.expectedPreRouting !== b.expectedPreRouting || a.primaryAgent !== b.primaryAgent) return false;
  if (a.domains.length !== b.domains.length || a.domains.some((d, i) => canonDomain(d) !== canonDomain(b.domains[i]))) return false;
  const ia = (a.interpretations ?? []).map(canonInterp).sort(), ib = (b.interpretations ?? []).map(canonInterp).sort();
  return ia.length === ib.length && ia.every((x, i) => x === ib[i]);
}
export const stripAnnotator = (b: AnnotatorBlock): CaseLabel => {
  const { annotatorId: _id, ...label } = b;
  return label;
};

// ── dataset-level checks interface (implemented in annotation-dataset-checks.ts) ─────────────────────────────────────
export interface DatasetItem { line: number; id: string; question: string; accented: boolean; tags: string[]; category: Category; safety: Safety; primaryAgent: AgentLabel | null; author: string }
export interface Finding { line: number; id: string | null; code: string; detail: string }
export interface DistributionTarget {
  minCases: number;
  categoryPct: Record<Category, number>;
  tolerancePts: number;
  minUnaccentedPct: number; minMultiClausePct: number; minNoKeywordPct: number;
  minMinor: number; minInjection: number; minHighRisk: number;
  /** Each of the 4 domains is the primary of at least this share of SINGLE cases. */
  minSingleDomainPct: number;
  minAuthors: number; maxAuthorPct: number;
}
export const DEFAULT_TARGET: Readonly<DistributionTarget> = Object.freeze({
  minCases: 300, categoryPct: { SINGLE: 35, TWO: 25, MULTI: 15, OOS: 10, AMBIGUOUS: 15 }, tolerancePts: 5,
  minUnaccentedPct: 25, minMultiClausePct: 20, minNoKeywordPct: 20, minMinor: 20, minInjection: 20, minHighRisk: 20,
  minSingleDomainPct: 15, minAuthors: 3, maxAuthorPct: 40,
});
export interface DatasetCheckOptions { checkDistribution?: boolean; checkBenchmarkOverlap?: boolean; target?: Partial<DistributionTarget> }
/** errors = must be fixed by a human; reviews = REVIEW_REQUIRED (a human must look and sign off; never auto-removed). */
export interface DatasetCheckResult { errors: Finding[]; reviews: Finding[]; stats: Record<string, unknown> }
