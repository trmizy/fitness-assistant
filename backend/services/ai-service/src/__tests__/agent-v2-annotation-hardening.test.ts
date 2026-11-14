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
    schemaVersion: "m7-p5a2", id, question, accented: /[̀-ͯ]|đ|Đ/.test(question.normalize("NFD")), tags: [],
    source: { kind: "synthetic", author, note: "TEST FIXTURE — not evaluation data" },
    annotatorA: { annotatorId: "A01", rationale: "TEST FIXTURE annotator rationale", ...TRAIN }, annotatorB: { annotatorId: "B02", rationale: "TEST FIXTURE annotator rationale", ...TRAIN },
    adjudication: { needed: false }, final: TRAIN, rationale: "TEST FIXTURE rationale", rationaleBy: "ADJ01", routingScored: true, ...over,
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


// ── M7-P5A.3b: inner tab / newline in a decoded question ─────────────────────────────────────────────────────────────────
// mk() + JSON.stringify ESCAPES the control characters, so the file keeps one JSON object per physical line.
const hasCode = (text: string, c: string) => codes(text).includes(c);
test("P5A.3b escaped \\n, \\t and \\r\\n inside a question are decoded and accepted (row otherwise valid)", () => {
  for (const q of ["Sau buổi tập lưng,\nngày mai nên nghỉ không?", "Sau buổi tập lưng,\tngày mai nên nghỉ không?", "Sau buổi tập lưng,\r\nngày mai nên nghỉ không?"]) {
    const text = lines(mk("N-1", q));
    assert.ok(!text.includes("\n") && !text.includes("\t") && !text.includes("\r"), "file text has them escaped");
    const r = validateRoutingAnnotations(text, NO_DIST);
    assert.equal(r.errors.length, 0, JSON.stringify(q) + " " + JSON.stringify(r.errors));
    assert.equal(r.stats.totalLines, 1);
  }
});
test("P5A.3b CRLF-terminated file with escaped inner newline still works", () => {
  const text = [mk("N-1", "Câu một,\nngày hai"), mk("N-2", Q(1))].map((r) => JSON.stringify(r)).join("\r\n") + "\r\n";
  const r = validateRoutingAnnotations(text, NO_DIST);
  assert.equal(r.stats.totalLines, 2);
  assert.ok(!r.errors.some((e) => e.code === "MALFORMED_JSON" || e.code === "QUESTION_INVISIBLE_CHARS"));
});
test("P5A.3b RAW newline inside a JSON string splits the row: both fragments MALFORMED_JSON, nothing accepted, nothing joined", () => {
  const raw = JSON.stringify(mk("N-1", "Sau buổi tập lưng,|ngày mai nên nghỉ không?")).replace("|", "\n");
  const r = validateRoutingAnnotations(raw, NO_DIST);
  assert.equal(r.errors.filter((e) => e.code === "MALFORMED_JSON").length, 2);
  assert.equal(r.items?.length ?? 0, 0);
  assert.ok(!r.errors.some((e) => e.code === "QUESTION_INVISIBLE_CHARS"));
});
test("P5A.3b RAW tab inside a JSON string is invalid JSON (MALFORMED_JSON), not repaired", () => {
  const raw = JSON.stringify(mk("N-1", "Sau buổi tập lưng,|ngày mai nên nghỉ không?")).replace("|", "\t");
  const r = validateRoutingAnnotations(raw, NO_DIST);
  assert.deepEqual(r.errors.map((e) => e.code), ["MALFORMED_JSON"]);
});
test("P5A.3b leading / trailing \\n and \\t are still rejected by the trim rule", () => {
  for (const q of ["\nCâu hỏi thử", "Câu hỏi thử\n", "\tCâu hỏi thử", "Câu hỏi thử\t", "Câu hỏi thử\r\n"]) {
    assert.ok(hasCode(lines(mk("N-1", q)), "QUESTION_NOT_TRIMMED"), JSON.stringify(q));
  }
});
test("P5A.3b U+2028 / U+2029 in a question are rejected (physical-line breaks for some JSONL readers)", () => {
  for (const ch of [" ", " "]) assert.ok(hasCode(lines(mk("N-1", `Câu hỏi${ch}thử nghiệm`)), "QUESTION_INVISIBLE_CHARS"), ch.charCodeAt(0).toString(16));
});
test("P5A.3b other controls / format chars are still rejected in a question", () => {
  for (const ch of ["​", "­", "\u0000", "\u0007", "\u000b", "\u000c", "\u001f", "\u007f", "\u0085"]) {
    assert.ok(hasCode(lines(mk("N-1", `Câu hỏi${ch}thử nghiệm`)), "QUESTION_INVISIBLE_CHARS"), ch.charCodeAt(0).toString(16));
  }
});
test("P5A.3b author / id stay STRICT: tab, newline, CR (and U+2028) are rejected", () => {
  for (const ch of ["\t", "\n", "\r", " "]) {
    assert.ok(hasCode(lines(mk("N-1", Q(0), `writer${ch}01`)), "AUTHOR_NOT_CANONICAL"), "author " + ch.charCodeAt(0));
    if (ch !== " ") assert.ok(hasCode(lines(mk(`N-1${ch}`, Q(0))), "ID_NOT_TRIMMED"), "id trailing " + ch.charCodeAt(0)); // id rule at HEAD = trim only; inner id controls are not validated (unchanged)
  }
});
test("P5A.3b benchmark question with a newline replacing a space is still BENCHMARK_OVERLAP (and accepted by the char rule)", () => {
  const nl = T01.replace(" ", "\n");
  assert.notEqual(nl, T01);
  const c = codes(lines(mk("N-1", nl)));
  assert.ok(c.includes("BENCHMARK_OVERLAP"));
  assert.ok(!c.includes("QUESTION_INVISIBLE_CHARS"));
});
test("P5A.3b normalizeForCompare treats \\n \\t \\r as whitespace; format chars still stripped first", () => {
  assert.equal(normalizeForCompare("a\nb"), normalizeForCompare("a b"));
  assert.equal(normalizeForCompare("a\tb\r\nc"), "a b c");
  assert.equal(normalizeForCompare("a​b"), "ab");
});
test("P5A.3b length is measured on the decoded string (inner newline = 1 char; 2000 ok, 2001 QUESTION_TOO_LONG)", () => {
  const ok = "a\n".repeat(1000), over = "a\n".repeat(1000) + "b";
  assert.equal(ok.length, 2000);
  assert.ok(!runDatasetChecks([dsItem(ok)], { checkDistribution: false, checkBenchmarkOverlap: false }).errors.some((e) => e.code === "QUESTION_TOO_LONG"));
  assert.ok(runDatasetChecks([dsItem(over)], { checkDistribution: false, checkBenchmarkOverlap: false }).errors.some((e) => e.code === "QUESTION_TOO_LONG"));
});
