import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createFixtureIo, prepareCorpus, retrieveDevEvidence } from "../evaluation/ai-coach-dev/retrieval";
import { detectConcepts } from "../llm/fitness-concepts";
import { devCases, createScriptedMock } from "../evaluation/ai-coach-dev/fixtures";
import { ARMS, runDevSlice } from "../evaluation/ai-coach-dev/pipeline";
const root = path.resolve(__dirname, "../../../../..");
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(root, "data/eval", name), "utf8"));
const corpus = prepareCorpus(read("advisory-progress-dev/evidence-pack.json"), read("advisory-progress-dev/evidence-claim-map-v2.json"), read("ai-coach-dev/corpus-supplement.json"));
test("muscle-size paraphrases resolve and select the exact relevant excerpt", async () => {
  for (const q of ["Kích thước cơ của tôi thay đổi thế nào?", "Muscle size thay đổi không?", "Độ dày cơ có tăng không?"]) {
    assert.ok(detectConcepts(q).concepts.some((c) => c.id === "hypertrophy"), q);
    const io = createFixtureIo(corpus), r = await retrieveDevEvidence(q, corpus, io.io);
    assert.equal(r.status, "FOUND", q);
    assert.equal(io.queries[0], q);
    assert.ok(r.passages.some((p) => p.excerpts.some((e) => e.id === "LOAD_HYPERTROPHY_RESULT")), q);
    assert.ok(!r.passages.some((p) => p.excerpts.some((e) => e.id === "ACSM_CONTEXT")));
    assert.equal(r.claimSupport, "NOT_EVALUATED");
  }
});
test("same-topic group strength result is relevant without certifying individual cause", async () => {
  const r = await retrieveDevEvidence("Sức mạnh của tôi tăng do chương trình tập này phải không?", corpus, createFixtureIo(corpus).io);
  assert.equal(r.status, "FOUND");
  assert.ok(r.passages.some((p) => p.excerpts.some((e) => e.id === "LOAD_STRENGTH_RESULT")));
  assert.ok(r.passages.every((p) => !p.source.id.startsWith("SYNTH_")));
  assert.equal(r.claimSupport, "NOT_EVALUATED");
});
test("empty reasons, safety and transport errors are distinguished without forcing FOUND", async () => {
  for (const [q, status] of [["Sức mạnh của tôi thay đổi thế nào?", "EMPTY_NO_MATCH"], ["xyz qwerty", "EMPTY_UNRESOLVED"], ["Viết mã JavaScript cho tôi", "EMPTY_OUT_OF_DOMAIN"], ["Tôi đau ngực và khó thở khi tập", "EMPTY_SAFETY"]]) {
    const fixture = createFixtureIo([]), r = await retrieveDevEvidence(q, [], fixture.io);
    assert.equal(r.status, status, q);
    if (status !== "EMPTY_NO_MATCH") assert.equal(fixture.queries.length, 0);
  }
  const io = createFixtureIo(corpus).io;
  const r = await retrieveDevEvidence("Sức mạnh của tôi?", corpus, { ...io, async search() { throw new Error("offline failure"); } });
  assert.equal(r.status, "UNAVAILABLE"); assert.deepEqual(r.passages, []);
});
test("safety handoff happens before generation for every arm", async () => {
  for (const arm of ARMS) {
    const provider = createScriptedMock(), fixture = createFixtureIo(corpus);
    const r = await runDevSlice({ ...devCases()[0].request, question: "Tôi đau ngực và khó thở khi tập" }, arm, { provider, corpus, io: fixture.io });
    assert.equal(provider.calls(), 0);
    assert.equal(fixture.queries.length, 0);
    assert.equal(r.release, "SAFETY_HANDLING_REQUIRED");
    assert.equal(r.safetyHandling.disposition, "HANDOFF_TO_EXISTING_SAFETY_FLOW");
  }
});
test("source ablation cannot restore removed quotes or assistant paraphrases", async () => {
  const ablated = corpus.map((p) => ({ ...p, excerpts: p.excerpts.filter((e) => e.id !== "LOAD_HYPERTROPHY_RESULT") }));
  const r = await retrieveDevEvidence("Kích thước cơ của tôi?", ablated, createFixtureIo(ablated).io);
  assert.equal(r.status, "EMPTY_NO_MATCH");
});
