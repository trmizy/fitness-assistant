/** Unit tests for the "Điều chỉnh" text → constraints parser (adjust eval 2026-11-11). Pure, no I/O. */
import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkoutAdjustment, exerciseViolates, fetchLocationFor } from "../services/revision/workout-adjustment-constraints";

const P = parseWorkoutAdjustment;
const bad = (text: string, name: string, eq = "BARBELL", diff = "beginner") => exerciseViolates({ exerciseName: name, typeOfEquipment: eq, difficultyLevel: diff }, P(text));

test("explicit removals filter the matching catalog names only", () => {
  assert.equal(bad("Bỏ hết các bài squat", "Barbell Back Squat"), true);
  assert.equal(bad("Bỏ hết các bài squat", "Romanian Deadlift"), false);
  assert.equal(bad("Tôi bị đau lưng dưới, bỏ deadlift và các bài gập người mang tạ", "Bent Over Barbell Row"), true);
  assert.equal(bad("Đổi bench press thành bài khác cho ngực", "Incline Bench Press"), true);
  assert.equal(bad("Đổi bench press thành bài khác cho ngực", "Dumbbell Fly", "DUMBBELLS"), false);
  assert.equal(bad("Bỏ bài burpee và các bài nhảy vì tôi đang thừa cân", "Box Jump", "BODYWEIGHT"), true);
  assert.equal(bad("Tôi không có xà đơn, bỏ các bài kéo xà", "Wide-Grip Pull-Up", "BODYWEIGHT"), true);
});

test("pain statements remove the movements that load the painful joint", () => {
  assert.equal(bad("Tôi bị đau gối, bỏ bài nhảy, lunge và squat sâu", "Walking Lunge", "DUMBBELLS"), true);
  assert.equal(bad("Tôi bị đau gối, bỏ bài nhảy, lunge và squat sâu", "Smith Machine Pistol Squat", "MACHINE"), true);
  assert.equal(bad("Tôi bị đau gối, bỏ bài nhảy, lunge và squat sâu", "Glute Bridge", "BODYWEIGHT"), false);
  assert.equal(bad("Tôi bị đau vai, tránh các bài đẩy qua đầu", "Push Press - Behind the Neck"), true);
  assert.equal(bad("Tôi bị đau vai, tránh các bài đẩy qua đầu", "Seated Cable Row", "CABLE"), false);
});

test("equipment-only requests", () => {
  const db = "Tôi chỉ có tạ đơn ở nhà, đổi toàn bộ sang bài dùng tạ đơn";
  assert.equal(P(db).equipmentOnly, "DUMBBELL");
  assert.equal(fetchLocationFor(P(db), "GYM"), "HOME");
  assert.equal(bad(db, "Dumbbell Bench Press", "DUMBBELLS"), false);
  assert.equal(bad(db, "Close-Grip Barbell Bench Press", "BARBELL"), true);
  const bw = "Tôi tập ở nhà không có dụng cụ, chỉ dùng trọng lượng cơ thể";
  assert.equal(P(bw).equipmentOnly, "BODYWEIGHT");
  assert.equal(bad(bw, "Push-Up", "BODYWEIGHT"), false);
  assert.equal(bad(bw, "Barbell Ab Rollout - On Knees", "BODYWEIGHT"), true, "name gives the equipment away");
  const fw = "Tôi không thích tập máy, ưu tiên tạ tự do";
  assert.equal(P(fw).equipmentOnly, "FREE_WEIGHT");
  assert.equal(bad(fw, "Leg Press", "MACHINE"), true);
  assert.equal(bad(fw, "Goblet Squat", "DUMBBELLS"), false);
});

test("focus, cardio, level and volume flags", () => {
  assert.deepEqual(P("Thêm bài tập bụng vào mỗi buổi").addFocus, ["CORE"]);
  assert.deepEqual(P("Thêm bài cho tay sau (triceps)").addFocus, ["TRICEPS"]);
  assert.deepEqual(P("Tập trung nhiều hơn vào mông và đùi sau").addFocus, ["GLUTES_HAMSTRINGS"]);
  assert.equal(P("Tôi muốn thêm cardio nhẹ vào cuối mỗi buổi").cardioEachDay, true);
  assert.equal(P("Tôi 52 tuổi mới tập, thay các bài khó bằng bài đơn giản hơn").beginnerSafe, true);
  assert.equal(bad("Tôi 52 tuổi mới tập, thay các bài khó bằng bài đơn giản hơn", "Muscle Snatch"), true);
  assert.equal(P("Tập nhẹ hơn, ít hiệp hơn vì tôi hay mệt").lighterVolume, true);
  assert.equal(P("Tôi muốn tăng sức mạnh, tập rep thấp tạ nặng hơn").strengthFocus, true);
  assert.deepEqual(P("Tôi bị đau lưng, tập gì cho đỡ").addFocus, [], "back pain is not 'add back work'");
});

test("numbers typed in the text are read only with clear framing", () => {
  assert.equal(P("Giảm xuống còn 2 buổi mỗi tuần").daysPerWeek, 2);
  assert.equal(P("Tôi muốn tập 4 buổi một tuần").daysPerWeek, 4);
  assert.equal(P("Mỗi buổi chỉ 4 bài thôi").exercisesPerDay, 4);
  assert.equal(P("Cho tôi 6 bài mỗi buổi").exercisesPerDay, 6);
  assert.equal(P("Đổi buổi 1 thành buổi tập toàn thân").daysPerWeek, undefined, "an ordinal is not a count");
  assert.equal(P("Thêm 2 bài bụng").exercisesPerDay, undefined, "an addition is not a per-day count");
});

import { exerciseUnsafeForTrainee } from "../services/revision/workout-adjustment-constraints";

test("level safety: beginners and 50+ never get Olympic/explosive/powerlifting-specialty lifts; nobody gets neck pressing", () => {
  const beginner = { experienceLevel: "BEGINNER", age: 30 };
  const older = { experienceLevel: "INTERMEDIATE", age: 52 };
  const inter = { experienceLevel: "INTERMEDIATE", age: 22 };
  for (const name of ["Muscle Snatch", "Power Clean", "Power Jerk", "Bench Press with Chains", "Board Press", "Muscle Up", "Smith Machine Pistol Squat", "Plyo Push-up"]) {
    assert.equal(exerciseUnsafeForTrainee({ exerciseName: name, difficultyLevel: "intermediate" }, beginner), true, name);
    assert.equal(exerciseUnsafeForTrainee({ exerciseName: name, difficultyLevel: "intermediate" }, older), true, name);
  }
  assert.equal(exerciseUnsafeForTrainee({ exerciseName: "Power Clean", difficultyLevel: "intermediate" }, { experienceLevel: "ADVANCED", age: 22 }), false, "advanced trainees keep them (intermediates no longer do, see below)");
  assert.equal(exerciseUnsafeForTrainee({ exerciseName: "Neck Press", difficultyLevel: "intermediate" }, inter), true);
  assert.equal(exerciseUnsafeForTrainee({ exerciseName: "Barbell Guillotine Bench Press" }, inter), true);
  assert.equal(exerciseUnsafeForTrainee({ exerciseName: "Goblet Squat", difficultyLevel: "beginner" }, beginner), false);
  assert.equal(exerciseUnsafeForTrainee({ exerciseName: "Dumbbell Bench Press", difficultyLevel: "expert" }, beginner), true, "catalog difficulty counts");
});

test("dumbbell-only keeps dumbbell exercises only; full-body day is parsed", () => {
  const db = "Tôi chỉ có tạ đơn ở nhà, đổi toàn bộ sang bài dùng tạ đơn";
  assert.equal(bad(db, "Band Good Morning", "BODYWEIGHT"), true);
  assert.equal(bad(db, "Push-Up", "BODYWEIGHT"), true);
  assert.equal(bad(db, "Dumbbell Romanian Deadlift", "DUMBBELLS"), false);
  assert.deepEqual(P("Đổi buổi 1 thành buổi tập toàn thân").fullBodyDays, [0]);
});

test("level safety: intermediates get no Olympic/strongman/powerlifting-specialty lifts; advanced trainees keep them", () => {
  const inter = { experienceLevel: "INTERMEDIATE", age: 28 };
  for (const name of ["Squat Jerk", "Power Snatch", "Hang Clean - Below the Knees", "Reverse Band Sumo Deadlift", "Pin Presses", "Anti-Gravity Press", "Sled Push", "Bench Press - Powerlifting"]) {
    assert.equal(exerciseUnsafeForTrainee({ exerciseName: name, difficultyLevel: "intermediate" }, inter), true, name);
  }
  for (const name of ["Barbell Bench Press - Medium Grip", "Romanian Deadlift", "Box Jump", "Pull-Up", "Barbell Squat"]) {
    assert.equal(exerciseUnsafeForTrainee({ exerciseName: name, difficultyLevel: "intermediate" }, inter), false, name);
  }
  assert.equal(exerciseUnsafeForTrainee({ exerciseName: "Power Snatch" }, { experienceLevel: "ADVANCED", age: 28 }), false);
  assert.equal(exerciseUnsafeForTrainee({ exerciseName: "Neck Press" }, { experienceLevel: "ADVANCED", age: 28 }), true);
});
