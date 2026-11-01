import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildDevContext } from "../evaluation/ai-coach-dev/context";
import { createFixtureIo, prepareCorpus } from "../evaluation/ai-coach-dev/retrieval";
import { ARMS, POLICY_VARIANTS, SETTINGS, AnalysisEnvelopeSchema, checkSourceLinks, groundCandidate, runDevSlice, type MockProvider } from "../evaluation/ai-coach-dev/pipeline";
import { devCases, createScriptedMock } from "../evaluation/ai-coach-dev/fixtures";
import { measureDevResult } from "../evaluation/ai-coach-dev/evaluation";
import { runMockExperiment } from "../evaluation/ai-coach-dev/run";
const root = path.resolve(__dirname, "../../../../..");
const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(root, "data/eval/advisory-progress-dev", name), "utf8"));
const corpus = prepareCorpus(read("evidence-pack.json"), read("evidence-claim-map-v2.json"));
const cases = devCases(), request = cases[0].request;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const deps = () => ({ corpus, io: createFixtureIo(corpus).io, provider: createScriptedMock() });

test("context rejects cross-subject, provenance mismatch and duplicate facts", () => {
  const bad = clone(request); bad.snapshots[0].subjectId = "synthetic-other";
  assert.throws(() => buildDevContext(bad), /cross_subject/);
  const ns = clone(request); ns.snapshots[0].namespace = "MEASUREMENTS";
  assert.throws(() => buildDevContext(ns), /namespace_provenance/);
  const dup = clone(request); dup.snapshots[0].facts.push(dup.snapshots[0].facts[0]);
  assert.throws(() => buildDevContext(dup), /duplicate_fact/);
  assert.throws(() => buildDevContext({ ...request, dataClass: "REAL_USER" }));
});
test("conversation remains separate from owner projections and request-local context", () => {
  const c = buildDevContext(cases[3].request);
  assert.deepEqual(c.facts, cases[3].request.snapshots[0].facts);
  assert.ok(!JSON.stringify(c.facts).includes("120"));
  c.facts[0].evidence.value.completed = -1;
  assert.equal(cases[3].request.snapshots[0].facts[0].evidence.value.completed, 18);
});
test("six generation arms share schema, fact references, policy text and sampling; sources are arm-local", async () => {
  for (const policy of POLICY_VARIANTS) {
    const d = deps(), results = [];
    for (const arm of ARMS) results.push(await runDevSlice(request, arm, d, { policy }));
    assert.equal(d.provider.calls(), 6);
    for (const r of results) {
      assert.ok(AnalysisEnvelopeSchema.safeParse(r.raw).success);
      assert.deepEqual(r.allowedReferences.factIds, results[0].allowedReferences.factIds);
      assert.deepEqual(r.allowedReferences.sourceIds, r.evidence.passages.map((p) => p.source.id));
      assert.deepEqual(r.settings, SETTINGS);
      assert.equal(r.prompt.system, results[0].prompt.system);
      assert.deepEqual(r.input.facts, results[0].input.facts);
      assert.equal(r.grounding, null);
    }
    assert.equal(results[0].prompt.layers.length, 1);
    assert.equal(results[1].prompt.layers.length, 5);
    assert.equal(results[2].evidence.status, "DISABLED");
  }
});
test("MINIMAL excludes domain answers; FULL adds only common domain principles", async () => {
  const minimal = await runDevSlice(request, ARMS[0], deps(), { policy: "MINIMAL" });
  const full = await runDevSlice(request, ARMS[0], deps(), { policy: "FULL" });
  assert.ok(!minimal.prompt.system.includes("Attendance chỉ đo"));
  assert.ok(full.prompt.system.includes("Attendance chỉ đo"));
  assert.ok(!full.prompt.system.includes("70"));
  assert.deepEqual(minimal.allowedReferences, full.allowedReferences);
});
test("generation boundary receives no case ID, gold labels or arm name", async () => {
  let payload: unknown;
  const mock = createScriptedMock();
  const provider: MockProvider = { kind: "MOCK_ONLY", async complete(r) { payload = r; return mock.complete(r); } };
  const r = await runDevSlice(cases[3].request, "LAYERED_CONTEXT_RAG", { ...deps(), provider });
  assert.deepEqual(Object.keys(payload as object), ["prompt", "settings"]);
  assert.ok(!JSON.stringify(payload).includes("expectedAssessment"));
  assert.ok(!JSON.stringify(payload).includes(cases[3].request.caseId));
  assert.ok(!r.prompt.system.includes("PWNED"));
  assert.ok(r.prompt.user.includes("PWNED"));
  const source = fs.readFileSync(path.join(__dirname, "../evaluation/ai-coach-dev/fixtures.ts"), "utf8").split("export function createScriptedMock")[1];
  assert.ok(!/evaluationOnly|caseId|expectedAssessment/.test(source));
});
test("grounding uses the identical raw RAG candidate and makes zero extra generation calls", async () => {
  const d = deps();
  const raw = await runDevSlice(request, "LAYERED_CONTEXT_RAG", d);
  const grounded = groundCandidate(raw);
  assert.equal(d.provider.calls(), 1);
  assert.equal(grounded.raw, raw.raw);
  assert.equal(grounded.prompt, raw.prompt);
  assert.equal(grounded.generationCalls, 0);
  assert.equal(grounded.semanticReview.scientificPass, null);
  assert.throws(() => groundCandidate({ ...raw, arm: "LAYERED_CONTEXT" }), /SameRagCandidate/);
});
test("unknown fact/source namespaces are checked for every generation arm", async () => {
  const valid = await runDevSlice(request, ARMS[0], deps());
  const bad = AnalysisEnvelopeSchema.parse(clone(valid.raw));
  bad.analysis.claims[0].factIds = [corpus[0].source.id];
  for (const arm of ARMS) {
    const r = await runDevSlice(request, arm, { ...deps(), provider: { kind: "MOCK_ONLY", async complete() { return bad; } } });
    assert.equal(r.release, "BLOCKED");
    assert.ok(r.referenceIssues?.includes("INVALID_REFERENCE_NAMESPACE"));
  }
});
test("citation identity is separate from independent support and blocks forged excerpts", async () => {
  const base = await runDevSlice(request, "LAYERED_CONTEXT_RAG", deps());
  const envelope = AnalysisEnvelopeSchema.parse(clone(base.raw)), p = base.evidence.passages[0];
  assert.ok(p);
  envelope.analysis.claims.push({ claimType: "GENERAL_PRINCIPLE", text: p.excerpts[0].text, factIds: [], evidenceIds: [p.source.id] });
  envelope.sourceLinks.push({ claimIndex: envelope.analysis.claims.length - 1, sourceId: p.source.id, excerptIds: [p.excerpts[0].id] });
  assert.deepEqual(checkSourceLinks(envelope, base.evidence), []);
  const valid = await runDevSlice(request, "LAYERED_CONTEXT_RAG", { ...deps(), provider: { kind: "MOCK_ONLY", async complete() { return envelope; } } });
  assert.equal(valid.semanticReview.claims.at(-1)?.sourceSupport, null);
  envelope.sourceLinks[0].excerptIds = ["FORGED"];
  const bad = await runDevSlice(request, "LAYERED_CONTEXT_RAG", { ...deps(), provider: { kind: "MOCK_ONLY", async complete() { return envelope; } } });
  assert.equal(bad.release, "BLOCKED");
});
test("raw metric contradiction can pass common contract but is excluded by the offline gate, never counted correct", async () => {
  const original = await runDevSlice(request, "LAYERED_CONTEXT_RAG", deps());
  const wrong = AnalysisEnvelopeSchema.parse(clone(original.raw));
  wrong.analysis.claims.find((c) => c.metricAssertion)!.metricAssertion!.currentKg = 95;
  const raw = await runDevSlice(request, "LAYERED_CONTEXT_RAG", { ...deps(), provider: { kind: "MOCK_ONLY", async complete() { return wrong; } } });
  assert.equal(raw.release, "DEV_REVIEW_ONLY");
  const post = groundCandidate(raw);
  assert.equal(post.release, "BLOCKED");
  assert.equal(post.raw, raw.raw);
  assert.equal(measureDevResult(cases[0], post).countedAsCorrect, null);
  assert.equal(measureDevResult(cases[0], post).postGateEligible, false);
});
test("unmeasurable metrics remain null; mock is not assessment accuracy", async () => {
  const r = await runDevSlice(cases[2].request, ARMS[0], deps());
  const m = measureDevResult(cases[2], r);
  assert.equal(m.factualConsistency.structuredMetricsChecked, 0);
  assert.equal(m.factualConsistency.mismatches, null);
  assert.equal(m.uncertaintyCalibration, null);
  assert.equal(m.sourceSupport.semanticSupportedFraction, null);
  assert.equal(m.modelTokens, null);
  const invalid = await runDevSlice(request, "LAYERED_CONTEXT_RAG", { ...deps(), provider: { kind: "MOCK_ONLY", async complete() { return null; } } });
  assert.equal(measureDevResult(cases[0], invalid).schemaValid, false);
  assert.equal(measureDevResult(cases[0], groundCandidate(invalid)).schemaValid, false);
});
test("harness pairs repeated raw RAG outputs with offline gates, excluding historical V2 from generation", async () => {
  const experiment = await runMockExperiment();
  assert.equal(cases.length, 40);
  assert.equal(experiment.manifest.mockCalls, experiment.results.reduce((n, r) => n + r.generationCalls, 0));
  assert.equal(experiment.results.length, cases.length * 6 * 2 * 2);
  assert.equal(experiment.postGate.length, cases.length * 2 * 2);
  for (const post of experiment.postGate) {
    const raw = experiment.results.find((r) => r.caseId === post.caseId && r.policy === post.policy && r.repetition === post.repetition && r.arm === "LAYERED_CONTEXT_RAG")!;
    assert.equal(post.raw, raw.raw);
  }
  assert.equal(experiment.manifest.historicalReference.scoresReused, false);
  assert.equal(experiment.rawVsPostGate.postGateCorrectness, null);
  assert.equal(experiment.manifest.modelCalls, 0);
});
test("live provider designation and live service imports are excluded", async () => {
  await assert.rejects(() => runDevSlice(request, ARMS[0], { ...deps(), provider: { kind: "BEDROCK" } as unknown as MockProvider }), /DevMockBoundary/);
  const folder = path.join(__dirname, "../evaluation/ai-coach-dev");
  const imports = fs.readdirSync(folder).filter((name) => name.endsWith(".ts")).flatMap((name) => [...fs.readFileSync(path.join(folder, name), "utf8").matchAll(/(?:from\s+|import\s*\()["']([^"']+)/g)].map((m) => m[1]));
  assert.ok(!imports.some((name) => /bedrock|llm\.service|retriever$|qdrant|repository|@aws-sdk/.test(name)));
});
