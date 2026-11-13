import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateRoutingAnnotations, type AnnotationError } from "./m7-benchmark/annotation-validator";
import { ROUTING_CASES_V1 } from "./m5-benchmark/dataset-v1";

// TEST FIXTURE only: invented sentences, no real labels, no dataset.
const FIX = path.join(__dirname, "m7-benchmark", "annotation-fixtures");
const invalidText = fs.readFileSync(path.join(FIX, "synthetic-invalid.jsonl"), "utf8");
const validText = fs.readFileSync(path.join(FIX, "synthetic-valid-sample.jsonl"), "utf8");
const ROW = { checkDistribution: false, checkBenchmarkOverlap: true } as const;

const codesAt = (errs: AnnotationError[], line: number) => errs.filter((e) => e.line === line).map((e) => e.code);

function row(o: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "T-1", question: "Câu hỏi thử nghiệm số một về kỹ thuật gánh tạ?", accented: true, category: "SINGLE",
    requiredAgents: ["training"], primaryAgent: "training", acceptable: [["training"]], expectDeferred: [], safety: "NONE",
    rationale: "TEST FIXTURE rationale",
    annotatorA: { requiredAgents: ["training"], primaryAgent: "training" }, annotatorB: { requiredAgents: ["training"], primaryAgent: "training" },
    adjudication: { needed: false, decision: "", by: "" }, tags: [],
    source: { kind: "synthetic", author: "fixture-bot", note: "TEST FIXTURE — not evaluation data" }, ...o,
  });
}
const codesOf = (text: string, opts = ROW) => validateRoutingAnnotations(text, opts).errors.map((e) => e.code);

test("valid sample passes row-level checks", () => {
  const r = validateRoutingAnnotations(validText, ROW);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.stats.cases, 6);
});

test("a baseline inline row is valid", () => {
  assert.deepEqual(validateRoutingAnnotations(row(), ROW).errors, []);
});

test("invalid fixture: each error code fires on the expected line", () => {
  const { errors } = validateRoutingAnnotations(invalidText, ROW);
  const expect: Array<[number, string]> = [
    [1, "MALFORMED_JSON"], [3, "DUPLICATE_ID"], [4, "DUPLICATE_QUESTION"], [5, "NEAR_DUPLICATE_QUESTION"],
    [6, "INVALID_AGENT"], [7, "INVALID_PRIMARY"], [8, "MISSING_RATIONALE"], [8, "MISSING_ANNOTATOR"],
    [9, "ADJUDICATION_MISSING"], [10, "INVALID_ACCEPTABLE"], [11, "INVALID_DEFERRED"], [12, "CATEGORY_MISMATCH"],
    [13, "ACCENTED_MISMATCH"], [14, "INVALID_SOURCE"], [15, "INVALID_ACCEPTABLE"], [16, "AMBIGUOUS_UNJUSTIFIED"], [17, "INVALID_ENUM"],
  ];
  for (const [line, code] of expect) assert.ok(codesAt(errors, line).includes(code), `line ${line} should report ${code}; got ${codesAt(errors, line)}`);
  assert.deepEqual(codesAt(errors, 2), [], "first copy of the base row is clean");
});

test("inline: malformed json, non-object", () => {
  assert.deepEqual(codesOf("{oops"), ["MALFORMED_JSON"]);
  assert.deepEqual(codesOf("[1,2]"), ["NOT_OBJECT"]);
});

test("inline: invalid agent ids anywhere", () => {
  assert.ok(codesOf(row({ expectDeferred: ["gym"] })).includes("INVALID_AGENT"));
  assert.ok(codesOf(row({ acceptable: [["gym"]] })).includes("INVALID_AGENT"));
  assert.ok(codesOf(row({ annotatorA: { requiredAgents: ["gym"], primaryAgent: "training" } })).includes("INVALID_AGENT"));
  assert.ok(codesOf(row({ annotatorB: { requiredAgents: ["training"], primaryAgent: "gym" } })).includes("INVALID_AGENT"));
  assert.ok(codesOf(row({ primaryAgent: "gym" })).includes("INVALID_AGENT"));
});

test("inline: primaryAgent null only when requiredAgents empty", () => {
  assert.ok(codesOf(row({ primaryAgent: null })).includes("INVALID_PRIMARY"));
  assert.ok(codesOf(row({ category: "OOS", requiredAgents: [], primaryAgent: "training", acceptable: [[]] })).includes("INVALID_PRIMARY"));
});

test("inline: acceptable rules (size, subset, OOS shape, >=3 first-two)", () => {
  assert.ok(codesOf(row({ category: "TWO", requiredAgents: ["training", "recovery"], acceptable: [["training", "recovery", "nutrition"]] })).includes("INVALID_ACCEPTABLE"));
  assert.ok(codesOf(row({ acceptable: [["nutrition"]] })).includes("INVALID_ACCEPTABLE"));
  assert.ok(codesOf(row({ acceptable: [["training"], []] })).includes("INVALID_ACCEPTABLE"));
  assert.ok(codesOf(row({ category: "OOS", requiredAgents: [], primaryAgent: null, acceptable: [] })).includes("INVALID_ACCEPTABLE"));
  const multi = { category: "MULTI", requiredAgents: ["training", "nutrition", "progress"], expectDeferred: ["progress"] };
  assert.ok(codesOf(row({ ...multi, acceptable: [["training", "progress"]] })).includes("INVALID_ACCEPTABLE"));
  assert.ok(!codesOf(row({ ...multi, acceptable: [["nutrition", "training"]] })).includes("INVALID_ACCEPTABLE"));
});

test("inline: deferred consistency and overlap", () => {
  const multi = { category: "MULTI", requiredAgents: ["training", "nutrition", "recovery", "progress"], acceptable: [["training", "nutrition"]] };
  assert.ok(codesOf(row({ ...multi, expectDeferred: ["recovery"] })).includes("INVALID_DEFERRED"));
  assert.ok(!codesOf(row({ ...multi, expectDeferred: ["recovery", "progress"] })).includes("INVALID_DEFERRED"));
  assert.ok(codesOf(row({ expectDeferred: ["training"] })).includes("INVALID_DEFERRED"));
});

test("inline: category consistency", () => {
  assert.ok(codesOf(row({ category: "TWO" })).includes("CATEGORY_MISMATCH"));
  assert.ok(codesOf(row({ category: "OOS" })).includes("CATEGORY_MISMATCH"));
  assert.ok(codesOf(row({ category: "MULTI" })).includes("CATEGORY_MISMATCH"));
  assert.ok(codesOf(row({ category: "AMBIGUOUS", rationale: "", tags: [] })).includes("AMBIGUOUS_UNJUSTIFIED"));
});

test("inline: rationale / annotators / adjudication / source / accented", () => {
  assert.ok(codesOf(row({ rationale: "  " })).includes("MISSING_RATIONALE"));
  assert.ok(codesOf(row({ annotatorA: undefined })).includes("MISSING_ANNOTATOR"));
  const disagree = { annotatorB: { requiredAgents: ["training"], primaryAgent: null } };
  assert.ok(codesOf(row(disagree)).includes("ADJUDICATION_MISSING"));
  assert.ok(!codesOf(row({ ...disagree, adjudication: { needed: true, decision: "training", by: "adj" } })).includes("ADJUDICATION_MISSING"));
  assert.ok(codesOf(row({ adjudication: undefined, ...disagree })).includes("ADJUDICATION_MISSING"));
  assert.ok(codesOf(row({ source: { kind: "scraped", author: "a", note: "n" } })).includes("INVALID_SOURCE"));
  assert.ok(codesOf(row({ source: { kind: "synthetic", author: "", note: "n" } })).includes("INVALID_SOURCE"));
  assert.ok(codesOf(row({ accented: false })).includes("ACCENTED_MISMATCH"));
});

test("inline: duplicate id / duplicate / near-duplicate question", () => {
  const a = row({ id: "D-1", question: "Mình nên ngủ bao nhiêu tiếng mỗi đêm để cơ bắp phục hồi tốt?" });
  assert.ok(codesOf(`${a}\n${a}`).includes("DUPLICATE_ID"));
  assert.ok(codesOf(`${a}\n${row({ id: "D-2", question: "mình nên ngủ bao nhiêu tiếng mỗi đêm để cơ bắp phục hồi tốt" })}`).includes("DUPLICATE_QUESTION"));
  assert.ok(codesOf(`${a}\n${row({ id: "D-3", question: "Mình nên ngủ bao nhiêu tiếng mỗi đêm để cơ bắp phục hồi tốt nhỉ?" })}`).includes("NEAR_DUPLICATE_QUESTION"));
  assert.ok(!codesOf(`${a}\n${row({ id: "D-4", question: "Tuần này mình có nên thử tập nhảy dây thay cho chạy bộ buổi sáng?" })}`).includes("NEAR_DUPLICATE_QUESTION"));
});

test("benchmark overlap with v1 is detected (exact and near)", () => {
  const q = ROUTING_CASES_V1[0].q;
  const acc = /[̀-ͯ]|đ/.test(q.normalize("NFD"));
  const exact = validateRoutingAnnotations(row({ question: q, accented: acc }), ROW).errors.filter((e) => e.code === "BENCHMARK_OVERLAP");
  assert.ok(exact.some((e) => e.detail.startsWith("V1:")), JSON.stringify(exact));
  const off = validateRoutingAnnotations(row({ question: q, accented: acc }), { ...ROW, checkBenchmarkOverlap: false });
  assert.ok(!off.errors.some((e) => e.code === "BENCHMARK_OVERLAP"));
});

test("distribution checks fire on a too-small file", () => {
  const r = validateRoutingAnnotations(validText);
  const codes = new Set(r.errors.map((e) => e.code));
  for (const c of ["DISTRIBUTION_SIZE", "DISTRIBUTION_CATEGORY", "DISTRIBUTION_UNACCENTED", "DISTRIBUTION_MULTI_CLAUSE", "DISTRIBUTION_NO_KEYWORD", "DISTRIBUTION_MINOR", "DISTRIBUTION_INJECTION"]) {
    assert.ok(codes.has(c), `${c} expected, got ${[...codes]}`);
  }
  assert.equal(r.ok, false);
  // a custom, satisfiable target passes
  const ok = validateRoutingAnnotations(row(), { target: { minCases: 1, categoryPct: { SINGLE: 100, TWO: 0, MULTI: 0, OOS: 0, AMBIGUOUS: 0 }, minUnaccentedPct: 0, minMultiClausePct: 0, minNoKeywordPct: 0, minMinor: 0, minInjection: 0 } });
  assert.deepEqual(ok.errors, []);
});

test("validator never mutates or repairs its input", () => {
  const before = invalidText;
  const frozen = `${before}`;
  validateRoutingAnnotations(before);
  assert.equal(before, frozen);
  assert.equal(fs.readFileSync(path.join(FIX, "synthetic-invalid.jsonl"), "utf8"), frozen);
  const r1 = validateRoutingAnnotations(invalidText, ROW);
  const r2 = validateRoutingAnnotations(invalidText, ROW);
  assert.deepEqual(r1, r2);
});
