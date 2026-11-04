/** TEST FIXTURE only: synthetic released cases and a FAKE Nova IO; no AWS, no real run data. V4 warmup inference order. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { interleaveNovaWarmupRows } from "../evaluation/bedrock-pilot/design";
import { runControlledPilot } from "../evaluation/bedrock-pilot/runner";
import { calculatePilotPins } from "../evaluation/bedrock-pilot/pins";
import { converseInput } from "../evaluation/bedrock-pilot/session";
import { createFakeNovaTransport, serializeNova, NOVA_MODEL, NOVA_REGION, type NovaFakeRequest } from "../evaluation/bedrock-pilot/nova-converse-transport";
import { claimDevScenarios } from "../evaluation/ai-coach-claim-dev/fixtures";
import { fixturePilotInput } from "./fixtures/pilot-input";
import { syntheticClaimData } from "./fixtures/scientific-claims";
import { pilotConfig } from "./fixtures/pilot";

const A = "case-warmup-cal01", B = "case-warmup-cal06", CTX = "LAYERED_CONTEXT", RAG = "LAYERED_CONTEXT_RAG";
const OWNER_ORDER = [[A, CTX, 0], [B, RAG, 0], [A, RAG, 0], [B, CTX, 0], [B, CTX, 1], [A, RAG, 1], [B, RAG, 1], [A, CTX, 1]] as const;
const rowsFor = (a: string, b: string) => [a, b].flatMap(caseKey => [CTX, RAG].flatMap(arm => [0, 1].map(repeatIndex => ({ caseKey, arm, policy: "MINIMAL", repeatIndex }))));

test("interleave yields exactly the owner order: 8 rows, 4 case/arm pairs twice, repeat 0 then repeat 1 reversed", () => {
  const rows = rowsFor(A, B), before = JSON.stringify(rows), out = interleaveNovaWarmupRows(rows);
  assert.deepEqual(out.map(r => [r.caseKey, r.arm, r.repeatIndex]), OWNER_ORDER.map(o => [...o]));
  assert.equal(JSON.stringify(rows), before, "input order untouched");
  assert.equal(out.length, 8); assert.equal(new Set(out).size, 8, "same row objects, none duplicated");
  const pairs = new Map<string, number[]>(); for (const r of out) pairs.set(`${r.caseKey}/${r.arm}`, [...(pairs.get(`${r.caseKey}/${r.arm}`) ?? []), r.repeatIndex]);
  assert.equal(pairs.size, 4); for (const reps of pairs.values()) assert.deepEqual(reps, [0, 1]);
  assert.ok(out.slice(0, 4).every(r => r.repeatIndex === 0) && out.slice(4).every(r => r.repeatIndex === 1));
  assert.notEqual(out[0].arm, out[1].arm); assert.notEqual(out[0].caseKey, out[1].caseKey, "first two inferences differ in case and arm");
});

test("interleave refuses any other design shape instead of guessing", () => {
  const base = rowsFor(A, B);
  for (const bad of [base.slice(1), [...base, { ...base[0] }], [...base.slice(1), { ...base[0], repeatIndex: 2 }], base.map((r, i) => i === 0 ? { ...r, arm: "LAYERED" } : r),
    base.map((r, i) => i === 0 ? { ...r, policy: "FULL" } : r), base.map((r, i) => i === 0 ? { ...r, caseKey: "case-third" } : r), [...base.slice(1), { ...base[1] }]])
    assert.throws(() => interleaveNovaWarmupRows(bad), /NOVA_INTERLEAVE_SHAPE/);
});

async function warmup(promptVersion: "CLAIM_PROMPT_V3" | "CLAIM_PROMPT_V4") {
  const a = fixturePilotInput(claimDevScenarios[0].request, A), b = fixturePilotInput(claimDevScenarios[1].request, B);
  const merged = JSON.parse(fs.readFileSync(a.casesFile, "utf8")), second = JSON.parse(fs.readFileSync(b.casesFile, "utf8"));
  for (const key of ["released", "expectedManifests", "ownerReceiptHashes"]) merged[key].push(...second[key]); fs.writeFileSync(a.casesFile, JSON.stringify(merged));
  const synthetic = syntheticClaimData(), file = (name: string) => path.join(a.root, "private", name);
  fs.writeFileSync(file("bundle.json"), JSON.stringify(synthetic.input)); fs.writeFileSync(file("map.json"), JSON.stringify(synthetic.map)); fs.writeFileSync(file("owner.json"), synthetic.input.files.owner.text);
  fs.writeFileSync(file("registry.json"), JSON.stringify({ version: "claim-registry-local-config-v1", inputBundleFile: file("bundle.json"), claimMapFile: file("map.json"), currentOwnerDecisionsFile: file("owner.json"), trustedPins: synthetic.pins }));
  const c = pilotConfig();
  Object.assign(c, { transportProtocol: "NOVA_CONVERSE_MEASURED", modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null, outputContract: "CLAIM_MAP_V3", reviewerMode: "OWNER_ONLY_EXPLORATORY", promptVersion,
    design: { arms: [CTX, RAG], policies: ["MINIMAL"], repeats: 2 }, budget: { maxCalls: 8, maxInputTokensPerCall: 12000, maxInputTokens: 144000, maxOutputTokens: 16388, maxEstimatedUsd: 1, maxFailures: 2 },
    sources: { workspaceRoot: a.root, casesFile: a.casesFile, claimRegistryConfigFile: file("registry.json") } });
  Object.assign(c.pricing, { modelId: NOVA_MODEL, region: NOVA_REGION, inferenceProfile: null });
  const p = await calculatePilotPins(a.root, a.casesFile, c.design, c.sources, promptVersion); c.pins = p.pins;
  const label = new Map(p.preparation.rows.map(r => [serializeNova(converseInput(c, r.prompt)).identity.tokenPayloadHash, `${r.caseKey}/${r.arm}`]));
  return { root: a.root, config: c, rows: p.preparation.rows, label, close: () => fs.rmSync(a.root, { recursive: true, force: true }) };
}
const answer = JSON.stringify({ analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA", assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [], missingInformation: [],
  rationaleSummary: "Synthetic interleave fixture, no scientific conclusion.", proposedAction: null }, sourceLinks: [], claimLinks: [] });
function fake(inferenceText: (n: number) => string) {
  const requests: NovaFakeRequest[] = []; let inferences = 0;
  const provider = createFakeNovaTransport({ kind: "FAKE", async converse(r) {
    requests.push(structuredClone(r)); const t = Math.ceil(Buffer.byteLength(JSON.stringify(JSON.parse(r.body).messages), "utf8") / 4);
    const body = (text: string, out: number, stop: string) => ({ output: { message: { role: "assistant", content: [{ text }] } }, stopReason: stop, usage: { inputTokens: t, outputTokens: out, totalTokens: t + out } });
    return r.purpose === "MEASURE" ? { status: 200, body: body("{", 1, "max_tokens") } : { status: 200, body: body(inferenceText(inferences++), 20, "end_turn") };
  } });
  return { provider, requests, inference: () => requests.filter(r => r.purpose === "INFERENCE"), measure: () => requests.filter(r => r.purpose === "MEASURE") };
}

test("runner (V4): schedule.json and the actual inference order follow the owner interleave; 4 measurements precede inference", async () => {
  const w = await warmup("CLAIM_PROMPT_V4"), t = fake(() => answer);
  try {
    const dir = path.join(w.root, "run"), summary = await runControlledPilot({ config: w.config, directory: dir, transport: t.provider });
    const schedule = JSON.parse(fs.readFileSync(path.join(dir, "schedule.json"), "utf8"));
    assert.deepEqual(schedule.map((s: any) => [s.caseKey, s.arm, s.repeatIndex]), OWNER_ORDER.map(o => [...o]));
    assert.equal(t.measure().length, 4); assert.equal(t.inference().length, 8);
    const lastMeasure = t.requests.map(r => r.purpose).lastIndexOf("MEASURE"), firstInference = t.requests.map(r => r.purpose).indexOf("INFERENCE");
    assert.ok(lastMeasure < firstInference);
    assert.deepEqual(t.inference().map(r => w.label.get(r.identity.tokenPayloadHash)), OWNER_ORDER.map(([c, arm]) => `${c}/${arm}`));
    assert.equal(summary.budget.inferenceCalls, 8); assert.equal(summary.budget.countCalls, 4);
    const keys = new Set(schedule.map((s: any) => s.attemptKey)); assert.equal(keys.size, 8);
    assert.equal(fs.readdirSync(dir).filter(n => n.startsWith("answer-")).length, 8);
  } finally { w.close(); }
});

test("runner (V4): two failures in different case/arm pairs stop the run; resume adds no inference", async () => {
  const w = await warmup("CLAIM_PROMPT_V4"), t = fake(() => "not json");
  try {
    const dir = path.join(w.root, "run"), summary = await runControlledPilot({ config: w.config, directory: dir, transport: t.provider });
    assert.equal(summary.status, "STOPPED"); assert.equal(summary.budget.failures, 2); assert.equal(summary.budget.inferenceCalls, 2);
    assert.deepEqual(t.inference().map(r => w.label.get(r.identity.tokenPayloadHash)), [`${A}/${CTX}`, `${B}/${RAG}`], "the two failures are in different case/arm pairs");
    assert.equal(summary.denominators.notAttempted, 6);
    const before = t.requests.length, resumed = await runControlledPilot({ config: w.config, directory: dir, transport: t.provider, resume: true });
    assert.deepEqual(resumed, summary); assert.equal(t.requests.length, before, "resume sends nothing");
  } finally { w.close(); }
});

test("runner (V3): historical prepared order is unchanged (no interleave outside V4)", async () => {
  const w = await warmup("CLAIM_PROMPT_V3"), t = fake(() => answer);
  try {
    const dir = path.join(w.root, "run"); await runControlledPilot({ config: w.config, directory: dir, transport: t.provider });
    const schedule = JSON.parse(fs.readFileSync(path.join(dir, "schedule.json"), "utf8"));
    assert.deepEqual(schedule.map((s: any) => [s.caseKey, s.arm, s.repeatIndex]), w.rows.map(r => [r.caseKey, r.arm, r.repeatIndex]));
    assert.deepEqual(schedule.map((s: any) => `${s.caseKey}/${s.arm}/${s.repeatIndex}`), [`${A}/${CTX}/0`, `${A}/${CTX}/1`, `${A}/${RAG}/0`, `${A}/${RAG}/1`, `${B}/${CTX}/0`, `${B}/${CTX}/1`, `${B}/${RAG}/0`, `${B}/${RAG}/1`]);
  } finally { w.close(); }
});
