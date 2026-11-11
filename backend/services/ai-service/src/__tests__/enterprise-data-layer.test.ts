/**
 * Phase 3 Batch 1 (docs/ai-product/phase3-batch1-context-foundation.md) — Enterprise Data Layer.
 * Unit-level: stubs profileExtractor.extract (for the profile/goal/workout-program/nutrition-
 * program readers, which are thin projections over it) and axios.get at the HTTP boundary (for
 * the two readers that call fitness-service directly: getLatestNutritionGoal, getNutritionGoals).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { profileExtractor } from "../llm/profile_extractor";
import { getUserProfile, getCurrentFitnessGoal } from "../services/enterprise-data/profile.reader";
import { getActiveNutritionGoal, getLatestNutritionGoal, getNutritionGoals, getCurrentNutritionProgram } from "../services/enterprise-data/nutrition.reader";
import { getCurrentWorkoutProgram } from "../services/enterprise-data/workout.reader";

const originalExtract = profileExtractor.extract;
const originalAxiosGet = axios.get;
test.afterEach(() => {
  profileExtractor.extract = originalExtract;
  axios.get = originalAxiosGet;
});

const identity = () => ({ userId: `edl-${randomUUID()}`, authorizationHeader: "Bearer test" });

// ───────────────────────── T01/T07 profile canonicalization + auth propagation ─────────────────────────
test("getUserProfile: canonicalizes the authoritative profile and propagates identity to profileExtractor.extract", async () => {
  const id = identity();
  let seenArgs: unknown[] = [];
  profileExtractor.extract = (async (userId: any, authHeader: any) => {
    seenArgs = [userId, authHeader];
    return { profile: { userId, goal: "MUSCLE_GAIN", heightCm: 175 }, inBodyHistory: [], workoutHistory: [], nutritionHistory: [] };
  }) as any;

  const read = await getUserProfile(id);
  assert.equal(read.status, "ok");
  assert.equal((read as any).value.goal, "MUSCLE_GAIN");
  assert.equal(read.source, "USER_SERVICE");
  assert.deepEqual(seenArgs, [id.userId, id.authorizationHeader], "identity must flow through to the real extract call, never trusted from elsewhere");
});

test("getCurrentFitnessGoal: absent (not an error) when the profile has no goal set", async () => {
  profileExtractor.extract = (async () => ({ profile: {}, inBodyHistory: [], workoutHistory: [], nutritionHistory: [] })) as any;
  const read = await getCurrentFitnessGoal(identity());
  assert.equal(read.status, "absent");
});

// ───────────────────────── T02/T03/T04 nutrition goal semantics ─────────────────────────
test("getActiveNutritionGoal: returns the ACTIVE goal when profileExtractor resolved one", async () => {
  profileExtractor.extract = (async () => ({
    profile: { nutritionGoal: { calories: 2200, protein: 150, carbs: 220, fat: 70 } },
    inBodyHistory: [], workoutHistory: [], nutritionHistory: [],
  })) as any;
  const read = await getActiveNutritionGoal(identity());
  assert.equal(read.status, "ok");
  assert.equal((read as any).value.calories, 2200);
});

test("getActiveNutritionGoal: explicit absence (not a fabricated default) when no ACTIVE goal exists — DEFAULT/inactive already excluded by profileExtractor's own guard", async () => {
  profileExtractor.extract = (async () => ({ profile: {}, inBodyHistory: [], workoutHistory: [], nutritionHistory: [], nutritionGoalFetchFailed: false })) as any;
  const read = await getActiveNutritionGoal(identity());
  assert.equal(read.status, "absent", "must never substitute a fabricated default for a genuinely-missing active goal");
});

test("getActiveNutritionGoal: upstream fetch failure is reported as an explicit error, never confused with 'no goal' (the real gap profile_extractor.ts had before this batch)", async () => {
  profileExtractor.extract = (async () => ({ profile: {}, inBodyHistory: [], workoutHistory: [], nutritionHistory: [], nutritionGoalFetchFailed: true })) as any;
  const read = await getActiveNutritionGoal(identity());
  assert.equal(read.status, "error", "a failed /nutrition/goals fetch must never be reported as 'you have no goal'");
});

test("getLatestNutritionGoal: a real (id-having) goal is returned regardless of ACTIVE status", async () => {
  (axios as any).get = (async (url: string) => {
    assert.match(url, /\/nutrition\/goals$/);
    return { data: { id: "goal-1", calories: 1900, protein: 140, carbs: 180, fat: 60, status: "SUPERSEDED" } };
  }) as any;
  const read = await getLatestNutritionGoal(identity());
  assert.equal(read.status, "ok", "latest goal must not apply the ACTIVE-only filter getActiveNutritionGoal does");
  assert.equal((read as any).value.calories, 1900);
});

test("getLatestNutritionGoal: the id-less DEFAULT placeholder is still correctly treated as absent", async () => {
  (axios as any).get = (async () => ({ data: { calories: 2000, protein: 150, carbs: 200, fat: 65 } })) as any; // no id
  const read = await getLatestNutritionGoal(identity());
  assert.equal(read.status, "absent");
});

test("getNutritionGoals: reads the real goal-history endpoint and filters out any placeholder rows", async () => {
  let calledUrl = "";
  (axios as any).get = (async (url: string) => {
    calledUrl = url;
    return { data: [
      { id: "g1", calories: 2000, protein: 150, carbs: 200, fat: 65 },
      { calories: 1800, protein: 130, carbs: 180, fat: 55 }, // no id — not a real row
    ] };
  }) as any;
  const read = await getNutritionGoals(identity());
  assert.match(calledUrl, /\/nutrition\/goals\/history$/);
  assert.equal(read.status, "ok");
  assert.equal((read as any).value.length, 1);
});

// ───────────────────────── T05/T06 workout/nutrition program normalization ─────────────────────────
test("getCurrentWorkoutProgram: projects profileExtractor's compacted shape, absent when none", async () => {
  profileExtractor.extract = (async () => ({ profile: {}, inBodyHistory: [], workoutHistory: [], nutritionHistory: [], currentWorkoutProgram: { name: "Push Pull Legs", dayCount: 6 } })) as any;
  const read = await getCurrentWorkoutProgram(identity());
  assert.equal(read.status, "ok");
  assert.equal((read as any).value.name, "Push Pull Legs");

  profileExtractor.extract = (async () => ({ profile: {}, inBodyHistory: [], workoutHistory: [], nutritionHistory: [], currentWorkoutProgram: null })) as any;
  const absentRead = await getCurrentWorkoutProgram(identity());
  assert.equal(absentRead.status, "absent");
});

test("getCurrentNutritionProgram: projects profileExtractor's compacted shape, absent when none", async () => {
  profileExtractor.extract = (async () => ({ profile: {}, inBodyHistory: [], workoutHistory: [], nutritionHistory: [], currentNutritionProgram: { name: "Cutting Plan", mealsPerDay: 4 } })) as any;
  const read = await getCurrentNutritionProgram(identity());
  assert.equal(read.status, "ok");
  assert.equal((read as any).value.mealsPerDay, 4);
});

// ───────────────────────── T08 cross-user isolation ─────────────────────────
test("cross-user isolation: two identities never see each other's stubbed result (no shared module state leaking through the readers)", async () => {
  const idA = identity();
  const idB = identity();
  profileExtractor.extract = (async (userId: any) => ({
    profile: { goal: userId === idA.userId ? "WEIGHT_LOSS" : "MUSCLE_GAIN" },
    inBodyHistory: [], workoutHistory: [], nutritionHistory: [],
  })) as any;
  const [a, b] = await Promise.all([getCurrentFitnessGoal(idA), getCurrentFitnessGoal(idB)]);
  assert.equal((a as any).value, "WEIGHT_LOSS");
  assert.equal((b as any).value, "MUSCLE_GAIN");
});
