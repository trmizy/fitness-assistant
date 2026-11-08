import test from "node:test";
import assert from "node:assert/strict";
import {
  isFirstSessionQuestion, parseExerciseHowTo, shortInstructions, buildSessionGuidance, buildExerciseHowTo,
  isHomeNoEquipmentQuestion, pickHomeExercises, buildHomeNoEquipmentAnswer, usableWithoutEquipment,
} from "../services/exercise-guidance";
import { parseDishToAdd, buildDishAnalysis, dishNotFoundAnswer } from "../services/dish-addition";

/** Reviewer feedback (persona playground v2, newbie persona). */
test("first-session questions are recognised; ordinary 'today' questions are not", () => {
  assert.equal(isFirstSessionQuestion("Buổi tập đầu tiên tôi sẽ làm những gì? Hướng dẫn từng bước giúp tôi"), true);
  assert.equal(isFirstSessionQuestion("buoi tap hom nay gom nhung bai nao"), true);
  assert.equal(isFirstSessionQuestion("Hôm nay tôi tập gì?"), false);
  assert.equal(isFirstSessionQuestion("Squat đúng kỹ thuật thế nào?"), false);
});

test("the session guide follows the user's REAL exercises and says nothing was invented", () => {
  const a = buildSessionGuidance({ title: "Thứ 2 (Push A)", source: "DRAFT", exercises: [
    { name: "Incline Dumbbell Press", sets: 3, reps: "8-10", restSeconds: 75, instructions: "Lie on an incline bench. Press the dumbbells up. Lower slowly." },
    { name: "Face Pull", sets: 3, reps: "12-15", restSeconds: 60 },
  ] });
  assert.match(a, /bản nháp lịch tập của bạn/); assert.match(a, /Incline Dumbbell Press/); assert.match(a, /3 hiệp × 8-10/); assert.ok(a.includes("Cách làm (mô tả gốc của thư viện, tiếng Anh): Lie on an incline bench"));
  assert.match(a, /hướng dẫn <tên bài>/);
});

test("'how do I do <exercise>' is parsed; unrelated phrasing is not", () => {
  assert.equal(parseExerciseHowTo("hướng dẫn Goblet Squat"), "goblet squat");
  assert.equal(parseExerciseHowTo("Cách tập bài push-up?"), "push-up");
  assert.equal(parseExerciseHowTo("goblet squat tập như thế nào"), "goblet squat");
  assert.equal(parseExerciseHowTo("Buổi tập đầu tiên tập như thế nào"), null);
  assert.match(buildExerciseHowTo("Goblet Squat", "Hold a dumbbell at chest. Squat down. Stand up."), /Hold a dumbbell/);
  assert.equal(shortInstructions("A. B. C.", 3), "A.");
});

test("home/no-equipment question: recognised, and the answer uses only gear-free library exercises", () => {
  assert.equal(isHomeNoEquipmentQuestion("Tôi muốn giảm mỡ bụng, tập ở nhà không có dụng cụ được không?"), true);
  assert.equal(isHomeNoEquipmentQuestion("Tạo lịch tập ở nhà cho tôi"), false);
  assert.equal(usableWithoutEquipment("Ab Wheel Rollout"), false);
  assert.equal(usableWithoutEquipment("Copenhagen Plank"), true);
  const picks = pickHomeExercises({
    LOWER_BODY: [{ exerciseName: "Bodyweight Squat" }, { exerciseName: "Box Jump" }, { exerciseName: "Walking Lunge" }],
    UPPER_BODY: [{ exerciseName: "Push-Up" }, { exerciseName: "Pull-Up" }],
    CORE: [{ exerciseName: "Ab Wheel Rollout" }, { exerciseName: "Plank" }, { exerciseName: "Dead Bug" }],
  });
  const names = picks.map((p) => p.name);
  assert.ok(!names.some((n) => /wheel|box|pull-up/i.test(n)), names.join(","));
  assert.ok(names.includes("Plank") && names.includes("Push-Up"));
  const a = buildHomeNoEquipmentAnswer(picks);
  assert.match(a, /^\*\*Được\.\*\*/); assert.match(a, /không thể giảm mỡ riêng ở bụng/); assert.match(a, /chỉ lưu khi bạn xác nhận/);
  assert.ok(a.split("\n").length < 18, "short, on the point");
});

test("'thêm bún bò vào thực đơn' gives real numbers, the share of the daily target and a swap, and changes nothing", () => {
  assert.equal(parseDishToAdd("tôi muốn thêm bún bò vào thực đơn"), "bún bò");
  assert.equal(parseDishToAdd("them pho ga vao bua trua"), "pho ga");
  assert.equal(parseDishToAdd("Thực đơn hôm nay của tôi thế nào?"), null);
  const a = buildDishAnalysis({ name: "Bún bò Huế", calories: 90, protein: 6, carbs: 12, fats: 2 }, { asked: "bún bò", dailyCalories: 1351 });
  assert.match(a, /360 kcal/); assert.match(a, /27%/); assert.match(a, /thay cho một bữa chính/); assert.match(a, /chưa thay đổi thực đơn đã lưu/);
  assert.match(dishNotFoundAnswer("món lạ"), /chưa tìm thấy món/);
});
