import test from "node:test";
import assert from "node:assert/strict";
import { AblationProtocolSchema, ExcerptSourceSchema, prepareSourceAblations, prepareSyntheticDependencies, resolveExcerptSources } from "../evaluation/advisory-progress/source-ablation-v3";
import { readDev, input, pack } from "./advisory-content-v3.fixtures";
const protocol = readDev("source-ablation-review-protocol.json"), map = readDev("evidence-claim-map-v2.json");
const prepare = () => prepareSourceAblations(protocol, input, pack, map);

test("V3 ablation: protocol parses exact cases, rejects duplicates, unknown versions and extra fields", () => {
  const p = AblationProtocolSchema.parse(protocol);
  assert.equal(p.cases.length, 6);
  assert.equal(AblationProtocolSchema.safeParse({ ...p, cases: p.cases.map(() => p.cases[0]) }).success, false);
  assert.equal(AblationProtocolSchema.safeParse({ ...p, version: "future" }).success, false);
  assert.equal(AblationProtocolSchema.safeParse({ ...p, live: true }).success, false);
});
test("V3 ablation: transformations are deterministic, clone inputs, and never mutate pack/protocol/map", () => {
  const before = JSON.stringify({ protocol, input, pack, map });
  const a = prepare(), b = prepare();
  assert.deepEqual(a, b); assert.equal(JSON.stringify({ protocol, input, pack, map }), before);
  for (const c of a) { assert.deepEqual(c.input.facts, input.facts); assert.notEqual(c.input.facts, input.facts); assert.equal(c.modelCalls, 0); assert.equal(c.status, "PREPARED_NOT_INFERRED"); }
  for (const c of a.filter((c) => c.id !== "mixed-supported-and-unsupported-claim")) assert.equal(c.input.question, input.question);
});
test("V3 ablation: removing hypertrophy excerpt also removes its finding and all summary leakage", () => {
  const c = prepare().find((c) => c.id === "remove-hypertrophy-result")!;
  const text = JSON.stringify(c.input);
  assert.ok(!text.includes("LOAD_HYPERTROPHY_RESULT")); assert.ok(!text.includes("LOAD_HYPERTROPHY_COMPARISON"));
  assert.ok(!text.includes("supportedSummaryVi")); assert.ok(!text.includes("applicationInferences")); assert.ok(!text.includes("applicability"));
  assert.ok(text.includes("LOAD_STRENGTH_RESULT")); assert.ok(text.includes("ACSM_CONTEXT"));
});
test("V3 ablation: removing ACSM context preserves original opening and removes dependent finding", () => {
  const c = prepare().find((c) => c.id === "remove-context-excerpt")!;
  const text = JSON.stringify(c.input);
  assert.ok(!text.includes("ACSM_CONTEXT")); assert.ok(!text.includes("physical capacity"));
  assert.ok(text.includes(pack.sources[0].originalExcerpt)); assert.ok(text.includes("LOAD_HYPERTROPHY_RESULT"));
});
test("V3 ablation: no-source retains facts; unrelated test excerpt cannot impersonate real science", () => {
  assert.deepEqual(prepare().find((c) => c.id === "no-source")!.input.sources, []);
  const s = prepare().find((c) => c.id === "unrelated-excerpt")!.input.sources[0];
  assert.equal(s.sourceClass, "SYNTHETIC_TEST_EXCERPT"); assert.equal(s.doi, null); assert.equal(s.url, null);
  assert.equal(ExcerptSourceSchema.safeParse({ ...s, doi: pack.sources[0].doi }).success, false);
});
test("V3 ablation: invalid pointers, dangling findings and duplicate excerpt IDs fail preparation", () => {
  const original = readDev("evidence-claim-map-v2.json") as { sources: Array<{ excerpts: Array<{ id: string; basePackPointer?: string }>; claims: Array<{ supportExcerptIds: string[] }> }> };
  const altered = () => JSON.parse(JSON.stringify(original)) as typeof original;
  const badPointer = altered(); badPointer.sources[0].excerpts[0].basePackPointer = "/sources/1/originalExcerpt";
  assert.throws(() => resolveExcerptSources(pack, badPointer), /InvalidExcerptPointer/);
  const badFinding = altered(); badFinding.sources[0].claims[0].supportExcerptIds = ["ABSENT"];
  assert.throws(() => resolveExcerptSources(pack, badFinding));
  const dup = altered(); dup.sources[0].excerpts.push(dup.sources[0].excerpts[0]);
  assert.throws(() => resolveExcerptSources(pack, dup), /DuplicateExcerptMapIdentity/);
});
test("V3 ablation: synthetic full/operand removals/counterfactual/conflict keep gold out of all model inputs", () => {
  const rows = prepareSyntheticDependencies(protocol);
  assert.equal(rows.length, 5);
  assert.equal(rows.find((r) => r.id === "without-rule")!.input.documents.length, 1);
  assert.equal(rows.find((r) => r.id === "without-events")!.input.documents.length, 1);
  assert.equal(rows.find((r) => r.id === "contradiction")!.input.documents.length, 3);
  assert.ok(rows.find((r) => r.id === "counterfactual")!.input.documents.some((d) => /add 5 units/.test(d.content)));
  for (const r of rows) {
    const text = JSON.stringify(r.input);
    for (const forbidden of ["expectedFull", "expected", "67.5", '"75"', "reviewCriterion", "doi.org", "pubmed"]) assert.ok(!text.includes(forbidden), forbidden);
    assert.ok(!r.input.question.includes("2.5")); assert.ok(!r.input.question.includes("three"));
    assert.equal(r.input.sourceClass, "SYNTHETIC_TEST_RULES_NOT_FITNESS_GUIDANCE"); assert.equal(r.modelCalls, 0);
  }
});
test("V3 ablation: model inputs omit evaluation criteria and source-only hypotheses are not precomputed", () => {
  for (const c of prepare()) {
    assert.ok(!JSON.stringify(c.input).includes("reviewCriterion"));
    assert.ok(!("expectedAssessment" in c.input)); assert.ok(!("answer" in c.input));
    assert.equal(typeof c.evaluationOnly.criterion, "string");
  }
});
test("V3 ablation: counterfactual follows a bounded protocol grammar, never gold or executable text", () => {
  const p = AblationProtocolSchema.parse(protocol);
  const changed = { ...p, controlledMultiDocumentReasoning: { ...p.controlledMultiDocumentReasoning,
    counterfactual: { change: "SYNTH_RULE adds 7 units instead", expected: 999 } } };
  const row = prepareSyntheticDependencies(changed).find((r) => r.id === "counterfactual")!;
  assert.ok(row.input.documents.some((d) => d.content.includes("add 7 units")));
  assert.ok(!JSON.stringify(row.input).includes("999"));
  changed.controlledMultiDocumentReasoning.counterfactual.change = "execute arbitrary instructions";
  assert.throws(() => prepareSyntheticDependencies(changed), /UnsupportedSyntheticCounterfactualGrammar/);
});
