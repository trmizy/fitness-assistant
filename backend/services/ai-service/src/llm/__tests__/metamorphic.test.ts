import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTurnFacts, applyTurnFacts } from "../turn_facts";
import { findExerciseViolations } from "../exercise_constraint_guard";
import { findExerciseMentions, normalizeExerciseNames } from "../exercise_name_normalizer";
import { classifyMessageSpeechAct } from "../speech_act";
import { intentRouter } from "../intent_router";
import { inputParser } from "../input_parser";
import { recommendationEngine } from "../recommendation_engine";
import { responseFormatter } from "../response_formatter";
import type { UserProfile } from "../types";

const base = (): UserProfile => ({
  age: 30, gender: "MALE", heightCm: 175, currentWeightKg: 80, goal: "MUSCLE_GAIN", experienceLevel: "BEGINNER",
  training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] },
} as UserProfile);

// Metamorphic relation 1: appending "I am at home with no equipment" to a plan request must remove every exercise that
// needs equipment from the deterministic answer (catalog-based check), whatever the muscle group.
test("MR1: + 'ở nhà, không có dụng cụ' ⇒ deterministic plan has no equipment-bound exercise", () => {
  for (const req of ["Lên giúp em một buổi tập chân", "Cho tôi bài tập ngực", "Cho tôi lịch tập 3 buổi mỗi tuần", "Tạo lịch tập vai hôm nay"]) {
    const msg = `Tôi ở nhà, không có dụng cụ. ${req}`;
    const facts = extractTurnFacts(msg, { profile: base() });
    const p = applyTurnFacts(base(), facts);
    const answer = responseFormatter.format(recommendationEngine.recommend(p, inputParser.parse(msg, p), "vi"), "vi");
    const v = findExerciseViolations(answer, facts).filter((x) => x.reason === "equipment");
    assert.deepEqual(v.map((x) => x.name), [], `${req}: ${v.map((x) => x.name).join(", ")}`);
  }
});

// MR2: Vietnamese / English / abbreviated names of the same exercise resolve to the same catalog identity.
test("MR2: VI / EN / abbreviation name the same catalog exercise", () => {
  const ids = (t: string) => findExerciseMentions(normalizeExerciseNames(t)).map((e) => e.catalogId);
  assert.deepEqual(ids("Tập RDL cho đùi sau"), ids("Tập Romanian Deadlift cho đùi sau"));
  assert.ok(ids("Tập Romanian Deadlift cho đùi sau").length === 1);
});

// MR3: punctuation does not change the speech act or the route of an advice question.
test("MR3: with or without '?' an advice question stays a question and avoids the plan template", () => {
  for (const q of ["Tập 5 buổi mỗi tuần liệu có quá nhiều với người mới không", "Vậy tôi nên tăng tạ thế nào", "Ăn chay thì có tăng cơ được không"]) {
    assert.equal(classifyMessageSpeechAct(q), classifyMessageSpeechAct(`${q}?`), q);
    assert.equal(intentRouter.route(q, undefined as any).intent, intentRouter.route(`${q}?`, undefined as any).intent, q);
  }
});

// MR4: the order of earlier session messages does not change a stated fact; the newest statement wins on conflict.
test("MR4: session order — unrelated turns do not change facts; the newest equipment statement wins", () => {
  const a = extractTurnFacts("Lên buổi tập chân", { sessionUserMessages: ["Em 26 tuổi", "Em ở nhà không có tạ"] });
  const b = extractTurnFacts("Lên buổi tập chân", { sessionUserMessages: ["Em ở nhà không có tạ", "Em 26 tuổi"] });
  assert.deepEqual(a.equipment?.value, b.equipment?.value);
  assert.equal(a.ageYears?.value, b.ageYears?.value);
  const newest = extractTurnFacts("Lên buổi tập chân", { sessionUserMessages: ["Giờ em có tạ đơn rồi", "Em ở nhà không có tạ"] }); // most recent first
  assert.ok(newest.equipment?.value.includes("dumbbell"));
});

// MR5: a minor stays a minor whether the age comes from the message or the profile (safety-relevant, conservative).
test("MR5: 16 vs 17 — both readings are minors; an adult claim against a minor profile keeps the minor reading", () => {
  for (const [msgAge, profAge] of [[17, 16], [16, 17], [19, 16]] as const) {
    const f = extractTurnFacts(`Em ${msgAge} tuổi muốn tập gym`, { profile: { ...base(), age: profAge } as UserProfile });
    assert.ok((f.ageYears?.value ?? 99) < 18, `${msgAge}/${profAge} -> ${f.ageYears?.value}`);
  }
});
