/**
 * Phase 4.7R6 — pure helpers for the independent query-routing annotation workflow
 * (schema validation, duplicate / near-duplicate / family-leakage audit, blind export, agreement, adjudication, family split).
 * No I/O, no model calls. These helpers never produce labels; labels come only from human annotators.
 */
import crypto from "node:crypto";

export const SAFETY_LABELS = ["NORMAL_FITNESS", "GENERAL_INFORMATION_ONLY", "SAFE_ABSTAIN"] as const;
export const PROGRAMMING_LABELS = ["PROGRAMMING", "NOT_PROGRAMMING"] as const;
export const DOMAIN_LABELS = ["STRENGTH", "HYPERTROPHY", "CATALOG", "RECOVERY", "NUTRITION", "BODY_COMPOSITION", "SUPPLEMENTS", "OOD", "UNKNOWN"] as const;
export const SAFETY_TAGS = ["PERSONAL_CURRENT", "RECENT_EVENT", "SYMPTOM", "FUNCTIONAL_LIMITATION", "EXPECTED_TRAINING_RESPONSE", "GENERAL_KNOWLEDGE", "UNCERTAIN"] as const;

export interface AnnotationRow {
  id: string;
  familyId: string;
  text: string;
  annotator?: string;
  safetyLabel?: string;
  programmingLabel?: string;
  domain?: string;
  tags?: string[];
  uncertain?: boolean;
  comment?: string;
  timestamp?: string;
}

export const fold = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const tokens = (s: string): Set<string> => new Set(fold(s).split(" ").filter((w) => w.length > 1));
export function jaccard(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / (A.size + B.size - i);
}
/** documented near-duplicate threshold (token Jaccard over accent-folded words) */
export const NEAR_DUPLICATE_THRESHOLD = 0.8;

const PII_PATTERNS: Array<[string, RegExp]> = [
  ["email", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["phone", /(?<!\d)(\+?84|0)\d{9,10}(?!\d)/],
  ["long_number", /\d{8,}/],
  ["url", /https?:\/\//],
];
export function detectPii(text: string): string[] {
  return PII_PATTERNS.filter(([, re]) => re.test(text)).map(([n]) => n);
}

export function validateRow(row: AnnotationRow, opts: { requireLabels?: boolean } = {}): string[] {
  const e: string[] = [];
  if (!row.id) e.push("missing id");
  if (!row.familyId) e.push("missing familyId");
  if (!row.text || !row.text.trim()) e.push("empty text");
  else if (row.text.length > 600) e.push("text too long");
  if (row.text) { const p = detectPii(row.text); if (p.length) e.push(`possible PII: ${p.join(",")}`); }
  if (opts.requireLabels) {
    if (!row.annotator) e.push("missing annotator");
    else if (/@|\s/.test(row.annotator)) e.push("annotator must be a pseudonymous id (no email / spaces)");
    if (row.safetyLabel && !(SAFETY_LABELS as readonly string[]).includes(row.safetyLabel)) e.push(`bad safetyLabel ${row.safetyLabel}`);
    if (row.programmingLabel && !(PROGRAMMING_LABELS as readonly string[]).includes(row.programmingLabel)) e.push(`bad programmingLabel ${row.programmingLabel}`);
    if (row.domain && !(DOMAIN_LABELS as readonly string[]).includes(row.domain)) e.push(`bad domain ${row.domain}`);
    if (!row.safetyLabel && !row.programmingLabel) e.push("no label given");
    for (const t of row.tags ?? []) if (!(SAFETY_TAGS as readonly string[]).includes(t)) e.push(`bad tag ${t}`);
  }
  return e;
}

export function findExactDuplicates(rows: AnnotationRow[]): string[][] {
  const by = new Map<string, string[]>();
  for (const r of rows) { const k = fold(r.text); by.set(k, [...(by.get(k) ?? []), r.id]); }
  return [...by.values()].filter((v) => v.length > 1);
}

export function findNearDuplicates(rows: AnnotationRow[], threshold = NEAR_DUPLICATE_THRESHOLD): Array<{ a: string; b: string; sim: number }> {
  const out: Array<{ a: string; b: string; sim: number }> = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    if (fold(rows[i].text) === fold(rows[j].text)) continue; // exact handled separately
    const sim = jaccard(rows[i].text, rows[j].text);
    if (sim >= threshold) out.push({ a: rows[i].id, b: rows[j].id, sim: +sim.toFixed(3) });
  }
  return out;
}

/** rows (candidate evaluation set) whose text equals / nearly equals any sentence of a reference set (e.g. V1–V5) */
export function findLeakage(rows: AnnotationRow[], refs: string[], threshold = NEAR_DUPLICATE_THRESHOLD): Array<{ id: string; kind: "exact" | "near"; sim: number }> {
  const refFold = new Set(refs.map(fold));
  const out: Array<{ id: string; kind: "exact" | "near"; sim: number }> = [];
  for (const r of rows) {
    if (refFold.has(fold(r.text))) { out.push({ id: r.id, kind: "exact", sim: 1 }); continue; }
    let best = 0;
    for (const ref of refs) { const s = jaccard(r.text, ref); if (s > best) best = s; }
    if (best >= threshold) out.push({ id: r.id, kind: "near", sim: +best.toFixed(3) });
  }
  return out;
}

export type Split = "train" | "calibration" | "test";
const h = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
/** deterministic family-level split: every row of one family lands in exactly one split */
export function assignFamilySplit(familyIds: string[], ratios = { train: 0.7, calibration: 0.15 }): Record<string, Split> {
  const ids = [...new Set(familyIds)].sort((a, b) => h(a).localeCompare(h(b)));
  const out: Record<string, Split> = {};
  ids.forEach((f, i) => { const r = i / ids.length; out[f] = r < ratios.train ? "train" : r < ratios.train + ratios.calibration ? "calibration" : "test"; });
  return out;
}
export function familyOverlap(rows: Array<{ familyId: string; split: Split }>): string[] {
  const seen = new Map<string, Set<Split>>();
  for (const r of rows) seen.set(r.familyId, (seen.get(r.familyId) ?? new Set()).add(r.split));
  return [...seen].filter(([, s]) => s.size > 1).map(([f]) => f);
}

/** Annotator-facing export: ONLY id + text, deterministic shuffled order. Any other field (predictions, family, scores) is dropped. */
export function blindExport(rows: AnnotationRow[], seed = "r6"): Array<{ id: string; text: string }> {
  return rows
    .map((r) => ({ id: r.id, text: r.text }))
    .sort((a, b) => h(seed + a.id).localeCompare(h(seed + b.id)));
}

export function rawAgreement(a: string[], b: string[]): number {
  if (a.length !== b.length || !a.length) return NaN;
  let m = 0; for (let i = 0; i < a.length; i++) if (a[i] === b[i]) m++;
  return m / a.length;
}
export function cohenKappa(a: string[], b: string[]): number {
  if (a.length !== b.length || !a.length) return NaN;
  const n = a.length, cats = [...new Set([...a, ...b])];
  const po = rawAgreement(a, b);
  let pe = 0;
  for (const c of cats) pe += (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

export interface Adjudication { id: string; finalLabel: string; reasonClass: "GUIDELINE_AMBIGUITY" | "GENUINE_QUERY_AMBIGUITY" | "ANNOTATOR_ERROR" | "DOMAIN_OVERLAP" | "SAFETY_POLICY_UNCLEAR" | "OTHER" | "AMBIGUOUS_WORDING" | "POLICY_AMBIGUITY" | "ANNOTATOR_MISTAKE"; adjudicator: string }
export interface AdjudicationResult {
  final: Record<string, string>;
  disagreements: string[];
  pending: string[];
  policyAmbiguous: string[];
}
/** merge two annotators' labels per id; a disagreement is only resolved by an explicit adjudication row (never by silently picking one) */
export function adjudicate(a: Record<string, string>, b: Record<string, string>, adj: Adjudication[]): AdjudicationResult {
  const adjBy = new Map(adj.map((x) => [x.id, x]));
  const final: Record<string, string> = {}, disagreements: string[] = [], pending: string[] = [], policyAmbiguous: string[] = [];
  for (const id of Object.keys(a)) {
    if (!(id in b)) { pending.push(id); continue; }
    if (a[id] === b[id]) { final[id] = a[id]; continue; }
    disagreements.push(id);
    const j = adjBy.get(id);
    if (!j) { pending.push(id); continue; }
    if (j.reasonClass === "POLICY_AMBIGUITY" || j.reasonClass === "SAFETY_POLICY_UNCLEAR") policyAmbiguous.push(id);
    else final[id] = j.finalLabel;
  }
  return { final, disagreements, pending, policyAmbiguous };
}

// ── CSV (RFC-4180-ish, enough for the templates) ───────────────────────────
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
}

// ── privacy: forbidden columns (schema-level rejection) ─────────────────────
export const FORBIDDEN_COLUMNS = ["email", "phone", "phone_number", "user_id", "userid", "account_id", "accountid", "full_name", "fullname", "name", "medical_record_id", "address", "dob", "birthdate", "ip", "ip_address"] as const;
/** returns the forbidden column names present in a CSV/JSON header (case / separator insensitive) */
export function forbiddenColumns(header: string[]): string[] {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const bad = new Set<string>(FORBIDDEN_COLUMNS);
  return header.filter((h) => bad.has(norm(h)) || bad.has(norm(h).replace(/_/g, "")));
}

/** rows = annotator A label, columns = annotator B label */
export function confusionMatrix(a: string[], b: string[]): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {};
  for (let i = 0; i < a.length; i++) { m[a[i]] ??= {}; m[a[i]][b[i]] = (m[a[i]][b[i]] ?? 0) + 1; }
  return m;
}
