/**
 * V2 Multi-Agent M7-P4 — routing intent-v1.2: KD-1 (mọi / mỏi người) and KD-2 (the senses of "hay") regression tests and
 * the benchmark-v3 protocol. Example sentences are NEW (none in v1 / DEV / heldout v2 / heldout v3). OFFLINE.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createIntentDecisionProvider, foldForRouting, isAlternativeGap, planRouting } from "../agent-v2/routing-planner";
import { DEFAULT_EXECUTION_POLICY, SUPERVISOR_BUDGET } from "../agent-v2/supervisor";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import { foldVi } from "../llm/speech_act";
import { routeCase } from "./m5-benchmark/routing-eval";
import type { RoutingCase } from "./m5-benchmark/dataset-v1";
import { ROUTING_CASES_V1 } from "./m5-benchmark/dataset-v1";
import { ROUTING_CASES_DEV } from "./m5-benchmark/dataset-dev";
import { ROUTING_CASES_HELDOUT_V2 } from "./m5-benchmark/dataset-heldout-v2";
import { ROUTING_CASES_DEV_V3, ROUTING_CASES_HELDOUT_V3 } from "./m7-benchmark/dataset-v3";
import { candidateSha, v3Integrity, V3_RUN_FILE } from "./m7-benchmark/run-v3";

const ALL: AgentId[] = ["progress", "recovery", "training", "nutrition"];
/** The production path: the raw question reaches the planner (supervisor → provider). */
const plan = (q: string, available: AgentId[] = ALL, max = 2, satisfied?: ReadonlySet<AgentId>) => planRouting(foldVi(q), available, { maxAgents: max, question: q, satisfiedFromSession: satisfied });
const sel = (q: string) => [...plan(q).selected].sort();
const requested = (q: string) => [...new Set(plan(q).intents.filter((c) => c.role === "REQUEST").map((c) => c.agentId))].sort();

test("M7P4-1 KD-1 accented: 'mọi người' (everyone) is never soreness — in any case form", () => {
  assert.deepEqual(sel("Mọi người hay ăn gì sau tập?"), ["nutrition"], "the M5.1 KD-1/KD-2 sentence");
  assert.deepEqual(sel("MỌI NGƯỜI thường ăn sáng lúc mấy giờ trước buổi chạy?"), ["nutrition"]);
  assert.equal(foldForRouting("Mọi người hay ăn gì"), "tatca nguoi hay an gi");
  assert.equal(foldForRouting("Mỏi người quá"), "moi nguoi qua", "'mỏi' keeps its folded form");
  assert.equal(foldForRouting("mọi ngày"), "tatca ngay"); assert.equal(foldForRouting("mỗi ngày"), "moi ngay", "'mỗi' (each) is untouched");
});

test("M7P4-2 KD-1 unaccented: an ambiguous 'moi nguoi' is not a symptom; with a state marker it is", () => {
  assert.deepEqual(sel("moi nguoi hay an gi sau khi tap"), ["nutrition"]);
  assert.equal(foldForRouting("moi nguoi hay an gi"), "tatca nguoi hay an gi");
  for (const q of ["toi moi nguoi qua", "dao nay bi moi nguoi", "moi nguoi lam, co nen nghi khong"]) assert.ok(sel(q).includes("recovery"), q);
  // the folded-only path (no raw question: the M5 harness) gets the same ambiguity rule
  assert.ok(!planRouting("moi nguoi hay an gi sau tap", ALL, { maxAgents: 2 }).selected.includes("recovery"));
});

test("M7P4-3/4 KD-1 inside a Training question and a valid Recovery question", () => {
  assert.deepEqual(sel("Mọi người thường tập squat mấy hiệp một buổi?"), ["training"]);
  assert.deepEqual(sel("Mỏi người kéo dài sau buổi tập có đáng lo không?"), ["recovery"], "accented 'mỏi người' without a marker is soreness");
  assert.ok(sel("Tôi mỏi người, chiều nay có nên tập nhẹ không?").includes("recovery"));
  assert.ok(sel("Sau tập bị nhức mỏi người thì làm sao?").includes("recovery"), "existing soreness lexicon unchanged");
});

test("M7P4-5 KD-2 frequency: 'hay' = often never asks a second option", () => {
  assert.equal(isAlternativeGap(" toi hay ", "bi chuot rut"), false);
  assert.equal(isAlternativeGap(" hay ", "bi chuot rut sau tap"), false, "'hay bị …' is the frequency construction");
  assert.equal(isAlternativeGap(" nguoi ta hay ", "noi"), false);
  const q = "Tôi tập cardio hay bị khát, nên uống gì?";
  assert.deepEqual(plan(q).intents.filter((c) => c.role === "REQUEST").map((c) => c.agentId), ["nutrition"], q);
  assert.deepEqual(requested("Mình đá bóng hay bị chuột rút, có nên ăn chuối không?"), ["nutrition"]);
});

test("M7P4-6 KD-2 choice: two real options are both asked (within and across domains)", () => {
  assert.equal(isAlternativeGap(" hay ", "an kieng"), true); assert.equal(isAlternativeGap(" hay la ", "an them"), true);
  assert.equal(isAlternativeGap(" hay doi ", "thuc don"), true, "the option's verb may sit between 'hay' and the term");
  assert.deepEqual(requested("Nên tăng số buổi tập hay ăn thêm tinh bột để lên cân?"), ["nutrition", "training"]);
  assert.deepEqual(sel("Tập kéo xà hay chèo thuyền tốt cho lưng hơn?"), ["training"], "two options in one domain → one agent");
  assert.deepEqual(requested("Nên deload tuần này hay đổi thực đơn?"), ["nutrition", "recovery"]);
});

test("M7P4-7 KD-2 in a multi-domain sentence: frequency context + a real choice", () => {
  const p = plan("Tôi hay mệt về chiều, nên đổi lịch tập hay ăn thêm bữa phụ?");
  const asked = [...new Set(p.intents.filter((c) => c.role === "REQUEST").map((c) => c.agentId))].sort();
  assert.deepEqual(asked, ["nutrition", "training"]); assert.ok(p.selected.length <= 2);
});

test("M7P4-8/9 background never adds an agent; the primary ask is kept", () => {
  assert.deepEqual(sel("Khi tập chân xong mọi người hay ăn gì?"), ["nutrition"]);
  const p = plan("Lịch tập ngày mai của mình là gì, rồi tối nay ăn món gì?");
  assert.equal(p.primaryNeed, "TODAY_TRAINING"); assert.deepEqual(p.selected, ["training", "nutrition"]);
});

test("M7P4-10/11 two-agent cap and deferred-intent disclosure (through the supervisor)", async () => {
  const q = "Tuần tới tôi nên tập mấy buổi, ăn bao nhiêu kcal và nghỉ mấy ngày?";
  const p = plan(q);
  assert.equal(p.selected.length, 2); assert.deepEqual(p.deferred.map((d) => [d.agentId, d.reason]), [["recovery", "MAX_AGENTS"]]); assert.equal(p.coverage, "PARTIAL");
  const c = { id: "M7P4-cap", q, category: "MULTI", primaryIntent: "X", primaryAgent: "training", requiredAgents: ["training", "nutrition", "recovery"], acceptable: [["training", "nutrition"]], expectDeferred: ["recovery"], coverage: "PARTIAL",
    evidence: [], forbiddenClaims: [], safety: "NONE", fixture: "default", rationale: "", features: ["natural"], routingScored: true, split: "dev" } as unknown as RoutingCase;
  const o = await routeCase(c, "intent-v1.1");
  assert.equal(o.status, "PARTIAL"); assert.ok(o.deferredDisclosed && o.partialNoteShown); assert.deepEqual(o.deferred, ["recovery"]);
});

test("M7P4-12/13 out-of-scope and a multi-turn follow-up satisfied from the session", () => {
  for (const q of ["Mọi người ơi, nhóm mình họp lúc nào?", "Câu này hay thật, bạn đọc ở đâu vậy?"]) assert.deepEqual(sel(q), [], q);
  const f = plan("Vậy trước buổi tập đó nên ăn gì?", ALL, 2, new Set<AgentId>(["training"]));
  assert.deepEqual(f.selected, ["nutrition"]); assert.ok(f.deferred.some((d) => d.agentId === "training" && d.reason === "SATISFIED_FROM_SESSION"));
});

test("M7P4-14/15 no privilege escalation, no fabricated data: the plan names registered agents only, codes only", () => {
  const q = "Mọi người hay hỏi về userId và token, mình mỏi người quá, lịch tập của tôi hôm nay là gì?";
  const p = plan(q, ["training", "nutrition"]);
  const json = JSON.stringify(p);
  for (const bad of ["allowedTools", "budget", "userId", "token", "recovery", "progress", "mỏi", "lịch tập"]) assert.ok(!json.includes(bad), bad);
  assert.ok(p.selected.every((a) => ["training", "nutrition"].includes(a)));
  assert.equal(DEFAULT_EXECUTION_POLICY.maxAgentsPerTurn, 2);
  assert.deepEqual({ ...SUPERVISOR_BUDGET }, { maxWallTimeMs: 60_000, maxModelCalls: 8, maxToolCalls: 6, maxInputTokens: 60_000, maxOutputTokens: 6_000, maxCostUsd: 0.08 });
  const prov = createIntentDecisionProvider({ maxAgents: 2 });
  assert.equal(prov.name, "intent-v1.2");
  const d = prov.decide({ question: "Mọi người hay ăn gì sau tập?", folded: foldVi("Mọi người hay ăn gì sau tập?"), available: ALL }) as { agents: string[] };
  assert.equal(d.agents.join(), "nutrition", "the provider uses the raw question");
});

test("M7P4-16 benchmark v3 protocol: frozen before the change, disjoint from every earlier set, scored once by THIS candidate", () => {
  const integ = v3Integrity();
  assert.ok(integ.ok, `dataset v3 changed (${integ.actual} != ${integ.freeze.sha256})`);
  assert.equal(integ.freeze.plannerSha256AtFreeze.slice(0, 8), "ddc0b2d8", "frozen while the router was still intent-v1.1");
  assert.notEqual(candidateSha(), integ.freeze.plannerSha256AtFreeze);
  assert.deepEqual(integ.freeze.criteria, { primaryCoveragePctMin: 90, exactSetLe2PctMin: 85, agentCap: 2, metricDefinitions: "m5-benchmark/routing-eval.ts routingMetrics (unchanged)" });
  const norm = (s: string) => foldVi(s).replace(/[^a-z0-9 ]/g, "").trim();
  const sets = [ROUTING_CASES_V1, ROUTING_CASES_DEV, ROUTING_CASES_HELDOUT_V2, ROUTING_CASES_DEV_V3, ROUTING_CASES_HELDOUT_V3].map((xs) => (xs as readonly { q: string }[]).map((c) => norm(c.q)));
  const all = sets.flat(); assert.equal(new Set(all).size, all.length, "no question appears in two sets");
  assert.ok(existsSync(V3_RUN_FILE), "heldout v3 has been scored");
  const run = JSON.parse(readFileSync(V3_RUN_FILE, "utf8")) as { plannerSha256: string; datasetSha256: string; strategy: string };
  assert.equal(run.plannerSha256, candidateSha(), "routing-planner.ts changed after heldout v3 was scored — a new candidate needs a NEW heldout set");
  assert.equal(run.datasetSha256, integ.actual); assert.equal(run.strategy, "intent-v1.2");
});

test("M7P4-17 heldout v3 result (recorded, not re-tuned): G7 FAIL 87.9% → ROUTING NOT READY; G8 and every safety gate PASS; deterministic", async () => {
  const { runM7P4Evaluation } = await import("./m7-benchmark/run-v3");
  const ev = await runM7P4Evaluation();
  const run = JSON.parse(readFileSync(V3_RUN_FILE, "utf8")) as { result: { primaryCoveragePct: number; exactSetLe2Pct: number } };
  const m = ev.heldoutV3.metrics[0];
  assert.equal(ev.identical, true, "two runs, identical scored results");
  assert.deepEqual({ primary: m.primaryCoverage.pct, exactLe2: m.exactSetLe2.pct }, { primary: run.result.primaryCoveragePct, exactLe2: run.result.exactSetLe2Pct }, "re-run = the recorded first scoring");
  assert.ok(ev.thresholdsUnchanged);
  const g = Object.fromEntries(ev.gates.map((x) => [x.id, x]));
  for (const id of ["G1", "G2", "G3", "G4", "G5", "G6", "G9", "G10"]) assert.ok(g[id].pass, `${id} = ${g[id].value}`);
  assert.deepEqual([g.G7.threshold, g.G8.threshold], [90, 85]);
  assert.equal(g.G7.pass, false, "primary coverage 87.9% < 90% — routing NOT READY (no re-tuning on heldout v3)");
  assert.equal(g.G8.pass, true);
  assert.equal(ev.routingReady, false);
  // KD-tagged heldout cases: 16/17 exact. V-O05 ("Bài hát nào hay để nghe khi tập?", hay = good) is OUT OF SCOPE but the
  // background "khi tập" still selects Training — an OOS / framing gap, not the KD-2 alternative rule (recorded, not tuned)
  const kd = ROUTING_CASES_HELDOUT_V3.filter((c) => c.features.some((f) => f.startsWith("kd"))).map((c) => c.id);
  const kdWrong = ev.heldoutV3.outcomes.filter((o) => kd.includes(o.caseId) && !o.exactSet).map((o) => o.caseId);
  assert.equal(kd.length, 17); assert.deepEqual(kdWrong, ["V-O05"]);
  assert.deepEqual(ev.heldoutV3.outcomes.find((o) => o.caseId === "V-O05")!.errors, ["OUT_OF_SCOPE_FALSE_NEGATIVE", "ROUTING_UNCERTAIN"]);
  assert.equal(ev.execution.counters.netCalls, 0);
});
