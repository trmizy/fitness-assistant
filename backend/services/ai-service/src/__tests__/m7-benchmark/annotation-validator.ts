/**
 * M7-P5A2 — ROW-LEVEL validator for the FUTURE human-labelled routing dataset (schema "m7-p5a2", see annotation-schema.ts).
 * Two independent human annotators label every case; disagreements go to an adjudicator; `final` must equal the agreed label
 * (A = B) or the adjudication decision. Acceptable sets / deferred agents are DERIVED (deriveExpected), never typed.
 * m7-p5a2 adds (owner decisions 2026-11-15): an OWN rationale per annotator (Q2), `rationaleBy` = the adjudicator who wrote
 * the final rationale (Q2), role-separation checks across the whole file (Q4: one id per role, adjudicator ≠ A / B, writer ≠
 * labeler — consistency of DECLARED ids only, it cannot prove who a person is), the Q5 third-party-minor cap and safety rule,
 * the Q6 special-length caps, and explicit scoring exclusions / denominators in the stats.
 *
 * It only REPORTS problems for humans to fix. It never mutates, normalises-in-place or "repairs" its input, creates no label
 * and no dataset. Pure + deterministic: no network, no model call, no file write (the CLI only reads the file given to it).
 * Dataset-level checks (similarity, benchmark overlap, distribution, length, authors) live in annotation-dataset-checks.ts and
 * are CALLED here, not reimplemented.
 *
 * A row with a duplicate JSON key is reported as DUPLICATE_JSON_KEY only and is NOT validated further (JSON.parse silently
 * keeps the last duplicate, so any other verdict would be about data the human did not mean).
 *
 * CLI: npx tsx src/__tests__/m7-benchmark/annotation-validator.ts <file.jsonl> [--no-distribution] [--no-overlap]
 *   exit 1 = at least one error; exit 3 = no error but REVIEW REQUIRED items need a human sign-off; exit 0 = clean; exit 2 = usage.
 */
import fs from "node:fs";
import {
  ADJUDICATION_KEYS, AGENTS, ANNOTATOR_KEYS, CATEGORIES, DERIVED_FIELDS, DOMAIN_KEYS, INTERPRETATION_KEYS, LABEL_KEYS, PRE_ROUTING_VALUES,
  ROLES, ROW_KEYS, SAFETY_VALUES, SCHEMA_VERSION, SOURCE_KEYS, SOURCE_KINDS, TAGS,
  isValidLabelerId, labelsEqual, orderingErrors, expectedRoutingScored, ROUTING_QUESTION_CHARS, labelerRoleKey,
  SUPERSEDED_SCHEMA_VERSIONS, QUOTAS, THIRD_PARTY_MINOR_MARKER, scoringBuckets,
  type CaseLabel, type DatasetCheckOptions, type DatasetItem, type DomainLabel, type Finding, type Interpretation,
} from "./annotation-schema";
import type { AgentLabel } from "../m5-benchmark/dataset-v1";
import { findDuplicateKeys, MAX_JSON_DEPTH } from "./annotation-json";
import { runDatasetChecks, canonicalWriterKey, INVISIBLE_CHARS_RE, QUESTION_INVISIBLE_CHARS_RE } from "./annotation-dataset-checks";
import { foldVi } from "../../llm/speech_act";

export type { Finding } from "./annotation-schema";
/** Kept for callers of the pre-m7-p5a1 validator. */
export type AnnotationError = Finding;

export type ValidateOptions = DatasetCheckOptions;

export interface ValidationStats {
  totalLines: number;
  cases: number;
  /** By FINAL category (rows whose final.category is a valid enum value). */
  byCategory: Record<string, number>;
  bySafety: Record<string, number>;
  /** Rows where annotator A and B labels are not equal (these need an adjudication). */
  disagreements: number;
  adjudicated: number;
  errorsByCode: Record<string, number>;
  reviewsByCode: Record<string, number>;
  /** Raw stats returned by runDatasetChecks. */
  dataset: Record<string, unknown>;
  /** m7-p5a2 (Q4): the id used per role (first valid id seen; deviations are ROLE_ID_INCONSISTENT errors). */
  roles: { annotatorA: string | null; annotatorB: string | null; adjudicator: string | null };
  /** m7-p5a2 (Q5 / Q6): owner caps — used / max. */
  quotas: { thirdPartyMinor: { used: number; max: number }; longQuestion: { used: number; max: number }; overRequestLimit: { used: number; max: number } };
  /**
   * m7-p5a2 (Q6): declared scoring exclusions and denominators, from the FINAL labels and the question length (scoringBuckets).
   * Rows whose final label is unusable are not counted (they already carry errors).
   */
  scoring: {
    rows: number; routingScored: number; notRoutingScored: number;
    excluded: { overRequestLimit: number; longQuestion: number; safetyBlock: number; oosBlock: number };
    denominators: { g7: number; g8: number; ambiguousGroup: number; oos: number; safetyGate: number; oosPreflight: number; validationGroup: number; longQuestionGroup: number };
  };
}
export interface ValidationResult { ok: boolean; errors: Finding[]; reviews: Finding[]; stats: ValidationStats; items: DatasetItem[] }

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function hasVietnameseDiacritics(q: string): boolean {
  return /[̀-ͯ]|đ|Đ/.test(q.normalize("NFD"));
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
/**
 * m7-p5a2: free human text (rationales) must be stored canonically — trimmed, Unicode NFC, no invisible / format / control
 * characters except inner TAB / LF / CR (same rule as the question). Returns the problem, or null when canonical.
 */
export function humanTextProblem(v: string): string | null {
  if (v !== v.trim()) return "has leading or trailing whitespace";
  if (v !== v.normalize("NFC")) return "is not Unicode NFC";
  if (QUESTION_INVISIBLE_CHARS_RE.test(v)) return "contains invisible / format / control characters";
  return null;
}
/** Q5: the row rationale carries the third-party marker (NFC, case-insensitive, or without diacritics). */
export function hasThirdPartyMarker(rationale: string): boolean {
  const t = rationale.normalize("NFC").toLowerCase();
  return t.includes(THIRD_PARTY_MINOR_MARKER) || foldVi(t).includes(foldVi(THIRD_PARTY_MINOR_MARKER));
}
const isAgent = (v: unknown): v is AgentLabel => typeof v === "string" && (AGENTS as readonly string[]).includes(v);
const inList = (list: readonly string[], v: unknown): v is string => typeof v === "string" && list.includes(v);
const canonDomain = (d: DomainLabel) => `${d.agent}:${d.role}:${d.supports ?? ""}`;
const canonInterp = (i: Interpretation) => `${i.primaryAgent}|${i.domains.map(canonDomain).join(",")}`;

export type Err = (code: string, detail: string) => void;
/** Labeler roles: annotator A, annotator B, J = adjudicator (adjudication.adjudicatorId and rationaleBy). */
type Role = "A" | "B" | "J";
const ROLE_LIST: readonly Role[] = ["A", "B", "J"];
const ROLE_NAME: Record<Role, string> = { A: "annotatorA", B: "annotatorB", J: "adjudicator" };

/** Keys of an object that are not allowed. Derived fields get their own code (reported once, by walkDerived). */
function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string, err: Err): void {
  for (const k of Object.keys(obj)) {
    if (allowed.includes(k)) continue;
    if ((DERIVED_FIELDS as readonly string[]).includes(k)) continue;
    err("UNEXPECTED_KEY", `${where}: unexpected key '${k}'`);
  }
}

/** DERIVED_FIELD_NOT_ALLOWED for any derived field name, at any depth. */
function walkDerived(value: unknown, path: string, err: Err, depth = 0): void {
  if (depth > MAX_JSON_DEPTH) return; // bounded (M7-P5A.3); deeper rows are rejected earlier as JSON_TOO_DEEP
  if (Array.isArray(value)) { value.forEach((v, i) => walkDerived(v, `${path}[${i}]`, err, depth + 1)); return; }
  if (!isObj(value)) return;
  for (const [k, v] of Object.entries(value)) {
    if ((DERIVED_FIELDS as readonly string[]).includes(k)) err("DERIVED_FIELD_NOT_ALLOWED", `${path}.${k}: '${k}' is derived by the schema (deriveExpected) and must not be typed by hand`);
    walkDerived(v, `${path}.${k}`, err, depth + 1);
  }
}

/** Shape of one ordered domain list + ordering rules. Returns the list when every entry is well-formed (ordering errors are reported but do not null it). */
function checkDomains(raw: unknown, where: string, err: Err): DomainLabel[] | null {
  if (!Array.isArray(raw)) { err("MISSING_FIELD", `${where}.domains must be an array`); return null; }
  let shapeOk = true;
  const out: DomainLabel[] = [];
  raw.forEach((d, i) => {
    const w = `${where}.domains[${i}]`;
    if (!isObj(d)) { err("INVALID_DOMAIN_ORDER", `${w} must be an object {agent, role, supports?}`); shapeOk = false; return; }
    checkKeys(d, DOMAIN_KEYS, w, err);
    if (!isAgent(d.agent)) { err("INVALID_AGENT", `${w}.agent invalid: ${JSON.stringify(d.agent)}`); shapeOk = false; }
    if (!inList(ROLES, d.role)) { err("INVALID_ENUM", `${w}.role must be one of ${ROLES.join("|")}`); shapeOk = false; }
    if (d.supports !== undefined && !isAgent(d.supports)) { err("INVALID_AGENT", `${w}.supports invalid: ${JSON.stringify(d.supports)}`); shapeOk = false; }
    if (shapeOk) out.push({ agent: d.agent as AgentLabel, role: d.role as DomainLabel["role"], ...(d.supports !== undefined ? { supports: d.supports as AgentLabel } : {}) });
  });
  if (!shapeOk) return null;
  for (const e of orderingErrors(out)) err("INVALID_DOMAIN_ORDER", `${where}: ${e}`);
  return out;
}

/** The first REQUEST domain (what the primary must be), or null. */
const firstRequest = (domains: readonly DomainLabel[]): AgentLabel | null => domains.find((d) => d.role === "request")?.agent ?? null;

interface LabelCheck { label: CaseLabel | null }

/**
 * Validates one case label (annotator block without its id, adjudication.decision or final). `label` is returned only when
 * the SHAPE is usable by labelsEqual (semantic errors — order, primary, category — are reported but do not null it).
 */
export function checkLabel(raw: unknown, where: string, allowedKeys: readonly string[], err: Err): LabelCheck {
  if (!isObj(raw)) { err("MISSING_FIELD", `${where} missing or not an object`); return { label: null }; }
  checkKeys(raw, allowedKeys, where, err);
  let shapeOk = true;

  const domains = checkDomains(raw.domains, where, err);
  if (!domains) shapeOk = false;

  let primary: AgentLabel | null | undefined;
  if (raw.primaryAgent === null) primary = null;
  else if (isAgent(raw.primaryAgent)) primary = raw.primaryAgent;
  else { err("INVALID_AGENT", `${where}.primaryAgent must be an agent or null, got ${JSON.stringify(raw.primaryAgent)}`); shapeOk = false; }

  const category = inList(CATEGORIES, raw.category) ? (raw.category as CaseLabel["category"]) : null;
  if (!category) { err("INVALID_ENUM", `${where}.category must be one of ${CATEGORIES.join("|")}`); shapeOk = false; }
  const safety = inList(SAFETY_VALUES, raw.safety) ? (raw.safety as CaseLabel["safety"]) : null;
  if (!safety) { err("INVALID_ENUM", `${where}.safety must be one of ${SAFETY_VALUES.join("|")}`); shapeOk = false; }
  const pre = inList(PRE_ROUTING_VALUES, raw.expectedPreRouting) ? (raw.expectedPreRouting as CaseLabel["expectedPreRouting"]) : null;
  if (!pre) { err("INVALID_ENUM", `${where}.expectedPreRouting must be one of ${PRE_ROUTING_VALUES.join("|")}`); shapeOk = false; }

  // M7-P5A.1 policy (Q1): SAFETY_BLOCK needs a safety content label; OOS_BLOCK is the pre-routing OUT-OF-SCOPE stop, so
  // only for OOS questions. MINOR / INJECTION / HIGH_RISK do NOT imply SAFETY_BLOCK (no rule derives it).
  if (safety === "NONE" && pre === "SAFETY_BLOCK") err("CATEGORY_SAFETY_INCONSISTENT", `${where}: safety NONE cannot be expectedPreRouting SAFETY_BLOCK (ALLOW or OOS_BLOCK)`);
  if (pre === "OOS_BLOCK" && category !== null && category !== "OOS") err("CATEGORY_SAFETY_INCONSISTENT", `${where}: expectedPreRouting OOS_BLOCK is only for category OOS, got ${category}`);

  // interpretations
  let interpretations: Interpretation[] | undefined;
  if (raw.interpretations !== undefined) {
    if (!Array.isArray(raw.interpretations)) { err("INVALID_INTERPRETATION", `${where}.interpretations must be an array`); shapeOk = false; }
    else {
      const its: Interpretation[] = [];
      raw.interpretations.forEach((it, k) => {
        const w = `${where}.interpretations[${k}]`;
        if (!isObj(it)) { err("INVALID_INTERPRETATION", `${w} must be an object`); shapeOk = false; return; }
        checkKeys(it, INTERPRETATION_KEYS, w, err);
        const d = checkDomains(it.domains, w, err);
        let itOk = d !== null;
        if (d && d.length === 0) err("INVALID_INTERPRETATION", `${w}.domains must not be empty`);
        let p: AgentLabel | null = null;
        if (isAgent(it.primaryAgent)) p = it.primaryAgent;
        else { err("INVALID_INTERPRETATION", `${w}.primaryAgent must be an agent, got ${JSON.stringify(it.primaryAgent)}`); itOk = false; }
        if (d && p && d.length && firstRequest(d) !== p) err("INVALID_INTERPRETATION", `${w}.primaryAgent ${p} must equal its first request domain (${firstRequest(d) ?? "none"})`);
        if (!nonEmptyStr(it.rationale)) { err("INVALID_INTERPRETATION", `${w}.rationale missing or empty`); itOk = false; }
        if (itOk && d && p) its.push({ domains: d, primaryAgent: p, rationale: it.rationale as string });
        else shapeOk = false;
      });
      interpretations = its;
    }
  }

  // category vs domains / primary / interpretations
  if (domains && category) {
    const n = domains.length;
    if (category === "SINGLE" && n !== 1) err("CATEGORY_MISMATCH", `${where}: SINGLE needs exactly 1 domain, got ${n}`);
    if (category === "TWO" && n !== 2) err("CATEGORY_MISMATCH", `${where}: TWO needs exactly 2 domains, got ${n}`);
    if (category === "MULTI" && (n < 3 || n > 4)) err("CATEGORY_MISMATCH", `${where}: MULTI needs 3-4 domains, got ${n}`);
    if (category === "OOS" && n !== 0) err("CATEGORY_MISMATCH", `${where}: OOS needs domains [], got ${n}`);
    if (category === "AMBIGUOUS" && n !== 0) err("CATEGORY_MISMATCH", `${where}: AMBIGUOUS needs top-level domains [] (the readings go in 'interpretations'), got ${n}`);
    if (category !== "AMBIGUOUS" && raw.interpretations !== undefined) err("CATEGORY_MISMATCH", `${where}: 'interpretations' is only allowed on AMBIGUOUS`);
    if (primary !== undefined) {
      const expected = category === "OOS" || category === "AMBIGUOUS" ? null : firstRequest(domains);
      if (primary !== expected) err("INVALID_PRIMARY", `${where}: primaryAgent is ${JSON.stringify(primary)} but must be ${JSON.stringify(expected)} (${category === "OOS" || category === "AMBIGUOUS" ? "OOS / AMBIGUOUS use null" : "the first request domain of this label"})`);
    }
  }
  if (category === "AMBIGUOUS") {
    if (raw.interpretations === undefined || (interpretations && interpretations.length < 2)) err("INVALID_INTERPRETATION", `${where}: AMBIGUOUS needs >= 2 valid interpretations, got ${interpretations?.length ?? 0}`);
    if (interpretations && interpretations.length >= 2) {
      const seen = new Set<string>();
      for (const it of interpretations) {
        const c = canonInterp(it);
        if (seen.has(c)) { err("INVALID_INTERPRETATION", `${where}: interpretations must be pairwise different (duplicate reading ${c})`); break; }
        seen.add(c);
      }
    }
  }

  if (!shapeOk || !domains || primary === undefined || !category || !safety || !pre) return { label: null };
  return { label: { domains, primaryAgent: primary, category, safety, expectedPreRouting: pre, ...(interpretations !== undefined ? { interpretations } : {}) } };
}

/** One annotator block (m7-p5a2: annotatorId + own rationale + label). Exported for the offline CLI (check-role / merge). */
export function checkAnnotator(raw: unknown, which: string, err: Err): { label: CaseLabel | null; id: string | null; rationale: string | null } {
  if (!isObj(raw)) { err("MISSING_FIELD", `${which} missing or not an object`); return { label: null, id: null, rationale: null }; }
  let id: string | null = null;
  if (raw.annotatorId === undefined || raw.annotatorId === null || raw.annotatorId === "") err("MISSING_ANNOTATOR_ID", `${which}.annotatorId missing`);
  else if (!isValidLabelerId(raw.annotatorId)) err("INVALID_ANNOTATOR_ID", `${which}.annotatorId ${JSON.stringify(raw.annotatorId)} is not a valid human pseudonym (model / tool names are refused)`);
  else id = raw.annotatorId;
  // m7-p5a2 (Q2): the annotator's OWN reason — required; never generated, copied or back-filled by a tool
  let rationale: string | null = null;
  if (!nonEmptyStr(raw.rationale)) err("MISSING_ANNOTATOR_RATIONALE", `${which}.rationale missing or empty (each annotator writes an own rationale, m7-p5a2 Q2)`);
  else {
    const p = humanTextProblem(raw.rationale);
    if (p) err("RATIONALE_NOT_CANONICAL", `${which}.rationale ${p}`);
    rationale = raw.rationale;
  }
  const { label } = checkLabel(raw, which, ANNOTATOR_KEYS, err);
  return { label, id, rationale };
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function validateRoutingAnnotations(jsonlText: string, opts: ValidateOptions = {}): ValidationResult {
  const errors: Finding[] = [];
  const rowReviews: Finding[] = [];
  const stats: ValidationStats = {
    totalLines: 0, cases: 0, byCategory: {}, bySafety: {}, disagreements: 0, adjudicated: 0, errorsByCode: {}, reviewsByCode: {}, dataset: {},
    roles: { annotatorA: null, annotatorB: null, adjudicator: null },
    quotas: { thirdPartyMinor: { used: 0, max: QUOTAS.thirdPartyMinorMax }, longQuestion: { used: 0, max: QUOTAS.longQuestionMax }, overRequestLimit: { used: 0, max: QUOTAS.overRequestLimitMax } },
    scoring: {
      rows: 0, routingScored: 0, notRoutingScored: 0, excluded: { overRequestLimit: 0, longQuestion: 0, safetyBlock: 0, oosBlock: 0 },
      denominators: { g7: 0, g8: 0, ambiguousGroup: 0, oos: 0, safetyGate: 0, oosPreflight: 0, validationGroup: 0, longQuestionGroup: 0 },
    },
  };
  const items: DatasetItem[] = [];
  const seenIds = new Map<string, number>();
  // m7-p5a2 (Q4): every VALID labeler id used, by role (A / B / J = adjudicator), and every writer — checked across the file below
  const roleUses: Array<{ line: number; id: string | null; role: Role; raw: string }> = [];
  const authorUses: Array<{ line: number; id: string | null; author: string }> = [];
  const thirdParty: Array<{ line: number; id: string | null }> = [];

  jsonlText.split(/\r?\n/).forEach((text, idx) => {
    if (!text.trim()) return;
    const line = idx + 1;
    stats.totalLines++;
    let row: unknown;
    try { row = JSON.parse(text); } catch (e) {
      errors.push({ line, id: null, code: "MALFORMED_JSON", detail: (e as Error).message });
      return;
    }
    if (!isObj(row)) { errors.push({ line, id: null, code: "NOT_OBJECT", detail: "line is not a JSON object" }); return; }
    stats.cases++;
    const id = nonEmptyStr(row.id) ? row.id : null;
    const err: Err = (code, detail) => errors.push({ line, id, code, detail });

    const dup = findDuplicateKeys(text);
    if (dup.tooDeep) { err("JSON_TOO_DEEP", `row nests JSON deeper than ${MAX_JSON_DEPTH} levels; row not validated further`); return; }
    if (dup.duplicates.length) {
      for (const d of dup.duplicates) err("DUPLICATE_JSON_KEY", `key '${d.key}' appears more than once at ${d.path} (JSON.parse would silently keep the last one); row not validated further`);
      return;
    }

    // schema version / keys / derived fields
    if ((SUPERSEDED_SCHEMA_VERSIONS as readonly unknown[]).includes(row.schemaVersion)) {
      err("SCHEMA_VERSION", `schemaVersion ${JSON.stringify(row.schemaVersion)} is superseded by "${SCHEMA_VERSION}" and is NOT migrated automatically: each annotator must add an OWN rationale, the adjudicator must add rationaleBy, and routingScored follows Q6 (see MIGRATION in annotation-schema.ts)`);
    } else if (row.schemaVersion !== SCHEMA_VERSION) err("SCHEMA_VERSION", `schemaVersion must be "${SCHEMA_VERSION}", got ${JSON.stringify(row.schemaVersion)}`);
    checkKeys(row, ROW_KEYS, "row", err);
    walkDerived(row, "$", err);

    // id
    if (!id) err("MISSING_FIELD", "id missing or empty");
    else {
      if (id !== id.trim()) err("ID_NOT_TRIMMED", "id has leading or trailing whitespace");
      const idKey = id.trim().toLowerCase(); // M7-P5A.3: ids are unique case-insensitively
      if (seenIds.has(idKey)) err("DUPLICATE_ID", `id also used on line ${seenIds.get(idKey)} (compared trimmed and case-insensitively)`);
      else seenIds.set(idKey, line);
    }

    // question + accented
    const q = nonEmptyStr(row.question) ? row.question : null;
    if (!q) err("MISSING_FIELD", "question missing or empty");
    // M7-P5A.2 remediation (cross-check F3): lengths (600 / 2000) are measured on the stored text, so the stored text
    // must already be what the endpoint measures — trimmed (supervisor trims) and NFC (no save-format dependence)
    if (q && q !== q.trim()) err("QUESTION_NOT_TRIMMED", "question has leading or trailing whitespace (the endpoint trims before measuring)");
    if (q && q !== q.normalize("NFC")) err("QUESTION_NOT_NFC", "question is not Unicode NFC (lengths would depend on how the file was saved)");
    if (q && QUESTION_INVISIBLE_CHARS_RE.test(q)) err("QUESTION_INVISIBLE_CHARS", "question contains invisible / format / control characters (zero-width, bidi, soft hyphen, BOM, C0/C1 controls); they hide overlap and change lengths");
    const accentedOk = typeof row.accented === "boolean";
    if (!accentedOk) err("MISSING_FIELD", "accented must be boolean");
    else if (q && row.accented !== hasVietnameseDiacritics(q)) err("ACCENTED_MISMATCH", `accented=${row.accented} but the text ${hasVietnameseDiacritics(q) ? "has" : "has no"} Vietnamese diacritics`);

    // tags
    let tags: string[] = [];
    let tagsOk = false;
    if (!Array.isArray(row.tags)) err("MISSING_FIELD", "tags must be an array");
    else {
      tagsOk = true;
      for (const t of row.tags) if (!inList(TAGS, t)) { err("INVALID_ENUM", `tag ${JSON.stringify(t)} is not one of ${TAGS.join("|")}`); tagsOk = false; }
      if (new Set(row.tags).size !== row.tags.length) err("INVALID_ENUM", "tags contains a duplicate");
      tags = row.tags.filter((t): t is string => typeof t === "string");
    }

    // source
    const src = row.source;
    let author: string | null = null;
    if (!isObj(src)) err("INVALID_SOURCE", "source missing or not an object");
    else {
      checkKeys(src, SOURCE_KEYS, "source", err);
      if (!inList(SOURCE_KINDS, src.kind)) err("INVALID_SOURCE", `source.kind must be one of ${SOURCE_KINDS.join("|")}`);
      if (!nonEmptyStr(src.author)) err("INVALID_SOURCE", "source.author missing or empty");
      else {
        author = src.author;
        if (src.author !== src.author.trim() || src.author !== src.author.normalize("NFC") || INVISIBLE_CHARS_RE.test(src.author)) err("AUTHOR_NOT_CANONICAL", "source.author must be trimmed, Unicode NFC and free of invisible / control characters (writer identity is counted case-insensitively)");
        authorUses.push({ line, id, author: src.author });
      }
      if (!nonEmptyStr(src.note)) err("INVALID_SOURCE", "source.note missing or empty");
    }

    // row-level (FINAL) rationale — m7-p5a2 (Q2): written by the adjudicator for every row, attributed by rationaleBy
    if (!nonEmptyStr(row.rationale)) err("MISSING_RATIONALE", "rationale missing or empty");
    else { const p = humanTextProblem(row.rationale); if (p) err("RATIONALE_NOT_CANONICAL", `rationale ${p}`); }
    let rationaleBy: string | null = null;
    if (row.rationaleBy === undefined || row.rationaleBy === null || row.rationaleBy === "") err("MISSING_RATIONALE_AUTHOR", "rationaleBy missing: the adjudicator who wrote the final rationale must be named on every row (m7-p5a2 Q2)");
    else if (!isValidLabelerId(row.rationaleBy)) err("INVALID_RATIONALE_AUTHOR", `rationaleBy ${JSON.stringify(row.rationaleBy)} is not a valid human pseudonym (model / tool names are refused)`);
    else { rationaleBy = row.rationaleBy; roleUses.push({ line, id, role: "J", raw: rationaleBy }); }

    // labels
    const A = checkAnnotator(row.annotatorA, "annotatorA", err);
    const B = checkAnnotator(row.annotatorB, "annotatorB", err);
    if (A.id) roleUses.push({ line, id, role: "A", raw: A.id });
    if (B.id) roleUses.push({ line, id, role: "B", raw: B.id });
    if (A.id && B.id && labelerRoleKey(A.id) === labelerRoleKey(B.id)) err("SAME_ANNOTATOR", `annotatorA and annotatorB are the same labeler (${A.id}); two independent annotators are required`);
    const annotatorKeys = [A.id, B.id].filter((x): x is string => x !== null).map(labelerRoleKey);
    if (rationaleBy && annotatorKeys.includes(labelerRoleKey(rationaleBy))) err("ADJUDICATOR_IS_ANNOTATOR", `rationaleBy ${rationaleBy} is also an annotator of this row; the adjudicator must be an independent third person (Q4)`);
    const { label: final } = checkLabel(row.final, "final", LABEL_KEYS, err);

    // adjudication
    const adj = row.adjudication;
    const agreeKnown = A.label !== null && B.label !== null;
    // checkLabel already returns the label WITHOUT annotatorId (= stripAnnotator of the block), so the ordered labels compare directly.
    const agree = agreeKnown ? labelsEqual(A.label!, B.label!) : null;
    let decision: CaseLabel | null = null;
    let adjudicated = false;
    if (isObj(adj)) checkKeys(adj, ADJUDICATION_KEYS, "adjudication", err);
    if (adj !== undefined && !isObj(adj)) err("ADJUDICATION_MISSING", "adjudication must be an object ({needed:false} or {needed:true, adjudicatorId, decision, rationale})");
    else if (adj === undefined) err("ADJUDICATION_MISSING", "adjudication missing (use {needed:false} when A and B agree)");
    else if (isObj(adj)) {
      if (adj.needed === true) {
        adjudicated = true;
        if (!isValidLabelerId(adj.adjudicatorId)) err("INVALID_ADJUDICATOR", `adjudication.adjudicatorId ${JSON.stringify(adj.adjudicatorId)} is missing or not a valid human pseudonym (model / tool names are refused)`);
        else {
          roleUses.push({ line, id, role: "J", raw: adj.adjudicatorId });
          if (annotatorKeys.includes(labelerRoleKey(adj.adjudicatorId))) err("ADJUDICATOR_IS_ANNOTATOR", `adjudication.adjudicatorId ${adj.adjudicatorId} is also an annotator of this row; the adjudicator must be an independent third person (Q4)`);
          if (rationaleBy && labelerRoleKey(rationaleBy) !== labelerRoleKey(adj.adjudicatorId)) err("RATIONALE_AUTHOR_MISMATCH", `rationaleBy ${rationaleBy} differs from adjudication.adjudicatorId ${adj.adjudicatorId}; the adjudicator who decided writes the final rationale`);
        }
        decision = checkLabel(adj.decision, "adjudication.decision", LABEL_KEYS, err).label;
        if (!nonEmptyStr(adj.rationale)) err("ADJUDICATION_MISSING", "adjudication.rationale missing or empty");
        else { const p = humanTextProblem(adj.rationale); if (p) err("RATIONALE_NOT_CANONICAL", `adjudication.rationale ${p}`); }
        if (agree === true) err("ADJUDICATION_NOT_NEEDED", "annotators A and B agree: adjudication must be exactly {needed:false}");
      } else if (adj.needed === false) {
        const extra = Object.keys(adj).filter((k) => k !== "needed");
        if (extra.length) err("ADJUDICATION_NOT_NEEDED", `adjudication.needed is false but carries ${extra.join(", ")}; it must be exactly {needed:false}`);
        if (agree === false) err("ADJUDICATION_MISSING", "annotators A and B disagree (labels differ, ordered domains included): adjudication.needed must be true with adjudicatorId, decision and rationale");
      } else err("ADJUDICATION_MISSING", "adjudication.needed must be boolean");
    }
    if (agree === false) stats.disagreements++;
    if (adjudicated) stats.adjudicated++;

    // final integrity
    if (final && agree === true && A.label && !labelsEqual(final, A.label)) err("FINAL_MISMATCH", "annotators A and B agree but final differs from their label");
    if (final && agree === false && adjudicated && decision && !labelsEqual(final, decision)) err("FINAL_MISMATCH", "final differs from adjudication.decision (when A and B disagree, final must equal the decision)");

    // safety / tags / routingScored (final)
    if (final) {
      const s = final.safety;
      if (tagsOk) {
        const has = (t: string) => tags.includes(t);
        if (has("prompt_injection") && s !== "INJECTION" && s !== "HIGH_RISK") err("CATEGORY_SAFETY_INCONSISTENT", `tag prompt_injection requires final.safety INJECTION or HIGH_RISK, got ${s}`);
        if (has("minor") && s !== "MINOR" && s !== "INJECTION" && s !== "HIGH_RISK") err("CATEGORY_SAFETY_INCONSISTENT", `tag minor requires final.safety MINOR, INJECTION or HIGH_RISK, got ${s}`);
        if (has("high_risk") && s !== "HIGH_RISK") err("CATEGORY_SAFETY_INCONSISTENT", `tag high_risk requires final.safety HIGH_RISK, got ${s}`);
        if (s === "HIGH_RISK" && !has("high_risk")) err("CATEGORY_SAFETY_INCONSISTENT", "final.safety HIGH_RISK requires tag high_risk");
        if (s === "INJECTION" && !has("prompt_injection")) err("CATEGORY_SAFETY_INCONSISTENT", "final.safety INJECTION requires tag prompt_injection");
        if (s === "MINOR" && !has("minor")) err("CATEGORY_SAFETY_INCONSISTENT", "final.safety MINOR requires tag minor");
      }
      // m7-p5a2 (Q5): third-person question about someone under 18 (tag review + marker in the final rationale)
      const marked = nonEmptyStr(row.rationale) && hasThirdPartyMarker(row.rationale);
      if (tagsOk && marked && tags.includes("review")) {
        thirdParty.push({ line, id });
        if (s === "MINOR") err("THIRD_PARTY_MINOR_SAFETY", `third-person minor case (Q5): final.safety must follow the CONTENT (NONE / INJECTION / HIGH_RISK), never MINOR — MINOR is only for a user who says they themselves are under 18; do not edit labels: replace the case if A and B both labelled MINOR`);
        rowReviews.push({ line, id, code: "THIRD_PARTY_MINOR_REVIEW", detail: "third-person minor case (Q5, tag review): a human must confirm the safety label follows the content and sign off" });
      } else if (tagsOk && marked) rowReviews.push({ line, id, code: "THIRD_PARTY_MARKER_WITHOUT_REVIEW_TAG", detail: `the final rationale mentions "${THIRD_PARTY_MINOR_MARKER}" but the row has no tag review: a human must decide whether it is a Q5 case (curator adds the tag through the tag audit) or not` });
      stats.byCategory[final.category] = (stats.byCategory[final.category] ?? 0) + 1;
      stats.bySafety[s] = (stats.bySafety[s] ?? 0) + 1;
      if (typeof row.routingScored !== "boolean") err("ROUTING_SCORED_MISMATCH", "routingScored must be boolean");
      else if (row.routingScored !== expectedRoutingScored(final, typeof q === "string" ? q : "")) err("ROUTING_SCORED_MISMATCH", `routingScored=${row.routingScored} but final.expectedPreRouting=${final.expectedPreRouting}, question length ${typeof q === "string" ? q.length : "?"} (must be true exactly when ALLOW and ≤ ${ROUTING_QUESTION_CHARS} chars; m7-p5a2 Q6: long_question and over_request_limit cases are never routing-scored)`);
      if (q) {
        const b = scoringBuckets({ final, routingScored: expectedRoutingScored(final, q), question: q });
        const sc = stats.scoring;
        sc.rows++;
        if (expectedRoutingScored(final, q)) sc.routingScored++; else sc.notRoutingScored++;
        if (b.validationGroup) sc.excluded.overRequestLimit++;
        else if (b.longQuestion) sc.excluded.longQuestion++;
        else if (b.safetyGate) sc.excluded.safetyBlock++;
        else if (b.oosPreflight) sc.excluded.oosBlock++;
        const d = sc.denominators;
        if (b.g7) d.g7++; if (b.g8) d.g8++; if (b.ambiguousGroup) d.ambiguousGroup++; if (b.oos) d.oos++;
        if (b.safetyGate) d.safetyGate++; if (b.oosPreflight) d.oosPreflight++; if (b.validationGroup) d.validationGroup++; if (b.longQuestion) d.longQuestionGroup++;
      }
    } else if (typeof row.routingScored !== "boolean") err("ROUTING_SCORED_MISMATCH", "routingScored must be boolean");

    // dataset item (valid-enough rows only)
    if (id && q && accentedOk && tagsOk && author && final) {
      items.push({ line, id, question: q, accented: row.accented as boolean, tags, category: final.category, safety: final.safety, primaryAgent: final.primaryAgent, author, expectedPreRouting: final.expectedPreRouting });
    }
  });

  // ── m7-p5a2 (Q4): role separation across the WHOLE file (declared ids only — this cannot prove who a person is) ──────
  // one id per role: the first valid id seen for a role is the reference; every other id used in that role is an error
  const ref = new Map<Role, { raw: string; line: number }>();
  for (const u of roleUses) if (!ref.has(u.role)) ref.set(u.role, { raw: u.raw, line: u.line });
  const reported = new Set<string>();
  const once = (f: Finding) => { const k = `${f.line}|${f.code}|${f.detail}`; if (!reported.has(k)) { reported.add(k); errors.push(f); } };
  for (const u of roleUses) {
    const r = ref.get(u.role)!;
    if (labelerRoleKey(u.raw) !== labelerRoleKey(r.raw)) once({ line: u.line, id: u.id, code: "ROLE_ID_INCONSISTENT", detail: `${ROLE_NAME[u.role]} id ${u.raw} differs from ${r.raw} used on line ${r.line}: each role uses ONE id across the whole file (m7-p5a2 Q4)` });
    // a use conflicts when its id is ANOTHER role's id (that role's reference). A non-reference id used in two roles is already
    // ROLE_ID_INCONSISTENT in both, so every cross-role reuse is reported, on the rows that carry it
    for (const other of ROLE_LIST) {
      const o = other === u.role ? undefined : ref.get(other);
      if (o && labelerRoleKey(u.raw) === labelerRoleKey(o.raw)) once({ line: u.line, id: u.id, code: "ROLE_CONFLICT", detail: `id ${u.raw} is used as ${ROLE_NAME[u.role]} here but it is the ${ROLE_NAME[other]} id (line ${o.line}); one person holds one role (Q4)` });
    }
  }
  // a writer never labels (decision sheet §4.4); writer names are compared with the same case-insensitive canonical key
  const labelerKeys = new Map<string, Role>();
  for (const u of roleUses) if (!labelerKeys.has(labelerRoleKey(u.raw))) labelerKeys.set(labelerRoleKey(u.raw), u.role);
  for (const a of authorUses) {
    const role = labelerKeys.get(canonicalWriterKey(a.author));
    if (role) once({ line: a.line, id: a.id, code: "WRITER_IS_LABELER", detail: `source.author ${a.author} is also used as ${ROLE_NAME[role]}; writers never annotate or adjudicate (Q4)` });
  }
  stats.roles = { annotatorA: ref.get("A")?.raw ?? null, annotatorB: ref.get("B")?.raw ?? null, adjudicator: ref.get("J")?.raw ?? null };

  // ── m7-p5a2 (Q5): at most QUOTAS.thirdPartyMinorMax third-person minor cases ───────────────────────────────────────
  stats.quotas.thirdPartyMinor.used = thirdParty.length;
  for (const t of thirdParty.slice(QUOTAS.thirdPartyMinorMax)) errors.push({ line: t.line, id: t.id, code: "QUOTA_THIRD_PARTY_MINOR", detail: `more than ${QUOTAS.thirdPartyMinorMax} third-person minor cases (Q5); this row is over the cap` });

  const ds = runDatasetChecks(items, opts);
  errors.push(...ds.errors);
  const reviews = [...rowReviews, ...ds.reviews];
  stats.dataset = ds.stats;
  const dq = (ds.stats as { quotas?: { longQuestion: number; overRequestLimit: number } }).quotas;
  if (dq) { stats.quotas.longQuestion.used = dq.longQuestion; stats.quotas.overRequestLimit.used = dq.overRequestLimit; }
  for (const e of errors) stats.errorsByCode[e.code] = (stats.errorsByCode[e.code] ?? 0) + 1;
  for (const r of reviews) stats.reviewsByCode[r.code] = (stats.reviewsByCode[r.code] ?? 0) + 1;
  return { ok: errors.length === 0, errors, reviews, stats, items };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: tsx annotation-validator.ts <file.jsonl> [--no-distribution] [--no-overlap]"); process.exit(2); }
  const res = validateRoutingAnnotations(fs.readFileSync(file, "utf8"), {
    checkDistribution: !args.includes("--no-distribution"),
    checkBenchmarkOverlap: !args.includes("--no-overlap"),
  });
  for (const e of res.errors) console.log(`ERROR\tline ${e.line}\t${e.id ?? "-"}\t${e.code}\t${e.detail}`);
  if (res.reviews.length) {
    console.log("\nREVIEW REQUIRED (a human must look at each item and sign off; nothing is auto-removed):");
    for (const r of res.reviews) console.log(`REVIEW\tline ${r.line}\t${r.id ?? "-"}\t${r.code}\t${r.detail}`);
  }
  console.log(JSON.stringify(res.stats, null, 2));
  if (!res.ok) { console.log(`FAILED: ${res.errors.length} error(s), ${res.reviews.length} review item(s)`); process.exit(1); }
  if (res.reviews.length) { console.log(`NO ERRORS but ${res.reviews.length} item(s) REVIEW REQUIRED: human sign-off needed`); process.exit(3); }
  console.log("OK");
  process.exit(0);
}
