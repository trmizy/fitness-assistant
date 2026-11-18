/** "Giải thích thể trạng InBody" service: facts are deterministic, the text is AI-written or null — never canned. */
import test from "node:test";
import assert from "node:assert/strict";
import { explainInBody, inbodyExplanationRequest, INBODY_EXPLAIN_UNAVAILABLE_VI, type InBodyExplanationDeps } from "../services/inbody-explanation.service";

const entries = [
  { id: "11111111-aaaa", date: "2026-10-01", weight: 86, height: 175, bodyFat: 25, muscleMass: 33.5 },
  { id: "22222222-bbbb", date: "2026-11-01", weight: 84, height: 175, bodyFat: 22.5, muscleMass: 34 },
];
const longText = "**Tổng quan** ".padEnd(220, "x");
const deps = (call: InBodyExplanationDeps["call"]): InBodyExplanationDeps => ({
  fetchEntries: async () => entries,
  fetchTrainee: async () => ({ age: 30, gender: "MALE", heightCm: 175, goal: "WEIGHT_LOSS" }),
  call,
});

test("latest entry is explained against the previous one; text comes from the model", async () => {
  let prompt = "";
  const r = await explainInBody("u1", "Bearer t", undefined, deps(async (p) => { prompt = p; return { answer: longText }; }));
  assert.equal(r.entryId, "22222222-bbbb");
  assert.equal(r.source, "llm");
  assert.equal(r.explanation, longText);
  assert.equal(r.facts!.changes.find((c) => c.key === "weight")!.delta, -2);
  assert.match(prompt, /FACTS \(JSON, nguồn duy nhất\)/);
});

test("a specific older entry has no previous scan", async () => {
  const r = await explainInBody("u1", undefined, "11111111-aaaa", deps(async () => ({ answer: longText })));
  assert.equal(r.facts!.changes.length, 0);
  assert.ok(r.facts!.dataQuality.some((q) => /lần đo đầu tiên/.test(q)));
});

test("AI failure keeps the facts and returns NO canned explanation", async () => {
  const r = await explainInBody("u1", undefined, undefined, deps(async () => { throw new Error("bedrock down"); }));
  assert.ok(r.facts);
  assert.equal(r.explanation, null);
  assert.equal(r.source, null);
  assert.equal(r.explanationError, INBODY_EXPLAIN_UNAVAILABLE_VI);
});

test("no entries -> no facts; the prompt forbids new numbers and diagnoses", async () => {
  const r = await explainInBody("u1", undefined, undefined, { ...deps(async () => ({ answer: longText })), fetchEntries: async () => [] });
  assert.equal(r.facts, null);
  const req = inbodyExplanationRequest({ measuredAt: null, daysSincePrevious: null, metrics: [], bodyType: null, balance: [], changes: [], flags: [], dataQuality: [] }, {});
  assert.match(req.systemPrompt, /KHÔNG thêm con số mới/);
  assert.match(req.systemPrompt, /KHÔNG chẩn đoán/);
  assert.match(req.systemPrompt, /ƯỚC TÍNH CỦA ỨNG DỤNG/);
});
