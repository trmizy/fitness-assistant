import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens, mergeDelta, parseDeltaResponse, planRevisionWork, runDeltaRevision, tokenBudgetConfig, trimDay, verifyFinalDays,
  estimateSessionMinutes, RevisionShortfallError,
  type CandidateExercise, type PlanDay,
} from "../services/revision/workout-revision-planner";
import { parseWorkoutAdjustment as P, resolveExercisesPerDay as R } from "../services/revision/workout-adjustment-constraints";

/**
 * Pure unit tests (no DB, no model): constraint resolution, delta planning, token budget + chunking, strict parsing, deterministic merge.
 * Evidence label: unit. The Postgres lifecycle (identity/version/idempotency/concurrency) is workout-plan-revision.pg.itest.ts.
 */
const CFG = { providerMaxOutputTokens: 5000, headroom: 1.25, baseTokens: 250, tokensPerExercise: 140 };
const ex = (id: string, order = 1) => ({ exerciseId: id, name: `Ex ${id}`, order, sets: 3, reps: "8-12", restSeconds: 75 });
const day = (n: number, goal: string, prefix: string): PlanDay => ({ day: `Day ${n}`, goal, cardio: "Khởi động", exercises: Array.from({ length: 4 }, (_, i) => ex(`${prefix}${i + 1}`, i + 1)) });
const plan4x4 = (): PlanDay[] => [day(1, "Ngực + Vai", "a"), day(2, "Lưng + Tay trước", "b"), day(3, "Chân + Mông", "c"), day(4, "Vai + Tay sau", "d")];
const pool = (prefix: string, n = 12): CandidateExercise[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}p${i + 1}`, exerciseName: `Pool ${prefix}${i + 1}` }));
const poolAll = (): Map<number, CandidateExercise[]> => new Map([[0, pool("a")], [1, pool("b")], [2, pool("c")], [3, pool("d")]]);
const allIds = (days: PlanDay[]) => new Set([...days.flatMap((d) => d.exercises.map((e) => e.exerciseId)), ...["a", "b", "c", "d"].flatMap((p) => pool(p).map((c) => c.id))]);

// ── B2: structured constraints ────────────────────────────────────────────────────────────────────────────────────────────

test("B2 phrases: absolute vs relative vs question vs replacement are told apart; the OLD count never overrides the user's", () => {
  const cur = 4;
  const r = (t: string, explicit?: number) => R({ explicit, parsed: P(t), current: cur });
  for (const [t, want] of [["Tăng tất cả buổi lên 7 bài", 7], ["Mỗi buổi 8 bài", 8], ["Từ 4 lên 8 bài", 8], ["Giảm còn 3 bài", 3], ["7 bài mỗi buổi", 7]] as const) {
    assert.deepEqual(r(t), { ok: true, target: want, source: "text-absolute" }, t);
  }
  assert.deepEqual(r("Thêm 2 bài mỗi buổi"), { ok: true, target: 6, source: "text-relative" });
  assert.deepEqual(r("bớt 1 bài mỗi buổi"), { ok: true, target: 3, source: "text-relative" });
  assert.deepEqual(r("Thêm 2 bài bụng"), { ok: true, target: 4, source: "current" }, "'thêm 2 bài bụng' is a muscle-focus addition, not a count");
  // 2026-11-20: "thêm bài mới" with NO count used to resolve to "current" (=> the job answered "nothing to change"); the user clearly wants MORE, so it is a question now.
  assert.ok(!r("Giữ nguyên bài cũ, thêm bài mới").ok && (r("Giữ nguyên bài cũ, thêm bài mới") as any).code === "AMBIGUOUS");
  assert.equal(P("Giữ nguyên bài cũ, thêm bài mới").keepExisting, true);
  assert.deepEqual(r("lên 7 bài", 5), { ok: true, target: 5, source: "explicit" }, "an explicit numeric input beats the text");
  const o = P("Đổi bài thứ 2 của buổi ngực");
  assert.deepEqual(o.replaceOrdinal, { ordinal: 2, dayHint: "nguc" });
  assert.equal(o.exercisesPerDay, undefined, "an ordinal is not a count");
});

test("B2 ambiguity: a request that cannot be applied without guessing is refused with a question, not applied", () => {
  for (const t of ["tăng số bài", "buổi 1 và 3 lên 6 bài", "mỗi buổi 15 bài"]) {
    const res = R({ parsed: P(t), current: 4 });
    assert.equal(res.ok, false, t);
    assert.ok(!res.ok && res.message.length > 10);
  }
  assert.equal(R({ explicit: 11, parsed: P("điều chỉnh nhẹ"), current: 4 }).ok, false);
});

// ── B3: delta + budget + chunking ────────────────────────────────────────────────────────────────────────────────────────

test("B03 4x4 -> 4x7 needs exactly +3 per day (12 objects, not 28); +2/day from 4 -> 6 needs +2 per day", () => {
  const w7 = planRevisionWork(plan4x4(), 7, CFG);
  assert.equal(w7.mode, "ADD");
  assert.deepEqual(w7.days.map((d) => d.add), [3, 3, 3, 3]);
  assert.equal(w7.chunks.flat().length, 4);
  assert.equal(planRevisionWork(plan4x4(), 6, CFG).days.every((d) => d.add === 2), true);
  assert.equal(planRevisionWork(plan4x4(), 4, CFG).mode, "NOOP");
  const w3 = planRevisionWork(plan4x4(), 3, CFG);
  assert.equal(w3.mode, "TRIM");
  assert.deepEqual(w3.days.map((d) => d.remove), [1, 1, 1, 1]);
});

test("B04 only the days that need work are touched: untouched days are byte-identical, uneven plans add only where short", () => {
  const prev = plan4x4();
  prev[0].exercises.push(ex("a5", 5), ex("a6", 6), ex("a7", 7)); // day 1 already has 7
  const w = planRevisionWork(prev, 7, CFG);
  assert.deepEqual(w.days.map((d) => d.add), [0, 3, 3, 3]);
  const merged = mergeDelta(prev, 7, new Map(), poolAll()); // no model help at all: topped up from the catalog
  assert.deepEqual(merged.days[0], prev[0], "day 1 unchanged (same object content)");
  assert.deepEqual(merged.days[0].exercises.map((e) => e.exerciseId), ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
});

test("B06/B18 low provider limit -> chunked by day; EVERY call's budget stays within the configured provider max", () => {
  const tiny = { ...CFG, providerMaxOutputTokens: 1000 }; // (250 + n*140)*1.25 <= 1000  => n <= 3 objects per call
  const w = planRevisionWork(plan4x4(), 7, tiny);
  assert.equal(w.conflict, undefined);
  assert.ok(w.chunks.length > 1, `expected several chunks, got ${w.chunks.length}`);
  assert.ok(w.chunkTokens.every((t) => t <= tiny.providerMaxOutputTokens), JSON.stringify(w.chunkTokens));
  assert.deepEqual(w.chunks.flat().sort(), [0, 1, 2, 3], "every day that needs additions is covered exactly once");
  const roomy = planRevisionWork(plan4x4(), 7, CFG);
  assert.equal(roomy.chunks.length, 1, "with a roomy limit one call is enough");
});

test("B06 a single day that cannot fit even alone is a specific conflict — the target is NEVER silently lowered", () => {
  const w = planRevisionWork(plan4x4(), 9, { ...CFG, providerMaxOutputTokens: 600 });
  assert.equal(w.conflict?.code, "TOKEN_BUDGET");
  assert.match(w.conflict!.message, /không tự giảm số bài/);
});

test("session length ceiling: a plan whose sessions would exceed the maximum is refused with a concrete reason", () => {
  const long: PlanDay[] = [{ goal: "x", exercises: Array.from({ length: 4 }, (_, i) => ({ ...ex(`l${i}`, i + 1), sets: 6, restSeconds: 180 })) }];
  const w = planRevisionWork(long, 10, CFG);
  assert.equal(w.conflict?.code, "SESSION_TOO_LONG");
  assert.ok(estimateSessionMinutes(plan4x4()[0]) < 60);
});

test("token estimate has headroom and grows with the number of objects", () => {
  assert.ok(estimateTokens(12, CFG) > estimateTokens(4, CFG));
  assert.equal(estimateTokens(10, { ...CFG, headroom: 1 }), 250 + 1400);
  assert.equal(tokenBudgetConfig({ LLM_PROVIDER: "ollama" } as any).providerMaxOutputTokens, 4500);
  assert.equal(tokenBudgetConfig({ LLM_PROVIDER: "bedrock", AI_PLAN_MAX_OUTPUT_TOKENS: "3000", AI_PLAN_TOKEN_HEADROOM: "1.5" } as any).providerMaxOutputTokens, 3000);
});

// ── B05: truncation / strict parsing ────────────────────────────────────────────────────────────────────────────────────

test("B05 truncated or malformed model output never yields partial data", () => {
  assert.equal(parseDeltaResponse('{"days":[{"dayIndex":0,"add":[{"exerciseId":"ap1","name":"x"').ok, false, "cut off mid-object");
  assert.equal(parseDeltaResponse("no json here").ok, false);
  assert.equal(parseDeltaResponse('{"days":"nope"}').ok, false);
  const ok = parseDeltaResponse('Sure! {"days":[{"dayIndex":0,"add":[{"exerciseId":"ap1","name":"Pool a1","sets":3,"reps":"8-12","restSeconds":60}]}]} thanks');
  assert.ok(ok.ok && ok.additions.get(0)?.[0].exerciseId === "ap1");
});

const delta = (additions: Record<number, string[]>) => JSON.stringify({ days: Object.entries(additions).map(([i, ids]) => ({ dayIndex: Number(i), add: ids.map((id) => ({ exerciseId: id, name: id, sets: 3, reps: "10", restSeconds: 60, note: "ok" })) })) });
const run = (callLLM: any, over: Partial<Parameters<typeof runDeltaRevision>[0]> = {}, target = 7) => {
  const prev = plan4x4();
  return runDeltaRevision({
    prev, target, work: planRevisionWork(prev, target, CFG), candidatesByDay: poolAll(), validIds: allIds(prev),
    goal: "MUSCLE_GAIN", trainingLocation: "GYM", equipmentPreference: "MIXED_GYM", adjustmentContext: "Tăng tất cả buổi lên 7 bài", callLLM, ...over,
  });
};

test("B01/B02 4x4 -> 4x7 and 4x8: existing exercises kept in place, exactly 7/8 per day, final check passes, catalog ids only (B16)", async () => {
  for (const target of [7, 8]) {
    const callLLM = async (prompt: string) => {
      assert.match(prompt, new RegExp(`ADD EXACTLY ${target - 4} NEW`));
      return delta({ 0: ["ap1", "ap2", "ap3", "ap4"].slice(0, target - 4), 1: ["bp1", "bp2", "bp3", "bp4"].slice(0, target - 4), 2: ["cp1", "cp2", "cp3", "cp4"].slice(0, target - 4), 3: ["dp1", "dp2", "dp3", "dp4"].slice(0, target - 4) });
    };
    const out = await run(callLLM, {}, target);
    assert.ok(out.ok, JSON.stringify(out));
    if (!out.ok) return;
    assert.equal(out.days.length, 4);
    out.days.forEach((d, i) => {
      assert.equal(d.exercises.length, target);
      assert.deepEqual(d.exercises.slice(0, 4).map((e) => e.exerciseId), plan4x4()[i].exercises.map((e) => e.exerciseId), "old exercises first, unchanged");
      assert.deepEqual(d.exercises.map((e) => e.order), Array.from({ length: target }, (_, k) => k + 1));
      assert.equal(d.goal, plan4x4()[i].goal);
    });
    assert.equal(verifyFinalDays(out.days, target, allIds(plan4x4())).ok, true);
  }
});

test("B16 invented/duplicate/foreign ids from the model are rejected and topped up from the catalog; the count still lands exactly on target", async () => {
  const out = await run(async () => delta({ 0: ["INVENTED-1", "a1", "bp1"], 1: ["bp1", "bp2", "bp3"], 2: ["cp1", "cp2", "cp3"], 3: ["dp1", "dp2", "dp3"] }));
  assert.ok(out.ok);
  if (!out.ok) return;
  const d0 = out.days[0].exercises.map((e) => e.exerciseId);
  assert.equal(d0.length, 7);
  assert.ok(!d0.includes("INVENTED-1") && !d0.includes("bp1"), "unknown / other-day ids are never used");
  assert.equal(new Set(d0).size, 7, "no duplicates");
  assert.ok(out.warnings.some((w) => w.type === "delta_invalid_addition") && out.warnings.some((w) => w.type === "delta_topped_up_from_catalog"));
  assert.equal(verifyFinalDays(out.days, 7, allIds(plan4x4())).ok, true);
});

test("B05 truncated output on every attempt -> NO result at all (nothing to persist), plan untouched", async () => {
  let calls = 0;
  const out = await run(async () => { calls += 1; return '{"days":[{"dayIndex":0,"add":[{"exerciseId":"ap1"'; });
  assert.equal(out.ok, false);
  assert.equal(calls, 2, "one retry, then give up");
  if (!out.ok) assert.match(out.userMessage, /Kế hoạch cũ vẫn giữ nguyên/);
});

test("B05 a truncated FIRST attempt is retried and the retry can succeed; no partial merge of the broken one", async () => {
  let n = 0;
  const out = await run(async () => (++n === 1 ? '{"days":[{"dayIndex":0,"add":[{"exerciseId":"ap1"' : delta({ 0: ["ap1", "ap2", "ap3"], 1: ["bp1", "bp2", "bp3"], 2: ["cp1", "cp2", "cp3"], 3: ["dp1", "dp2", "dp3"] })));
  assert.ok(out.ok);
  if (out.ok) assert.equal(out.calls, 2);
});

test("B06 chunked execution: with a tiny provider limit several calls run, each given a numPredict within the limit, and the merged result is complete", async () => {
  const tiny = { ...CFG, providerMaxOutputTokens: 1000 };
  const prev = plan4x4();
  const work = planRevisionWork(prev, 7, tiny);
  const budgets: number[] = [];
  const out = await runDeltaRevision({
    prev, target: 7, work, candidatesByDay: poolAll(), validIds: allIds(prev), goal: "G", trainingLocation: "GYM", equipmentPreference: "MIXED_GYM",
    callLLM: async (prompt, { numPredict }) => {
      budgets.push(numPredict);
      const days = [...prompt.matchAll(/\[Day (\d)\]/g)].map((m) => Number(m[1]) - 1);
      return delta(Object.fromEntries(days.map((i) => [i, ["a", "b", "c", "d"][i] ? [1, 2, 3].map((k) => `${["a", "b", "c", "d"][i]}p${k}`) : []])));
    },
  });
  assert.ok(out.ok);
  assert.ok(budgets.length > 1);
  assert.ok(budgets.every((b) => b <= tiny.providerMaxOutputTokens + 1 && b <= tokenBudgetConfig().providerMaxOutputTokens), JSON.stringify(budgets));
  if (out.ok) assert.ok(out.days.every((d) => d.exercises.length === 7));
});

test("a day the catalog cannot fill to the target is a shortfall conflict — the target is not lowered", async () => {
  const out = await run(async () => delta({}), { candidatesByDay: new Map([[0, pool("a", 1)], [1, pool("b")], [2, pool("c")], [3, pool("d")]]) });
  assert.equal(out.ok, false);
  if (!out.ok) assert.match(out.userMessage, /không tự giảm số bài/);
  assert.throws(() => mergeDelta(plan4x4(), 7, new Map(), new Map([[0, pool("a", 1)]])), RevisionShortfallError);
});

test("lowering the count trims deterministically from the tail by training order (no model call, nothing invented)", () => {
  const t = trimDay(plan4x4()[0], 2);
  assert.deepEqual(t.exercises.map((e) => e.exerciseId), ["a1", "a2"]);
  const merged = mergeDelta(plan4x4(), 3, new Map(), new Map());
  assert.ok(merged.days.every((d) => d.exercises.length === 3));
});

test("verifyFinalDays is the authority: wrong count, unknown id and duplicates are all reported", () => {
  const bad: PlanDay[] = [{ exercises: [ex("a1"), ex("a1"), ex("zzz")] }];
  const v = verifyFinalDays(bad, 4, new Set(["a1"]));
  assert.ok(!v.ok && v.problems.length === 3);
});

// ── A1 (independent review): the whole-plan regeneration guard must use the REAL plan size and the same estimate the call is sized with ─────────
import { fullRegenerationCheck } from "../services/revision/workout-revision-planner";
const HOSTED = { providerMaxOutputTokens: 5000, headroom: 1.25, baseTokens: 250, tokensPerExercise: 140 };
const LOCAL = { providerMaxOutputTokens: 4500, headroom: 1.25, baseTokens: 250, tokensPerExercise: 80 };
const sized = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`);

test("A1 boundary: plans of 25, 28, 30 and 31 exercises FIT a hosted 5000-token output (600 + 140/exercise, no headroom) and are not rejected; 32 does not", () => {
  const expected: Record<number, number> = { 25: 4100, 28: 4520, 30: 4800, 31: 4940, 32: 5080 };
  for (const [n, needed] of Object.entries(expected)) {
    const r = fullRegenerationCheck(Number(n), HOSTED);
    assert.equal(r.needed, needed, `${n} exercises`);
    assert.equal(r.ok, Number(n) <= 31, `${n} exercises: ok=${r.ok}`);
    assert.equal(r.limit, 5000);
  }
  // the pre-fix formula (with the 1.25 headroom) would have refused 25..31 although the call itself fits:
  for (const n of [25, 28, 30, 31]) assert.ok(Math.ceil((600 + n * 140) * 1.25) > 5000, `${n}: old guard would have refused`);
});

test("A1: the budget follows the ACTUAL exercise count and the provider's limit (non-hosted 80/exercise, env override), and the target is never lowered", () => {
  assert.ok(fullRegenerationCheck(31, LOCAL).ok);
  assert.equal(fullRegenerationCheck(31, LOCAL).needed, 600 + 31 * 80);
  assert.ok(!fullRegenerationCheck(31, { ...HOSTED, providerMaxOutputTokens: 4000 }).ok, "a lower provider limit refuses; it never silently shrinks the plan");
  assert.equal(fullRegenerationCheck(0, HOSTED).needed, 600);
  // monotonic in the count
  let prev = 0; for (let n = 1; n <= 40; n++) { const r = fullRegenerationCheck(n, HOSTED).needed; assert.ok(r > prev); prev = r; }
  // env-driven config feeds the same function
  const env = tokenBudgetConfig({ LLM_PROVIDER: "bedrock", AI_PLAN_MAX_OUTPUT_TOKENS: "5000" } as any);
  assert.equal(fullRegenerationCheck(31, env).ok, true);
  assert.equal(fullRegenerationCheck(32, env).ok, false);
});

test("A1 chunking: a 31-exercise plan (4,4,4,4,5,5,5) raised to the per-day maximum of 10 needs more output than one call allows -> several day-aligned chunks, each within the limit, covering every day", () => {
  const counts = [4, 4, 4, 4, 5, 5, 5];
  const prev: PlanDay[] = counts.map((c, d) => ({ day: `Day ${d + 1}`, goal: "x", cardio: "c", exercises: sized(c).map((id, i) => ex(`p${d}-${id}`, i + 1)) }));
  assert.equal(prev.reduce((n, d) => n + d.exercises.length, 0), 31);
  const work = planRevisionWork(prev, 10, HOSTED);
  assert.equal(work.conflict, undefined);
  assert.equal(work.days.reduce((n, d) => n + d.add, 0), 39, "adds exactly what is missing: 10*7 - 31");
  assert.ok(work.days.every((d) => d.have + d.add === 10), "every day ends at the per-day maximum, never above");
  assert.ok(work.chunks.length > 1, `chunked (${work.chunks.length})`);
  assert.ok(work.chunkTokens.every((t) => t <= HOSTED.providerMaxOutputTokens), JSON.stringify(work.chunkTokens));
  assert.deepEqual([...work.chunks.flat()].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6], "each day is in exactly one chunk");
  // a 4-day plan of 25 -> 10/day still fits one call (no needless chunking)
  const small: PlanDay[] = [0, 1, 2, 3, 4].map((d) => ({ day: `Day ${d + 1}`, goal: "x", cardio: "c", exercises: sized(5).map((id, i) => ex(`q${d}-${id}`, i + 1)) }));
  const w2 = planRevisionWork(small, 10, HOSTED);
  assert.equal(w2.chunks.length, 1); assert.ok(w2.chunkTokens[0] <= 5000);
});

import { planFullRegenerationChunks } from "../services/revision/workout-revision-planner";
test("A1-F1 chunk planner: a plan that fits stays ONE group; bigger ones are split by DAYS, each group within the limit, every day exactly once, the count never lowered", () => {
  assert.deepEqual(planFullRegenerationChunks([5, 5, 5, 5, 5], HOSTED).chunks, [[0, 1, 2, 3, 4]], "25 exercises: one call (unchanged behaviour)");
  assert.deepEqual(planFullRegenerationChunks([7, 7, 7, 7], HOSTED).chunks, [[0, 1, 2, 3]], "28: one call");
  assert.deepEqual(planFullRegenerationChunks([8, 8, 8, 8], HOSTED).chunks, [[0, 1, 2], [3]], "32: refused before, now 2 groups");
  assert.deepEqual(planFullRegenerationChunks([7, 7, 7, 7, 7], HOSTED).chunks, [[0, 1, 2, 3], [4]], "35");
  const big = planFullRegenerationChunks([10, 10, 10, 10, 10, 10, 10], HOSTED);
  assert.deepEqual(big.chunks, [[0, 1, 2], [3, 4, 5], [6]], "70 (7 days x the per-day maximum 10)");
  assert.ok(big.chunkTokens.every((t) => t <= HOSTED.providerMaxOutputTokens), JSON.stringify(big.chunkTokens));
  assert.deepEqual(big.chunks.flat(), [0, 1, 2, 3, 4, 5, 6], "each day in exactly one group, in order");
  // uneven days (the real 31-exercise case) are respected by actual count
  const uneven = planFullRegenerationChunks([4, 4, 4, 4, 5, 5, 5], HOSTED);
  assert.equal(uneven.chunks.length, 1, "31 exercises fit one call"); 
  assert.equal(planFullRegenerationChunks([10, 10, 10, 10], LOCAL).chunks.flat().length, 4);
  // a single day that cannot fit the provider limit is the only conflict, and it is explicit
  const tiny = planFullRegenerationChunks([10, 4], { ...HOSTED, providerMaxOutputTokens: 1500 });
  assert.equal(tiny.conflict?.code, "TOKEN_BUDGET"); assert.match(tiny.conflict!.message, /không tự giảm số bài/);
});

test("item 2 phrases: 7 / 8 absolute, +2 relative, 'còn 3' absolute, 'giữ nguyên bài cũ và bổ sung bài mới' (no count) is a QUESTION, never 'no change'", () => {
  const r = (t: string, cur = 4) => R({ parsed: P(t), current: cur });
  assert.deepEqual(r("Tăng tất cả buổi lên 7 bài"), { ok: true, target: 7, source: "text-absolute" });
  assert.deepEqual(r("Từ 4 bài lên 8 bài mỗi buổi"), { ok: true, target: 8, source: "text-absolute" });
  assert.deepEqual(r("Thêm 2 bài mỗi buổi"), { ok: true, target: 6, source: "text-relative" });
  assert.deepEqual(r("Giảm còn 3 bài"), { ok: true, target: 3, source: "text-absolute" });
  const keep = r("Giữ nguyên bài cũ và bổ sung bài mới");
  assert.ok(!keep.ok && keep.code === "AMBIGUOUS" && /bao nhiêu bài/.test(keep.message));
  assert.equal(P("Giữ nguyên bài cũ và bổ sung bài mới").keepExisting, true);
  // with a number the same sentence is a normal request
  assert.deepEqual(r("Giữ nguyên bài cũ và bổ sung thêm bài mới, mỗi buổi 6 bài"), { ok: true, target: 6, source: "text-absolute" });
  // "giữ nguyên bài cũ" alone does not ask anything
  assert.deepEqual(r("Giữ nguyên bài cũ, thêm cardio"), { ok: true, target: 4, source: "current" });
});

test("Phase 1A phrases: ambiguous 'add' requests ask for the number (never guessed, never 'no change'); clear ones parse exactly; muscle-focus additions are not counts", () => {
  const r = (t: string) => R({ parsed: P(t), current: 4 });
  for (const t of ["Bổ sung bài mới", "Thêm bài cho các buổi", "Tăng số bài", "Thêm bài", "Bổ sung bài tập", "Thêm bài mới cho mỗi buổi", "Bổ sung thêm bài cho tất cả các buổi", "Giữ nguyên bài cũ và bổ sung bài mới"]) {
    const x = r(t); assert.ok(!x.ok && x.code === "AMBIGUOUS", `${t} -> ${JSON.stringify(x)}`);
  }
  assert.deepEqual(r("Lên 7 bài"), { ok: true, target: 7, source: "text-absolute" });
  assert.deepEqual(r("Thêm 2 bài mỗi buổi"), { ok: true, target: 6, source: "text-relative" });
  assert.deepEqual(r("Mỗi buổi 7 bài"), { ok: true, target: 7, source: "text-absolute" });
  // a muscle-focus addition keeps the current count (existing behaviour), it is not a question
  for (const t of ["Thêm bài bụng", "Thêm 2 bài bụng", "Bổ sung bài tập chân"]) assert.deepEqual(r(t), { ok: true, target: 4, source: "current" }, t);
  // a number anywhere wins over the vague wording
  assert.deepEqual(r("Bổ sung bài mới, mỗi buổi 6 bài"), { ok: true, target: 6, source: "text-absolute" });
});
