import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ARMS, runDevSlice } from "../evaluation/ai-coach-dev/pipeline";
import { devCases, createScriptedMock } from "../evaluation/ai-coach-dev/fixtures";
import { prepareCorpus, createFixtureIo } from "../evaluation/ai-coach-dev/retrieval";
const root = path.resolve(__dirname, "../../../../..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, "data/eval/advisory-progress-dev", p), "utf8"));
const corpus = prepareCorpus(read("evidence-pack.json"), read("evidence-claim-map-v2.json"));
const deps = () => ({ corpus, io: createFixtureIo(corpus).io, provider: createScriptedMock() });
test("no-RAG arms see no corpus IDs and no duplicated fact objects", async () => {
  const countFacts = (v: unknown): number => Array.isArray(v) ? v.reduce((n, x) => n + countFacts(x), 0) : v && typeof v === "object" ? (("evidence" in v && "id" in v) ? 1 : Object.values(v).reduce<number>((n, x) => n + countFacts(x), 0)) : 0;
  for (const arm of ARMS.slice(0, 4)) {
    const r = await runDevSlice(devCases()[0].request, arm, deps());
    assert.deepEqual(r.allowedReferences.sourceIds, []);
    assert.ok(corpus.every((p) => !r.prompt.user.includes(p.source.id)));
    assert.equal(countFacts(JSON.parse(r.prompt.user)), r.input.facts.length);
    assert.equal(r.contextSize.modelInputTokens, null);
  }
});
test("placebo matches context character length and adds no facts/evidence", async () => {
  const request = devCases()[0].request;
  const context = await runDevSlice(request, "LAYERED_CONTEXT", deps());
  const placebo = await runDevSlice(request, "LAYERED_CONTEXT_PLACEBO", deps());
  const raw = await runDevSlice(request, "LAYERED", deps());
  assert.equal(placebo.prompt.user.length, context.prompt.user.length);
  const p = JSON.parse(placebo.prompt.user); assert.match(p.placeboPadding, /^ *$/); delete p.placeboPadding;
  assert.deepEqual(p, JSON.parse(raw.prompt.user));
});
test("wrong-excerpt control is genuinely different but does not leak treatment labels", async () => {
  const rag = await runDevSlice(devCases()[0].request, "LAYERED_CONTEXT_RAG", deps());
  const wrong = await runDevSlice(devCases()[0].request, "LAYERED_CONTEXT_WRONG_EXCERPT", deps());
  const relevant = new Set(rag.evidence.passages.flatMap((p) => p.excerpts.map((e) => e.id)));
  assert.ok(wrong.evidence.passages.length > 0);
  assert.ok(wrong.evidence.passages.every((p) => p.excerpts.every((e) => !relevant.has(e.id))));
  assert.equal(wrong.evidence.status, "CONTROL_SUPPLIED");
  assert.ok(!/WRONG_EXCERPT|CONTROL_SUPPLIED/.test(wrong.prompt.user));
  assert.deepEqual(wrong.allowedReferences.sourceIds, wrong.evidence.passages.map((p) => p.source.id));
});
