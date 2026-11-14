import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runDatasetChecks } from "./m7-benchmark/annotation-dataset-checks";
import { AGENTS, CATEGORIES, type Category, type DatasetItem } from "./m7-benchmark/annotation-schema";
import { ROUTING_CASES_V1 } from "./m5-benchmark/dataset-v1";

let lineNo = 0;
function item(question: string, over: Partial<DatasetItem> = {}): DatasetItem {
  lineNo += 1;
  return { line: lineNo, id: `T${lineNo}`, question, accented: true, tags: [], category: "SINGLE", safety: "NONE", primaryAgent: "training", author: "ann1", ...over };
}
const codes = (fs: { code: string }[]) => fs.map((f) => f.code);
const NOBENCH = { checkDistribution: false } as const;

describe("dataset checks: within-dataset similarity", () => {
  it("R7: tôi vs mình variant -> no error, a SIMILAR_QUESTION_REVIEW", () => {
    const r = runDatasetChecks([item("Hôm nay tôi nên tập gì?"), item("Hôm nay mình nên tập gì?")], NOBENCH);
    assert.deepEqual(r.errors, []);
    assert.ok(codes(r.reviews).includes("SIMILAR_QUESTION_REVIEW"), JSON.stringify(r.reviews));
  });
  it("clearly different questions -> neither error nor review", () => {
    const r = runDatasetChecks([item("Quasar zebra lumen pivot orchid"), item("Mango tundra whisper cobalt ember galaxy")], NOBENCH);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.reviews, []);
  });
  it("exact duplicate (even with accents/case/punctuation) -> DUPLICATE_QUESTION", () => {
    const r = runDatasetChecks([item("Tập chân hôm nay thế nào?"), item("tap chan hom nay the nao")], NOBENCH);
    assert.deepEqual(codes(r.errors), ["DUPLICATE_QUESTION"]);
  });
  it("strong near-duplicate (jaccard >= 0.9) -> NEAR_DUPLICATE_QUESTION", () => {
    const base = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const r = runDatasetChecks([item(base), item(base + " lambda")], NOBENCH);
    assert.deepEqual(codes(r.errors), ["NEAR_DUPLICATE_QUESTION"]);
  });
  it("containment >= 0.85 with >= 4 tokens -> review", () => {
    const r = runDatasetChecks([item("alpha beta gamma delta"), item("alpha beta gamma delta plus several other extra words here")], NOBENCH);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(codes(r.reviews), ["SIMILAR_QUESTION_REVIEW"]);
  });
  it("containment with < 4 tokens is not a review", () => {
    const r = runDatasetChecks([item("alpha beta gamma"), item("alpha beta gamma plus several other extra words here")], NOBENCH);
    assert.deepEqual(r.reviews, []);
  });
});

describe("dataset checks: benchmark overlap", () => {
  it("R8: N04 with tôi->mình -> ERROR BENCHMARK_OVERLAP naming V1 and N04", () => {
    const q = ROUTING_CASES_V1.find((c) => c.id === "N04")!.q.replace("tôi", "mình");
    const r = runDatasetChecks([item(q)], { checkDistribution: false });
    const hit = r.errors.find((e) => e.code === "BENCHMARK_OVERLAP" && e.detail.startsWith("V1") && e.detail.includes("N04"));
    assert.ok(hit, JSON.stringify(r.errors));
  });
  it("exact benchmark question -> ERROR", () => {
    const q = ROUTING_CASES_V1[0].q;
    const r = runDatasetChecks([item(q)], { checkDistribution: false });
    assert.ok(r.errors.some((e) => e.code === "BENCHMARK_OVERLAP" && e.detail.includes(ROUTING_CASES_V1[0].id)));
  });
  it("checkBenchmarkOverlap:false skips it", () => {
    const q = ROUTING_CASES_V1[0].q;
    const r = runDatasetChecks([item(q)], { checkDistribution: false, checkBenchmarkOverlap: false });
    assert.deepEqual(r.errors, []);
  });
  it("partially overlapping question -> BENCHMARK_SIMILAR_REVIEW (not error)", () => {
    const src = ROUTING_CASES_V1.find((c) => c.id === "N04")!;
    const toks = src.q.split(/\s+/);
    const q = toks.slice(0, Math.ceil(toks.length * 0.6)).join(" ");
    const r = runDatasetChecks([item(q)], { checkDistribution: false });
    assert.ok(!r.errors.some((e) => e.detail.startsWith("V1") && e.detail.includes("N04")), JSON.stringify(r.errors));
    assert.ok(r.reviews.some((e) => e.code === "BENCHMARK_SIMILAR_REVIEW" && e.detail.startsWith("V1") && e.detail.includes("N04")), JSON.stringify(r.reviews));
  });
});

describe("dataset checks: length", () => {
  const long = (n: number) => ("lorem ipsum dolor ".repeat(200)).slice(0, n);
  it("601 chars no tag -> QUESTION_OVER_ROUTING_LIMIT", () => {
    const r = runDatasetChecks([item(long(601))], { checkDistribution: false, checkBenchmarkOverlap: false });
    assert.deepEqual(codes(r.errors), ["QUESTION_OVER_ROUTING_LIMIT"]);
  });
  it("601 chars with long_question -> review only", () => {
    const r = runDatasetChecks([item(long(601), { tags: ["long_question"] })], { checkDistribution: false, checkBenchmarkOverlap: false });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(codes(r.reviews), ["LONG_QUESTION_REVIEW"]);
  });
  it("600 chars is fine; 2001 chars -> QUESTION_TOO_LONG (even tagged)", () => {
    assert.deepEqual(runDatasetChecks([item(long(600))], { checkDistribution: false, checkBenchmarkOverlap: false }).errors, []);
    const r = runDatasetChecks([item(long(2001), { tags: ["long_question"] })], { checkDistribution: false, checkBenchmarkOverlap: false });
    // CONTRACT CHANGE m7-p5a2 (owner decision Q6): long_question means 601–2000 chars, so the tag on a 2001-char question is also TAG_LENGTH_MISMATCH
    assert.deepEqual(codes(r.errors), ["QUESTION_TOO_LONG", "TAG_LENGTH_MISMATCH"]);
  });
});

/** Fully distinct synthetic questions: every question has its own unique tokens, so no similarity of any kind is possible. */
function balanced(n = 300): DatasetItem[] {
  const plan: Array<[Category, number]> = [["SINGLE", 0.35], ["TWO", 0.25], ["MULTI", 0.15], ["OOS", 0.1], ["AMBIGUOUS", 0.15]];
  const cats: Category[] = [];
  for (const [c, p] of plan) for (let k = 0; k < Math.round(n * p); k++) cats.push(c);
  const authors = ["ann1", "ann2", "ann3", "ann4"];
  let singleIdx = 0;
  return cats.map((category, i) => {
    const tags: string[] = [];
    if (i % 4 === 0) tags.push("multi_clause");
    if (i % 4 === 1) tags.push("no_keyword");
    if (i % 10 === 2) tags.push("minor");
    if (i % 10 === 3) tags.push("prompt_injection");
    if (i % 10 === 4) tags.push("high_risk");
    const primaryAgent = category === "SINGLE" ? AGENTS[singleIdx++ % 4] : null;
    const question = `zq${i}a zq${i}b zq${i}c zq${i}d zq${i}e zq${i}f`;
    // M7-P5A.1 policy: ≥ 20 expected SAFETY_BLOCK cases (the high_risk-tagged ones here) so the SG2 gate has evidence
    const expectedPreRouting = tags.includes("high_risk") ? "SAFETY_BLOCK" as const : "ALLOW" as const;
    return { line: i + 1, id: `B${i}`, question, accented: i % 3 !== 0, tags, category, safety: tags.includes("high_risk") ? "HIGH_RISK" as const : "NONE" as const, primaryAgent, author: authors[i % 4], expectedPreRouting };
  });
}

describe("dataset checks: distribution", () => {
  it("balanced synthetic set of 300 passes with no findings at all", () => {
    const items = balanced();
    assert.equal(items.length, 300);
    const r = runDatasetChecks(items);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.reviews, []);
    assert.equal((r.stats as { cases: number }).cases, 300);
  });
  it("every DISTRIBUTION_* code fires on a crafted small set", () => {
    const items = [
      item("alpha one", { category: "SINGLE", primaryAgent: "training", accented: true }),
      item("beta two", { category: "SINGLE", primaryAgent: "training", accented: true }),
      item("gamma three", { category: "SINGLE", primaryAgent: "training", accented: true }),
    ];
    const r = runDatasetChecks(items, { checkBenchmarkOverlap: false });
    const got = new Set(codes(r.errors));
    for (const c of ["DISTRIBUTION_SIZE", "DISTRIBUTION_CATEGORY", "DISTRIBUTION_UNACCENTED", "DISTRIBUTION_MULTI_CLAUSE", "DISTRIBUTION_NO_KEYWORD",
      "DISTRIBUTION_MINOR", "DISTRIBUTION_INJECTION", "DISTRIBUTION_HIGH_RISK", "DISTRIBUTION_SAFETY_BLOCK", "DISTRIBUTION_SINGLE_DOMAIN", "DISTRIBUTION_AUTHORS", "DISTRIBUTION_AUTHOR_SHARE"]) {
      assert.ok(got.has(c), `${c} missing; got ${[...got].join(",")}`);
    }
    const share = r.errors.find((e) => e.code === "DISTRIBUTION_AUTHOR_SHARE")!;
    assert.ok(share.detail.includes("ann1") && share.detail.includes("100"));
    assert.equal(share.line, 0);
    assert.equal(share.id, null);
  });
  it("checkDistribution:false skips; target override is merged", () => {
    const items = [item("alpha one")];
    assert.deepEqual(runDatasetChecks(items, { checkDistribution: false, checkBenchmarkOverlap: false }).errors, []);
    const r = runDatasetChecks(balanced(), { target: { minCases: 301, categoryPct: { SINGLE: 35 } as never } });
    assert.deepEqual(codes(r.errors), ["DISTRIBUTION_SIZE"]);
  });
  it("stats count categories, tags, authors and error codes", () => {
    const r = runDatasetChecks([item("aaa bbb ccc"), item("aaa bbb ccc")], { checkBenchmarkOverlap: false });
    const s = r.stats as { categories: Record<string, number>; authors: Record<string, number>; errorsByCode: Record<string, number> };
    assert.equal(s.categories.SINGLE, 2);
    assert.equal(s.authors.ann1, 2);
    assert.equal(s.errorsByCode.DUPLICATE_QUESTION, 1);
    for (const c of CATEGORIES) assert.ok(c in s.categories);
  });
});

describe("dataset checks: purity", () => {
  it("never mutates its input", () => {
    const items = [item("Hôm nay tôi nên tập gì?"), item("Hôm nay mình nên tập gì?"), item("x".repeat(700))];
    const before = JSON.stringify(items);
    for (const it of items) { Object.freeze(it.tags); Object.freeze(it); }
    Object.freeze(items);
    runDatasetChecks(items);
    assert.equal(JSON.stringify(items), before);
  });
});
