/**
 * M7-P5A2 — minimal OFFLINE annotation CLI (owner decision Q1, 2026-11-15) for the m7-p5a2 contract, with the C1–C4
 * integrity remediation (Codex review of eafbe3be).
 *
 * Provenance chain (each step binds to the identities of the previous ones):
 *   prepare            questions.jsonl + --curator → for-annotator-A/B.jsonl (id, question, accented ONLY) + prepare-manifest.json
 *                      (the PREPARE RECEIPT: batchId = hash of every prepared question's content identity + original tags)
 *   check-role         one annotator's submission → report (helper, writes nothing)
 *   accept-submissions receipt + A + B → submissions-receipt.json (the accepted identity of the ORIGINAL A / B bytes)
 *   agreement          receipt + ORIGINAL A + B → agreement-report.json (computeAgreement + κ policy)
 *   merge              receipt + submissions receipt + questions + A + B + adjudicator decisions [+ tag-audit]
 *                      → dataset.jsonl, adjudication.jsonl, merge-manifest.json (an all-or-nothing bundle directory)
 *   validate           dataset.jsonl → the official validator
 *   freeze --fixture   RE-COMPUTES merge and agreement from the source files and requires byte equality, checks three
 *                      ACCEPTED identities supplied out of band (--accepted-batch-id, --accepted-submissions-sha256,
 *                      --accepted-merge-manifest-sha256), content-bound review sign-offs, candidate identity → freeze.json
 *
 * TRUST LIMITATION (stated, not hidden): every hash here proves CONSISTENCY with the bytes that were recorded. It does not
 * prove AUTHENTICITY: someone who can rewrite every file AND the accepted identities can produce a consistent forgery.
 * The accepted identities are only as trustworthy as the place the owner keeps them (outside the artifacts). No signing key
 * or trust root exists, so an OFFICIAL freeze is refused unconditionally (OFFICIAL_FREEZE_NOT_AUTHORIZED); only --fixture runs.
 * Declared ids are pseudonyms: they show consistency of roles, never a person's real identity.
 *
 * Rules: offline; never creates, guesses, repairs or resolves a label; every input is read ONCE (parse and hash the same
 * bytes) and re-checked on disk before anything is published; outputs are never overwritten; multi-file outputs are built in a
 * private staging directory and published by one rename (an interrupted run leaves no finalized output); deterministic
 * output (rows sorted by id, fixed key order, LF, UTF-8 without BOM, no timestamps, no file names in identities).
 * Exit codes: 0 clean · 1 error / refused · 3 no error but human review / sign-off required · 2 usage.
 * Run: npx tsx src/__tests__/m7-benchmark/annotation-cli.ts <command> [options]
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  ANNOTATOR_KEYS, DERIVED_FIELDS, LABEL_KEYS, SCHEMA_VERSION, SOURCE_KEYS, SOURCE_KINDS, TAGS,
  expectedRoutingScored, isValidLabelerId, labelerRoleKey, labelsEqual,
  type CaseLabel, type DomainLabel, type Finding, type Interpretation,
} from "./annotation-schema";
import { checkAnnotator, checkLabel, hasVietnameseDiacritics, humanTextProblem, validateRoutingAnnotations, type ValidateOptions } from "./annotation-validator";
import { INVISIBLE_CHARS_RE, QUESTION_INVISIBLE_CHARS_RE, canonicalWriterKey } from "./annotation-dataset-checks";
import { findDuplicateKeys } from "./annotation-json";
import { AGREEMENT_POLICY, computeAgreement, evaluateAgreementPolicy, type AgreementPolicyResult } from "./annotation-agreement";
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
/** Accepted decisions of an agreement review, by recomputed policy status. */
export const AGREEMENT_REVIEW_DECISIONS = Object.freeze({ CALIBRATION_REQUIRED: "CALIBRATION_COMPLETED", KAPPA_UNDEFINED_REVIEW: "REVIEWED" } as const);

/** Test-only hooks (never set by the CLI): simulate an interruption, a concurrent writer, or a file changed mid-run. */
export const testHooks: { afterLoad?: (file: string) => void; failAfterFiles?: number; beforePublish?: (dir: string) => void } = {};

// ── small utilities ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface Io { out: (s: string) => void; err: (s: string) => void }
const defaultIo: Io = { out: (s) => process.stdout.write(`${s}\n`), err: (s) => process.stderr.write(`${s}\n`) };
type Obj = Record<string, unknown>;
interface F extends Finding { file: string }
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
export const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
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

/** An input read ONCE: it is parsed and hashed from the same bytes (no read-twice window). */
export interface Src { path: string; name: string; text: string; sha256: string }
function loadSource(file: string, fx: Findings): Src | null {
  const name = path.basename(file);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { fx.add(name, 0, null, "FILE_MISSING", `${file} does not exist`); return null; }
  const buf = fs.readFileSync(file);
  const text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) { fx.add(name, 1, null, "FILE_HAS_BOM", "file starts with a UTF-8 BOM; save as UTF-8 without BOM (nothing is stripped silently)"); return null; }
  testHooks.afterLoad?.(file);
  return { path: file, name, text, sha256: sha256(buf) };
}
/** Before publishing: every input must still hold the bytes that were parsed. */
function verifyUnchanged(srcs: ReadonlyArray<Src | null | undefined>, fx: Findings) {
  for (const s of srcs) {
    if (!s) continue;
    const now = fs.existsSync(s.path) ? sha256(fs.readFileSync(s.path)) : null;
    if (now !== s.sha256) fx.add(s.name, 0, null, "SOURCE_CHANGED_DURING_RUN", `${s.path} changed while the command ran; nothing was published`);
  }
}

interface Line { line: number; obj: Obj }
/** Strict JSONL: malformed JSON, non-object lines, duplicate keys and over-deep nesting are findings. */
function readJsonl(src: Src, fx: Findings): Line[] {
  const out: Line[] = [];
  src.text.split(/\r?\n/).forEach((t, i) => {
    if (!t.trim()) return;
    const line = i + 1;
    let v: unknown;
    try { v = JSON.parse(t); } catch (e) { fx.add(src.name, line, null, "MALFORMED_JSON", `${(e as Error).message} (an interrupted / truncated submission looks like this)`); return; }
    if (!isObj(v)) { fx.add(src.name, line, null, "NOT_OBJECT", "line is not a JSON object"); return; }
    const d = findDuplicateKeys(t);
    if (d.tooDeep || d.duplicates.length) { fx.add(src.name, line, typeof v.id === "string" ? v.id : null, "DUPLICATE_JSON_KEY", "duplicate key or nesting too deep; line not used"); return; }
    out.push({ line, obj: v });
  });
  return out;
}
function readJson(src: Src, fx: Findings): Obj | null {
  try { const v = JSON.parse(src.text); if (isObj(v)) return v; fx.add(src.name, 1, null, "NOT_OBJECT", "file is not a JSON object"); }
  catch (e) { fx.add(src.name, 1, null, "MALFORMED_JSON", (e as Error).message); }
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
 * Publishes a multi-file bundle as ONE directory: refused when `dir` exists; files are written into a private staging
 * directory next to it and published by a single rename. A failure or an interruption leaves no `dir` (only a `.partial-*`
 * staging directory if the process is killed). A competing writer that creates `dir` first makes this run fail, never overwrite.
 */
export function publishBundle(dir: string, files: Array<[string, string]>, fx: Findings): boolean {
  const target = path.resolve(dir);
  if (fs.existsSync(target)) { fx.add(path.basename(target), 0, null, "OUTPUT_EXISTS", `${target} already exists; outputs are never overwritten (choose a new --out-dir)`); return false; }
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(target)}.partial-${process.pid}-${randomBytes(6).toString("hex")}`);
  fs.mkdirSync(staging);
  try {
    files.forEach(([n, content], i) => {
      if (testHooks.failAfterFiles !== undefined && i >= testHooks.failAfterFiles) throw new Error("simulated interruption");
      fs.writeFileSync(path.join(staging, n), content, { encoding: "utf8", flag: "wx" });
    });
    testHooks.beforePublish?.(target);
    if (fs.existsSync(target)) throw Object.assign(new Error(`${target} was created by another process during this run`), { code: "EEXIST" });
    fs.renameSync(staging, target);
    return true;
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    const exists = (e as NodeJS.ErrnoException).code === "EEXIST" || (e as NodeJS.ErrnoException).code === "ENOTEMPTY" || fs.existsSync(target);
    fx.add(path.basename(target), 0, null, exists ? "OUTPUT_EXISTS" : "WRITE_FAILED", `${(e as Error).message}; nothing from this run was published`);
    return false;
  }
}
/** One output file, created atomically (temp file + no-replace hard link). */
function publishFile(file: string, content: string, fx: Findings): boolean {
  const target = path.resolve(file);
  if (fs.existsSync(target)) { fx.add(path.basename(target), 0, null, "OUTPUT_EXISTS", `${target} already exists; outputs are never overwritten`); return false; }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${path.join(path.dirname(target), `.${path.basename(target)}`)}.partial-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    fs.writeFileSync(tmp, content, { encoding: "utf8", flag: "wx" });
    fs.linkSync(tmp, target);
    return true;
  } catch (e) {
    fx.add(path.basename(target), 0, null, (e as NodeJS.ErrnoException).code === "EEXIST" ? "OUTPUT_EXISTS" : "WRITE_FAILED", `${(e as Error).message}; nothing written`);
    return false;
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}

// ── prepare receipt (C1) ─────────────────────────────────────────────────────────────────────────────────────────────
/** Content identity of one prepared question: exactly what the annotators were shown, bound to its id and the contract. */
export const questionContentSha = (id: string, question: string, accented: boolean) => sha256(JSON.stringify({ schemaVersion: SCHEMA_VERSION, id, question, accented }));
/** Content without the id: detects the same question re-issued under another id. */
const questionTextSha = (question: string, accented: boolean) => sha256(JSON.stringify({ question, accented }));
interface ReceiptQuestion { id: string; contentSha256: string; textSha256: string; tags: string[] }
export interface Receipt { batchId: string; curatorId: string; writerKeys: string[]; questions: ReceiptQuestion[] }
const batchIdOf = (r: Omit<Receipt, "batchId">) => sha256(JSON.stringify({
  kind: "m7-p5a2-prepare-batch", schemaVersion: SCHEMA_VERSION, curatorId: r.curatorId, writerKeys: r.writerKeys,
  questions: r.questions.map((q) => ({ id: q.id, contentSha256: q.contentSha256, textSha256: q.textSha256, tags: q.tags })),
}));
function parseReceipt(src: Src, fx: Findings): Receipt | null {
  const o = readJson(src, fx);
  if (!o) return null;
  const bad = (d: string) => { fx.add(src.name, 0, null, "RECEIPT_INVALID", d); return null; };
  if (o.kind !== "m7-p5a2-prepare-manifest" || o.schemaVersion !== SCHEMA_VERSION) return bad(`not an ${SCHEMA_VERSION} prepare receipt`);
  if (!isValidLabelerId(o.curatorId) || !Array.isArray(o.writerKeys) || !o.writerKeys.every((x) => typeof x === "string") || !Array.isArray(o.questions)) return bad("curatorId / writerKeys / questions missing or malformed");
  const qs: ReceiptQuestion[] = [];
  for (const q of o.questions) {
    if (!isObj(q) || !nonEmptyStr(q.id) || !isSha(q.contentSha256) || !isSha(q.textSha256) || !Array.isArray(q.tags) || !q.tags.every((t) => typeof t === "string")) return bad(`malformed question entry ${stable(q)}`);
    qs.push({ id: q.id, contentSha256: q.contentSha256, textSha256: q.textSha256, tags: [...(q.tags as string[])] });
  }
  const r = { curatorId: o.curatorId, writerKeys: [...(o.writerKeys as string[])], questions: qs };
  if (new Set(qs.map((q) => idKey(q.id))).size !== qs.length) return bad("duplicate id in the receipt");
  if (o.batchId !== batchIdOf(r)) { fx.add(src.name, 0, null, "RECEIPT_INCONSISTENT", "batchId does not match the receipt's own question entries (the receipt was edited)"); return null; }
  return { batchId: o.batchId as string, ...r };
}
/**
 * C1: the current question file must be exactly the prepared batch — same ids, same content (question + accented under that
 * id), and tags equal to the prepared tags after the curator's audited changes. Content cannot move to another id.
 */
function checkAgainstReceipt(qs: readonly QuestionRow[], rc: Receipt, expectedTags: ReadonlyMap<string, readonly string[]>, file: string, fx: Findings) {
  const cur = new Map(qs.map((q) => [idKey(q.id), q]));
  const prepared = new Map(rc.questions.map((q) => [idKey(q.id), q]));
  const byText = new Map(rc.questions.map((q) => [q.textSha256, q.id]));
  for (const p of rc.questions) {
    const q = cur.get(idKey(p.id));
    if (!q) { fx.add(file, 0, p.id, "MISSING_PREPARED_QUESTION", `prepared question ${p.id} is missing from the question file`); continue; }
    if (q.id !== p.id) fx.add(file, q.line, q.id, "QUESTION_ID_CHANGED", `id must be written exactly as prepared (${p.id})`);
    else if (questionContentSha(q.id, q.question, q.accented) !== p.contentSha256) fx.add(file, q.line, q.id, "QUESTION_CONTENT_CHANGED", "question / accented differ from the prepared revision: the existing labels belong to the old text; a changed question needs a new id and new annotation");
    const want = expectedTags.get(p.id) ?? p.tags;
    if (!(want.length === q.tags.length && want.every((t) => q.tags.includes(t)))) fx.add(file, q.line, q.id, "TAG_CHANGED_WITHOUT_AUDIT", `tags ${stable(q.tags)} differ from the prepared tags after the tag audit ${stable(want)}; every tag change goes through the tag audit (Q3)`);
  }
  for (const q of qs) {
    if (prepared.has(idKey(q.id))) continue;
    const moved = byText.get(questionTextSha(q.question, q.accented));
    if (moved) fx.add(file, q.line, q.id, "QUESTION_ID_CHANGED", `this text was prepared as ${moved}; labels are never transferred to another id`);
    else fx.add(file, q.line, q.id, "FOREIGN_QUESTION", `${q.id} was not in the prepared batch`);
  }
}

// ── parsing of each input kind ───────────────────────────────────────────────────────────────────────────────────────
export interface QuestionRow { line: number; id: string; question: string; accented: boolean; tags: string[]; source: { kind: string; author: string; note: string } }
/** The curator's question file. Labels never belong here. */
export function parseQuestions(src: Src, fx: Findings): QuestionRow[] {
  const name = src.name;
  const out: QuestionRow[] = [];
  const seen = new Map<string, number>();
  for (const { line, obj } of readJsonl(src, fx)) {
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

/** The ids an annotator was given (helper for check-role): a prepared task file or the curator's question file. */
function idsOfFile(src: Src, fx: Findings): string[] {
  const ids: string[] = [];
  for (const { line, obj } of readJsonl(src, fx)) {
    if (!nonEmptyStr(obj.id)) { fx.add(src.name, line, null, "MISSING_FIELD", "id missing"); continue; }
    if (ids.some((x) => idKey(x) === idKey(obj.id as string))) fx.add(src.name, line, obj.id, "DUPLICATE_ID", "id repeated in the prepared file");
    else ids.push(obj.id);
  }
  return ids;
}

export interface AnnotatorRow { line: number; id: string; annotatorId: string; rationale: string; label: CaseLabel }
export interface RoleFile { rows: Map<string, AnnotatorRow>; annotatorId: string | null; sha256: string }
/** One annotator's submission, checked against the ids that annotator was given. Nothing is repaired. */
export function parseRoleFile(src: Src, role: "A" | "B", expected: readonly string[], fx: Findings): RoleFile {
  const name = src.name;
  const rows = new Map<string, AnnotatorRow>();
  const seen = new Map<string, number>();
  let ref: { raw: string; line: number } | null = null;
  const exp = new Map(expected.map((x) => [idKey(x), x]));
  for (const { line, obj } of readJsonl(src, fx)) {
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
  return { rows, annotatorId: ref ? (ref as { raw: string }).raw : null, sha256: src.sha256 };
}

interface AdjRow { line: number; id: string; adjudicatorId: string; finalRationale: string; decision: CaseLabel | null; decisionRationale: string | null }
function parseAdjudicatorFile(src: Src, expected: readonly string[], agreeById: Map<string, boolean>, forbidden: Array<[string, string]>, fx: Findings) {
  const name = src.name;
  const rows = new Map<string, AdjRow>();
  const seen = new Map<string, number>();
  const exp = new Map(expected.map((x) => [idKey(x), x]));
  let ref: { raw: string; line: number } | null = null;
  for (const { line, obj } of readJsonl(src, fx)) {
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
    if (!canon) { e("UNKNOWN_ID", `id ${id} is not in the prepared batch`); continue; }
    if (canon !== id) e("ID_CASE_MISMATCH", `id must be written exactly as prepared (${canon})`);
    if (!isValidLabelerId(obj.adjudicatorId)) e("INVALID_ADJUDICATOR", `adjudicatorId ${JSON.stringify(obj.adjudicatorId)} missing or not a valid human pseudonym`);
    else {
      if (!ref) ref = { raw: obj.adjudicatorId, line };
      else if (labelerRoleKey(obj.adjudicatorId) !== labelerRoleKey(ref.raw)) e("ROLE_ID_INCONSISTENT", `adjudicatorId ${obj.adjudicatorId} differs from ${ref.raw} (line ${ref.line})`);
      for (const [key, role] of forbidden) if (labelerRoleKey(obj.adjudicatorId) === key) e(role === "annotator" ? "ADJUDICATOR_IS_ANNOTATOR" : "ROLE_CONFLICT", `adjudicatorId ${obj.adjudicatorId} is also the ${role}; the adjudicator is an independent third person (Q4)`);
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

/** Role separation of the two annotators against each other, the curator and the writers (declared ids only). */
function checkAnnotatorRoles(A: RoleFile, B: RoleFile, rc: Receipt, file: string, fx: Findings) {
  if (A.annotatorId && B.annotatorId && labelerRoleKey(A.annotatorId) === labelerRoleKey(B.annotatorId)) fx.add(file, 0, null, "ROLE_CONFLICT", `annotator A and annotator B use the same id ${A.annotatorId}; two independent people are required`);
  for (const id of [A.annotatorId, B.annotatorId]) {
    if (!id) continue;
    if (labelerRoleKey(id) === labelerRoleKey(rc.curatorId)) fx.add(file, 0, null, "ROLE_CONFLICT", `annotator ${id} is the curator; annotators never see tags (Q3)`);
    if (rc.writerKeys.includes(canonicalWriterKey(id))) fx.add(file, 0, null, "WRITER_IS_LABELER", `annotator ${id} is one of the writers`);
  }
}

// ── submissions receipt (C3: the accepted identity of the ORIGINAL A / B bytes) ────────────────────────────────────────
interface SubmissionsReceipt { batchId: string; prepareManifestSha256: string; a: { annotatorId: string; sha256: string }; b: { annotatorId: string; sha256: string } }
function parseSubmissionsReceipt(src: Src, fx: Findings): SubmissionsReceipt | null {
  const o = readJson(src, fx);
  if (!o) return null;
  const sub = (k: string) => (isObj(o[k]) ? (o[k] as Obj) : null);
  const a = sub("annotatorA"), b = sub("annotatorB");
  if (o.kind !== "m7-p5a2-submissions-receipt" || o.schemaVersion !== SCHEMA_VERSION || !isSha(o.batchId) || !isSha(o.prepareManifestSha256)
    || !a || !b || !isSha(a.sha256) || !isSha(b.sha256) || !isValidLabelerId(a.annotatorId) || !isValidLabelerId(b.annotatorId)) {
    fx.add(src.name, 0, null, "RECEIPT_INVALID", "not a valid m7-p5a2 submissions receipt"); return null;
  }
  return { batchId: o.batchId as string, prepareManifestSha256: o.prepareManifestSha256 as string, a: { annotatorId: a.annotatorId as string, sha256: a.sha256 as string }, b: { annotatorId: b.annotatorId as string, sha256: b.sha256 as string } };
}

// ── agreement (C2: always recomputable from the original submissions) ────────────────────────────────────────────────
interface AgreementBuild { text: string; policy: AgreementPolicyResult; queue: string[]; missing: { A: number; B: number } }
function buildAgreement(rcSrc: Src, rc: Receipt, aSrc: Src, bSrc: Src, fx: Findings): AgreementBuild | null {
  const ids = rc.questions.map((q) => q.id).sort(byId);
  const before = fx.list.length;
  const A = parseRoleFile(aSrc, "A", ids, fx), B = parseRoleFile(bSrc, "B", ids, fx);
  checkAnnotatorRoles(A, B, rc, "A+B", fx);
  const added = fx.list.slice(before);
  const missing = { A: added.filter((f) => f.code === "MISSING_SUBMISSION" && f.file === aSrc.name).length, B: added.filter((f) => f.code === "MISSING_SUBMISSION" && f.file === bSrc.name).length };
  if (added.length) return { text: "", policy: null as unknown as AgreementPolicyResult, queue: [], missing };
  const pairs = ids.map((id) => ({ id, a: A.rows.get(id)!.label, b: B.rows.get(id)!.label }));
  const report = computeAgreement(pairs);
  const policy = evaluateAgreementPolicy(report);
  const queue = pairs.filter((x) => !labelsEqual(x.a, x.b)).map((x) => x.id);
  const out = {
    kind: "m7-p5a2-agreement-report", tool: TOOL, schemaVersion: SCHEMA_VERSION,
    basis: "ORIGINAL annotator A / B labels, before any adjudication (never final or adjudicated labels)",
    batchId: rc.batchId, inputs: { prepareManifestSha256: rcSrc.sha256, annotatorASha256: aSrc.sha256, annotatorBSha256: bSrc.sha256 },
    roles: { annotatorA: A.annotatorId, annotatorB: B.annotatorId },
    n: pairs.length, missingLabels: missing,
    exactLabelAgreement: { agree: pairs.length - queue.length, n: pairs.length, percent: pairs.length ? (100 * (pairs.length - queue.length)) / pairs.length : undefined },
    adjudicationQueue: queue, agreementPolicy: AGREEMENT_POLICY, policy, report,
  };
  return { text: stable(out, 2) + "\n", policy, queue, missing };
}

// ── merge (pure: the same function is re-run by freeze) ──────────────────────────────────────────────────────────────
interface MergeSources { receipt: Src; submissions: Src; questions: Src; a: Src; b: Src; adjudicator: Src; tagAudit: Src | null }
interface MergeBuild { dataset: string; adjudication: string; manifest: string; reviews: Finding[]; rc: Receipt; adjudicatorId: string; annotatorA: string; annotatorB: string; datasetIds: string[] }
function buildMerge(s: MergeSources, vopts: ValidateOptions, fx: Findings): MergeBuild | null {
  const rc = parseReceipt(s.receipt, fx);
  const sr = parseSubmissionsReceipt(s.submissions, fx);
  if (!rc || !sr) return null;
  // C3: the A / B bytes must be the ones accepted in the submissions receipt, which must belong to this prepared batch
  if (sr.batchId !== rc.batchId || sr.prepareManifestSha256 !== s.receipt.sha256) fx.add(s.submissions.name, 0, null, "RECEIPT_MISMATCH", "the submissions receipt belongs to another prepared batch");
  if (sr.a.sha256 !== s.a.sha256) fx.add(s.a.name, 0, null, "SUBMISSION_CHANGED_SINCE_RECEIPT", "annotator A file differs from the bytes accepted in the submissions receipt");
  if (sr.b.sha256 !== s.b.sha256) fx.add(s.b.name, 0, null, "SUBMISSION_CHANGED_SINCE_RECEIPT", "annotator B file differs from the bytes accepted in the submissions receipt");
  const qs = parseQuestions(s.questions, fx);
  const ids = rc.questions.map((q) => q.id);
  const A = parseRoleFile(s.a, "A", ids, fx), B = parseRoleFile(s.b, "B", ids, fx);
  checkAnnotatorRoles(A, B, rc, "A+B", fx);
  if (!fx.ok) return null;
  const agree = new Map(ids.map((id) => [id, labelsEqual(A.rows.get(id)!.label, B.rows.get(id)!.label)]));
  const forbidden: Array<[string, string]> = [[labelerRoleKey(A.annotatorId!), "annotator"], [labelerRoleKey(B.annotatorId!), "annotator"], [labelerRoleKey(rc.curatorId), "curator"], ...rc.writerKeys.map((w) => [w, "writer"] as [string, string])];
  const J = parseAdjudicatorFile(s.adjudicator, ids, agree, forbidden, fx);
  if (!fx.ok || !J.adjudicatorId) return null;
  // Q3 / C1: tags = the PREPARED tags with the curator's audited changes, replayed from the receipt (never from the current file)
  const baseline = new Map(rc.questions.map((q) => [q.id, q.tags]));
  let tags: Map<string, string[]> = new Map([...baseline].map(([k, v]) => [k, [...v]]));
  let audit: ReturnType<typeof replayTagAudit> | null = null;
  if (s.tagAudit) {
    audit = replayTagAudit(baseline, s.tagAudit.text, { annotators: [A.annotatorId!, B.annotatorId!], adjudicator: J.adjudicatorId });
    for (const e of audit.errors) fx.add(s.tagAudit.name, e.line, e.id, e.code, e.detail);
    if (audit.curatorId && labelerRoleKey(audit.curatorId) !== labelerRoleKey(rc.curatorId)) fx.add(s.tagAudit.name, 0, null, "CURATOR_MISMATCH", `curatorId ${audit.curatorId} is not the curator recorded at prepare (${rc.curatorId})`);
    if (!audit.tags) return null;
    tags = audit.tags;
  }
  checkAgainstReceipt(qs, rc, tags, s.questions.name, fx);
  if (!fx.ok) return null;
  const byIdQ = new Map(qs.map((q) => [q.id, q]));
  const rows: unknown[] = [];
  const adjRows: unknown[] = [];
  for (const id of [...ids].sort(byId)) {
    const q = byIdQ.get(id)!;
    const ra = A.rows.get(id)!, rb = B.rows.get(id)!, rj = J.rows.get(id)!;
    const same = agree.get(id)!;
    const adjudication = same ? { needed: false } : { needed: true, adjudicatorId: rj.adjudicatorId, decision: labelOut(rj.decision!), rationale: rj.decisionRationale! };
    // final = the shared label when A = B, else the adjudicator's decision — nothing else, never a tool's choice
    const final = same ? ra.label : rj.decision!;
    rows.push({
      schemaVersion: SCHEMA_VERSION, id, question: q.question, accented: q.accented, tags: tags.get(id)!,
      source: { kind: q.source.kind, author: q.source.author, note: q.source.note },
      annotatorA: { annotatorId: ra.annotatorId, rationale: ra.rationale, ...labelOut(ra.label) },
      annotatorB: { annotatorId: rb.annotatorId, rationale: rb.rationale, ...labelOut(rb.label) },
      adjudication, final: labelOut(final), rationale: rj.finalRationale, rationaleBy: rj.adjudicatorId,
      routingScored: expectedRoutingScored(final, q.question),
    });
    adjRows.push({ schemaVersion: SCHEMA_VERSION, id, adjudication, rationale: rj.finalRationale, rationaleBy: rj.adjudicatorId });
  }
  const dataset = jsonl(rows), adjudication = jsonl(adjRows);
  const v = validateRoutingAnnotations(dataset, vopts);
  // no finalized output when validation fails: the errors are reported, nothing is written
  for (const e of v.errors) fx.add("dataset.jsonl", e.line, e.id, e.code, e.detail);
  if (!fx.ok) return null;
  const manifest = {
    kind: "m7-p5a2-merge-manifest", tool: TOOL, schemaVersion: SCHEMA_VERSION, batchId: rc.batchId,
    rule: "annotator A / B values copied unchanged (fixed key order only); final = shared label when A = B, else the adjudicator's decision; rationale / rationaleBy = the adjudicator's final rationale; tags = prepared tags after the tag audit",
    inputs: {
      prepareManifestSha256: s.receipt.sha256, submissionsReceiptSha256: s.submissions.sha256, questionsSha256: s.questions.sha256,
      annotatorASha256: s.a.sha256, annotatorBSha256: s.b.sha256, adjudicatorDecisionsSha256: s.adjudicator.sha256, tagAuditSha256: s.tagAudit?.sha256 ?? null,
    },
    outputs: { datasetSha256: sha256(dataset), adjudicationSha256: sha256(adjudication) },
    counts: { cases: rows.length, agreements: [...agree.values()].filter(Boolean).length, disagreements: [...agree.values()].filter((x) => !x).length, tagAuditEntries: audit?.entries ?? 0 },
    roles: { annotatorA: A.annotatorId, annotatorB: B.annotatorId, adjudicator: J.adjudicatorId, curator: rc.curatorId },
    validator: { options: vopts, errors: 0, reviews: v.reviews.length, reviewsByCode: v.stats.reviewsByCode },
  };
  return { dataset, adjudication, manifest: stable(manifest, 2) + "\n", reviews: v.reviews, rc, adjudicatorId: J.adjudicatorId, annotatorA: A.annotatorId!, annotatorB: B.annotatorId!, datasetIds: ids };
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

/** mulberry32: a tiny seeded PRNG (deterministic shuffles; the seed is recorded in the receipt). */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

function cmdPrepare(a: Args, io: Io): number {
  if (!need(a, ["--questions", "--out-dir", "--seed", "--curator"], io)) return 2;
  const seedText = a.opt.get("--seed")!;
  if (!/^[0-9]{1,10}$/.test(seedText) || Number(seedText) > 0xffffffff) { io.err("usage: --seed must be an integer 0..4294967295"); return 2; }
  const seed = Number(seedText);
  const curator = a.opt.get("--curator")!;
  const fx = new Findings();
  if (!isValidLabelerId(curator)) fx.add("args", 0, null, "INVALID_CURATOR", `--curator ${JSON.stringify(curator)} is not a valid human pseudonym`);
  const qSrc = loadSource(a.opt.get("--questions")!, fx);
  if (!qSrc || !fx.ok) return finish(fx, io, "");
  const qs = parseQuestions(qSrc, fx);
  if (!fx.ok) return finish(fx, io, "");
  if (!qs.length) { fx.add(qSrc.name, 0, null, "EMPTY_FILE", "no question rows"); return finish(fx, io, ""); }
  const writerKeys = [...new Set(qs.map((q) => canonicalWriterKey(q.source.author)))].sort(byId);
  // owner decision: the curator is not one of the writers
  if (writerKeys.includes(canonicalWriterKey(curator))) { fx.add("args", 0, null, "CURATOR_IS_WRITER", `curator ${curator} is also a writer`); return finish(fx, io, ""); }
  const sorted = [...qs].sort((x, y) => byId(x.id, y.id));
  // annotators get id, question, accented ONLY: no tags (Q3), no source / author, no labels, no predictions
  const task = (q: QuestionRow) => ({ id: q.id, question: q.question, accented: q.accented });
  const A = jsonl(shuffled(sorted, seed).map(task));
  const B = jsonl(shuffled(sorted, (seed + 1) >>> 0).map(task));
  const questions = sorted.map((q) => ({ id: q.id, contentSha256: questionContentSha(q.id, q.question, q.accented), textSha256: questionTextSha(q.question, q.accented), tags: q.tags }));
  const batchId = batchIdOf({ curatorId: curator, writerKeys, questions });
  const receipt = {
    kind: "m7-p5a2-prepare-manifest", tool: TOOL, schemaVersion: SCHEMA_VERSION, batchId, curatorId: curator, writerKeys,
    seed, orderRule: "ids sorted (code point), then mulberry32 shuffle: A with seed, B with seed+1",
    count: qs.length, fieldsGivenToAnnotators: [...ANNOTATOR_TASK_KEYS],
    inputs: { questionsSha256: qSrc.sha256 }, outputs: { forAnnotatorASha256: sha256(A), forAnnotatorBSha256: sha256(B) },
    questions,
  };
  verifyUnchanged([qSrc], fx);
  if (!fx.ok || !publishBundle(a.opt.get("--out-dir")!, [["for-annotator-A.jsonl", A], ["for-annotator-B.jsonl", B], ["prepare-manifest.json", stable(receipt, 2) + "\n"]], fx)) return finish(fx, io, "");
  io.out(stable({ batchId }));
  return finish(fx, io, `OK prepared ${qs.length} case(s) (seed ${seed}); record batchId ${batchId} OUTSIDE the artifacts (accepted identity)`);
}

function cmdCheckRole(a: Args, io: Io): number {
  if (!need(a, ["--role", "--prepared", "--labels"], io)) return 2;
  const role = a.opt.get("--role");
  if (role !== "A" && role !== "B") { io.err("usage: --role A|B"); return 2; }
  const fx = new Findings();
  const pSrc = loadSource(a.opt.get("--prepared")!, fx), lSrc = loadSource(a.opt.get("--labels")!, fx);
  if (!pSrc || !lSrc) return finish(fx, io, "");
  const ids = idsOfFile(pSrc, fx);
  const mine = parseRoleFile(lSrc, role, ids, fx);
  const other = a.opt.get("--other");
  if (other) {
    const oSrc = loadSource(other, new Findings());
    const theirs = oSrc ? parseRoleFile(oSrc, role === "A" ? "B" : "A", ids, new Findings()) : null; // only its annotatorId is used
    if (mine.annotatorId && theirs?.annotatorId && labelerRoleKey(mine.annotatorId) === labelerRoleKey(theirs.annotatorId)) fx.add(lSrc.name, 0, null, "ROLE_CONFLICT", `annotator A and annotator B use the same id ${mine.annotatorId}`);
  }
  io.out(stable({ role, annotatorId: mine.annotatorId, expected: ids.length, valid: mine.rows.size, submissionSha256: lSrc.sha256 }));
  return finish(fx, io, `OK annotator ${role} file is complete and well-formed`);
}

function cmdAcceptSubmissions(a: Args, io: Io): number {
  if (!need(a, ["--prepare-manifest", "--a", "--b", "--out"], io)) return 2;
  const fx = new Findings();
  const rcSrc = loadSource(a.opt.get("--prepare-manifest")!, fx), aSrc = loadSource(a.opt.get("--a")!, fx), bSrc = loadSource(a.opt.get("--b")!, fx);
  if (!rcSrc || !aSrc || !bSrc) return finish(fx, io, "");
  const rc = parseReceipt(rcSrc, fx);
  if (!rc) return finish(fx, io, "");
  const ids = rc.questions.map((q) => q.id);
  const A = parseRoleFile(aSrc, "A", ids, fx), B = parseRoleFile(bSrc, "B", ids, fx);
  checkAnnotatorRoles(A, B, rc, "A+B", fx);
  if (!fx.ok) return finish(fx, io, "");
  const out = {
    kind: "m7-p5a2-submissions-receipt", tool: TOOL, schemaVersion: SCHEMA_VERSION, batchId: rc.batchId, prepareManifestSha256: rcSrc.sha256,
    annotatorA: { annotatorId: A.annotatorId, sha256: aSrc.sha256, rows: A.rows.size }, annotatorB: { annotatorId: B.annotatorId, sha256: bSrc.sha256, rows: B.rows.size },
  };
  const text = stable(out, 2) + "\n";
  verifyUnchanged([rcSrc, aSrc, bSrc], fx);
  if (!fx.ok || !publishFile(a.opt.get("--out")!, text, fx)) return finish(fx, io, "");
  io.out(stable({ submissionsReceiptSha256: sha256(text) }));
  return finish(fx, io, `OK original submissions accepted; record submissionsReceiptSha256 ${sha256(text)} OUTSIDE the artifacts (accepted identity)`);
}

function cmdAgreement(a: Args, io: Io): number {
  if (!need(a, ["--a", "--b", "--prepare-manifest", "--out"], io)) return 2;
  const fx = new Findings();
  const rcSrc = loadSource(a.opt.get("--prepare-manifest")!, fx), aSrc = loadSource(a.opt.get("--a")!, fx), bSrc = loadSource(a.opt.get("--b")!, fx);
  if (!rcSrc || !aSrc || !bSrc) return finish(fx, io, "");
  const rc = parseReceipt(rcSrc, fx);
  if (!rc) return finish(fx, io, "");
  const ag = buildAgreement(rcSrc, rc, aSrc, bSrc, fx);
  if (!ag || !fx.ok) { io.out(stable({ missingLabels: ag?.missing ?? null })); return finish(fx, io, ""); }
  verifyUnchanged([rcSrc, aSrc, bSrc], fx);
  if (!fx.ok || !publishFile(a.opt.get("--out")!, ag.text, fx)) return finish(fx, io, "");
  io.out(stable({ primaryKappa: ag.policy.primaryKappa, status: ag.policy.status, adjudicationQueue: ag.queue.length }));
  if (ag.policy.reviewRequired) fx.review(path.basename(a.opt.get("--out")!), 0, null, ag.policy.status, `${ag.policy.reasons.join("; ")} — review + one calibration round on a subset OUTSIDE the dataset; existing labels are not edited`);
  return finish(fx, io, "OK agreement computed; no calibration trigger (kappa is not a PASS / FAIL verdict)");
}

function loadMergeSources(a: Args, fx: Findings): MergeSources | null {
  const l = (k: string) => loadSource(a.opt.get(k)!, fx);
  const s = { receipt: l("--prepare-manifest"), submissions: l("--submissions-receipt"), questions: l("--questions"), a: l("--a"), b: l("--b"), adjudicator: l("--adjudicator"), tagAudit: a.opt.get("--tag-audit") ? l("--tag-audit") : null };
  if (!s.receipt || !s.submissions || !s.questions || !s.a || !s.b || !s.adjudicator || (a.opt.get("--tag-audit") && !s.tagAudit)) return null;
  return s as MergeSources;
}
const MERGE_KEYS = ["--prepare-manifest", "--submissions-receipt", "--questions", "--a", "--b", "--adjudicator"];

function cmdMerge(a: Args, io: Io): number {
  if (!need(a, [...MERGE_KEYS, "--out-dir"], io)) return 2;
  const fx = new Findings();
  const s = loadMergeSources(a, fx);
  if (!s) return finish(fx, io, "");
  const vopts: ValidateOptions = { checkDistribution: !a.flags.has("--no-distribution"), checkBenchmarkOverlap: !a.flags.has("--no-overlap") };
  const m = buildMerge(s, vopts, fx);
  if (!m) return finish(fx, io, "");
  verifyUnchanged(Object.values(s), fx);
  if (!fx.ok || !publishBundle(a.opt.get("--out-dir")!, [["dataset.jsonl", m.dataset], ["adjudication.jsonl", m.adjudication], ["merge-manifest.json", m.manifest]], fx)) return finish(fx, io, "");
  for (const r of m.reviews) fx.review("dataset.jsonl", r.line, r.id, r.code, r.detail);
  io.out(stable({ mergeManifestSha256: sha256(m.manifest) }));
  return finish(fx, io, `OK merged; record mergeManifestSha256 ${sha256(m.manifest)} OUTSIDE the artifacts (accepted identity)`);
}

function cmdValidate(a: Args, io: Io): number {
  const file = a._[1];
  if (!file) { io.err("usage: validate <dataset.jsonl> [--no-distribution] [--no-overlap]"); return 2; }
  const fx = new Findings();
  const src = loadSource(file, fx);
  if (!src) return finish(fx, io, "");
  const v = validateRoutingAnnotations(src.text, { checkDistribution: !a.flags.has("--no-distribution"), checkBenchmarkOverlap: !a.flags.has("--no-overlap") });
  for (const e of v.errors) fx.add(src.name, e.line, e.id, e.code, e.detail);
  for (const r of v.reviews) fx.review(src.name, r.line, r.id, r.code, r.detail);
  io.out(stable(v.stats, 2));
  return finish(fx, io, "OK");
}

/** C4: the identity of a REVIEW finding (what exactly was approved). */
export const findingSha = (f: Finding) => sha256(JSON.stringify({ id: f.id, code: f.code, line: f.line, detail: f.detail }));

function cmdFreeze(a: Args, io: Io): number {
  const keys = [...MERGE_KEYS, "--dataset", "--adjudication", "--merge-manifest", "--agreement", "--guide", "--candidate", "--signoff", "--out",
    "--accepted-batch-id", "--accepted-submissions-sha256", "--accepted-merge-manifest-sha256"];
  if (!need(a, keys, io)) return 2;
  const fx = new Findings();
  // No trust root / signing authority exists: an OFFICIAL freeze cannot be authorized by this tool (owner decision pending).
  if (!a.flags.has("--fixture")) { fx.add("freeze", 0, null, "OFFICIAL_FREEZE_NOT_AUTHORIZED", "official dataset freeze is not authorized: no owner-approved trust anchor custody exists and hashes alone prove consistency, not authenticity; only --fixture runs"); return finish(fx, io, ""); }
  const s = loadMergeSources(a, fx);
  const l = (k: string) => loadSource(a.opt.get(k)!, fx);
  const ds = l("--dataset"), adj = l("--adjudication"), mm = l("--merge-manifest"), ag = l("--agreement"), guide = l("--guide"), cand = l("--candidate"), so = l("--signoff");
  if (!s || !ds || !adj || !mm || !ag || !guide || !cand || !so) return finish(fx, io, "");
  const F = "freeze";
  // 1. accepted identities, supplied OUTSIDE the artifacts (the merged output and its manifest cannot redefine them)
  const anchor = (k: string, actual: string, what: string) => { const v = a.opt.get(k)!; if (!isSha(v)) fx.add(F, 0, null, "ANCHOR_INVALID", `${k} must be a sha256 hex value`); else if (v !== actual) fx.add(F, 0, null, "ANCHOR_MISMATCH", `${what} differs from the accepted identity ${k}`); };
  const rc = parseReceipt(s.receipt, fx);
  if (rc) anchor("--accepted-batch-id", rc.batchId, "prepare batch");
  anchor("--accepted-submissions-sha256", s.submissions.sha256, "submissions receipt");
  anchor("--accepted-merge-manifest-sha256", mm.sha256, "merge manifest");
  if (!fx.ok || !rc) return finish(fx, io, "");
  // 2. C3: the dataset, the adjudication file and the merge manifest must be EXACTLY what merge produces from the sources
  const mmObj = readJson(mm, fx);
  const vo = isObj(mmObj) && isObj(mmObj.validator) && isObj(mmObj.validator.options) ? (mmObj.validator.options as Obj) : null;
  if (!vo || typeof vo.checkDistribution !== "boolean" || typeof vo.checkBenchmarkOverlap !== "boolean") { fx.add(mm.name, 0, null, "MERGE_MANIFEST_INVALID", "validator options missing"); return finish(fx, io, ""); }
  const m = buildMerge(s, { checkDistribution: vo.checkDistribution, checkBenchmarkOverlap: vo.checkBenchmarkOverlap }, fx);
  if (!m) return finish(fx, io, "");
  if (m.dataset !== ds.text) fx.add(ds.name, 0, null, "DATASET_NOT_REPRODUCIBLE", "dataset differs from what merge produces from the accepted sources (an edited A / B block, label, rationale or tag)");
  if (m.adjudication !== adj.text) fx.add(adj.name, 0, null, "ADJUDICATION_NOT_REPRODUCIBLE", "adjudication.jsonl differs from what merge produces from the adjudicator decisions");
  if (m.manifest !== mm.text) fx.add(mm.name, 0, null, "MERGE_MANIFEST_NOT_REPRODUCIBLE", "merge manifest differs from what merge produces from the sources");
  // 3. C2: agreement is RECOMPUTED from the original submissions; the supplied report must equal it byte for byte
  const agb = buildAgreement(s.receipt, rc, s.a, s.b, fx);
  if (!agb || !fx.ok) return finish(fx, io, "");
  if (agb.text !== ag.text) fx.add(ag.name, 0, null, "AGREEMENT_REPORT_MISMATCH", "agreement report differs from the agreement recomputed from the original A / B submissions (edited metrics or policy flags are never trusted)");
  const policy = agb.policy;
  // 4. official validator on the dataset (fixture: distribution off)
  const v = validateRoutingAnnotations(ds.text, { checkDistribution: false, checkBenchmarkOverlap: true });
  for (const e of v.errors) fx.add("dataset", e.line, e.id, "VALIDATOR_ERROR", `${e.code}: ${e.detail}`);
  // 5. C4: every approval is bound to the exact content identities (any material change invalidates old approvals)
  const binding = {
    kind: "m7-p5a2-review-binding", schemaVersion: SCHEMA_VERSION, agreementPolicy: AGREEMENT_POLICY, batchId: rc.batchId,
    prepareManifestSha256: s.receipt.sha256, submissionsReceiptSha256: s.submissions.sha256, annotatorASha256: s.a.sha256, annotatorBSha256: s.b.sha256,
    adjudicatorDecisionsSha256: s.adjudicator.sha256, tagAuditSha256: s.tagAudit?.sha256 ?? null, mergeManifestSha256: mm.sha256,
    datasetSha256: ds.sha256, adjudicationSha256: adj.sha256, agreementReportSha256: ag.sha256,
  };
  const bindingSha256 = sha256(JSON.stringify(binding));
  const soObj = readJson(so, fx);
  if (!soObj) return finish(fx, io, "");
  const annKeys = [m.annotatorA, m.annotatorB].map(labelerRoleKey);
  const signed = new Map<string, Obj>();
  for (const r of Array.isArray(soObj.reviews) ? soObj.reviews : []) {
    if (!isObj(r) || !isSha(r.findingSha256) || !isSha(r.bindingSha256) || r.decision !== "APPROVED" || !isValidLabelerId(r.signedBy) || !nonEmptyStr(r.note)) { fx.add("signoff", 0, null, "SIGNOFF_INVALID", `invalid review sign-off ${stable(r)} (needs id, code, findingSha256, bindingSha256, decision APPROVED, signedBy, note)`); continue; }
    if (annKeys.includes(labelerRoleKey(r.signedBy))) { fx.add("signoff", 0, null, "SIGNOFF_BY_ANNOTATOR", `${r.signedBy} is an annotator; review items are signed by someone else`); continue; }
    if (r.bindingSha256 !== bindingSha256) { fx.add("signoff", 0, typeof r.id === "string" ? r.id : null, "REVIEW_BINDING_MISMATCH", `approval was given for other content (binding ${r.bindingSha256}); expected binding ${bindingSha256}`); continue; }
    signed.set(r.findingSha256, r);
  }
  const wanted = new Set(v.reviews.map(findingSha));
  for (const r of v.reviews) if (!signed.has(findingSha(r))) fx.add("dataset", r.line, r.id, "REVIEW_NOT_SIGNED", `${r.code}: ${r.detail} — sign with findingSha256 ${findingSha(r)} and bindingSha256 ${bindingSha256}`);
  for (const k of signed.keys()) if (!wanted.has(k)) fx.add("signoff", 0, null, "SIGNOFF_UNMATCHED", `sign-off for finding ${k} matches no current REVIEW item (stale or for other content)`);
  // agreement review — required by the RECOMPUTED policy, never by a flag in a file
  const ar = isObj(soObj.agreementReview) ? soObj.agreementReview : null;
  if (policy.reviewRequired) {
    const bad = (code: string, d: string) => fx.add("signoff", 0, null, code, d);
    const expectDecision = AGREEMENT_REVIEW_DECISIONS[policy.status as keyof typeof AGREEMENT_REVIEW_DECISIONS];
    if (!ar) bad("AGREEMENT_REVIEW_NOT_SIGNED", `recomputed agreement policy ${policy.status} (${policy.reasons.join("; ")}): an agreementReview {role, signedBy, decision ${expectDecision}, bindingSha256 ${bindingSha256}, note${policy.calibrationRequired ? ", calibration {caseIds, ref}" : ""}} is required`);
    else if (!isValidLabelerId(ar.signedBy) || !nonEmptyStr(ar.note)) bad("AGREEMENT_REVIEW_INVALID", "agreementReview needs a valid signedBy and a note");
    else {
      if (annKeys.includes(labelerRoleKey(ar.signedBy))) bad("AGREEMENT_REVIEWER_IS_ANNOTATOR", `${ar.signedBy} is annotator A or B; the agreement reviewer must be someone else`);
      if (ar.role === "adjudicator") { if (labelerRoleKey(ar.signedBy) !== labelerRoleKey(m.adjudicatorId)) bad("AGREEMENT_REVIEW_ROLE", `role adjudicator but ${ar.signedBy} is not the adjudicator ${m.adjudicatorId}`); }
      else if (ar.role === "reviewer") { if (m.rc.writerKeys.includes(canonicalWriterKey(ar.signedBy))) bad("AGREEMENT_REVIEW_ROLE", `${ar.signedBy} is a writer`); }
      else bad("AGREEMENT_REVIEW_ROLE", `role must be "adjudicator" or "reviewer", got ${JSON.stringify(ar.role)}`);
      if (ar.bindingSha256 !== bindingSha256) bad("AGREEMENT_REVIEW_BINDING_MISMATCH", `agreementReview was given for other content; expected bindingSha256 ${bindingSha256}`);
      if (ar.decision !== expectDecision) bad("AGREEMENT_REVIEW_DECISION", `decision must be ${expectDecision} for policy ${policy.status}`);
      if (policy.calibrationRequired) {
        const c = isObj(ar.calibration) ? ar.calibration : null;
        const caseIds = c && Array.isArray(c.caseIds) && c.caseIds.length && c.caseIds.every(nonEmptyStr) ? (c.caseIds as string[]) : null;
        if (!c || !caseIds || !nonEmptyStr(c.ref)) bad("CALIBRATION_NOT_DOCUMENTED", "calibration {caseIds (non-empty), ref (where the calibration round is documented)} is required");
        else {
          const inDataset = new Set(m.datasetIds.map(idKey));
          for (const x of caseIds) if (inDataset.has(idKey(x))) bad("CALIBRATION_CASE_IN_DATASET", `calibration case ${x} is part of the evaluation dataset; calibration uses a subset OUTSIDE the dataset`);
        }
      }
    }
  }
  // 6. candidate identity: clean, and contains the Q9 safety files
  const candObj = readJson(cand, fx);
  const files = candObj && Array.isArray(candObj.files) ? candObj.files.filter(isObj) : [];
  if (candObj && candObj.clean !== true) fx.add("candidate", 0, null, "CANDIDATE_NOT_CLEAN", "candidate identity is not clean (clean !== true)");
  for (const req of REQUIRED_CANDIDATE_FILES) {
    const hit = files.find((x) => x.path === req);
    if (!hit || !isSha(hit.sha256)) fx.add("candidate", 0, null, "CANDIDATE_MISSING_REQUIRED_FILE", `${req} (owner decision Q9) is missing from the candidate identity or has no sha256`);
  }
  if (!fx.ok || !candObj) return finish(fx, io, "");
  const live = isObj(candObj.liveModel) ? candObj.liveModel : {};
  const out = {
    kind: "m7-p5a2-freeze-manifest", tool: TOOL, schemaVersion: SCHEMA_VERSION, fixture: true,
    status: "FIXTURE ONLY — synthetic test data; NOT a dataset freeze",
    trust: "hashes prove consistency with the accepted identities supplied out of band; they do not prove authenticity (no signing key / trust root)",
    acceptedIdentities: { batchId: rc.batchId, submissionsReceiptSha256: s.submissions.sha256, mergeManifestSha256: mm.sha256 },
    bindingSha256, binding,
    files: { annotationGuideSha256: guide.sha256, adjudicatedLabelsSha256: adj.sha256, candidateIdentitySha256: cand.sha256, signoffSha256: so.sha256 },
    candidate: { head: isObj(candObj.git) ? candObj.git.head ?? null : null, clean: true, requiredFilesQ9: [...REQUIRED_CANDIDATE_FILES], modelId: live.modelId ?? null, awsRegion: live.awsRegion ?? null },
    dataset: { cases: v.stats.cases, byCategory: v.stats.byCategory, scoring: v.stats.scoring, quotas: v.stats.quotas, roles: v.stats.roles },
    validator: { errors: 0, reviews: v.reviews.length, reviewsSigned: v.reviews.length },
    agreementPolicy: policy, agreementReview: ar ? { role: ar.role ?? null, signedBy: ar.signedBy ?? null, decision: ar.decision ?? null } : null,
  };
  verifyUnchanged([...Object.values(s), ds, adj, mm, ag, guide, cand, so], fx);
  if (!fx.ok || !publishFile(a.opt.get("--out")!, stable(out, 2) + "\n", fx)) return finish(fx, io, "");
  return finish(fx, io, `OK ${out.status}`);
}

export function main(argv: readonly string[], io: Io = defaultIo): number {
  const a = parseArgs(argv);
  switch (a._[0]) {
    case "prepare": return cmdPrepare(a, io);
    case "check-role": return cmdCheckRole(a, io);
    case "accept-submissions": return cmdAcceptSubmissions(a, io);
    case "agreement": return cmdAgreement(a, io);
    case "merge": return cmdMerge(a, io);
    case "validate": return cmdValidate(a, io);
    case "freeze": return cmdFreeze(a, io);
    default:
      io.err("usage: annotation-cli.ts prepare|check-role|accept-submissions|agreement|merge|validate|freeze [options] (see the file header)");
      return 2;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
