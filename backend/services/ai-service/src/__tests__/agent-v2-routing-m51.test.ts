/**
 * V2 Multi-Agent M5.1 — focused routing contract tests for intent-v1.1 + the heldout-v2 protocol. Example sentences here
 * are NEW (in none of the v1 / DEV / heldout sets). OFFLINE: no model, network, DB or Redis.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planRouting } from "../agent-v2/routing-planner";
import { DEFAULT_EXECUTION_POLICY, SUPERVISOR_BUDGET } from "../agent-v2/supervisor";
import type { AgentId } from "../agent-v2/multi-agent-contracts";
import { foldVi } from "../llm/speech_act";
import { ROUTING_CASES_V1 } from "./m5-benchmark/dataset-v1";
import { ROUTING_CASES_DEV } from "./m5-benchmark/dataset-dev";
import { ROUTING_CASES_HELDOUT_V2 } from "./m5-benchmark/dataset-heldout-v2";
import { heldoutIntegrity, plannerSha, RUN_FILE, runM51Final } from "./m5-benchmark/run-m51";
import { KNOWN_EXECUTION_FAILURES_V1 } from "./m5-benchmark/run-benchmark";
import { ADJUDICATIONS_M51 } from "./m5-benchmark/adjudication-m51";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { WORKTREE } from "./m5-benchmark/run-m6";
import { V3_RUN_FILE } from "./m7-benchmark/run-v3";
import { V4_RUN_FILE } from "./m7-benchmark/run-v4";

const ALL: AgentId[] = ["progress", "recovery", "training", "nutrition"];
const plan = (q: string, available: AgentId[] = ALL, max = 2) => planRouting(foldVi(q), available, { maxAgents: max });
const sel = (q: string) => [...plan(q).selected].sort();

test("M51-1 behaviour contract: the owner of the ASK is selected; background words do not add agents", () => {
  assert.deepEqual(sel("Trước giờ chạy bộ thì nên ăn nhẹ món gì?"), ["nutrition"], "pre-workout food only");
  assert.deepEqual(sel("Hôm nay em tập buổi nào, và trước đó nên ăn gì?"), ["nutrition", "training"], "schedule + food");
  assert.deepEqual(sel("Cân nặng đo được của tôi thay đổi ra sao từ đầu tháng?"), ["progress"], "measured weight change");
  assert.deepEqual(sel("Dạo này người cứ kiệt sức, phải làm sao?"), ["recovery"], "fatigue");
  assert.deepEqual(sel("Sức mạnh deadlift của tôi có tăng không, chương trình nên chỉnh gì?"), ["progress", "training"], "strength + program");
});

test("M51-2 three real needs → two agents by order of the asks, the third DEFERRED with its need, coverage PARTIAL", () => {
  const p = plan("Tuần sau tôi nên tập mấy buổi, ăn bao nhiêu calo và nghỉ ngơi ra sao?");
  assert.deepEqual(p.selected, ["training", "nutrition"]);
  assert.deepEqual(p.deferred.map((d) => [d.agentId, d.reason]), [["recovery", "MAX_AGENTS"]]);
  // the primary need is a Training need ("tuần sau … tập" is classified TODAY_TRAINING, a day-anchored schedule ask)
  assert.equal(p.coverage, "PARTIAL"); assert.ok(p.intents.some((c) => c.need === p.primaryNeed && c.agentId === "training" && c.role === "REQUEST"));
});

test("M51-3 unclear / out-of-scope → no agent, HIGH uncertainty, no personal read", () => {
  for (const q of ["Bạn giúp tôi chút được không?", "Cuộc sống dạo này thế nào nhỉ", "Có nên mua thảm tập yoga loại dày không?"]) {
    const p = plan(q);
    assert.deepEqual(p.selected, [], q); assert.equal(p.coverage, "NONE", q); assert.equal(p.uncertainty, "HIGH", q);
  }
});

test("M51-4 compound: the FIRST ask is kept; terms never match across a clause boundary", () => {
  const p = plan("Lịch tập ngày mai là gì, rồi tối nay ăn gì?");
  assert.deepEqual(p.selected, ["training", "nutrition"]); assert.equal(p.primaryNeed, "TODAY_TRAINING");
  // "… không giảm, nên đổi …" must not become one cross-clause "giảm … đổi" program-change term
  const q = plan("Vòng eo không giảm, nên đổi chương trình tập không?");
  assert.ok(q.intents.every((c) => c.position >= 0)); assert.deepEqual([...q.selected].sort(), ["progress", "training"]);
});

test("M51-5 general vs personal: a general question gets the owner only; a self-report adds its agent as support", () => {
  assert.deepEqual(sel("Uống nước điện giải khi tập có cần thiết không?"), ["nutrition"]);
  assert.deepEqual(sel("Tôi bị nhức vai từ hôm qua, buổi đẩy hôm nay có nên bỏ không?"), ["recovery", "training"]);
});

test("M51-6 unaccented + folded-collision words: 'giáo án' is not eating, 'mới/mọi' are not soreness", () => {
  assert.deepEqual(sel("giao an tuan nay cua toi co bao nhieu buoi"), ["training"]);
  assert.deepEqual(sel("Mới tập được hai tuần thì nên tập mấy buổi?"), ["training"]);
});

// KNOWN DEFECTS found by this contract test AFTER heldout v2 was scored, FIXED in M7-P4 by a new candidate (intent-v1.2)
// evaluated on a NEW heldout set (v3, frozen before the change):
//  KD-1 "mọi người" folds to "moi nguoi" = "mỏi người" (sore body) → Recovery was taken as asked.
//  KD-2 "hay" = "often" was read as "or" by the alternative-question rule → a second agent was asked.
// (Folded input here — the ambiguity rule applies; the accented path is covered in agent-v2-routing-m7p4.test.ts.)
test("M51-6b KD-1/KD-2 (fixed in M7-P4): 'Mọi người hay ăn gì sau tập?' routes to Nutrition only", () => {
  assert.deepEqual(sel("Mọi người hay ăn gì sau tập?"), ["nutrition"]);
});

test("M51-7 the planner names agents only: no tool, budget, identity; unregistered agents never appear; limits unchanged", () => {
  const p = plan("Tôi mệt, sức mạnh giảm, hôm nay nên tập gì?", ["training", "progress", "nutrition"]);
  const json = JSON.stringify(p);
  for (const bad of ["allowedTools", "policy", "budget", "userId", "recovery"]) assert.ok(!json.includes(bad), bad);
  assert.ok(p.selected.length <= 2);
  assert.equal(DEFAULT_EXECUTION_POLICY.maxAgentsPerTurn, 2);
  assert.deepEqual({ ...SUPERVISOR_BUDGET }, { maxWallTimeMs: 60_000, maxModelCalls: 8, maxToolCalls: 6, maxInputTokens: 60_000, maxOutputTokens: 6_000, maxCostUsd: 0.08 });
});

test("M51-8 protocol: heldout v2 frozen and scored by the M5.1 candidate only; v3 by M7-P4; the current candidate is locked to heldout v4; sets disjoint", () => {
  const integ = heldoutIntegrity();
  assert.ok(integ.ok, `heldout v2 changed (${integ.actual} != ${integ.expected})`);
  const run = JSON.parse(readFileSync(RUN_FILE, "utf8")) as { plannerSha256: string; heldoutSha256: string };
  assert.equal(run.heldoutSha256, integ.expected);
  // M7-P4: the router changed (intent-v1.2). Heldout v2 stays bound to the M5.1 candidate (= the planner at 099fb449);
  // the new candidate is bound to heldout v3 (a NEW set frozen before the change).
  const m51 = execFileSync("git", ["show", "099fb449:backend/services/ai-service/src/agent-v2/routing-planner.ts"], { cwd: WORKTREE, encoding: "utf8" });
  assert.equal(createHash("sha256").update(m51.replace(/\r\n/g, "\n")).digest("hex"), run.plannerSha256);
  assert.notEqual(plannerSha(), run.plannerSha256);
  // M7-P4.1: heldout v3 stays bound to intent-v1.2 (the planner at 0f529657); the current candidate (intent-v1.3) is bound
  // to heldout v4 — routing-planner.ts may not change after heldout v4 was scored
  const m7p4 = execFileSync("git", ["show", "0f529657:backend/services/ai-service/src/agent-v2/routing-planner.ts"], { cwd: WORKTREE, encoding: "utf8" });
  assert.equal(createHash("sha256").update(m7p4.replace(/\r\n/g, "\n")).digest("hex"), (JSON.parse(readFileSync(V3_RUN_FILE, "utf8")) as { plannerSha256: string }).plannerSha256);
  assert.equal((JSON.parse(readFileSync(V4_RUN_FILE, "utf8")) as { plannerSha256: string }).plannerSha256, plannerSha(), "routing-planner.ts changed after heldout v4 was scored — a new candidate needs a NEW heldout set");
  const norm = (s: string) => foldVi(s).replace(/[^a-z0-9 ]/g, "").trim();
  const sets = [ROUTING_CASES_V1, ROUTING_CASES_DEV, ROUTING_CASES_HELDOUT_V2].map((xs) => new Set(xs.map((c) => norm(c.q))));
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) for (const q of sets[i]) assert.ok(!sets[j].has(q), `duplicate across sets: ${q}`);
  assert.ok(ROUTING_CASES_DEV.every((c) => c.split === "dev") && ROUTING_CASES_HELDOUT_V2.every((c) => c.split === "heldout-v2"));
});

// M7-P4: the M5.1 final run re-scores heldout v2, which is bound to the M5.1 candidate — with intent-v1.2 in the tree it
// must REFUSE (one-shot protocol). Its recorded historical result and records are unchanged; the M5.1 adjudication
// records stay un-approved (the owner's approvals are the separate M6 records).
test("M51-9 the M5.1 final run refuses a different candidate; recorded results and adjudication records unchanged", async () => {
  await assert.rejects(runM51Final(), /HELDOUT_V2_ALREADY_SCORED_BY_ANOTHER_CANDIDATE/);
  const run = JSON.parse(readFileSync(RUN_FILE, "utf8")) as { result: { exactSetLe2Pct: number; primaryCoveragePct: number } };
  assert.deepEqual(run.result, { exactSetLe2Pct: 95.1, primaryCoveragePct: 95 });
  assert.ok(ADJUDICATIONS_M51.every((a) => !a.approved && a.decision === "LABEL_REVIEW_REQUIRED" && a.invariantMet && a.policyCompliant));
  assert.equal(KNOWN_EXECUTION_FAILURES_V1.length, 2);
});
