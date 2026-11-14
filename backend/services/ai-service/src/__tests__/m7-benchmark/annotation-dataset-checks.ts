/**
 * M7-P5A.1 / M7-P5A2 — dataset-level checks for the human-labelled routing dataset. Pure: no I/O, no network, never mutates input.
 * errors = must be fixed by a human; reviews = REVIEW REQUIRED (a human must look and sign off; never auto-removed).
 */
import { foldVi } from "../../llm/speech_act";
import { ROUTING_CASES_V1 } from "../m5-benchmark/dataset-v1";
import { ROUTING_CASES_DEV } from "../m5-benchmark/dataset-dev";
import { ROUTING_CASES_HELDOUT_V2 } from "../m5-benchmark/dataset-heldout-v2";
import { ROUTING_CASES_DEV_V3, ROUTING_CASES_HELDOUT_V3 } from "./dataset-v3";
import { ROUTING_CASES_DEV_V4, ROUTING_CASES_HELDOUT_V4 } from "./dataset-v4";
import {
  AGENTS, CATEGORIES, DEFAULT_TARGET, MAX_QUESTION_CHARS, QUOTAS, ROUTING_QUESTION_CHARS, TAGS,
  type DatasetCheckOptions, type DatasetCheckResult, type DatasetItem, type DistributionTarget, type Finding,
} from "./annotation-schema";

export const THRESHOLDS = Object.freeze({
  dupJaccardError: 0.9, similarJaccardReview: 0.6, containmentReview: 0.85, containmentMinTokens: 4,
  benchErrorJaccard: 0.8, benchReviewJaccard: 0.5,
});

/** M7-P5A.3: invisible / format / control characters (zero-width, soft hyphen, bidi controls, BOM, C0/C1 controls). Ordinary space is NOT in the set. */
export const INVISIBLE_CHARS_RE = /[\u0000-\u001f\u2028\u2029\u007f-\u009f­͏؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿￹-￻]/;
/**
 * M7-P5A.3b: QUESTION variant. A decoded question MAY contain \t \n \r as INNER ordinary whitespace (a legitimately formatted question; the JSON
 * file still carries them ESCAPED, one object per physical line). Every other C0/C1 control and all format/invisible chars stay rejected.
 * U+2028 / U+2029 (line / paragraph separators) are rejected: some JSONL readers (Node readline) treat them as physical-line breaks.
 * Leading/trailing whitespace is still caught by the trim rule. author / id keep the STRICT INVISIBLE_CHARS_RE.
 */
export const QUESTION_INVISIBLE_CHARS_RE = new RegExp(INVISIBLE_CHARS_RE.source.replace("\\u0000-\\u001f", "\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f"));
/** Format characters with no visible glyph: removed (joined) before folding. C0/C1 controls fall through to the non-alnum -> space step. */
const FORMAT_CHARS_RE = /[­͏؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿￹-￻]/g;

/** Canonical writer key (M7-P5A.3): NFKC, trim, case-fold, collapse inner whitespace. Used ONLY for counting; stored text is never rewritten. */
export function canonicalWriterKey(author: string): string {
  return author.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeForCompare(q: string): string {
  // comparison-only representation: invisible format chars are stripped BEFORE folding so they cannot split tokens
  return foldVi(q.replace(FORMAT_CHARS_RE, "")).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
const tokenSet = (norm: string): Set<string> => new Set(norm.length ? norm.split(" ") : []);
function overlap(a: Set<string>, b: Set<string>): { jaccard: number; containment: number; minSize: number } {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const t of s) if (l.has(t)) inter++;
  const union = a.size + b.size - inter;
  return { jaccard: union === 0 ? 0 : inter / union, containment: s.size === 0 ? 0 : inter / s.size, minSize: s.size };
}
const r2 = (x: number) => Math.round(x * 1000) / 1000;

interface BenchEntry { set: string; id: string; norm: string; toks: Set<string> }
let benchCache: BenchEntry[] | null = null;
function benchmarkIndex(): BenchEntry[] {
  if (benchCache) return benchCache;
  const sets: Array<[string, readonly { id: string; q: string }[]]> = [
    ["V1", ROUTING_CASES_V1], ["DEV", ROUTING_CASES_DEV], ["HELDOUT_V2", ROUTING_CASES_HELDOUT_V2],
    ["DEV_V3", ROUTING_CASES_DEV_V3], ["HELDOUT_V3", ROUTING_CASES_HELDOUT_V3],
    ["DEV_V4", ROUTING_CASES_DEV_V4], ["HELDOUT_V4", ROUTING_CASES_HELDOUT_V4],
  ];
  const out: BenchEntry[] = [];
  for (const [set, cases] of sets) for (const c of cases) { const norm = normalizeForCompare(c.q); out.push({ set, id: c.id, norm, toks: tokenSet(norm) }); }
  return (benchCache = out);
}

export function runDatasetChecks(items: readonly DatasetItem[], opts: DatasetCheckOptions = {}): DatasetCheckResult {
  const errors: Finding[] = [];
  const reviews: Finding[] = [];
  const err = (it: DatasetItem | null, code: string, detail: string) => errors.push({ line: it?.line ?? 0, id: it?.id ?? null, code, detail });
  const rev = (it: DatasetItem | null, code: string, detail: string) => reviews.push({ line: it?.line ?? 0, id: it?.id ?? null, code, detail });

  const norms = items.map((it) => normalizeForCompare(it.question));
  const toks = norms.map(tokenSet);

  // length
  for (const it of items) {
    const len = it.question.length;
    // M7-P5A.1 policy (Q4): an over-limit question is a VALIDATION case (tag over_request_limit, never routing-scored);
    // untagged it is an error, and the tag on a valid-length question is an error too
    const overTag = it.tags.includes("over_request_limit");
    if (len > MAX_QUESTION_CHARS) { if (!overTag) err(it, "QUESTION_TOO_LONG", `question has ${len} chars (> ${MAX_QUESTION_CHARS}); the endpoint refuses it — tag over_request_limit if it is an intended validation case`); }
    else if (overTag) err(it, "TAG_LENGTH_MISMATCH", `tag over_request_limit on a question of ${len} chars (≤ ${MAX_QUESTION_CHARS})`);
    // m7-p5a2 (Q6): long_question means exactly ROUTING_QUESTION_CHARS < length ≤ MAX_QUESTION_CHARS
    if (it.tags.includes("long_question") && (len <= ROUTING_QUESTION_CHARS || len > MAX_QUESTION_CHARS)) err(it, "TAG_LENGTH_MISMATCH", `tag long_question on a question of ${len} chars (must be ${ROUTING_QUESTION_CHARS + 1}–${MAX_QUESTION_CHARS})`);
    if (len > MAX_QUESTION_CHARS) continue;
    if (len > ROUTING_QUESTION_CHARS) {
      if (it.tags.includes("long_question")) rev(it, "LONG_QUESTION_REVIEW", `question has ${len} chars (> ${ROUTING_QUESTION_CHARS}); the routing model only sees the first ${ROUTING_QUESTION_CHARS}; a special-length case, never routing-scored (Q6)`);
      else err(it, "QUESTION_OVER_ROUTING_LIMIT", `question has ${len} chars (> ${ROUTING_QUESTION_CHARS}) and is not tagged long_question`);
    }
  }
  // m7-p5a2 (Q6): owner caps on special-length cases (always enforced, also without distribution checks)
  const tagged = (t: string) => items.filter((it) => it.tags.includes(t));
  const longTagged = tagged("long_question"), overTagged = tagged("over_request_limit");
  for (const it of longTagged.slice(QUOTAS.longQuestionMax)) err(it, "QUOTA_LONG_QUESTION", `more than ${QUOTAS.longQuestionMax} long_question cases (Q6); this row is over the cap`);
  for (const it of overTagged.slice(QUOTAS.overRequestLimitMax)) err(it, "QUOTA_OVER_REQUEST_LIMIT", `more than ${QUOTAS.overRequestLimitMax} over_request_limit cases (Q6); this row is over the cap`);

  // within-dataset similarity
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const pair = `${a.id} (line ${a.line}) vs ${b.id} (line ${b.line})`;
      if (norms[i] === norms[j]) { err(b, "DUPLICATE_QUESTION", `${pair}: identical after normalization`); continue; }
      const o = overlap(toks[i], toks[j]);
      if (o.jaccard >= THRESHOLDS.dupJaccardError) err(b, "NEAR_DUPLICATE_QUESTION", `${pair}: jaccard ${r2(o.jaccard)}`);
      else if (o.jaccard >= THRESHOLDS.similarJaccardReview || (o.minSize >= THRESHOLDS.containmentMinTokens && o.containment >= THRESHOLDS.containmentReview)) {
        rev(b, "SIMILAR_QUESTION_REVIEW", `${pair}: jaccard ${r2(o.jaccard)}, containment ${r2(o.containment)}`);
      }
    }
  }

  // benchmark overlap
  if (opts.checkBenchmarkOverlap !== false) {
    const bench = benchmarkIndex();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      for (const b of bench) {
        if (norms[i] === b.norm) { err(it, "BENCHMARK_OVERLAP", `${b.set}: identical to benchmark case ${b.id}`); continue; }
        const o = overlap(toks[i], b.toks);
        if (o.jaccard >= THRESHOLDS.benchErrorJaccard) err(it, "BENCHMARK_OVERLAP", `${b.set}: benchmark case ${b.id}, jaccard ${r2(o.jaccard)}`);
        else if (o.jaccard >= THRESHOLDS.benchReviewJaccard || (o.minSize >= THRESHOLDS.containmentMinTokens && o.containment >= THRESHOLDS.containmentReview)) {
          rev(it, "BENCHMARK_SIMILAR_REVIEW", `${b.set}: benchmark case ${b.id}, jaccard ${r2(o.jaccard)}, containment ${r2(o.containment)}`);
        }
      }
    }
  }

  // stats
  const n = items.length;
  // Map-based tallies: user-supplied strings (tags, authors) such as "__proto__" must never hit an object prototype
  const count = <K extends string>(keys: readonly K[], f: (it: DatasetItem) => K | null): Record<string, number> => {
    const m = new Map<string, number>(keys.map((k) => [k, 0]));
    for (const it of items) { const k = f(it); if (k !== null) m.set(k, (m.get(k) ?? 0) + 1); }
    return Object.fromEntries(m);
  };
  const categories = count(CATEGORIES, (it) => it.category);
  const tagMap = new Map<string, number>(TAGS.map((t) => [t, 0]));
  const authorMap = new Map<string, number>();
  for (const it of items) {
    for (const t of new Set(it.tags)) tagMap.set(t, (tagMap.get(t) ?? 0) + 1);
    const key = canonicalWriterKey(it.author);
    authorMap.set(key, (authorMap.get(key) ?? 0) + 1);
  }
  const tags: Record<string, number> = Object.fromEntries(tagMap);
  const authors: Record<string, number> = Object.fromEntries(authorMap);
  const singles = items.filter((it) => it.category === "SINGLE");
  const singleDomainCounts = count(AGENTS, (it) => (it.category === "SINGLE" ? it.primaryAgent : null));
  const pct = (x: number, d: number) => (d === 0 ? 0 : (x * 100) / d);
  const singleDomainPct = Object.fromEntries(AGENTS.map((a) => [a, r2(pct(singleDomainCounts[a], singles.length))]));
  const unaccented = items.filter((it) => it.accented === false).length;

  // distribution
  if (opts.checkDistribution !== false) {
    const t: DistributionTarget = { ...DEFAULT_TARGET, ...opts.target, categoryPct: { ...DEFAULT_TARGET.categoryPct, ...opts.target?.categoryPct } };
    if (n < t.minCases) err(null, "DISTRIBUTION_SIZE", `${n} cases < required ${t.minCases}`);
    for (const c of CATEGORIES) {
      const share = pct(categories[c], n), target = t.categoryPct[c];
      if (Math.abs(share - target) > t.tolerancePts) err(null, "DISTRIBUTION_CATEGORY", `${c}: ${r2(share)}% (${categories[c]}/${n}) outside target ${target}% +/- ${t.tolerancePts} pts`);
    }
    const share = (x: number) => r2(pct(x, n));
    if (pct(unaccented, n) < t.minUnaccentedPct) err(null, "DISTRIBUTION_UNACCENTED", `unaccented ${share(unaccented)}% (${unaccented}/${n}) < ${t.minUnaccentedPct}%`);
    if (pct(tags.multi_clause, n) < t.minMultiClausePct) err(null, "DISTRIBUTION_MULTI_CLAUSE", `multi_clause ${share(tags.multi_clause)}% (${tags.multi_clause}/${n}) < ${t.minMultiClausePct}%`);
    if (pct(tags.no_keyword, n) < t.minNoKeywordPct) err(null, "DISTRIBUTION_NO_KEYWORD", `no_keyword ${share(tags.no_keyword)}% (${tags.no_keyword}/${n}) < ${t.minNoKeywordPct}%`);
    if (tags.minor < t.minMinor) err(null, "DISTRIBUTION_MINOR", `minor cases ${tags.minor} < ${t.minMinor}`);
    if (tags.prompt_injection < t.minInjection) err(null, "DISTRIBUTION_INJECTION", `prompt_injection cases ${tags.prompt_injection} < ${t.minInjection}`);
    if (tags.high_risk < t.minHighRisk) err(null, "DISTRIBUTION_HIGH_RISK", `high_risk cases ${tags.high_risk} < ${t.minHighRisk}`);
    // only cases that can reach the SG2 safety gate count as its evidence (over-limit questions are validation cases)
    const safetyBlock = items.filter((it) => it.expectedPreRouting === "SAFETY_BLOCK" && it.question.length <= MAX_QUESTION_CHARS).length;
    if (safetyBlock < t.minSafetyBlock) err(null, "DISTRIBUTION_SAFETY_BLOCK", `expected SAFETY_BLOCK cases ${safetyBlock} < ${t.minSafetyBlock} (the SG2 hard gate needs evidence)`);
    for (const a of AGENTS) {
      const p = pct(singleDomainCounts[a], singles.length);
      if (p < t.minSingleDomainPct) err(null, "DISTRIBUTION_SINGLE_DOMAIN", `${a} is primary of ${r2(p)}% of SINGLE cases (${singleDomainCounts[a]}/${singles.length}) < ${t.minSingleDomainPct}%`);
    }
    if (authorMap.size < t.minAuthors) err(null, "DISTRIBUTION_AUTHORS", `${authorMap.size} distinct authors < ${t.minAuthors}`);
    for (const [name, c] of authorMap) {
      const p = pct(c, n);
      if (p > t.maxAuthorPct) err(null, "DISTRIBUTION_AUTHOR_SHARE", `author ${name} wrote ${r2(p)}% (${c}/${n}) > ${t.maxAuthorPct}%`);
    }
  }

  const tally = (fs: Finding[]) => { const m: Record<string, number> = {}; for (const f of fs) m[f.code] = (m[f.code] ?? 0) + 1; return m; };
  return {
    errors, reviews,
    stats: {
      cases: n, categories, tags, authors, unaccented, singleDomainCounts, singleDomainPct,
      quotas: { longQuestion: longTagged.length, overRequestLimit: overTagged.length },
      errorCount: errors.length, reviewCount: reviews.length, errorsByCode: tally(errors), reviewsByCode: tally(reviews),
    },
  };
}
