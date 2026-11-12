import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTurnFacts, applyTurnFacts, formatTurnFactsForPrompt } from "../turn_facts";
import { enforceExerciseConstraints, findExerciseViolations } from "../exercise_constraint_guard";
import { planContext, estimateTokens, fitToBudget } from "../context_plan";
import { promptBuilder } from "../prompt_builder";
import { recommendationEngine } from "../recommendation_engine";
import { inputParser } from "../input_parser";
import { responseFormatter } from "../response_formatter";
import type { UserProfile } from "../types";

const profile = (over: Partial<UserProfile> = {}): UserProfile => ({
  age: 52, gender: "FEMALE", heightCm: 158, currentWeightKg: 68, goal: "WEIGHT_LOSS", experienceLevel: "INTERMEDIATE",
  training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] },
  ...over,
} as UserProfile);

test("TurnFacts: '52 tuổi, mới tập, ở nhà không có dụng cụ' is extracted with provenance", () => {
  const f = extractTurnFacts("Tôi 52 tuổi, mới tập, ở nhà không có dụng cụ. Nên tập gì?", { profile: profile() });
  assert.deepEqual([f.ageYears?.value, f.ageYears?.source], [52, "message"]);
  assert.deepEqual([f.experience?.value, f.experience?.source], ["beginner", "message"]);
  assert.deepEqual(f.equipment?.value, ["bodyweight"]);
  assert.equal(f.location?.value, "home");
  assert.ok(f.conflicts.some((c) => c.field === "experience"), "profile says INTERMEDIATE → conflict recorded");
});

test("TurnFacts: message age beats profile (B3-14 / B3-41); approximate age kept as such", () => {
  assert.equal(extractTurnFacts("Em 17 tuổi muốn đi tập gym lần đầu", { profile: profile({ age: 16 }) }).ageYears?.value, 17);
  const sixty = extractTurnFacts("Tôi sắp 60 tuổi, tập tạ có an toàn không?", { profile: profile({ age: 52 }) });
  assert.equal(sixty.ageYears?.value, 60);
  assert.equal(sixty.ageYears?.approximate, true);
  assert.match(formatTurnFactsForPrompt(sixty), /khoảng 60/);
});

test("TurnFacts: an age conflict across 18 is resolved conservatively (minor reading) and flagged", () => {
  const f = extractTurnFacts("Mình 19 tuổi rồi, cho mình lịch tập nặng", { profile: profile({ age: 16 }) });
  assert.equal(f.ageYears?.value, 16);
  assert.ok(f.conflicts.find((c) => c.field === "age")?.safetyRelevant);
  assert.match(formatTurnFactsForPrompt(f), /dưới 18 tuổi/);
});

test("TurnFacts: an earlier turn of the SAME session counts (B1-50); the current message wins over it", () => {
  const f = extractTurnFacts("Vậy lên giúp em một buổi tập chân nhé.", { sessionUserMessages: ["Em chỉ có khoảng 30 phút mỗi buổi và tập ở nhà, không có tạ."] });
  assert.deepEqual([f.equipment?.value, f.equipment?.source], [["bodyweight"], "session"]);
  assert.equal(f.minutesPerSession?.value, 30);
  const g = extractTurnFacts("Giờ em có tạ đơn rồi", { sessionUserMessages: ["ở nhà, không có tạ"] });
  assert.deepEqual([g.equipment?.source, g.equipment?.value.includes("dumbbell")], ["message", true]);
});

test("TurnFacts: nothing is inferred when nothing was stated", () => {
  const f = extractTurnFacts("Plank nên giữ bao lâu là đủ?", {});
  assert.equal(f.ageYears, undefined);
  assert.equal(f.equipment, undefined);
  assert.equal(formatTurnFactsForPrompt(f), "");
});

test("TurnFacts → deterministic template: 'ở nhà, không có tạ' (previous turn) gets no dumbbell/machine leg exercise (B1-50)", () => {
  const p0 = profile({ age: 26, experienceLevel: "BEGINNER" });
  const facts = extractTurnFacts("Vậy lên giúp em một buổi tập chân nhé.", { sessionUserMessages: ["Em tập ở nhà, không có tạ."], profile: p0 });
  const p = applyTurnFacts(p0, facts);
  assert.deepEqual(p.training.availableEquipment, ["bodyweight"]);
  assert.deepEqual(p0.training.availableEquipment, [], "saved profile object untouched");
  const intent = inputParser.parse("Vậy lên giúp em một buổi tập chân nhé.", p);
  const answer = responseFormatter.format(recommendationEngine.recommend(p, intent, "vi"), "vi");
  assert.doesNotMatch(answer, /Goblet Squat|Leg Press|Hack Squat|Barbell|Smith/);
});

test("exercise constraint guard: machine/advanced exercises are removed for 'no equipment, beginner' (B1-12)", () => {
  const facts = extractTurnFacts("Tôi 52 tuổi, chưa tập thể dục bao giờ, ở nhà không có dụng cụ", {});
  const answer = ["Gợi ý tuần đầu:", "- Bodyweight Squat 2×10", "- Nordic Ham Curl 3×5", "- Lat Pulldown 3×10", "- Plank 3×20 giây", "Đi bộ 30 phút mỗi ngày."].join("\n");
  const out = enforceExerciseConstraints(answer, facts);
  assert.doesNotMatch(out.answer, /^- (Nordic Ham Curl|Lat Pulldown)/m);
  assert.match(out.answer, /Plank 3×20/);
  assert.match(out.answer, /Đi bộ 30 phút/);
  assert.ok(out.violations.some((v) => v.reason === "difficulty" && /Nordic/.test(v.exercise.nameEn)));
  assert.ok(out.violations.some((v) => v.reason === "equipment" && /Lat Pulldown/.test(v.exercise.nameEn)));
});

test("exercise constraint guard: no-op when the user stated nothing / is at a gym", () => {
  const answer = "- Lat Pulldown 3×10\n- Nordic Ham Curl 3×5";
  assert.equal(findExerciseViolations(answer, extractTurnFacts("Bài kéo lưng nào tốt?", {})).length, 0);
  assert.equal(findExerciseViolations(answer, extractTurnFacts("Tôi tập ở phòng gym đầy đủ máy, đã tập 3 năm", {})).length, 0);
});

test("context plan: a general knowledge question carries no history / body-comp / CoachContext / evidence", () => {
  const plan = planContext({ intent: "general_fitness_knowledge", question: "Plank nên giữ bao lâu là đủ?", personalQuestion: false, bodyCompositionQuestion: false, mentionsInjury: false, hasSessionHistory: false });
  for (const b of ["inbody_history", "workout_history", "nutrition_history", "programs", "body_composition", "coach_context", "body_comp_evidence", "chat_history"] as const) {
    assert.ok(!plan.blocks.has(b), b);
  }
  assert.ok(plan.blocks.has("retrieval") && plan.blocks.has("turn_facts"));
});

test("context plan: nutrition / InBody / progress / follow-up questions get what they need", () => {
  const base = { personalQuestion: true, bodyCompositionQuestion: false, mentionsInjury: false, hasSessionHistory: false };
  assert.ok(planContext({ ...base, intent: "meal_plan_request", question: "Thực đơn tăng cơ cho tôi" }).blocks.has("coach_context"));
  const inbody = planContext({ ...base, intent: "general_fitness_knowledge", question: "Chỉ số InBody của tôi nói gì?", bodyCompositionQuestion: true });
  assert.ok(inbody.blocks.has("inbody_history") && inbody.blocks.has("body_comp_evidence"));
  assert.ok(planContext({ ...base, intent: "general_fitness_knowledge", question: "Tiến độ của tôi so với tháng trước thế nào?" }).blocks.has("inbody_history"));
  assert.ok(planContext({ ...base, intent: "general_fitness_knowledge", question: "Vậy tôi nên giảm bao nhiêu kg mỗi tuần?", hasSessionHistory: true }).blocks.has("chat_history"));
});

test("fitToBudget cuts at line boundaries", () => {
  const long = Array.from({ length: 400 }, (_, i) => `- dòng ${i} có một chút nội dung`).join("\n");
  const cut = fitToBudget(long, "retrieval");
  assert.ok(estimateTokens(cut) <= 1100 + 2);
  assert.ok(cut.split("\n").slice(0, -1).every((l) => /^- dòng \d+ có một chút nội dung$/.test(l)));
});

function fullContext() {
  const p = profile({ training: { availableEquipment: ["dumbbell"], injuries: [], preferredTrainingDays: [], trainingDaysPerWeek: 4 } } as any);
  return {
    profile: p,
    inBodyHistory: Array.from({ length: 5 }, (_, i) => ({ date: `2026-1${i}-01`, weight: 68 - i, bodyFatPct: 30 - i, bodyFat: 20, muscleMass: 24, rightArmMuscle: 2.1, leftArmMuscle: 2.0, trunkMuscle: 20, rightLegMuscle: 7, leftLegMuscle: 7 })),
    workoutHistory: Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-0${i + 1}`, duration: 50, exercises: Array.from({ length: 6 }, (_, j) => ({ name: `Exercise ${j}`, sets: 3, reps: 10, weight: 20 })) })),
    nutritionHistory: Array.from({ length: 14 }, (_, i) => ({ date: `2026-11-${10 + (i % 7)}`, calories: 500, protein: 30, carbs: 50, fats: 15, foodName: `Món ${i}`, quantity: 100 })),
    memories: [],
  } as any;
}

test("prompt size: a general knowledge prompt with a plan is materially smaller than the legacy prompt (same inputs)", () => {
  const ctx = fullContext();
  const intent = { ...inputParser.parse("Plank nên giữ bao lâu là đủ?", ctx.profile), routeIntent: "general_fitness_knowledge" } as any;
  const rec = recommendationEngine.recommend(ctx.profile, intent, "vi");
  const retrieval = { documents: [], isEmpty: true, reason: "test" } as any;
  const legacy = promptBuilder.build("Plank nên giữ bao lâu là đủ?", intent, ctx, retrieval, rec, "vi", [], "CoachContext JSON (sanitized, no user identity):\n" + "x".repeat(4000));
  let manifest: any;
  const plan = planContext({ intent: "general_fitness_knowledge", question: "Plank nên giữ bao lâu là đủ?", personalQuestion: false, bodyCompositionQuestion: false, mentionsInjury: false, hasSessionHistory: false });
  const lean = promptBuilder.build("Plank nên giữ bao lâu là đủ?", intent, ctx, retrieval, rec, "vi", [], undefined, { contextPlan: plan, onManifest: (m) => (manifest = m) });
  assert.ok(estimateTokens(lean) < estimateTokens(legacy) * 0.6, `${estimateTokens(lean)} vs ${estimateTokens(legacy)}`);
  assert.doesNotMatch(lean, /Lịch sử InBody|Lịch sử tập luyện|Lịch sử dinh dưỡng|CoachContext JSON/);
  assert.ok(manifest && manifest.entries.every((e: any) => typeof e.tokens === "number" && !("text" in e)));
  assert.ok(manifest.skipped.includes("coach_context"));
});

test("prompt with plan: stated constraints reach a general-knowledge prompt; legacy call without options is unchanged in shape", () => {
  const ctx = fullContext();
  const intent = { ...inputParser.parse("Tôi 52 tuổi, mới tập, ở nhà không có dụng cụ. Nên tập gì?", ctx.profile), routeIntent: "general_fitness_knowledge" } as any;
  const rec = recommendationEngine.recommend(ctx.profile, intent, "vi");
  const facts = formatTurnFactsForPrompt(extractTurnFacts("Tôi 52 tuổi, mới tập, ở nhà không có dụng cụ. Nên tập gì?", { profile: ctx.profile }));
  const p = promptBuilder.build("Tôi 52 tuổi, mới tập, ở nhà không có dụng cụ. Nên tập gì?", intent, ctx, { documents: [], isEmpty: true } as any, rec, "vi", [], undefined, { turnFactsText: facts });
  assert.match(p, /Ràng buộc user đã nêu/);
  assert.match(p, /TUYỆT ĐỐI không đề xuất bài cần dụng cụ khác/);
  const legacy = promptBuilder.build("Plank?", intent, ctx, { documents: [], isEmpty: true } as any, rec, "vi", []);
  assert.match(legacy, /Lịch sử InBody/, "no plan → legacy blocks still present");
});
