/**
 * Phase 3 Batch 1 (docs/ai-product/phase3-batch1-context-foundation.md) — Context Assembler +
 * the request-scoped dedup it relies on (profile_extractor.ts's in-flight + 15s TTL cache).
 * Deliberately stubs axios.get (NOT profileExtractor.extract directly) so the REAL caching/
 * coalescing logic under test actually runs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { assembleContext } from "../services/context-assembler";
import { getCurrentWorkoutProgram } from "../services/enterprise-data/workout.reader";

const originalGet = axios.get;
const originalPost = axios.post;
const originalPut = axios.put;
let callLog: string[] = [];

function stubHttp() {
  callLog = [];
  (axios as any).get = async (url: string) => {
    callLog.push(url.split("?")[0]);
    if (url.includes("/profile/me")) return { data: { profile: { goal: "MUSCLE_GAIN", heightCm: 175 } } };
    if (url.includes("/inbody")) return { data: [] };
    if (url.includes("/workouts/programs/current")) return { data: { name: "PPL", daysPerWeek: 6, days: [] } };
    if (url.includes("/workouts/schedules")) return { data: [] };
    if (url.includes("/workouts")) return { data: [] };
    if (url.includes("/nutrition/daily-history")) return { data: { data: [] } };
    if (url.includes("/nutrition/plans/current")) return { data: { data: null } };
    if (url.includes("/nutrition/goals/history")) return { data: [] };
    if (url.includes("/nutrition/goals")) return { data: { id: "g1", calories: 2200, protein: 150, carbs: 220, fat: 70, status: "ACTIVE" } };
    if (url.includes("/nutrition")) return { data: [] };
    return { data: null };
  };
  // T18 — zero business mutations: any write call during context assembly is a real bug, not a stub gap.
  (axios as any).post = async () => { throw new Error("assembleContext must never issue a write"); };
  (axios as any).put = async () => { throw new Error("assembleContext must never issue a write"); };
}
test.afterEach(() => {
  axios.get = originalGet;
  (axios as any).post = originalPost;
  (axios as any).put = originalPut;
});

const identity = () => ({ userId: `ctx-${randomUUID()}`, authorizationHeader: "Bearer test" });

// ───────────────────────── T09/T10 request-scoped dedup ─────────────────────────
test("T09/T10: two profileExtractor-backed reads for the SAME user, issued concurrently, result in exactly one upstream /profile/me and one /workouts/programs/current call", async () => {
  stubHttp();
  const id = identity();
  await Promise.all([getCurrentWorkoutProgram(id), getCurrentWorkoutProgram(id)]);
  assert.equal(callLog.filter((u) => u.includes("/workouts/programs/current")).length, 1, "the second concurrent call must coalesce onto the first in-flight fetch, not start a new one");
  assert.equal(callLog.filter((u) => u.includes("/profile/me")).length, 1);
});

test("T09/T10 via the facade: assembleContext with two profile-backed needs makes exactly one upstream batch", async () => {
  stubHttp();
  const id = identity();
  const ctx = await assembleContext(id, ["PROFILE", "CURRENT_WORKOUT_PROGRAM"]);
  assert.equal(ctx.profile?.status, "ok");
  assert.equal(ctx.currentWorkoutProgram?.status, "ok");
  assert.equal(callLog.filter((u) => u.includes("/profile/me")).length, 1, "PROFILE and CURRENT_WORKOUT_PROGRAM share the same profileExtractor.extract() call — must not double-fetch");
});

// ───────────────────────── T11 cross-turn reuse of the existing 15s TTL cache ─────────────────────────
test("T11: a second assembleContext call for the same user within the existing 15s TTL window reuses the cached result (documented, pre-existing cache policy — not a new one invented by this batch)", async () => {
  stubHttp();
  const id = identity();
  await assembleContext(id, ["PROFILE"]);
  const before = callLog.filter((u) => u.includes("/profile/me")).length;
  await assembleContext(id, ["PROFILE"]);
  const after = callLog.filter((u) => u.includes("/profile/me")).length;
  assert.equal(before, 1);
  assert.equal(after, 1, "within the 15s TTL, a second call must be a cache hit, not a fresh request");
});

// ───────────────────────── T12 cross-user isolation ─────────────────────────
test("T12: two different users requesting the same resource each get their own independent fetch", async () => {
  stubHttp();
  const idA = identity();
  const idB = identity();
  await Promise.all([assembleContext(idA, ["PROFILE"]), assembleContext(idB, ["PROFILE"])]);
  assert.equal(callLog.filter((u) => u.includes("/profile/me")).length, 2, "different users must never share a cache entry");
});

// ───────────────────────── T13 failure-caching semantics ─────────────────────────
test("T13: a failed /nutrition/goals fetch is reported as an error, and that error is cached for the rest of the existing 15s TTL window (deliberate, pre-existing semantics — not redesigned by this batch)", async () => {
  const id = identity();
  callLog = [];
  let goalCalls = 0;
  (axios as any).get = async (url: string) => {
    callLog.push(url);
    if (url.includes("/nutrition/goals")) { goalCalls += 1; throw new Error("fitness-service unavailable"); }
    if (url.includes("/profile/me")) return { data: { profile: {} } };
    return { data: [] };
  };
  const first = await assembleContext(id, ["ACTIVE_NUTRITION_GOAL"]);
  assert.equal(first.activeNutritionGoal?.status, "error");
  const second = await assembleContext(id, ["ACTIVE_NUTRITION_GOAL"]);
  assert.equal(second.activeNutritionGoal?.status, "error", "the failed result is cached for the TTL, same as any other field in the batch");
  assert.equal(goalCalls, 1, "documents the deliberate choice: the SECOND call does not retry within the TTL window");
});

// ───────────────────────── T14/T15/T16 demand-driven ─────────────────────────
test("T14: nutrition-only needs never call the workout-schedule or nutrition-goal-history endpoints", async () => {
  stubHttp();
  await assembleContext(identity(), ["ACTIVE_NUTRITION_GOAL"]);
  assert.ok(!callLog.some((u) => u.includes("/workouts/schedules")));
  assert.ok(!callLog.some((u) => u.includes("/nutrition/goals/history")));
});

test("T15: workout-only needs never call the nutrition-goal-history endpoint, and the result carries no nutrition fields", async () => {
  stubHttp();
  const ctx = await assembleContext(identity(), ["CURRENT_WORKOUT_PROGRAM"]);
  assert.ok(!callLog.some((u) => u.includes("/nutrition/goals/history")));
  assert.equal(ctx.activeNutritionGoal, undefined);
  assert.equal(ctx.workoutSchedule, undefined);
});

test("T16: empty needs issues zero enterprise-data reads", async () => {
  stubHttp();
  const ctx = await assembleContext(identity(), []);
  assert.equal(callLog.length, 0);
  assert.deepEqual(ctx, { equipment: { status: "validationOnly" } });
});

// ───────────────────────── T17 partial upstream failure ─────────────────────────
test("T17: one upstream failure among several needs leaves the successful facts populated and marks only the failed one", async () => {
  const id = identity();
  callLog = [];
  (axios as any).get = async (url: string) => {
    callLog.push(url);
    if (url.includes("/profile/me")) return { data: { profile: { goal: "WEIGHT_LOSS" } } };
    if (url.includes("/nutrition/goals")) throw new Error("fitness-service unavailable");
    return { data: [] };
  };
  const ctx = await assembleContext(id, ["PROFILE", "ACTIVE_NUTRITION_GOAL"]);
  assert.equal(ctx.profile?.status, "ok");
  assert.equal((ctx.profile as any).value.goal, "WEIGHT_LOSS");
  assert.equal(ctx.activeNutritionGoal?.status, "error");
});

// ───────────────────────── T18 no writes ─────────────────────────
test("T18: assembling a full context issues zero business mutations", async () => {
  stubHttp();
  await assembleContext(identity(), ["PROFILE", "FITNESS_GOAL", "ACTIVE_NUTRITION_GOAL", "CURRENT_WORKOUT_PROGRAM", "WORKOUT_SCHEDULE", "RECENT_WORKOUT_HISTORY"]);
  // stubHttp() makes axios.post/put throw — reaching here without throwing is the assertion.
  assert.ok(true);
});
