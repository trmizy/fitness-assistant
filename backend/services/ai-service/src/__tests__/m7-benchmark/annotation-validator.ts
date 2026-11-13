/**
 * M7-P5A.1 — ROW-LEVEL validator for the FUTURE human-labelled routing dataset (schema "m7-p5a1", see annotation-schema.ts).
 * Two independent human annotators label every case; disagreements go to an adjudicator; `final` must equal the agreed label
 * (A = B) or the adjudication decision. Acceptable sets / deferred agents are DERIVED (deriveExpected), never typed.
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
  isValidLabelerId, labelsEqual, orderingErrors, expectedRoutingScored, MAX_QUESTION_CHARS,
  type CaseLabel, type DatasetCheckOptions, type DatasetItem, type DomainLabel, type Finding, type Interpretation,
} from "./annotation-schema";
import type { AgentLabel } from "../m5-benchmark/dataset-v1";
import { findDuplicateKeys } from "./annotation-json";
import { runDatasetChecks } from "./annotation-dataset-checks";

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
}
export interface ValidationResult { ok: boolean; errors: Finding[]; reviews: Finding[]; stats: ValidationStats; items: DatasetItem[] }

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function hasVietnameseDiacritics(q: string): boolean {
  return /[̀-ͯ]|đ|Đ/.test(q.normalize("NFD"));
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isAgent = (v: unknown): v is AgentLabel => typeof v === "string" && (AGENTS as readonly string[]).includes(v);
const inList = (list: readonly string[], v: unknown): v is string => typeof v === "string" && list.includes(v);
const canonDomain = (d: DomainLabel) => `${d.agent}:${d.role}:${d.supports ?? ""}`;
const canonInterp = (i: Interpretation) => `${i.primaryAgent}|${i.domains.map(canonDomain).join(",")}`;

type Err = (code: string, detail: string) => void;

/** Keys of an object that are not allowed. Derived fields get their own code (reported once, by walkDerived). */
function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string, err: Err): void {
  for (const k of Object.keys(obj)) {
    if (allowed.includes(k)) continue;
    if ((DERIVED_FIELDS as readonly string[]).includes(k)) continue;
    err("UNEXPECTED_KEY", `${where}: unexpected key '${k}'`);
  }
}

/** DERIVED_FIELD_NOT_ALLOWED for any derived field name, at any depth. */
function walkDerived(value: unknown, path: string, err: Err): void {
  if (Array.isArray(value)) { value.forEach((v, i) => walkDerived(v, `${path}[${i}]`, err)); return; }
  if (!isObj(value)) return;
  for (const [k, v] of Object.entries(value)) {
    if ((DERIVED_FIELDS as readonly string[]).includes(k)) err("DERIVED_FIELD_NOT_ALLOWED", `${path}.${k}: '${k}' is derived by the schema (deriveExpected) and must not be typed by hand`);
    walkDerived(v, `${path}.${k}`, err);
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
function checkLabel(raw: unknown, where: string, allowedKeys: readonly string[], err: Err): LabelCheck {
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

function checkAnnotator(raw: unknown, which: "annotatorA" | "annotatorB", err: Err): { label: CaseLabel | null; id: string | null } {
  if (!isObj(raw)) { err("MISSING_FIELD", `${which} missing or not an object`); return { label: null, id: null }; }
  let id: string | null = null;
  if (raw.annotatorId === undefined || raw.annotatorId === null || raw.annotatorId === "") err("MISSING_ANNOTATOR_ID", `${which}.annotatorId missing`);
  else if (!isValidLabelerId(raw.annotatorId)) err("INVALID_ANNOTATOR_ID", `${which}.annotatorId ${JSON.stringify(raw.annotatorId)} is not a valid human pseudonym (model / tool names are refused)`);
  else id = raw.annotatorId;
  const { label } = checkLabel(raw, which, ANNOTATOR_KEYS, err);
  return { label, id };
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function validateRoutingAnnotations(jsonlText: string, opts: ValidateOptions = {}): ValidationResult {
  const errors: Finding[] = [];
  const stats: ValidationStats = { totalLines: 0, cases: 0, byCategory: {}, bySafety: {}, disagreements: 0, adjudicated: 0, errorsByCode: {}, reviewsByCode: {}, dataset: {} };
  const items: DatasetItem[] = [];
  const seenIds = new Map<string, number>();

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
    if (dup.duplicates.length) {
      for (const d of dup.duplicates) err("DUPLICATE_JSON_KEY", `key '${d.key}' appears more than once at ${d.path} (JSON.parse would silently keep the last one); row not validated further`);
      return;
    }

    // schema version / keys / derived fields
    if (row.schemaVersion !== SCHEMA_VERSION) err("SCHEMA_VERSION", `schemaVersion must be "${SCHEMA_VERSION}", got ${JSON.stringify(row.schemaVersion)}`);
    checkKeys(row, ROW_KEYS, "row", err);
    walkDerived(row, "$", err);

    // id
    if (!id) err("MISSING_FIELD", "id missing or empty");
    else if (seenIds.has(id)) err("DUPLICATE_ID", `id also used on line ${seenIds.get(id)}`);
    else seenIds.set(id, line);

    // question + accented
    const q = nonEmptyStr(row.question) ? row.question : null;
    if (!q) err("MISSING_FIELD", "question missing or empty");
    // M7-P5A.2 remediation (cross-check F3): lengths (600 / 2000) are measured on the stored text, so the stored text
    // must already be what the endpoint measures — trimmed (supervisor trims) and NFC (no save-format dependence)
    if (q && q !== q.trim()) err("QUESTION_NOT_TRIMMED", "question has leading or trailing whitespace (the endpoint trims before measuring)");
    if (q && q !== q.normalize("NFC")) err("QUESTION_NOT_NFC", "question is not Unicode NFC (lengths would depend on how the file was saved)");
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
      if (!nonEmptyStr(src.author)) err("INVALID_SOURCE", "source.author missing or empty"); else author = src.author;
      if (!nonEmptyStr(src.note)) err("INVALID_SOURCE", "source.note missing or empty");
    }

    if (!nonEmptyStr(row.rationale)) err("MISSING_RATIONALE", "rationale missing or empty");

    // labels
    const A = checkAnnotator(row.annotatorA, "annotatorA", err);
    const B = checkAnnotator(row.annotatorB, "annotatorB", err);
    if (A.id && B.id && A.id.toLowerCase() === B.id.toLowerCase()) err("SAME_ANNOTATOR", `annotatorA and annotatorB are the same labeler (${A.id}); two independent annotators are required`);
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
        decision = checkLabel(adj.decision, "adjudication.decision", LABEL_KEYS, err).label;
        if (!nonEmptyStr(adj.rationale)) err("ADJUDICATION_MISSING", "adjudication.rationale missing or empty");
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
      stats.byCategory[final.category] = (stats.byCategory[final.category] ?? 0) + 1;
      stats.bySafety[s] = (stats.bySafety[s] ?? 0) + 1;
      if (typeof row.routingScored !== "boolean") err("ROUTING_SCORED_MISMATCH", "routingScored must be boolean");
      else if (row.routingScored !== expectedRoutingScored(final, typeof q === "string" ? q : "")) err("ROUTING_SCORED_MISMATCH", `routingScored=${row.routingScored} but final.expectedPreRouting=${final.expectedPreRouting}, question length ${typeof q === "string" ? q.length : "?"} (must be true exactly when ALLOW and ≤ ${MAX_QUESTION_CHARS} chars)`);
    } else if (typeof row.routingScored !== "boolean") err("ROUTING_SCORED_MISMATCH", "routingScored must be boolean");

    // dataset item (valid-enough rows only)
    if (id && q && accentedOk && tagsOk && author && final) {
      items.push({ line, id, question: q, accented: row.accented as boolean, tags, category: final.category, safety: final.safety, primaryAgent: final.primaryAgent, author, expectedPreRouting: final.expectedPreRouting });
    }
  });

  const ds = runDatasetChecks(items, opts);
  errors.push(...ds.errors);
  const reviews = [...ds.reviews];
  stats.dataset = ds.stats;
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
