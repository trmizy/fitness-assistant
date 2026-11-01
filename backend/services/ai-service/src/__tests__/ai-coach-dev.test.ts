import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildDevContext } from "../evaluation/ai-coach-dev/context";
import { createFixtureIo, prepareCorpus, retrieveDevEvidence } from "../evaluation/ai-coach-dev/retrieval";
import { ARMS, AnalysisEnvelopeSchema, checkSourceLinks, runDevSlice, type MockProvider } from "../evaluation/ai-coach-dev/pipeline";
import { devCases, createScriptedMock } from "../evaluation/ai-coach-dev/fixtures";
import { measureDevResult } from "../evaluation/ai-coach-dev/evaluation";
import { runMockExperiment } from "../evaluation/ai-coach-dev/run";
import type { V2Io } from "../llm/retrieval-v2";

const root = path.resolve(__dirname, "../../../../..");
const read = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(root, "data/eval/advisory-progress-dev", name), "utf8"));
const corpus = prepareCorpus(read("evidence-pack.json"), read("evidence-claim-map-v2.json"));
const cases = devCases();
const request = cases[0].request;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const deps = () => ({ corpus, io: createFixtureIo(corpus).io, provider: createScriptedMock() });

test("DEV context rejects cross-subject, wrong namespace/provenance and duplicate facts", () => {
  const bad = clone(request); bad.snapshots[0].subjectId = "synthetic-other";
  assert.throws(() => buildDevContext(bad), /cross_subject/);
  const ns = clone(request); ns.snapshots[0].namespace = "MEASUREMENTS";
  assert.throws(() => buildDevContext(ns), /namespace_provenance/);
  const dup = clone(request); dup.snapshots[0].facts.push(dup.snapshots[0].facts[0]);
  assert.throws(() => buildDevContext(dup), /duplicate_fact/);
  assert.throws(() => buildDevContext({ ...request, dataClass: "REAL_USER" }));
});

test("context preserves owner projections, isolates conversation and does not infer unknown measurements", () => {
  const c = buildDevContext(cases[3].request);
  assert.deepEqual(c.facts, cases[3].request.snapshots[0].facts);
  assert.ok(c.personal.absentNamespaces.includes("MEASUREMENTS"));
  assert.ok(c.personal.notAssessedByThisSlice.includes("sleep"));
  assert.ok(!JSON.stringify(c.facts).includes("120"));
  c.facts[0].evidence.value.completed = -1;
  assert.equal(cases[3].request.snapshots[0].facts[0].evidence.value.completed, 18);
});

test("RAG reuses V2 with the original question, returns registered excerpts and preserves applicability", async () => {
  const fixture = createFixtureIo(corpus);
  const found = await retrieveDevEvidence(request.question, corpus, fixture.io);
  assert.equal(fixture.queries[0], request.question);
  assert.equal(found.status, "FOUND");
  assert.ok(found.passages.some((p) => p.source.id === "LOAD_OUTCOME_SPECIFICITY"));
  assert.ok(found.passages.every((p) => p.excerpts.length && p.source.applicability.length));
  assert.equal(found.claimSupport, "NOT_EVALUATED");
  assert.equal(fixture.counters().modelCalls, 0);
});

test("RAG empty and transport failure are distinct; unrelated sources cannot become science", async () => {
  const empty = await retrieveDevEvidence(request.question, [], createFixtureIo([]).io);
  assert.equal(empty.status, "EMPTY");
  const failIo: V2Io = { ...createFixtureIo(corpus).io, async search() { throw new Error("offline failure"); } };
  const failed = await retrieveDevEvidence(request.question, corpus, failIo);
  assert.equal(failed.status, "UNAVAILABLE"); assert.deepEqual(failed.passages, []);
  const failedEmbed = await retrieveDevEvidence(request.question, corpus, { ...failIo, async embed() { throw new Error("no embedding"); } });
  assert.equal(failedEmbed.status, "UNAVAILABLE");
  const unrelated = await retrieveDevEvidence("Bảo tàng nào mở cửa thứ năm?", corpus, createFixtureIo(corpus).io);
  assert.equal(unrelated.status, "EMPTY");
});

test("five layers keep injection text in untrusted user JSON, with no gold labels in prompts", async () => {
  const result = await runDevSlice(cases[3].request, "GROUNDED", deps());
  assert.equal(result.prompt.layers.length, 5);
  assert.ok(!result.prompt.system.includes("PWNED"));
  assert.ok(result.prompt.user.includes("PWNED"));
  assert.ok(!result.prompt.user.includes("evaluationOnly"));
  assert.ok(!result.prompt.user.includes("expectedAssessment"));
  assert.ok(!result.prompt.user.includes("synthetic-dev-conflicting-chat"));
  assert.equal(result.semanticReview.scientificPass, null);
  assert.notEqual(result.release, "BLOCKED");
});

test("citation identity is checked separately from semantic support, and forged or absent links block grounded output", async () => {
  const valid = await runDevSlice(request, "GROUNDED", deps());
  const answer = AnalysisEnvelopeSchema.parse(valid.raw);
  assert.ok(answer.sourceLinks.length > 0);
  assert.deepEqual(checkSourceLinks(answer, valid.evidence), []);
  const review = valid.semanticReview.claims[1];
  assert.ok(review.citedExcerpts.length > 0);
  assert.equal(review.sourceSupport, null);
  assert.equal(review.personalApplicability, null);
  assert.ok(review.citedExcerpts[0].applicability.length > 0);
  for (const mutate of [(a: typeof answer) => { a.sourceLinks[0].excerptIds = ["FAKE_EXCERPT"]; }, (a: typeof answer) => { a.sourceLinks = []; }]) {
    const altered = clone(answer); mutate(altered);
    const provider: MockProvider = { kind: "MOCK_ONLY", async complete() { return altered; } };
    const result = await runDevSlice(request, "GROUNDED", { ...deps(), provider });
    assert.equal(result.release, "BLOCKED"); assert.equal(result.candidate, null);
    assert.ok(result.citationReferenceIssues.length > 0);
  }
});

test("V3 blocks wrong metric and advice while schema rejects attempted plan mutation", async () => {
  const initial = await runDevSlice(request, "GROUNDED", deps());
  const valid = AnalysisEnvelopeSchema.parse(initial.raw);
  for (const mutate of [
    (a: typeof valid) => { a.analysis.claims[0].metricAssertion!.currentKg = 95; },
    (a: typeof valid) => { a.analysis.rationaleSummary = "Bạn nên tăng số hiệp."; },
    (a: typeof valid) => { (a.analysis as unknown as Record<string, unknown>).proposedAction = "SAVE_PLAN"; },
  ]) {
    const altered = clone(valid); mutate(altered);
    const result = await runDevSlice(request, "GROUNDED", { ...deps(), provider: { kind: "MOCK_ONLY", async complete() { return altered; } } });
    assert.equal(result.release, "BLOCKED"); assert.equal(result.candidate, null);
    assert.equal(result.modelCalls, 0);
  }
});

test("missing evidence supports observations only; a forged sourced principle is blocked", async () => {
  const noRag = { corpus: [], io: createFixtureIo([]).io, provider: createScriptedMock() };
  const empty = await runDevSlice(request, "GROUNDED", noRag);
  assert.equal(empty.evidence.status, "EMPTY"); assert.notEqual(empty.release, "BLOCKED");
  const bad = AnalysisEnvelopeSchema.parse(empty.raw);
  bad.analysis.claims.push({ claimType: "GENERAL_PRINCIPLE", text: "Invented principle.", factIds: [], evidenceIds: ["FAKE_SOURCE"] });
  const rejected = await runDevSlice(request, "GROUNDED", { ...noRag, provider: { kind: "MOCK_ONLY", async complete() { return bad; } } });
  assert.equal(rejected.release, "BLOCKED");
});

test("excerpt ablation does not reintroduce a removed quote through the frozen pack summary", async () => {
  const ablated = corpus.map((p) => ({ ...p, excerpts: p.excerpts.filter((e) => !["LOAD_STRENGTH_RESULT", "ACSM_CONTEXT"].includes(e.id)) }));
  const result = await runDevSlice(request, "GROUNDED", { corpus: ablated, io: createFixtureIo(ablated).io, provider: createScriptedMock() });
  const answer = AnalysisEnvelopeSchema.parse(result.raw);
  assert.deepEqual(answer.sourceLinks, []);
  const payload = JSON.parse(result.prompt.user);
  assert.ok(payload.scientificEvidence.passages.every((p: { excerpts: { id: string }[] }) => p.excerpts.every((e) => !["LOAD_STRENGTH_RESULT", "ACSM_CONTEXT"].includes(e.id))));
  assert.ok(!result.prompt.user.includes("Gains in 1RM strength were significantly greater"));
  assert.ok(result.input.sources.every((s) => s.supportedSummaryVi === ""));
});

test("five-arm harness uses new paired inputs; pending scientific metrics remain null", async () => {
  const experiment = await runMockExperiment();
  assert.equal(experiment.results.length, 25);
  assert.equal(experiment.manifest.mockCalls, 25);
  assert.equal(experiment.manifest.modelCalls, 0);
  assert.equal(experiment.manifest.vectorDbCalls, 0);
  assert.ok(experiment.results.every((r) => r.schemaIssues.length === 0));
  for (const c of cases) {
    const paired = experiment.results.filter((r) => r.caseId === c.request.caseId);
    assert.deepEqual(paired.map((r) => r.arm), [...ARMS]);
    assert.ok(paired.every((r) => JSON.stringify(r.input.facts) === JSON.stringify(paired[0].input.facts) && r.input.question === c.request.question));
    assert.ok(paired.every((r) => r.input.untrustedText === paired[0].input.untrustedText));
    assert.deepEqual(paired.slice(0, 3).map((r) => r.evidence.status), ["DISABLED", "DISABLED", "DISABLED"]);
    assert.ok(paired.slice(0, 4).every((r) => r.grounding === null));
    assert.ok(paired[4].grounding);
    const metrics = measureDevResult(c, paired[4]);
    assert.equal(metrics.sourceSupport.semanticSupportedFraction, null);
    assert.equal(metrics.usefulnessLikert, null);
    assert.equal(metrics.uncertaintyCalibration.devAssessmentMatch, true);
  }
});

test("runtime rejects live provider designation; DEV implementation has no live service imports", async () => {
  await assert.rejects(() => runDevSlice(request, "GROUNDED", { ...deps(), provider: { kind: "BEDROCK" } as unknown as MockProvider }), /DevMockBoundary/);
  const folder = path.join(__dirname, "../evaluation/ai-coach-dev");
  const imports = fs.readdirSync(folder).filter((name) => name.endsWith(".ts")).flatMap((name) => [...fs.readFileSync(path.join(folder, name), "utf8").matchAll(/(?:from\s+|import\s*\()["']([^"']+)/g)].map((m) => m[1]));
  assert.ok(!imports.some((name) => /bedrock|llm\.service|retriever$|qdrant|repository|@aws-sdk/.test(name)));
});
