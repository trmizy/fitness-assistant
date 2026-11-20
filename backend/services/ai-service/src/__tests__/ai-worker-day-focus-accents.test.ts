import test from "node:test";
import assert from "node:assert/strict";
import { parseDayFocusMuscleGroups, splitGoalForDay } from "../workers/ai.worker";

/**
 * Day goals are written in ACCENTED Vietnamese (the plan schema requires it; splitGoalForDay now emits it), but the muscle-group
 * patterns are ASCII. Parsing must be accent-insensitive, otherwise "Ngực + Lưng" lost CHEST and BACK and exercise selection for
 * that day silently degraded to whatever fragment happened to be ASCII.
 */
test("accented and unaccented day goals resolve to the same muscle groups", () => {
  const pairs: Array<[string, string]> = [
    ["Ngực + Lưng", "Nguc + Lung"],
    ["Chân + Mông", "Chan + Mong"],
    ["Vai + Tay trước + Tay sau", "Vai + Tay truoc + Tay sau"],
    ["Lưng + Tay trước", "Lung + Tay truoc"],
    ["Ngực + Vai + Tay sau", "Nguc + Vai + Tay sau"],
  ];
  for (const [accented, plain] of pairs) {
    assert.deepEqual([...parseDayFocusMuscleGroups(accented)].sort(), [...parseDayFocusMuscleGroups(plain)].sort(), accented);
  }
});

test("concrete groups for the default split labels", () => {
  assert.deepEqual([...parseDayFocusMuscleGroups("Ngực + Lưng")].sort(), ["BACK", "CHEST"]);
  assert.deepEqual([...parseDayFocusMuscleGroups("Chân + Mông + Core")].sort(), ["CORE", "GLUTES", "LEGS"]);
  assert.ok(parseDayFocusMuscleGroups("Lưng + Tay trước").includes("BICEPS"));
  assert.ok(parseDayFocusMuscleGroups("Ngực + Vai + Tay sau").includes("TRICEPS"));
});

test("đ is folded too ('Đẩy'/'Đùi' style words do not break matching) and unknown text still falls back to FULL_BODY", () => {
  assert.deepEqual(parseDayFocusMuscleGroups("Toàn thân"), ["FULL_BODY"]);
  assert.deepEqual(parseDayFocusMuscleGroups("Buổi đặc biệt"), ["FULL_BODY"]);
});

test("default split labels are accented Vietnamese for every days-per-week / goal (no unaccented or English leftovers)", () => {
  const forbidden = /\b(Nguc|Lung|Chan|Mong|truoc|nhe|Push|Pull|Legs|Chest|Back|Shoulders|Arms)\b/;
  for (const goal of ["Tăng cơ", "Giảm mỡ", "Duy trì sức khỏe"]) {
    for (let days = 2; days <= 7; days += 1) {
      for (let i = 0; i < days; i += 1) {
        const label = splitGoalForDay(goal, i, days);
        assert.ok(!forbidden.test(label), `unaccented/English label: "${label}" (${goal}, ${days} days, day ${i})`);
        assert.ok(/[ưựứừửữăắằẳẵặâấầẩẫậêếềểễệôốồổỗộơớờởỡợđ]|Vai|Tay sau|Core|Cardio/.test(label), `no Vietnamese content in "${label}"`);
        assert.notDeepEqual(parseDayFocusMuscleGroups(label), ["FULL_BODY"], `label "${label}" resolves to no muscle group`);
      }
    }
  }
});
