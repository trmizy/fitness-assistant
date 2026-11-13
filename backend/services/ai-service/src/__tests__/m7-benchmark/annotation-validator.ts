/**
 * Offline validator for the FUTURE human-labelled routing dataset (>= 300 Vietnamese questions, two independent human
 * annotators; schema in docs/ai-v2/m7/M7-P4.2-HYBRID-ROUTER-vi.md plus a required `source` provenance block).
 *
 * It only REPORTS problems for humans to fix. It never mutates, normalises-in-place or "repairs" its input, creates no
 * label and no dataset. Pure + deterministic: no network, no model call, no file write.
 *
 * Rules worth documenting:
 *  - Question normalisation: foldVi (lowercase, strip diacritics, đ->d) then every non [a-z0-9] char becomes a space.
 *  - Near-duplicate = identical after normalisation (exact) OR Jaccard(token sets) >= 0.9 (opts.nearDupJaccard).
 *  - requiredAgents order is the ask order. With >= 3 required agents only 2 execute, so every acceptable set must be
 *    exactly the first two required agents and expectDeferred must be the rest.
 *  - AMBIGUOUS with EMPTY requiredAgents is allowed and then follows the OOS shape (acceptable [[]]).
 *
 * CLI: npx tsx src/__tests__/m7-benchmark/annotation-validator.ts <file.jsonl> [--no-distribution] [--no-overlap]
 */
import fs from "node:fs";
import { foldVi } from "../../llm/speech_act";
import type { AgentLabel } from "../m5-benchmark/dataset-v1";
import { ROUTING_CASES_V1 } from "../m5-benchmark/dataset-v1";
import { ROUTING_CASES_DEV } from "../m5-benchmark/dataset-dev";
import { ROUTING_CASES_HELDOUT_V2 } from "../m5-benchmark/dataset-heldout-v2";
import { ROUTING_CASES_DEV_V3, ROUTING_CASES_HELDOUT_V3 } from "./dataset-v3";
import { ROUTING_CASES_DEV_V4, ROUTING_CASES_HELDOUT_V4 } from "./dataset-v4";

export const AGENTS: readonly AgentLabel[] = ["training", "nutrition", "recovery", "progress"];
export const CATEGORIES = ["SINGLE", "TWO", "MULTI", "OOS", "AMBIGUOUS"] as const;
export const SAFETY_VALUES = ["NONE", "MINOR", "INJECTION", "HIGH_RISK"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface AnnotationError { line: number; id: string | null; code: string; detail: string }

export interface DistributionTarget {
  minCases: number;
  /** Target share (0-100) per category. */
  categoryPct: Record<Category, number>;
  tolerancePts: number;
  minUnaccentedPct: number;
  minMultiClausePct: number;
  minNoKeywordPct: number;
  minMinor: number;
  minInjection: number;
}

export const DEFAULT_TARGET: DistributionTarget = {
  minCases: 300,
  categoryPct: { SINGLE: 35, TWO: 25, MULTI: 15, OOS: 10, AMBIGUOUS: 15 },
  tolerancePts: 5,
  minUnaccentedPct: 25, minMultiClausePct: 20, minNoKeywordPct: 20, minMinor: 20, minInjection: 20,
};

export interface ValidateOptions {
  target?: Partial<DistributionTarget>;
  checkDistribution?: boolean;      // default true
  checkBenchmarkOverlap?: boolean;  // default true
  nearDupJaccard?: number;          // default 0.9
}

export interface ValidationStats {
  totalLines: number;
  cases: number;
  byCategory: Record<string, number>;
  unaccented: number;
  multiClause: number;
  noKeyword: number;
  minor: number;
  injection: number;
  errorsByCode: Record<string, number>;
}

export interface ValidationResult { ok: boolean; errors: AnnotationError[]; stats: ValidationStats }

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function normalizeQuestion(q: string): string {
  return foldVi(q).replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(norm: string): Set<string> { return new Set(norm.split(" ").filter(Boolean)); }
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
export function hasVietnameseDiacritics(q: string): boolean {
  return /[̀-ͯ]|đ|Đ/.test(q.normalize("NFD"));
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isAgent = (v: unknown): v is AgentLabel => typeof v === "string" && (AGENTS as readonly string[]).includes(v);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));

const BENCHMARKS: Array<{ name: string; cases: ReadonlyArray<{ q: string }> }> = [
  { name: "V1", cases: ROUTING_CASES_V1 },
  { name: "DEV", cases: ROUTING_CASES_DEV },
  { name: "HELDOUT_V2", cases: ROUTING_CASES_HELDOUT_V2 },
  { name: "DEV_V3", cases: ROUTING_CASES_DEV_V3 },
  { name: "HELDOUT_V3", cases: ROUTING_CASES_HELDOUT_V3 },
  { name: "DEV_V4", cases: ROUTING_CASES_DEV_V4 },
  { name: "HELDOUT_V4", cases: ROUTING_CASES_HELDOUT_V4 },
];
let benchIndex: Array<{ name: string; norms: Set<string>; toks: Set<string>[] }> | null = null;
function getBenchIndex() {
  if (!benchIndex) {
    benchIndex = BENCHMARKS.map((b) => {
      const list = b.cases.map((c) => normalizeQuestion(c.q));
      return { name: b.name, norms: new Set(list), toks: list.map(tokens) };
    });
  }
  return benchIndex;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function validateRoutingAnnotations(jsonlText: string, opts: ValidateOptions = {}): ValidationResult {
  const errors: AnnotationError[] = [];
  const target: DistributionTarget = { ...DEFAULT_TARGET, ...(opts.target ?? {}), categoryPct: { ...DEFAULT_TARGET.categoryPct, ...(opts.target?.categoryPct ?? {}) } };
  const nearThr = opts.nearDupJaccard ?? 0.9;
  const checkDist = opts.checkDistribution !== false;
  const checkOverlap = opts.checkBenchmarkOverlap !== false;
  const stats: ValidationStats = { totalLines: 0, cases: 0, byCategory: {}, unaccented: 0, multiClause: 0, noKeyword: 0, minor: 0, injection: 0, errorsByCode: {} };

  const lines = jsonlText.split(/\r?\n/);
  const seenIds = new Map<string, number>();
  const seenNorm = new Map<string, { line: number; id: string }>();
  const accepted: Array<{ line: number; id: string; norm: string; toks: Set<string> }> = [];

  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const line = i + 1;
    stats.totalLines++;
    let row: unknown;
    try { row = JSON.parse(raw); } catch (e) {
      errors.push({ line, id: null, code: "MALFORMED_JSON", detail: (e as Error).message });
      return;
    }
    if (!isObj(row)) { errors.push({ line, id: null, code: "NOT_OBJECT", detail: "line is not a JSON object" }); return; }
    stats.cases++;
    const id = nonEmptyStr(row.id) ? row.id : null;
    const err = (code: string, detail: string) => errors.push({ line, id, code, detail });

    if (!id) err("MISSING_FIELD", "id missing or empty");
    else if (seenIds.has(id)) err("DUPLICATE_ID", `id also used on line ${seenIds.get(id)}`);
    else seenIds.set(id, line);

    // question + accented
    const q = row.question;
    if (!nonEmptyStr(q)) err("MISSING_FIELD", "question missing or empty");
    else {
      const norm = normalizeQuestion(q);
      const toks = tokens(norm);
      const prev = seenNorm.get(norm);
      if (prev) err("DUPLICATE_QUESTION", `identical (after normalisation) to ${prev.id} on line ${prev.line}`);
      else {
        for (const a of accepted) {
          const j = jaccard(toks, a.toks);
          if (j >= nearThr) { err("NEAR_DUPLICATE_QUESTION", `token Jaccard ${j.toFixed(2)} >= ${nearThr} with ${a.id} on line ${a.line}`); break; }
        }
        seenNorm.set(norm, { line, id: id ?? "?" });
      }
      accepted.push({ line, id: id ?? "?", norm, toks });
      if (typeof row.accented !== "boolean") err("MISSING_FIELD", "accented must be boolean");
      else if (row.accented !== hasVietnameseDiacritics(q)) err("ACCENTED_MISMATCH", `accented=${row.accented} but text ${hasVietnameseDiacritics(q) ? "has" : "has no"} Vietnamese diacritics`);

      if (checkOverlap) {
        for (const b of getBenchIndex()) {
          if (b.norms.has(norm)) { err("BENCHMARK_OVERLAP", `${b.name}: identical question`); continue; }
          const hit = b.toks.some((t) => jaccard(toks, t) >= nearThr);
          if (hit) err("BENCHMARK_OVERLAP", `${b.name}: near-duplicate question (Jaccard >= ${nearThr})`);
        }
      }
      if (row.accented === false) stats.unaccented++;
    }

    // enums
    const category = row.category;
    const catOk = typeof category === "string" && (CATEGORIES as readonly string[]).includes(category);
    if (!catOk) err("INVALID_ENUM", `category must be one of ${CATEGORIES.join("|")}`);
    else stats.byCategory[category as string] = (stats.byCategory[category as string] ?? 0) + 1;
    if (typeof row.safety !== "string" || !(SAFETY_VALUES as readonly string[]).includes(row.safety)) err("INVALID_ENUM", `safety must be one of ${SAFETY_VALUES.join("|")}`);

    // tags
    const tags = Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [];
    if (!Array.isArray(row.tags)) err("MISSING_FIELD", "tags must be an array");
    if (tags.includes("multi_clause")) stats.multiClause++;
    if (tags.includes("no_keyword")) stats.noKeyword++;
    if (tags.includes("minor") || row.safety === "MINOR") stats.minor++;
    if (tags.includes("prompt_injection") || row.safety === "INJECTION") stats.injection++;

    // agents
    let agentsOk = true;
    const checkAgentList = (v: unknown, where: string): AgentLabel[] | null => {
      if (!Array.isArray(v)) { err("INVALID_AGENT", `${where} must be an array`); agentsOk = false; return null; }
      const bad = v.filter((x) => !isAgent(x));
      if (bad.length) { err("INVALID_AGENT", `${where} has invalid agent id(s): ${JSON.stringify(bad)}`); agentsOk = false; return null; }
      if (new Set(v).size !== v.length) err("INVALID_AGENT", `${where} has duplicate agents`);
      return v as AgentLabel[];
    };
    const required = checkAgentList(row.requiredAgents, "requiredAgents");
    const deferred = checkAgentList(row.expectDeferred, "expectDeferred");
    let primary: AgentLabel | null | undefined;
    if (row.primaryAgent === null) primary = null;
    else if (isAgent(row.primaryAgent)) primary = row.primaryAgent;
    else { err("INVALID_AGENT", `primaryAgent invalid: ${JSON.stringify(row.primaryAgent)}`); agentsOk = false; }

    let acceptable: AgentLabel[][] | null = null;
    if (!Array.isArray(row.acceptable) || !row.acceptable.length) { err("INVALID_ACCEPTABLE", "acceptable must be a non-empty array of agent sets"); }
    else {
      const sets: AgentLabel[][] = [];
      let bad = false;
      row.acceptable.forEach((s, k) => { const l = checkAgentList(s, `acceptable[${k}]`); if (l) sets.push(l); else bad = true; });
      if (!bad) acceptable = sets;
    }

    // primary vs required
    if (required && primary !== undefined) {
      if (required.length === 0 && primary !== null) err("INVALID_PRIMARY", "primaryAgent must be null when requiredAgents is empty");
      if (required.length > 0 && (primary === null || !required.includes(primary))) err("INVALID_PRIMARY", "primaryAgent must be one of requiredAgents");
    }

    // category consistency
    if (required && catOk) {
      const n = required.length;
      if (category === "SINGLE" && n !== 1) err("CATEGORY_MISMATCH", `SINGLE needs exactly 1 required agent, got ${n}`);
      if (category === "TWO" && n !== 2) err("CATEGORY_MISMATCH", `TWO needs exactly 2 required agents, got ${n}`);
      if (category === "MULTI" && (n < 3 || n > 4)) err("CATEGORY_MISMATCH", `MULTI needs 3-4 required agents, got ${n}`);
      if (category === "OOS" && n !== 0) err("CATEGORY_MISMATCH", `OOS needs 0 required agents, got ${n}`);
      if (category === "AMBIGUOUS" && !tags.includes("ambiguous") && !nonEmptyStr(row.rationale)) err("AMBIGUOUS_UNJUSTIFIED", "AMBIGUOUS needs an 'ambiguous' tag or a rationale");
    }

    // acceptable sets
    if (required && acceptable && agentsOk && catOk) {
      const emptyShape = category === "OOS" || (category === "AMBIGUOUS" && required.length === 0);
      if (emptyShape) {
        if (!(acceptable.length === 1 && acceptable[0].length === 0)) err("INVALID_ACCEPTABLE", "OOS (or AMBIGUOUS with no required agent) must have acceptable exactly [[]]");
      } else {
        if (acceptable.some((s) => s.length === 0)) err("INVALID_ACCEPTABLE", "non-OOS case must not contain an empty acceptable set");
        for (const s of acceptable) {
          if (s.length > 2) err("INVALID_ACCEPTABLE", `acceptable set ${JSON.stringify(s)} has more than 2 agents`);
          if (!s.every((a) => required.includes(a))) err("INVALID_ACCEPTABLE", `acceptable set ${JSON.stringify(s)} is not a subset of requiredAgents`);
        }
        if (required.length >= 3) {
          const firstTwo = required.slice(0, 2);
          for (const s of acceptable) if (s.length && !sameSet(s, firstTwo)) err("INVALID_ACCEPTABLE", `with >=3 required, acceptable must be the first two asks ${JSON.stringify(firstTwo)}, got ${JSON.stringify(s)}`);
        }
      }
    }

    // deferred
    if (required && deferred) {
      const expected = required.length >= 3 ? required.slice(2) : [];
      if (!sameSet(deferred, expected)) err("INVALID_DEFERRED", `expectDeferred must be ${JSON.stringify(expected)} (required minus the 2 kept), got ${JSON.stringify(deferred)}`);
      if (acceptable) for (const s of acceptable) if (s.some((a) => deferred.includes(a))) { err("INVALID_DEFERRED", `expectDeferred overlaps acceptable set ${JSON.stringify(s)}`); break; }
    }

    // rationale / source
    if (!nonEmptyStr(row.rationale)) err("MISSING_RATIONALE", "rationale missing or empty");
    const src = row.source;
    if (!isObj(src)) err("INVALID_SOURCE", "source missing");
    else {
      if (src.kind !== "synthetic" && src.kind !== "permitted") err("INVALID_SOURCE", "source.kind must be synthetic|permitted");
      if (!nonEmptyStr(src.author)) err("INVALID_SOURCE", "source.author missing or empty");
      if (!nonEmptyStr(src.note)) err("INVALID_SOURCE", "source.note missing or empty");
    }

    // annotators + adjudication
    const blocks: Array<{ req: AgentLabel[]; primary: AgentLabel | null } | null> = [];
    for (const key of ["annotatorA", "annotatorB"] as const) {
      const b = row[key];
      if (!isObj(b)) { err("MISSING_ANNOTATOR", `${key} missing`); blocks.push(null); continue; }
      const prevOk: boolean = agentsOk;
      const req = checkAgentList(b.requiredAgents, `${key}.requiredAgents`);
      let p: AgentLabel | null | undefined;
      if (b.primaryAgent === null) p = null;
      else if (isAgent(b.primaryAgent)) p = b.primaryAgent;
      else err("INVALID_AGENT", `${key}.primaryAgent invalid: ${JSON.stringify(b.primaryAgent)}`);
      agentsOk = prevOk;
      blocks.push(req && p !== undefined ? { req, primary: p } : null);
    }
    const [a, b] = blocks;
    if (a && b && (!sameSet(a.req, b.req) || a.primary !== b.primary)) {
      const adj = row.adjudication;
      if (!isObj(adj) || adj.needed !== true || !nonEmptyStr(adj.decision) || !nonEmptyStr(adj.by)) {
        err("ADJUDICATION_MISSING", "annotators disagree: adjudication.needed must be true with non-empty decision and by");
      }
    }
  });

  // distribution
  if (checkDist) {
    const dErr = (code: string, detail: string) => errors.push({ line: 0, id: null, code, detail });
    const n = stats.cases;
    if (n < target.minCases) dErr("DISTRIBUTION_SIZE", `${n} cases < required ${target.minCases}`);
    if (n > 0) {
      for (const cat of CATEGORIES) {
        const pct = ((stats.byCategory[cat] ?? 0) / n) * 100;
        if (Math.abs(pct - target.categoryPct[cat]) > target.tolerancePts) dErr("DISTRIBUTION_CATEGORY", `${cat} is ${pct.toFixed(1)}% (target ${target.categoryPct[cat]}% +/- ${target.tolerancePts})`);
      }
      const pctChecks: Array<[string, number, number]> = [
        ["DISTRIBUTION_UNACCENTED", stats.unaccented, target.minUnaccentedPct],
        ["DISTRIBUTION_MULTI_CLAUSE", stats.multiClause, target.minMultiClausePct],
        ["DISTRIBUTION_NO_KEYWORD", stats.noKeyword, target.minNoKeywordPct],
      ];
      for (const [code, count, min] of pctChecks) {
        const pct = (count / n) * 100;
        if (pct < min) dErr(code, `${pct.toFixed(1)}% (${count}/${n}) < required ${min}%`);
      }
    } else {
      dErr("DISTRIBUTION_CATEGORY", "no cases");
    }
    if (stats.minor < target.minMinor) dErr("DISTRIBUTION_MINOR", `${stats.minor} minor cases < required ${target.minMinor}`);
    if (stats.injection < target.minInjection) dErr("DISTRIBUTION_INJECTION", `${stats.injection} prompt_injection cases < required ${target.minInjection}`);
  }

  for (const e of errors) stats.errorsByCode[e.code] = (stats.errorsByCode[e.code] ?? 0) + 1;
  return { ok: errors.length === 0, errors, stats };
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
  for (const e of res.errors) console.log(`line ${e.line}\t${e.id ?? "-"}\t${e.code}\t${e.detail}`);
  console.log(JSON.stringify(res.stats, null, 2));
  console.log(res.ok ? "OK" : `FAILED: ${res.errors.length} error(s)`);
  process.exit(res.ok ? 0 : 1);
}
