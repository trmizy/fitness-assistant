/** "Đổi bài X thành Y" in POST /plans/adjust (2026-11-11): X must be in the plan, Y in the catalog — otherwise an honest 422. */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveExerciseSwap } from "../controllers/plan.controller";

const plan = { weeklySchedule: [
  { exercises: [{ name: "Barbell Bench Press - Medium Grip" }, { name: "Close-Grip Barbell Bench Press" }, { name: "Seated Cable Rows" }] },
  { exercises: [{ name: "Narrow Stance Squats" }, { name: "Romanian Deadlift" }] },
] };
const id = { userId: "u1" };
const catalog: Record<string, { id: string; exerciseName: string }> = {
  "goblet squat": { id: "ex-goblet", exerciseName: "Goblet Squat" },
  "dumbbell bench press": { id: "ex-dbbp", exerciseName: "Dumbbell Bench Press" },
};
const search = async (_i: unknown, name: string) => catalog[name.toLowerCase()] ?? null;

test("named swap resolves X in the plan and Y in the catalog", async () => {
  const r = await resolveExerciseSwap("Thay Narrow Stance Squats bằng Goblet Squat", plan, id, search);
  assert.deepEqual(r, { kind: "swap", swap: { fromNames: ["Narrow Stance Squats"], toExerciseId: "ex-goblet", toName: "Goblet Squat" } });
});

test("'không thích X, đổi sang Y' word order is understood", async () => {
  const r = await resolveExerciseSwap("Tôi không thích bài Romanian Deadlift, đổi sang Goblet Squat nhé", plan, id, search);
  assert.equal(r.kind, "swap");
  assert.deepEqual((r as any).swap.fromNames, ["Romanian Deadlift"]);
});

test("ambiguous X, unknown X and unknown Y are refused honestly; a generic target lets the model choose", async () => {
  const amb = await resolveExerciseSwap("Đổi bench press thành Dumbbell Bench Press", plan, id, search);
  assert.equal(amb.kind, "error");
  assert.match((amb as any).message, /Có nhiều bài khớp/);
  const missing = await resolveExerciseSwap("Đổi Leg Press thành Goblet Squat", plan, id, search);
  assert.match((missing as any).message, /không thấy bài/);
  const noTarget = await resolveExerciseSwap("Đổi Seated Cable Rows thành Unicorn Row", plan, id, search);
  assert.match((noTarget as any).message, /không tìm thấy bài/);
  const generic = await resolveExerciseSwap("Đổi Seated Cable Rows thành một bài khác", plan, id, search);
  assert.deepEqual(generic, { kind: "swap", swap: { fromNames: ["Seated Cable Rows"] } });
});

test("non-swap requests are left to the other adjustment rules", async () => {
  assert.deepEqual(await resolveExerciseSwap("Thêm bài tập bụng vào mỗi buổi", plan, id, search), { kind: "none" });
});
