/**
 * M7-P5A2 — minimal OFFLINE annotation CLI (owner decision Q1, 2026-11-15) for the m7-p5a2 contract.
 *
 *   prepare     questions.jsonl → for-annotator-A.jsonl, for-annotator-B.jsonl (id, question, accented ONLY; seeded order) + prepare-manifest.json
 *   check-role  one annotator's label file → report (ids vs prepared, shape, own rationale, one annotatorId, role conflicts)
 *   agreement   ORIGINAL A + B label files → agreement-report.json (computeAgreement + κ policy; never adjudicated labels)
 *   merge       questions + A + B + adjudicator decisions [+ tag-audit] → dataset.jsonl, adjudication.jsonl, merge-manifest.json
 *   validate    dataset.jsonl → the official validator (annotation-validator.ts), unchanged
 *   freeze      dataset + guide + A + B + adjudication + merge-manifest + agreement-report + candidate identity + signoff → freeze.json
 *
 * Rules: offline (no network, no model, no AWS); NEVER creates, guesses, repairs or resolves a label; inputs are read only;
 * outputs are never overwritten (an existing target ⇒ refused, nothing written; each file is created atomically with a
 * no-replace hard link); deterministic output (rows sorted by id, fixed key order, LF, UTF-8 without BOM, no timestamps).
 * Exit codes: 0 clean · 1 error / refused · 3 no error but human review / sign-off required · 2 usage.
 * Findings are printed one per line: ERROR|REVIEW <TAB> file <TAB> line <TAB> id <TAB> code <TAB> detail.
 *
 * `freeze` produces a PROPOSED manifest (or, with --fixture, a FIXTURE-only manifest). It never approves a freeze: the
 * owner signs separately. Run: npx tsx src/__tests__/m7-benchmark/annotation-cli.ts <command> [options]
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  ANNOTATOR_KEYS, DERIVED_FIELDS, LABEL_KEYS, SCHEMA_VERSION, SOURCE_KEYS, SOURCE_KINDS, TAGS,
  expectedRoutingScored, isValidLabelerId, labelerRoleKey, labelsEqual,
  type CaseLabel, type DomainLabel, type Finding, type Interpretation,
} from "./annotation-schema";
import { checkAnnotator, checkLabel, hasVietnameseDiacritics, humanTextProblem, validateRoutingAnnotations, type ValidateOptions } from "./annotation-validator";
import { INVISIBLE_CHARS_RE, QUESTION_INVISIBLE_CHARS_RE } from "./annotation-dataset-checks";
import { findDuplicateKeys } from "./annotation-json";
import { computeAgreement, evaluateAgreementPolicy } from "./annotation-agreement";
import { replayTagAudit } from "./annotation-tag-audit";

export const TOOL = "m7-p5a2-annotation-cli";
export const QUESTION_FILE_KEYS = ["schemaVersion", "id", "question", "accented", "tags", "source"] as const;
export const ANNOTATOR_TASK_KEYS = ["id", "question", "accented"] as const;
export const ANNOTATOR_FILE_KEYS = ["schemaVersion", "id", ...ANNOTATOR_KEYS] as const;
export const ADJUDICATOR_FILE_KEYS = ["schemaVersion", "id", "adjudicatorId", "finalRationale", "decision", "decisionRationale"] as const;
/** Q9: files the candidate identity must contain before any freeze. */
export const REQUIRED_CANDIDATE_FILES = Object.freeze([
  "backend/services/ai-service/src/llm/safety_guard.ts",
  "backend/services/ai-service/src/llm/induced_vomiting_events.ts",
  "backend/services/ai-service/src/llm/safety-limits.ts",
  "backend/services/ai-service/src/agent-v2/answer-guards.ts",
]);

// ── small utilities ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface Io { out: (s: string) => void; err: (s: string) => void }
const defaultIo: Io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) };
type Obj = Record<string, unknown>;
interface F extends Finding { file: string }
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
const shaFile = (p: string) => sha256(fs.readFileSync(p));
/** JSON.stringify keeping `undefined` visible as null (a κ that is not defined must stay visible, never vanish). */
const stable = (v: unknown, indent?: number) => JSON.stringify(v, (_k, x) => (x === undefined ? null : x), indent);
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const idKey = (id: string) => id.trim().toLowerCase();

class Findings {
  readonly list: F[] = [];
  readonly reviews: F[] = [];
  add(file: string, line: number, id: string | null, code: string, detail: string) { this.list.push({ file, line, id, code, detail }); }
  review(file: string, line: number, id: string | null, code: string, detail: string) { this.reviews.push({ file, line, id, code, detail }); }
  get ok() { return this.list.length === 0; }
  print(io: Io) {
    for (const e of this.list) io.out(`ERROR\t${e.file}\tline ${e.line}\t${e.id ?? "-"}\t${e.code}\t${e.detail}`);
    for (const r of this.reviews) io.out(`REVIEW\t${r.file}\tline ${r.line}\t${r.id ?? "-"}\t${r.code}\t${r.detail}`);
  }
}

interface Line { line: number; obj: Obj }
/** Reads a JSONL file strictly: BOM, malformed JSON, non-object lines, duplicate keys and over-deep nesting are findings. */
function readJsonl(file: string, fx: Findings): Line[] | null {
  const name = path.basename(file);
  if (!fs.existsSync(file)) { fx.add(name, 0, null, "FILE_MISSING", `${file} does not exist`); return null; }
  const text = fs.readFileSync(file, "utf8");
  if (text.charCodeAt(0) === 0xfeff) { fx.add(name, 1, null, "FILE_HAS_BOM", "file starts with a UTF-8 BOM; save as UTF-8 without BOM (nothing is stripped silently)"); return null; }
  const out: Line[] = [];
  text.split(/\r?\n/).forEach((t, i) => {
    if (!t.trim()) return;
    const line = i + 1;
    let v: unknown;
    try { v = JSON.parse(t); } catch (e) { fx.add(name, line, null, "MALFORMED_JSON", `${(e as Error).message} (an interrupted / truncated submission looks like this)`); return; }
    if (!isObj(v)) { fx.add(name, line, null, "NOT_OBJECT", "line is not a JSON object"); return; }
    const d = findDuplicateKeys(t);
    if (d.tooDeep || d.duplicates.length) { fx.add(name, line, typeof v.id === "string" ? v.id : null, "DUPLICATE_JSON_KEY", "duplicate key or nesting too deep; line not used"); return; }
    out.push({ line, obj: v });
  });
  return out;
}
function readJson(file: string, fx: Findings): Obj | null {
  const name = path.basename(file);
  if (!fs.existsSync(file)) { fx.add(name, 0, null, "FILE_MISSING", `${file} does not exist`); return null; }
  try { const v = JSON.parse(fs.readFileSync(file, "utf8")); if (isObj(v)) return v; fx.add(name, 1, null, "NOT_OBJECT", "file is not a JSON object"); }
  catch (e) { fx.add(name, 1, null, "MALFORMED_JSON", (e as Error).message); }
  return null;
}
function unexpectedKeys(o: Obj, allowed: readonly string[], fx: Findings, file: string, line: number, id: string | null, where: string) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fx.add(file, line, id, (DERIVED_FIELDS as readonly string[]).includes(k) ? "DERIVED_FIELD_NOT_ALLOWED" : "UNEXPECTED_KEY", `${where}: unexpected key '${k}'`);
}
/** Derived fields anywhere in a label (the validator's checkKeys skips them at every level, so report them here). */
function derivedAnywhere(v: unknown, p: string, hit: (p: string) => void, depth = 0): void {
  if (depth > 64) return;
  if (Array.isArray(v)) { v.forEach((x, i) => derivedAnywhere(x, `${p}[${i}]`, hit, depth + 1)); return; }
  if (!isObj(v)) return;
  for (const [k, x] of Object.entries(v)) { if ((DERIVED_FIELDS as readonly string[]).includes(k)) hit(`${p}.${k}`); derivedAnywhere(x, `${p}.${k}`, hit, depth + 1); }
}

// ── deterministic output ─────────────────────────────────────────────────────────────────────────────────────────────
const domainOut = (d: DomainLabel) => (d.supports === undefined ? { agent: d.agent, role: d.role } : { agent: d.agent, role: d.role, supports: d.supports });
const interpOut = (i: Interpretation) => ({ domains: i.domains.map(domainOut), primaryAgent: i.primaryAgent, rationale: i.rationale });
/** A label in the fixed LABEL_KEYS order. Values are the annotator's / adjudicator's own, unchanged. */
export const labelOut = (l: CaseLabel) => ({
  domains: l.domains.map(domainOut), primaryAgent: l.primaryAgent, category: l.category, safety: l.safety, expectedPreRouting: l.expectedPreRouting,
  ...(l.interpretations !== undefined ? { interpretations: l.interpretations.map(interpOut) } : {}),
});
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");

/**
 * Creates every file of `files` in `dir`, or none: refused when ANY target exists. Each file is written to a private temp
 * name and published with a hard link, which fails instead of replacing an existing file (no overwrite even under a race).
 * Files are published in the given order; the manifest goes last so an interrupted run never leaves a manifest.
 */
export function writeAllOrNothing(dir: string, files: Array<[string, string]>, fx: Findings): boolean {
  fs.mkdirSync(dir, { recursive: true });
  const existing = files.filter(([n]) => fs.existsSync(path.join(dir, n)));
  for (const [n] of existing) fx.add(n, 0, null, "OUTPUT_EXISTS", `${path.join(dir, n)} already exists; outputs are never overwritten (choose a new --out-dir)`);
  if (existing.length) return false;
  const created: string[] = [];
  try {
    for (const [n, content] of files) {
      const target = path.join(dir, n);
      const tmp = path.join(dir, `.${n}.partial-${process.pid}`);
      fs.writeFileSync(tmp, content, { encoding: "utf8", flag: "wx" });
      try { fs.linkSync(tmp, target); created.push(target); } finally { fs.unlinkSync(tmp); }
    }
    return true;
  } catch (e) {
    for (const c of created) fs.unlinkSync(c); // only what THIS run created
    fx.add(path.basename(dir), 0, null, "WRITE_FAILED", `${(e as Error).message}; nothing from this run was kept`);
    return false;
  }
}

// ── parsing of each input kind ───────────────────────────────────────────────────────────────────────────────────────
export interface QuestionRow { line: number; id: string; question: string; accented: boolean; tags: string[]; source: { kind: string; author: string; note: string } }
/** The curator's question file. Labels never belong here. */
export function parseQuestions(file: string, fx: Findings): QuestionRow[] | null {
  const name = path.basename(file);
  const lines = readJsonl(file, fx);
  if (!lines) return null;
  const out: QuestionRow[] = [];
  const seen = new Map<string, number>();
  for (const { line, obj } of lines) {
    const id = nonEmptyStr(obj.id) ? obj.id : null;
    const e = (code: string, d: string) => fx.add(name, line, id, code, d);
    unexpectedKeys(obj, QUESTION_FILE_KEYS, fx, name, line, id, "question row");
    if (obj.schemaVersion !== SCHEMA_VERSION) e("SCHEMA_VERSION", `schemaVersion must be "${SCHEMA_VERSION}", got ${JSON.stringify(obj.schemaVersion)}`);
    let ok = true;
    if (!id) { e("MISSING_FIELD", "id missing or empty"); ok = false; }
    else {
      if (id !== id.trim() || INVISIBLE_CHARS_RE.test(id)) { e("ID_NOT_TRIMMED", "id must be trimmed and free of invisible characters"); ok = false; }
      if (seen.has(idKey(id))) { e("DUPLICATE_ID", `id also on line ${seen.get(idKey(id))} (case-insensitive)`); ok = false; } else seen.set(idKey(id), line);
    }
    const q = nonEmptyStr(obj.question) ? obj.question : null;
    if (!q) { e("MISSING_FIELD", "question missing or empty"); ok = false; }
    else {
      if (q !== q.trim()) { e("QUESTION_NOT_TRIMMED", "question has leading or trailing whitespace"); ok = false; }
      if (q !== q.normalize("NFC")) { e("QUESTION_NOT_NFC", "question is not Unicode NFC"); ok = false; }
      if (QUESTION_INVISIBLE_CHARS_RE.test(q)) { e("QUESTION_INVISIBLE_CHARS", "question contains invisible / format / control characters"); ok = false; }
    }
    if (typeof obj.accented !== "boolean") { e("MISSING_FIELD", "accented must be boolean"); ok = false; }
    else if (q && obj.accented !== hasVietnameseDiacritics(q)) { e("ACCENTED_MISMATCH", `accented=${obj.accented} does not match the text`); ok = false; }
    if (!Array.isArray(obj.tags) || obj.tags.some((t) => typeof t !== "string" || !(TAGS as readonly string[]).includes(t)) || new Set(obj.tags).size !== obj.tags.length) { e("INVALID_ENUM", `tags must be distinct values of ${TAGS.join("|")}`); ok = false; }
    const s = obj.source;
    if (!isObj(s)) { e("INVALID_SOURCE", "source missing or not an object"); ok = false; }
    else {
      unexpectedKeys(s, SOURCE_KEYS, fx, name, line, id, "source");
      if (!(SOURCE_KINDS as readonly unknown[]).includes(s.kind)) { e("INVALID_SOURCE", `source.kind must be one of ${SOURCE_KINDS.join("|")}`); ok = false; }
      if (!nonEmptyStr(s.author)) { e("INVALID_SOURCE", "source.author missing or empty"); ok = false; }
      else if (s.author !== s.author.trim() || s.author !== s.author.normalize("NFC") || INVISIBLE_CHARS_RE.test(s.author)) { e("AUTHOR_NOT_CANONICAL", "source.author must be trimmed, NFC, no invisible characters"); ok = false; }
      if (!nonEmptyStr(s.note)) { e("INVALID_SOURCE", "source.note missing or empty"); ok = false; }
    }
    if (ok && id && q && isObj(s)) out.push({ line, id, question: q, accented: obj.accented as boolean, tags: [...(obj.tags as string[])], source: { kind: s.kind as string, author: s.author as string, note: s.note as string } });
  }
  return out;
}

/** The ids an annotator was given: a prepared for-annotator file (id, question, accented) or the curator's question file. */
function preparedIds(file: string, fx: Findings): string[] | null {
  const lines = readJsonl(file, fx);
  if (!lines) return null;
  const ids: string[] = [];
  for (const { line, obj } of lines) {
    if (!nonEmptyStr(obj.id)) { fx.add(path.basename(file), line, null, "MISSING_FIELD", "id missing"); continue; }
    if (ids.some((x) => idKey(x) === idKey(obj.id as string))) fx.add(path.basename(file), line, obj.id, "DUPLICATE_ID", "id repeated in the prepared file");
    else ids.push(obj.id);
  }
  return ids;
}

export interface AnnotatorRow { line: number; id: string; annotatorId: string; rationale: string; label: CaseLabel }
export interface RoleFile { rows: Map<string, AnnotatorRow>; annotatorId: string | null }
/** One annotator's submission, checked against the ids that annotator was given. Nothing is repaired. */
export function parseRoleFile(file: string, role: "A" | "B", expected: readonly string[], fx: Findings): RoleFile | null {
  const name = path.basename(file);
  const lines = readJsonl(file, fx);
  if (!lines) return null;
  const rows = new Map<string, AnnotatorRow>();
  const seen = new Map<string, number>();
  let ref: { raw: string; line: number } | null = null;
  const exp = new Map(expected.map((x) => [idKey(x), x]));
  for (const { line, obj } of lines) {
    const id = nonEmptyStr(obj.id) ? obj.id : null;
    const e = (code: string, d: string) => fx.add(name, line, id, code, d);
    if (obj.schemaVersion !== SCHEMA_VERSION) e("SCHEMA_VERSION", `schemaVersion must be "${SCHEMA_VERSION}", got ${JSON.stringify(obj.schemaVersion)}`);
    for (const k of Object.keys(obj)) if (!(ANNOTATOR_FILE_KEYS as readonly string[]).includes(k) && !(DERIVED_FIELDS as readonly string[]).includes(k)) e(k === "tags" ? "TAG_IN_ANNOTATOR_FILE" : "UNEXPECTED_KEY", `unexpected key '${k}'${k === "tags" ? " (annotators never see or write tags, Q3)" : ""}`);
    derivedAnywhere(obj, "$", (p) => e("DERIVED_FIELD_NOT_ALLOWED", `${p} is derived by the schema and must not be typed`));
    if (!id) { e("MISSING_FIELD", "id missing or empty"); continue; }
    if (seen.has(idKey(id))) { e("DUPLICATE_ID", `id also on line ${seen.get(idKey(id))}: a submission has exactly one label per case`); continue; }
    seen.set(idKey(id), line);
    if (!exp.has(idKey(id))) { e("UNKNOWN_ID", `id ${id} was not given to annotator ${role}`); continue; }
    if (exp.get(idKey(id)) !== id) e("ID_CASE_MISMATCH", `id must be written exactly as given (${exp.get(idKey(id))})`);
    const block: Obj = {};
    for (const k of ANNOTATOR_KEYS) if (k in obj) block[k] = obj[k];
    let rowOk = true;
    const err = (code: string, d: string) => { rowOk = false; e(code, d); };
    const a = checkAnnotator(block, `annotator${role}`, err);
    if (a.id) {
      if (!ref) ref = { raw: a.id, line };
      else if (labelerRoleKey(a.id) !== labelerRoleKey(ref.raw)) err("ROLE_ID_INCONSISTENT", `annotatorId ${a.id} differs from ${ref.raw} (line ${ref.line}); one annotator id per file`);
    }
    if (rowOk && a.label && a.id && a.rationale) rows.set(exp.get(idKey(id))!, { line, id: exp.get(idKey(id))!, annotatorId: a.id, rationale: a.rationale, label: a.label });
  }
  for (const x of expected) if (!seen.has(idKey(x))) fx.add(name, 0, x, "MISSING_SUBMISSION", `no label for ${x} (incomplete or interrupted submission)`);
  return { rows, annotatorId: ref ? (ref as { raw: string }).raw : null };
}

interface AdjRow { line: number; id: string; adjudicatorId: string; finalRationale: string; decision: CaseLabel | null; decisionRationale: string | null }
function parseAdjudicatorFile(file: string, expected: readonly string[], agreeById: Map<string, boolean>, annotators: string[], fx: Findings): { rows: Map<string, AdjRow>; adjudicatorId: string | null } | null {
  const name = path.basename(file);
  const lines = readJsonl(file, fx);
  if (!lines) return null;
  const rows = new Map<string, AdjRow>();
  const seen = new Map<string, number>();
  const exp = new Map(expected.map((x) => [idKey(x), x]));
  let ref: { raw: string; line: number } | null = null;
  const annKeys = annotators.map(labelerRoleKey);
  for (const { line, obj } of lines) {
    const id = nonEmptyStr(obj.id) ? obj.id : null;
    let ok = true;
    const e = (code: string, d: string) => { ok = false; fx.add(name, line, id, code, d); };
    unexpectedKeys(obj, ADJUDICATOR_FILE_KEYS, fx, name, line, id, "adjudicator row");
    derivedAnywhere(obj, "$", (p) => e("DERIVED_FIELD_NOT_ALLOWED", `${p} is derived and must not be typed`));
    if (obj.schemaVersion !== SCHEMA_VERSION) e("SCHEMA_VERSION", `schemaVersion must be "${SCHEMA_VERSION}"`);
    if (!id) { e("MISSING_FIELD", "id missing"); continue; }
    if (seen.has(idKey(id))) { e("DUPLICATE_ID", `id also on line ${seen.get(idKey(id))}`); continue; }
    seen.set(idKey(id), line);
    const canon = exp.get(idKey(id));
    if (!canon) { e("UNKNOWN_ID", `id ${id} is not in the question file`); continue; }
    if (!isValidLabelerId(obj.adjudicatorId)) e("INVALID_ADJUDICATOR", `adjudicatorId ${JSON.stringify(obj.adjudicatorId)} missing or not a valid human pseudonym`);
    else {
      if (!ref) ref = { raw: obj.adjudicatorId, line };
      else if (labelerRoleKey(obj.adjudicatorId) !== labelerRoleKey(ref.raw)) e("ROLE_ID_INCONSISTENT", `adjudicatorId ${obj.adjudicatorId} differs from ${ref.raw} (line ${ref.line})`);
      if (annKeys.includes(labelerRoleKey(obj.adjudicatorId))) e("ADJUDICATOR_IS_ANNOTATOR", `adjudicatorId ${obj.adjudicatorId} is annotator A or B; the adjudicator is an independent third person (Q4)`);
    }
    if (!nonEmptyStr(obj.finalRationale)) e("MISSING_RATIONALE", "finalRationale missing or empty (the adjudicator writes the final rationale for EVERY case, Q2)");
    else { const p = humanTextProblem(obj.finalRationale); if (p) e("RATIONALE_NOT_CANONICAL", `finalRationale ${p}`); }
    const agree = agreeById.get(canon);
    let decision: CaseLabel | null = null;
    let decisionRationale: string | null = null;
    if (agree === true) {
      if (obj.decision !== undefined || obj.decisionRationale !== undefined) e("ADJUDICATION_NOT_NEEDED", "A and B agree on this case: no decision / decisionRationale (only finalRationale)");
    } else if (agree === false) {
      if (obj.decision === undefined) e("ADJUDICATION_MISSING", "A and B disagree: a decision is required");
      else decision = checkLabel(obj.decision, "decision", LABEL_KEYS, (c, d) => e(c, d)).label;
      if (!nonEmptyStr(obj.decisionRationale)) e("ADJUDICATION_MISSING", "A and B disagree: decisionRationale is required");
      else { const p = humanTextProblem(obj.decisionRationale); if (p) e("RATIONALE_NOT_CANONICAL", `decisionRationale ${p}`); decisionRationale = obj.decisionRationale; }
    }
    if (ok && isValidLabelerId(obj.adjudicatorId) && nonEmptyStr(obj.finalRationale)) rows.set(canon, { line, id: canon, adjudicatorId: obj.adjudicatorId, finalRationale: obj.finalRationale, decision, decisionRationale });
  }
  for (const x of expected) if (!seen.has(idKey(x))) fx.add(name, 0, x, "MISSING_SUBMISSION", `no adjudicator line for ${x} (one line per case, agreed cases included)`);
  return { rows, adjudicatorId: ref ? (ref as { raw: string }).raw : null };
}

function roleConflict(a: RoleFile | null, b: RoleFile | null, fx: Findings, file: string) {
  if (a?.annotatorId && b?.annotatorId && labelerRoleKey(a.annotatorId) === labelerRoleKey(b.annotatorId)) fx.add(file, 0, null, "ROLE_CONFLICT", `annotator A and annotator B use the same id ${a.annotatorId}; two independent people are required`);
}

// ── commands ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type Args = { _: string[]; opt: Map<string, string>; flags: Set<string> };
function parseArgs(argv: readonly string[]): Args {
  const a: Args = { _: [], opt: new Map(), flags: new Set() };
  const FLAGS = new Set(["--no-distribution", "--no-overlap", "--fixture"]);
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (FLAGS.has(t)) a.flags.add(t);
    else if (t.startsWith("--")) { a.opt.set(t, argv[i + 1] ?? ""); i++; }
    else a._.push(t);
  }
  return a;
}
const need = (a: Args, keys: string[], io: Io): boolean => {
  const miss = keys.filter((k) => !a.opt.get(k));
  if (miss.length) io.err(`usage: missing ${miss.join(", ")}`);
  return miss.length === 0;
};
const finish = (fx: Findings, io: Io, okMsg: string): number => {
  fx.print(io);
  if (!fx.ok) { io.out(`FAILED: ${fx.list.length} error(s)`); return 1; }
  if (fx.reviews.length) { io.out(`NO ERRORS but ${fx.reviews.length} item(s) REVIEW REQUIRED: human sign-off needed`); return 3; }
  io.out(okMsg);
  return 0;
};

/** mulberry32: a tiny seeded PRNG (deterministic shuffles; the seed is recorded in the manifest). */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

function cmdPrepare(a: Args, io: Io): number {
  if (!need(a, ["--questions", "--out-dir", "--seed"], io)) return 2;
  const seedText = a.opt.get("--seed")!;
  if (!/^[0-9]{1,10}$/.test(seedText) || Number(seedText) > 0xffffffff) { io.err("usage: --seed must be an integer 0..4294967295"); return 2; }
  const seed = Number(seedText);
  const fx = new Findings();
  const qFile = a.opt.get("--questions")!;
  const qs = parseQuestions(qFile, fx);
  if (!qs || !fx.ok) return finish(fx, io, "");
  if (!qs.length) { fx.add(path.basename(qFile), 0, null, "EMPTY_FILE", "no question rows"); return finish(fx, io, ""); }
  const sorted = [...qs].sort((x, y) => byId(x.id, y.id));
  // annotators get id, question, accented ONLY: no tags (Q3), no source / author, no labels, no predictions
  const task = (q: QuestionRow) => ({ id: q.id, question: q.question, accented: q.accented });
  const A = jsonl(shuffled(sorted, seed).map(task));
  const B = jsonl(shuffled(sorted, (seed + 1) >>> 0).map(task));
  const manifest = {
    kind: "m7-p5a2-prepare-manifest", tool: TOOL, schemaVersion: SCHEMA_VERSION, seed, orderRule: "ids sorted (code point), then mulberry32 shuffle: A with seed, B with seed+1",
    count: qs.length, fieldsGivenToAnnotators: [...ANNOTATOR_TASK_KEYS],
    inputs: { questions: { file: path.basename(qFile), sha256: shaFile(qFile) } },
    outputs: { forAnnotatorA: { file: "for-annotator-A.jsonl", sha256: sha256(A) }, forAnnotatorB: { file: "for-annotator-B.jsonl", sha256: sha256(B) } },
  };
  if (!writeAllOrNothing(a.opt.get("--out-dir")!, [["for-annotator-A.jsonl", A], ["for-annotator-B.jsonl", B], ["prepare-manifest.json", stable(manifest, 2) + "\n"]], fx)) return finish(fx, io, "");
  return finish(fx, io, `OK prepared ${qs.length} case(s) for annotators A and B (seed ${seed})`);
}

function cmdCheckRole(a: Args, io: Io): number {
  if (!need(a, ["--role", "--prepared", "--labels"], io)) return 2;
  const role = a.opt.get("--role");
  if (role !== "A" && role !== "B") { io.err("usage: --role A|B"); return 2; }
  const fx = new Findings();
  const ids = preparedIds(a.opt.get("--prepared")!, fx);
  if (!ids) return finish(fx, io, "");
  const mine = parseRoleFile(a.opt.get("--labels")!, role, ids, fx);
  const other = a.opt.get("--other");
  if (other && mine) {
    const ofx = new Findings();
    const theirs = parseRoleFile(other, role === "A" ? "B" : "A", ids, ofx); // only its annotatorId is used here
    roleConflict(mine, theirs, fx, path.basename(a.opt.get("--labels")!));
  }
  io.out(stable({ role, annotatorId: mine?.annotatorId ?? null, expected: ids.length, valid: mine?.rows.size ?? 0 }));
  return finish(fx, io, `OK annotator ${role} file is complete and well-formed`);
}

/** Pairs of ORIGINAL A / B labels (sorted by id). Refused on any missing / duplicate / malformed submission. */
function loadPairs(a: Args, fx: Findings) {
  const ids = preparedIds(a.opt.get("--prepared") ?? a.opt.get("--questions")!, fx);
  if (!ids) return null;
  const A = parseRoleFile(a.opt.get("--a")!, "A", ids, fx);
  const B = parseRoleFile(a.opt.get("--b")!, "B", ids, fx);
  roleConflict(A, B, fx, "A+B");
  return { ids: [...ids].sort(byId), A, B };
}

function cmdAgreement(a: Args, io: Io): number {
  if (!need(a, ["--a", "--b", "--prepared", "--out"], io)) return 2;
  const fx = new Findings();
  const p = loadPairs(a, fx);
  const missing = { A: fx.list.filter((f) => f.code === "MISSING_SUBMISSION" && f.file === path.basename(a.opt.get("--a")!)).length, B: fx.list.filter((f) => f.code === "MISSING_SUBMISSION" && f.file === path.basename(a.opt.get("--b")!)).length };
  if (!p || !p.A || !p.B || !fx.ok) { io.out(stable({ missingLabels: missing })); return finish(fx, io, ""); }
  const pairs = p.ids.map((id) => ({ id, a: p.A!.rows.get(id)!.label, b: p.B!.rows.get(id)!.label }));
  const report = computeAgreement(pairs);
  const policy = evaluateAgreementPolicy(report);
  const queue = pairs.filter((x) => !labelsEqual(x.a, x.b)).map((x) => x.id);
  const out = {
    kind: "m7-p5a2-agreement-report", tool: TOOL, schemaVersion: SCHEMA_VERSION,
    basis: "ORIGINAL annotator A / B labels, before any adjudication (never final or adjudicated labels)",
    inputs: { a: { file: path.basename(a.opt.get("--a")!), sha256: shaFile(a.opt.get("--a")!) }, b: { file: path.basename(a.opt.get("--b")!), sha256: shaFile(a.opt.get("--b")!) }, prepared: { file: path.basename(a.opt.get("--prepared")!), sha256: shaFile(a.opt.get("--prepared")!) } },
    roles: { annotatorA: p.A.annotatorId, annotatorB: p.B.annotatorId },
    n: pairs.length, missingLabels: missing,
    exactLabelAgreement: { agree: pairs.length - queue.length, n: pairs.length, percent: pairs.length ? (100 * (pairs.length - queue.length)) / pairs.length : undefined },
    adjudicationQueue: queue, policy, report,
  };
  const outPath = a.opt.get("--out")!;
  if (!writeAllOrNothing(path.dirname(outPath), [[path.basename(outPath), stable(out, 2) + "\n"]], fx)) return finish(fx, io, "");
  io.out(stable({ n: out.n, exactLabelAgreementPct: out.exactLabelAgreement.percent, primaryKappa: policy.primaryKappa, status: policy.status, adjudicationQueue: queue.length }));
  if (policy.reviewRequired) fx.review(path.basename(outPath), 0, null, policy.status, `${policy.reasons.join("; ")} — ${AGREEMENT_NOTE}`);
  return finish(fx, io, "OK agreement computed; no calibration trigger (kappa is not a PASS / FAIL verdict)");
}
const AGREEMENT_NOTE = "review + one calibration round on a subset OUTSIDE the dataset; existing labels are not edited";

function cmdMerge(a: Args, io: Io): number {
  if (!need(a, ["--questions", "--a", "--b", "--adjudicator", "--out-dir"], io)) return 2;
  const fx = new Findings();
  const qFile = a.opt.get("--questions")!;
  const qs = parseQuestions(qFile, fx);
  if (!qs) return finish(fx, io, "");
  const ids = qs.map((q) => q.id);
  const A = parseRoleFile(a.opt.get("--a")!, "A", ids, fx);
  const B = parseRoleFile(a.opt.get("--b")!, "B", ids, fx);
  roleConflict(A, B, fx, "A+B");
  if (!A || !B || !fx.ok) return finish(fx, io, "");
  const agree = new Map(ids.map((id) => [id, labelsEqual(A.rows.get(id)!.label, B.rows.get(id)!.label)]));
  const adjFile = a.opt.get("--adjudicator")!;
  const J = parseAdjudicatorFile(adjFile, ids, agree, [A.annotatorId!, B.annotatorId!], fx);
  if (!J || !fx.ok) return finish(fx, io, "");
  const auditFile = a.opt.get("--tag-audit");
  let tags = new Map(qs.map((q) => [q.id, q.tags]));
  let audit: ReturnType<typeof replayTagAudit> | null = null;
  if (auditFile) {
    if (!fs.existsSync(auditFile)) { fx.add(path.basename(auditFile), 0, null, "FILE_MISSING", `${auditFile} does not exist`); return finish(fx, io, ""); }
    const t = fs.readFileSync(auditFile, "utf8");
    if (t.charCodeAt(0) === 0xfeff) { fx.add(path.basename(auditFile), 1, null, "FILE_HAS_BOM", "save as UTF-8 without BOM"); return finish(fx, io, ""); }
    audit = replayTagAudit(tags, t, { annotators: [A.annotatorId!, B.annotatorId!], adjudicator: J.adjudicatorId });
    for (const e of audit.errors) fx.add(path.basename(auditFile), e.line, e.id, e.code, e.detail);
    if (!audit.tags) return finish(fx, io, "");
    tags = audit.tags;
  }
  const sorted = [...qs].sort((x, y) => byId(x.id, y.id));
  const rows: unknown[] = [];
  const adjRows: unknown[] = [];
  for (const q of sorted) {
    const ra = A.rows.get(q.id)!, rb = B.rows.get(q.id)!, rj = J.rows.get(q.id)!;
    const same = agree.get(q.id)!;
    const adjudication = same ? { needed: false } : { needed: true, adjudicatorId: rj.adjudicatorId, decision: labelOut(rj.decision!), rationale: rj.decisionRationale! };
    // final = the shared label when A = B, else the adjudicator's decision — nothing else, never a tool's choice
    const final = same ? ra.label : rj.decision!;
    rows.push({
      schemaVersion: SCHEMA_VERSION, id: q.id, question: q.question, accented: q.accented, tags: tags.get(q.id)!,
      source: { kind: q.source.kind, author: q.source.author, note: q.source.note },
      annotatorA: { annotatorId: ra.annotatorId, rationale: ra.rationale, ...labelOut(ra.label) },
      annotatorB: { annotatorId: rb.annotatorId, rationale: rb.rationale, ...labelOut(rb.label) },
      adjudication, final: labelOut(final), rationale: rj.finalRationale, rationaleBy: rj.adjudicatorId,
      routingScored: expectedRoutingScored(final, q.question),
    });
    adjRows.push({ schemaVersion: SCHEMA_VERSION, id: q.id, adjudication, rationale: rj.finalRationale, rationaleBy: rj.adjudicatorId });
  }
  const dataset = jsonl(rows), adjudication = jsonl(adjRows);
  const vopts: ValidateOptions = { checkDistribution: !a.flags.has("--no-distribution"), checkBenchmarkOverlap: !a.flags.has("--no-overlap") };
  const v = validateRoutingAnnotations(dataset, vopts);
  const inputs = (p: string | undefined) => (p ? { file: path.basename(p), sha256: shaFile(p) } : null);
  const manifest = {
    kind: "m7-p5a2-merge-manifest", tool: TOOL, schemaVersion: SCHEMA_VERSION,
    rule: "annotator A / B values copied unchanged (fixed key order only); final = shared label when A = B, else the adjudicator's decision; rationale / rationaleBy = the adjudicator's final rationale; tags = curator tags after the tag audit",
    inputs: { questions: inputs(qFile), annotatorA: inputs(a.opt.get("--a")), annotatorB: inputs(a.opt.get("--b")), adjudicatorDecisions: inputs(adjFile), tagAudit: inputs(auditFile) },
    outputs: { dataset: { file: "dataset.jsonl", sha256: sha256(dataset) }, adjudication: { file: "adjudication.jsonl", sha256: sha256(adjudication) } },
    counts: { cases: rows.length, agreements: [...agree.values()].filter(Boolean).length, disagreements: [...agree.values()].filter((x) => !x).length, tagAuditEntries: audit?.entries ?? 0 },
    roles: { annotatorA: A.annotatorId, annotatorB: B.annotatorId, adjudicator: J.adjudicatorId, curator: audit?.curatorId ?? null },
    validator: { options: vopts, ok: v.ok, errors: v.errors.length, reviews: v.reviews.length, errorsByCode: v.stats.errorsByCode, reviewsByCode: v.stats.reviewsByCode },
  };
  if (!writeAllOrNothing(a.opt.get("--out-dir")!, [["dataset.jsonl", dataset], ["adjudication.jsonl", adjudication], ["merge-manifest.json", stable(manifest, 2) + "\n"]], fx)) return finish(fx, io, "");
  for (const e of v.errors) fx.add("dataset.jsonl", e.line, e.id, e.code, e.detail);
  for (const r of v.reviews) fx.review("dataset.jsonl", r.line, r.id, r.code, r.detail);
  io.out(stable(manifest.counts));
  return finish(fx, io, `OK merged ${rows.length} case(s); validator clean`);
}

function cmdValidate(a: Args, io: Io): number {
  const file = a._[1];
  if (!file) { io.err("usage: validate <dataset.jsonl> [--no-distribution] [--no-overlap]"); return 2; }
  const fx = new Findings();
  if (!fs.existsSync(file)) { fx.add(path.basename(file), 0, null, "FILE_MISSING", `${file} does not exist`); return finish(fx, io, ""); }
  const v = validateRoutingAnnotations(fs.readFileSync(file, "utf8"), { checkDistribution: !a.flags.has("--no-distribution"), checkBenchmarkOverlap: !a.flags.has("--no-overlap") });
  for (const e of v.errors) fx.add(path.basename(file), e.line, e.id, e.code, e.detail);
  for (const r of v.reviews) fx.review(path.basename(file), r.line, r.id, r.code, r.detail);
  io.out(stable(v.stats, 2));
  return finish(fx, io, "OK");
}

function cmdFreeze(a: Args, io: Io): number {
  const keys = ["--dataset", "--adjudication", "--a", "--b", "--guide", "--merge-manifest", "--agreement", "--candidate", "--signoff", "--out"];
  if (!need(a, keys, io)) return 2;
  const fixture = a.flags.has("--fixture");
  const fx = new Findings();
  const f = (k: string) => a.opt.get(k)!;
  for (const k of keys.filter((k) => k !== "--out")) if (!fs.existsSync(f(k))) fx.add(path.basename(f(k)), 0, null, "FILE_MISSING", `${k} ${f(k)} does not exist`);
  if (!fx.ok) return finish(fx, io, "");
  const mm = readJson(f("--merge-manifest"), fx), ag = readJson(f("--agreement"), fx), cand = readJson(f("--candidate"), fx), so = readJson(f("--signoff"), fx);
  if (!mm || !ag || !cand || !so) return finish(fx, io, "");
  const M = "merge-manifest.json";
  // 1. nothing changed since the merge (outputs AND the original A / B submissions)
  const rec = (o: unknown, k: string) => (isObj(o) && isObj(o[k]) ? (o[k] as Obj) : null);
  const check = (label: string, recorded: Obj | null, file: string | undefined) => {
    if (!recorded) { if (file) fx.add(M, 0, null, "FILE_NOT_IN_MANIFEST", `${label}: not recorded in the merge manifest`); return; }
    if (!file) { fx.add(M, 0, null, "FILE_MISSING", `${label} was used by the merge; pass it`); return; }
    if (recorded.sha256 !== shaFile(file)) fx.add(path.basename(file), 0, null, "FILE_CHANGED_SINCE_MERGE", `${label} sha256 differs from the merge manifest`);
  };
  check("dataset", rec(mm.outputs, "dataset"), f("--dataset"));
  check("adjudication.jsonl", rec(mm.outputs, "adjudication"), f("--adjudication"));
  check("annotator A", rec(mm.inputs, "annotatorA"), f("--a"));
  check("annotator B", rec(mm.inputs, "annotatorB"), f("--b"));
  check("tag audit", rec(mm.inputs, "tagAudit"), a.opt.get("--tag-audit"));
  // 2. the agreement report was computed on these exact ORIGINAL A / B files
  if (rec(ag.inputs, "a")?.sha256 !== shaFile(f("--a")) || rec(ag.inputs, "b")?.sha256 !== shaFile(f("--b"))) fx.add("agreement", 0, null, "AGREEMENT_INPUT_MISMATCH", "the agreement report was not computed on these annotator A / B files");
  const policy = isObj(ag.policy) ? ag.policy : null;
  const agreementSign = isObj(so.agreementReview) ? so.agreementReview : null;
  if (!policy) fx.add("agreement", 0, null, "AGREEMENT_POLICY_MISSING", "the agreement report has no policy block");
  else if (policy.reviewRequired === true && !(agreementSign && isValidLabelerId(agreementSign.signedBy) && nonEmptyStr(agreementSign.note))) fx.add("signoff", 0, null, "AGREEMENT_REVIEW_NOT_SIGNED", `agreement policy status ${String(policy.status)}: a human must sign agreementReview {signedBy, note} (calibration outside the dataset) before freeze`);
  // 3. official validator; every REVIEW item signed
  const opts: ValidateOptions = fixture ? { checkDistribution: false, checkBenchmarkOverlap: true } : { checkDistribution: true, checkBenchmarkOverlap: true };
  const v = validateRoutingAnnotations(fs.readFileSync(f("--dataset"), "utf8"), opts);
  for (const e of v.errors) fx.add("dataset", e.line, e.id, "VALIDATOR_ERROR", `${e.code}: ${e.detail}`);
  const roles = v.stats.roles;
  const annKeys = [roles.annotatorA, roles.annotatorB].filter((x): x is string => !!x).map(labelerRoleKey);
  const signed = new Map<string, string>();
  for (const s of Array.isArray(so.reviews) ? so.reviews : []) {
    if (!isObj(s) || typeof s.code !== "string" || !isValidLabelerId(s.signedBy) || !nonEmptyStr(s.note)) { fx.add("signoff", 0, null, "SIGNOFF_INVALID", `invalid review sign-off ${stable(s)} (needs id, code, signedBy, note)`); continue; }
    if (annKeys.includes(labelerRoleKey(s.signedBy))) { fx.add("signoff", 0, null, "SIGNOFF_BY_ANNOTATOR", `${s.signedBy} is an annotator; review items are signed by someone else`); continue; }
    signed.set(`${s.id ?? ""}|${s.code}`, s.signedBy);
  }
  const unsigned = v.reviews.filter((r) => !signed.has(`${r.id ?? ""}|${r.code}`));
  for (const r of unsigned) fx.add("dataset", r.line, r.id, "REVIEW_NOT_SIGNED", `${r.code}: ${r.detail}`);
  // 4. candidate identity: clean, and contains the Q9 safety files
  const files = Array.isArray(cand.files) ? cand.files.filter(isObj) : [];
  if (cand.clean !== true) fx.add("candidate", 0, null, "CANDIDATE_NOT_CLEAN", "candidate identity is not clean (clean !== true)");
  for (const req of REQUIRED_CANDIDATE_FILES) {
    const hit = files.find((x) => x.path === req);
    if (!hit || typeof hit.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(hit.sha256)) fx.add("candidate", 0, null, "CANDIDATE_MISSING_REQUIRED_FILE", `${req} (owner decision Q9) is missing from the candidate identity or has no sha256`);
  }
  if (!fx.ok) return finish(fx, io, "");
  const live = isObj(cand.liveModel) ? cand.liveModel : {};
  const out = {
    kind: "m7-p5a2-freeze-manifest", tool: TOOL, schemaVersion: SCHEMA_VERSION, fixture,
    status: fixture ? "FIXTURE ONLY — synthetic test data; NOT a dataset freeze" : "PROPOSED FREEZE MANIFEST — requires the owner's signature; NOT an approved freeze",
    files: {
      datasetSha256: shaFile(f("--dataset")), annotationGuideSha256: shaFile(f("--guide")),
      originalLabelsASha256: shaFile(f("--a")), originalLabelsBSha256: shaFile(f("--b")),
      // owner decision Q8: the separate adjudication.jsonl written by merge (one line per id, needed:false included) — NOT the merged dataset
      adjudicatedLabelsSha256: shaFile(f("--adjudication")),
      mergeManifestSha256: shaFile(f("--merge-manifest")), agreementReportSha256: shaFile(f("--agreement")),
      candidateIdentitySha256: shaFile(f("--candidate")), tagAuditSha256: a.opt.get("--tag-audit") ? shaFile(a.opt.get("--tag-audit")!) : null,
      signoffSha256: shaFile(f("--signoff")),
    },
    candidate: { head: isObj(cand.git) ? cand.git.head ?? null : null, clean: true, requiredFilesQ9: [...REQUIRED_CANDIDATE_FILES], modelId: live.modelId ?? null, awsRegion: live.awsRegion ?? null },
    dataset: { cases: v.stats.cases, byCategory: v.stats.byCategory, scoring: v.stats.scoring, quotas: v.stats.quotas, roles },
    validator: { options: opts, errors: 0, reviews: v.reviews.length, reviewsSigned: v.reviews.length },
    agreementPolicy: policy, agreementReviewSignedBy: agreementSign?.signedBy ?? null,
  };
  const outPath = f("--out");
  if (!writeAllOrNothing(path.dirname(outPath), [[path.basename(outPath), stable(out, 2) + "\n"]], fx)) return finish(fx, io, "");
  return finish(fx, io, `OK ${out.status}`);
}

export function main(argv: readonly string[], io: Io = defaultIo): number {
  const a = parseArgs(argv);
  switch (a._[0]) {
    case "prepare": return cmdPrepare(a, io);
    case "check-role": return cmdCheckRole(a, io);
    case "agreement": return cmdAgreement(a, io);
    case "merge": return cmdMerge(a, io);
    case "validate": return cmdValidate(a, io);
    case "freeze": return cmdFreeze(a, io);
    default:
      io.err("usage: annotation-cli.ts prepare|check-role|agreement|merge|validate|freeze [options] (see the file header)");
      return 2;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
