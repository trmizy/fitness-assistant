/**
 * M8-B Stream 4 — smoke test of the OFFLINE DEMO (src/__tests__/m8-demo/offline-demo.ts).
 * Evidence label: TEST FIXTURE — real /ai/v2/ask route + supervisor + agents over mock models, synthetic data, stubbed auth /
 * transport; no network, Bedrock, DB or Redis. Asserts that every scenario of the demo behaved as expected.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { runOfflineDemo, BANNER, type DemoReport } from "./m8-demo/offline-demo";

let report: DemoReport;
test.before(async () => { report = await runOfflineDemo(); });

const scenario = (id: string) => { const s = report.results.find((x) => x.id === id); assert.ok(s, `scenario ${id} exists`); return s; };
const allPass = (id: string) => {
  const s = scenario(id);
  assert.ok(s.checks.length > 0, `${id} has checks`);
  assert.deepEqual(s.checks.filter((c) => !c.ok).map((c) => c.text), [], `${id} failed checks`);
  assert.equal(s.verdict, "DEMONSTRATED");
};

test("DM-1 transcript starts with the mandatory banner and ends with the Known limitations section", () => {
  assert.ok(report.transcript.startsWith(`${BANNER}\n`));
  const tail = report.transcript.slice(report.transcript.indexOf("== Known limitations"));
  for (const k of ["zero-width space", "quarantine", "persistent", "G7 and G8", "human validation"]) assert.ok(tail.includes(k), k);
});

test("DM-2 S1 supervisor orchestration", () => allPass("S1"));
test("DM-3 S2 the four domain agents", () => { allPass("S2"); assert.equal(scenario("S2").checks.length, 4); });
test("DM-4 S3 routing cap + deferred disclosure", () => allPass("S3"));
test("DM-5 S4 safety: benign / SAFETY_BLOCKED / user-scoped minor restriction and its in-memory limit", () => {
  allPass("S4");
  assert.match(report.transcript, /LIMIT: the restriction store is IN-MEMORY ONLY/);
});
test("DM-6 S5 model unavailable: routing fallback and agent failure", () => allPass("S5"));
test("DM-7 S6 V1/V2 opt-in isolation", () => { allPass("S6"); assert.ok(report.v1AskReached >= 2); });
test("DM-8 S7 error handling", () => allPass("S7"));
test("DM-9 S0 offline guarantees: every tripwire is 0", () => {
  allPass("S0");
  assert.deepEqual(report.tripwires, { fetch: 0, bedrock: 0, callLLM: 0, unmockedHttp: 0 });
});
test("DM-10 overall result and determinism (no ids, no tokens, no timestamps in the transcript)", () => {
  assert.equal(report.ok, true);
  assert.ok(!/Bearer|tok-|11111111-1111|22222222-2222/.test(report.transcript.replace(/\[user [AB]\]/g, "")), "no bearer / user id printed");
});
