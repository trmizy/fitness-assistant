import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prepareCorpus, createFixtureIo, retrieveDevEvidence, type Passage } from "../evaluation/ai-coach-dev/retrieval";
const root = path.resolve(__dirname, "../../../../..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, "data/eval", p), "utf8"));
const corpus = prepareCorpus(read("advisory-progress-dev/evidence-pack.json"), read("advisory-progress-dev/evidence-claim-map-v2.json"), read("ai-coach-dev/corpus-supplement.json"));
test("nutrition and supplement targets cannot borrow a same-topic strength excerpt", async () => {
  for (const q of ["Protein cho sức mạnh có tác dụng gì?", "Creatine tăng sức mạnh như thế nào?", "Calo và strength liên quan thế nào?", "Dinh dưỡng protein giúp tăng cơ thế nào?"]) {
    const r = await retrieveDevEvidence(q, corpus, createFixtureIo(corpus).io);
    assert.notEqual(r.status, "FOUND", q); assert.deepEqual(r.passages, []);
  }
});
test("progressive resistance principle can retrieve ACSM without requiring personal causality support", async () => {
  const r = await retrieveDevEvidence("Progressive overload là gì?", corpus, createFixtureIo(corpus).io);
  assert.equal(r.status, "FOUND"); assert.ok(r.passages.some((p) => p.excerpts.some((e) => e.id === "ACSM_PROGRESSIVE_OPENING")));
  assert.equal(r.claimSupport, "NOT_EVALUATED");
});
test("relabelled synthetic and forged scientific quote fail trusted identity/content pins", async () => {
  const fake = JSON.parse(JSON.stringify(corpus.find((p) => p.source.id === "SYNTH_CAUSE"))) as Passage;
  fake.source.sourceClass = "CURATED_EVIDENCE"; fake.source.evidenceLevel = "systematic_review"; fake.excerpts[0].authorship = "ORIGINAL_SCIENTIFIC_EXCERPT";
  const r = await retrieveDevEvidence("Sức mạnh và kích thước cơ?", [fake], createFixtureIo([fake]).io);
  assert.notEqual(r.status, "FOUND");
  const forged = JSON.parse(JSON.stringify(corpus[1])) as Passage;
  forged.excerpts[0].text = "Strength always proves muscle hypertrophy in the individual.";
  const wrong = await retrieveDevEvidence("Sức mạnh của tôi?", [forged], createFixtureIo([forged]).io);
  assert.notEqual(wrong.status, "FOUND");
});
test("wrong original excerpt from the right source is not automatically relevant", async () => {
  const wrong = corpus.filter((p) => p.source.id === "LOAD_OUTCOME_SPECIFICITY").map((p) => ({ ...p, excerpts: p.excerpts.filter((e) => e.id === "LOAD_STRENGTH_RESULT") }));
  const r = await retrieveDevEvidence("Kích thước cơ thay đổi thế nào?", wrong, createFixtureIo(wrong).io);
  assert.equal(r.status, "EMPTY_NO_MATCH");
});
