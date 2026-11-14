import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRoutingAnnotations } from "./m7-benchmark/annotation-validator";
import { runDatasetChecks, normalizeForCompare, canonicalWriterKey } from "./m7-benchmark/annotation-dataset-checks";
import { findDuplicateKeys } from "./m7-benchmark/annotation-json";
import type { CaseLabel } from "./m7-benchmark/annotation-schema";

// M7-P5A.3 hardening regressions. TEST FIXTURE only: synthetic rows, no real labels.
const NO_DIST = { checkDistribution: false, checkBenchmarkOverlap: true } as const;
const TRAIN: CaseLabel = { domains: [{ agent: "training", role: "request" }], primaryAgent: "training", category: "SINGLE", safety: "NONE", expectedPreRouting: "ALLOW" };
type Obj = Record<string, any>;
function mk(id: string, question: string, author = "F-author-1", over: Obj = {}): Obj {
  return {
    schemaVersion: "m7-p5a1", id, question, accented: /[̀-ͯ]|đ|Đ/.test(question.normalize("NFD")), tags: [],
    source: { kind: "synthetic", author, note: "TEST FIXTURE — not evaluation data" },
    annotatorA: { annotatorId: "A01", ...TRAIN }, annotatorB: { annotatorId: "B02", ...TRAIN },
    adjudication: { needed: false }, final: TRAIN, rationale: "TEST FIXTURE rationale", routingScored: true, ...over,
  };
}
const lines = (...rows: Array<Obj | string>) => rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n");
const codes = (text: string, opts: Parameters<typeof validateRoutingAnnotations>[1] = NO_DIST) => validateRoutingAnnotations(text, opts).errors.map((e) => e.code);
const Q = (n: number) => `Câu hỏi thử nghiệm riêng biệt số ${["một", "hai", "ba", "bốn", "năm"][n]} về chuyện hoàn toàn khác biệt ${n * 7919}`;
const dsItem = (question: string, over: Obj = {}) => ({ line: 1, id: "X", question, accented: true, tags: [], category: "SINGLE", safety: "NONE", primaryAgent: "training", author: "a", expectedPreRouting: "ALLOW", ...over }) as any;

// ── 1. writer identity ────────────────────────────────────────────────────────────────────────────────────────────────
test("H1 writer identity variants collapse to one canonical writer (>=3 writers check cannot be bypassed)", () => {
  const text = lines(mk("W-1", Q(0), "Writer-01"), mk("W-2", Q(1), "writer-01"), mk("W-3", Q(2), "WRITER-01"));
  const r = validateRoutingAnnotations(text, { checkDistribution: true, checkBenchmarkOverlap: false });
  assert.deepEqual(Object.keys(r.stats.dataset.authors as object), ["writer-01"]);
  assert.ok(r.errors.some((e) => e.code === "DISTRIBUTION_AUTHORS"), "1 distinct writer < 3");
  assert.ok(r.errors.some((e) => e.code === "DISTRIBUTION_AUTHOR_SHARE"), "100% share > 40%");
});
test("H1 canonicalWriterKey: NFKC, case-fold, trim, inner whitespace", () => {
  assert.equal(canonicalWriterKey("  Ｗriter   01 "), "writer 01");
  assert.equal(canonicalWriterKey("writer 01"), canonicalWriterKey("WRITER\t01"));
});
test("H1 non-canonical author (untrimmed / non-NFC / invisible chars) is rejected AUTHOR_NOT_CANONICAL, data never rewritten", () => {
  for (const a of [" writer-01 ", "writer-01​", "wri­ter-01", "Nguyên", "writer\u0000"]) {
    const r = validateRoutingAnnotations(lines(mk("A-1", Q(0), a)), NO_DIST);
    assert.ok(r.errors.some((e) => e.code === "AUTHOR_NOT_CANONICAL"), JSON.stringify(a));
    assert.equal(r.items[0].author, a, "stored value untouched");
  }
  assert.ok(!codes(lines(mk("A-2", Q(0), "Writer-01"))).includes("AUTHOR_NOT_CANONICAL"));
});

// ── 2. prototype-key hazards ─────────────────────────────────────────────────────────────────────────────────────────
test("H2 an author literally named __proto__ is counted and subject to the 40% cap", () => {
  const text = lines(mk("P-1", Q(0), "__proto__"), mk("P-2", Q(1), "__proto__"), mk("P-3", Q(2), "other-writer"));
  const r = validateRoutingAnnotations(text, { checkDistribution: true, checkBenchmarkOverlap: false });
  const authors = r.stats.dataset.authors as Record<string, number>;
  assert.equal(Object.prototype.hasOwnProperty.call(authors, "__proto__"), true);
  assert.equal(authors["__proto__"], 2);
  assert.ok(r.errors.some((e) => e.code === "DISTRIBUTION_AUTHOR_SHARE" && e.detail.includes("__proto__")));
  assert.equal(({} as Obj).polluted, undefined);
});
test("H2 tag counting does not touch prototypes for odd tag names (direct dataset call)", () => {
  const res = runDatasetChecks([dsItem(Q(0), { tags: ["__proto__", "constructor"] })], { checkDistribution: false, checkBenchmarkOverlap: false });
  assert.equal(Object.prototype.hasOwnProperty.call(res.stats.tags, "__proto__"), true);
  assert.equal((res.stats.tags as Obj)["__proto__"], 1);
});

// ── 3. invisible characters ──────────────────────────────────────────────────────────────────────────────────────────
const T01 = "Hôm nay mình tập gì vậy?";
const T01_ZW = [..."Hôm nay mình tập gì vậy?"].join("​");
test("H3 T01 zero-width obfuscation: normalizeForCompare equals the plain question", () => {
  assert.equal(normalizeForCompare(T01_ZW), normalizeForCompare(T01));
});
test("H3 T01 obfuscated question is rejected (invisible chars) AND still flagged BENCHMARK_OVERLAP like the plain one", () => {
  const plain = codes(lines(mk("O-1", T01)));
  const obf = codes(lines(mk("O-1", T01_ZW)));
  assert.ok(plain.includes("BENCHMARK_OVERLAP"));
  assert.ok(obf.includes("QUESTION_INVISIBLE_CHARS"));
  assert.ok(obf.includes("BENCHMARK_OVERLAP"));
});
test("H3 overlap is detected even without the validator check (dataset checks alone)", () => {
  const res = runDatasetChecks([dsItem(T01_ZW)], { checkDistribution: false });
  assert.ok(res.errors.some((e) => e.code === "BENCHMARK_OVERLAP"));
});
test("H3 each invisible class is rejected; ordinary space is fine", () => {
  for (const ch of ["​", "‌", "‍", "‎", "⁠", "﻿", "­", "‮", "⁦", "\u0007", "\u0085"]) {
    assert.ok(codes(lines(mk("I-1", `Câu hỏi riêng biệt ${ch}số một 12345`))).includes("QUESTION_INVISIBLE_CHARS"), JSON.stringify(ch));
  }
  assert.ok(!codes(lines(mk("I-2", Q(0)))).includes("QUESTION_INVISIBLE_CHARS"));
});

// ── 4. deep nesting ──────────────────────────────────────────────────────────────────────────────────────────────────
test("H4 100000-deep nesting: no throw, JSON_TOO_DEEP for that row, other rows still validated", () => {
  const deep = '{"x":' + "[".repeat(100000) + "0" + "]".repeat(100000) + "}";
  const deepObj = '{"a":'.repeat(100000) + "0" + "}".repeat(100000);
  const good = mk("D-1", Q(0));
  const bad = mk("D-2", Q(1), "F-author-1", { schemaVersion: "nope" });
  for (const d of [deep, deepObj]) {
    const r = validateRoutingAnnotations(lines(good, d, bad), NO_DIST);
    assert.deepEqual(r.errors.filter((e) => e.line === 2).map((e) => e.code), ["JSON_TOO_DEEP"]);
    assert.ok(r.errors.some((e) => e.line === 3 && e.code === "SCHEMA_VERSION"));
    assert.equal(r.errors.filter((e) => e.line === 1).length, 0);
  }
});
test("H4 findDuplicateKeys reports tooDeep at 65 levels, not at 64, and never throws", () => {
  assert.equal(findDuplicateKeys("[".repeat(65) + "]".repeat(65)).tooDeep, true);
  assert.equal(findDuplicateKeys("[".repeat(64) + "]".repeat(64)).tooDeep, undefined);
  assert.doesNotThrow(() => findDuplicateKeys("[".repeat(500000)));
});
test("H4 validateRoutingAnnotations never throws on odd input", () => {
  for (const t of ["", "\n\n", "[", "{", '{"a":', "null", "[[[[[[", "\u0000", '{"a":1,"a":2}']) assert.doesNotThrow(() => validateRoutingAnnotations(t, NO_DIST));
});

// ── 5. row ids ───────────────────────────────────────────────────────────────────────────────────────────────────────
test("H5 untrimmed id rejected; case-variant duplicate ids rejected", () => {
  assert.ok(codes(lines(mk(" X-1", Q(0)))).includes("ID_NOT_TRIMMED"));
  assert.ok(!codes(lines(mk("X-1", Q(0)))).includes("ID_NOT_TRIMMED"));
  const r = validateRoutingAnnotations(lines(mk("X-1", Q(0)), mk("x-1", Q(1))), NO_DIST);
  assert.ok(r.errors.some((e) => e.code === "DUPLICATE_ID" && e.line === 2));
  assert.ok(codes(lines(mk("X-1", Q(0)), mk("X-1 ", Q(1)))).includes("DUPLICATE_ID"));
});
