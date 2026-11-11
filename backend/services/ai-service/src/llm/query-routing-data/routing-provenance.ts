/**
 * Phase 4.7R6A.1 — annotation PROVENANCE gate for the independent routing corpus.
 *
 * Provenance controls authority. A label file is only usable as independent human annotation when a machine-readable,
 * declared provenance manifest accompanies it and every condition below holds. Dishonesty is not detected automatically:
 * the gate relies on declared provenance (experiment provenance, not legal language). Pure functions; no I/O.
 */
import crypto from "node:crypto";
import { forbiddenColumns, validateRow, SAFETY_LABELS, PROGRAMMING_LABELS, type AnnotationRow } from "./routing-data-tools";

export type AnnotationAuthority =
  | "SIMULATED_LABELS"
  | "INDEPENDENT_HUMAN_LABELS_ON_SYNTHETIC_UTTERANCES"
  | "HUMAN_WRITTEN_AND_HUMAN_LABELED"
  | "REAL_USER_DEIDENTIFIED_HUMAN_LABELED";

export const HUMAN_AUTHORITIES: readonly AnnotationAuthority[] = [
  "INDEPENDENT_HUMAN_LABELS_ON_SYNTHETIC_UTTERANCES", "HUMAN_WRITTEN_AND_HUMAN_LABELED", "REAL_USER_DEIDENTIFIED_HUMAN_LABELED",
];

export type ProvenanceErrorCode =
  | "INDEPENDENT_HUMAN_PROVENANCE_REQUIRED"
  | "ANNOTATION_GUIDELINE_VERSION_MISMATCH"
  | "ANNOTATION_BATCH_MISMATCH";

export interface HumanProvenance {
  annotatorId: string;
  human: boolean;
  independent: boolean;
  usedLLMForLabels: boolean;
  sawOtherAnnotatorLabels: boolean;
  sawClassifierPredictions: boolean;
  sawGoldLabels: boolean;
  annotationGuidelineVersion: string;
  annotationGuidelineHash: string;
  batchHash: string;
  annotationTimestampRange?: { start: string; end: string };
  authority: AnnotationAuthority;
  notes?: string;
}

export interface Check { ok: boolean; code?: ProvenanceErrorCode; errors: string[] }

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const sha256Hex = sha;

/** order-insensitive hash of the blind batch (id + exact text) */
export function canonicalBatchHash(rows: Array<{ id: string; text: string }>): string {
  return sha(rows.map((r) => `${r.id}\t${r.text}`).sort().join("\n"));
}

const ALLOWED_KEYS = new Set<string>(["annotatorId", "human", "independent", "usedLLMForLabels", "sawOtherAnnotatorLabels", "sawClassifierPredictions", "sawGoldLabels", "annotationGuidelineVersion", "annotationGuidelineHash", "batchHash", "annotationTimestampRange", "authority", "notes", "attestation"]);

export interface ProvenanceExpectation { annotatorId: string; batchHash: string; guidelineVersion: string; guidelineHash: string }

export function validateHumanProvenance(p: unknown, exp: ProvenanceExpectation): Check {
  const errors: string[] = [];
  const fail = (code: ProvenanceErrorCode, ...e: string[]): Check => ({ ok: false, code, errors: [...errors, ...e] });
  if (!p || typeof p !== "object") return fail("INDEPENDENT_HUMAN_PROVENANCE_REQUIRED", "provenance missing or not an object");
  const o = p as Record<string, unknown>;

  const forbidden = forbiddenColumns(Object.keys(o));
  if (forbidden.length) errors.push(`forbidden personal-data field(s): ${forbidden.join(", ")}`);
  for (const k of Object.keys(o)) if (!ALLOWED_KEYS.has(k) && !forbidden.includes(k)) errors.push(`unknown field: ${k}`);
  if (JSON.stringify(o).match(/[\w.+-]+@[\w-]+\.[\w.-]+/)) errors.push("provenance contains an email-like value");

  if (typeof o.annotatorId !== "string" || !/^[A-Za-z0-9_-]{2,16}$/.test(o.annotatorId)) errors.push("annotatorId must be a pseudonymous id");
  else if (o.annotatorId !== exp.annotatorId) errors.push(`annotatorId ${o.annotatorId} != expected ${exp.annotatorId}`);
  if (o.human !== true) errors.push("human must be true");
  if (o.independent !== true) errors.push("independent must be true");
  if (o.usedLLMForLabels !== false) errors.push("usedLLMForLabels must be false (LLM-assisted labels are not independent)");
  if (o.sawOtherAnnotatorLabels !== false) errors.push("sawOtherAnnotatorLabels must be false");
  if (o.sawClassifierPredictions !== false) errors.push("sawClassifierPredictions must be false");
  if (o.sawGoldLabels !== false) errors.push("sawGoldLabels must be false");
  if (!HUMAN_AUTHORITIES.includes(o.authority as AnnotationAuthority)) errors.push(`authority ${String(o.authority)} is not a human authority (simulated / unknown rejected)`);
  if (errors.length) return fail("INDEPENDENT_HUMAN_PROVENANCE_REQUIRED");

  if (o.annotationGuidelineVersion !== exp.guidelineVersion || o.annotationGuidelineHash !== exp.guidelineHash)
    return fail("ANNOTATION_GUIDELINE_VERSION_MISMATCH", `provenance guideline ${String(o.annotationGuidelineVersion)}/${String(o.annotationGuidelineHash).slice(0, 12)} != frozen ${exp.guidelineVersion}/${exp.guidelineHash.slice(0, 12)}`);
  if (o.batchHash !== exp.batchHash) return fail("ANNOTATION_BATCH_MISMATCH", "provenance batchHash differs from the blind pilot batch hash");
  return { ok: true, errors: [] };
}

/** the frozen-guideline record must match the actual guideline file */
export function verifyGuidelineFreeze(freeze: { version: string; sha256: string }, guidelineFileBytes: Buffer | string): Check {
  const h = crypto.createHash("sha256").update(guidelineFileBytes).digest("hex");
  return h === freeze.sha256 ? { ok: true, errors: [] } : { ok: false, code: "ANNOTATION_GUIDELINE_VERSION_MISMATCH", errors: [`guideline file hash ${h.slice(0, 12)} != freeze ${freeze.sha256.slice(0, 12)}`] };
}

export interface BatchRow { id: string; text: string }

/** A01 / A02 (and the blind batch) must carry exactly the same ids and texts; order may differ */
export function checkSameBatch(batch: BatchRow[], a: BatchRow[], b: BatchRow[]): Check {
  const errors: string[] = [];
  const idx = (rows: BatchRow[], name: string) => {
    const m = new Map<string, string>();
    for (const r of rows) { if (m.has(r.id)) errors.push(`${name}: duplicate id ${r.id}`); m.set(r.id, r.text); }
    return m;
  };
  const B = idx(batch, "batch"), A = idx(a, "A01"), C = idx(b, "A02");
  for (const [name, M] of [["A01", A], ["A02", C]] as const) {
    for (const id of B.keys()) if (!M.has(id)) errors.push(`${name}: missing id ${id}`);
    for (const [id, t] of M) {
      if (!B.has(id)) errors.push(`${name}: extra id ${id}`);
      else if (B.get(id) !== t) errors.push(`${name}: text changed for ${id}`);
    }
  }
  return errors.length ? { ok: false, code: "ANNOTATION_BATCH_MISMATCH", errors } : { ok: true, errors: [] };
}

/** per-file audit: schema / PII / ids / enums / annotator identity / completeness against the blind batch */
export function auditAnnotationFile(rows: Array<Record<string, string>>, header: string[], batch: BatchRow[], expectedAnnotator: string): Check {
  const errors: string[] = [];
  const bad = forbiddenColumns(header);
  if (bad.length) errors.push(`forbidden column(s): ${bad.join(", ")}`);
  for (const c of ["id", "text", "annotator", "safetyLabel", "programmingLabel"]) if (!header.includes(c)) errors.push(`missing required column ${c}`);
  if (errors.length) return { ok: false, errors };
  const seen = new Set<string>();
  const batchIds = new Set(batch.map((r) => r.id));
  for (const r of rows) {
    const row: AnnotationRow = { id: r.id, familyId: "-", text: r.text, annotator: r.annotator, safetyLabel: r.safetyLabel, programmingLabel: r.programmingLabel, domain: r.domain || undefined };
    for (const e of validateRow(row, { requireLabels: true })) errors.push(`${r.id}: ${e}`);
    if (!(SAFETY_LABELS as readonly string[]).includes(r.safetyLabel)) errors.push(`${r.id}: safetyLabel missing/invalid`);
    if (!(PROGRAMMING_LABELS as readonly string[]).includes(r.programmingLabel)) errors.push(`${r.id}: programmingLabel missing/invalid`);
    if (r.annotator !== expectedAnnotator) errors.push(`${r.id}: annotator ${r.annotator} != ${expectedAnnotator}`);
    if (seen.has(r.id)) errors.push(`${r.id}: duplicate id`);
    seen.add(r.id);
    if (!batchIds.has(r.id)) errors.push(`${r.id}: not in blind batch`);
  }
  for (const id of batchIds) if (!seen.has(id)) errors.push(`missing batch id ${id}`);
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export interface AxisReport {
  column: "safetyLabel" | "programmingLabel";
  n: number;
  rawAgreement: number;
  cohenKappa: number;
  /** rows = A01 label, columns = A02 label */
  confusionMatrix: Record<string, Record<string, number>>;
  disagreements: Array<{ id: string; text: string; labelA01: string; labelA02: string; uncertainA01: string; uncertainA02: string; commentA01: string; commentA02: string }>;
}

export function axisReport(column: AxisReport["column"], a: Array<Record<string, string>>, b: Array<Record<string, string>>): AxisReport {
  const bm = new Map(b.map((r) => [r.id, r]));
  const ids = a.filter((r) => bm.has(r.id)).map((r) => r.id).sort();
  const am = new Map(a.map((r) => [r.id, r]));
  const cm: Record<string, Record<string, number>> = {};
  let agree = 0;
  const dis: AxisReport["disagreements"] = [];
  const A: string[] = [], B: string[] = [];
  for (const id of ids) {
    const x = am.get(id)!, y = bm.get(id)!;
    A.push(x[column]); B.push(y[column]);
    cm[x[column]] ??= {};
    cm[x[column]][y[column]] = (cm[x[column]][y[column]] ?? 0) + 1;
    if (x[column] === y[column]) agree++;
    else dis.push({ id, text: x.text, labelA01: x[column], labelA02: y[column], uncertainA01: x.uncertain ?? "", uncertainA02: y.uncertain ?? "", commentA01: x.comment ?? "", commentA02: y.comment ?? "" });
  }
  const n = ids.length, po = n ? agree / n : NaN;
  const cats = [...new Set([...A, ...B])];
  let pe = 0;
  for (const c of cats) pe += (A.filter((v) => v === c).length / n) * (B.filter((v) => v === c).length / n);
  return { column, n, rawAgreement: po, cohenKappa: pe === 1 ? 1 : (po - pe) / (1 - pe), confusionMatrix: cm, disagreements: dis };
}
