import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bodySeries, programSummary, recentWorkouts, seriesDelta, sparklinePoints } from "../dashboard/dashboardBody";
import { mergePtSources, normalizePt } from "../services/ptDiscovery";
import { bodyBalance, gaugePosition } from "../inbody/bodyBalance";
import { normalizeEntry } from "../inbody/inbodyMath";

/**
 * 14B.7 — the data blocks mobile lacked against web: client home trends / program / recent workouts,
 * and the PT detail's method + target groups.
 *
 * Chạy: npx tsx --test src/features/__tests__/cluster14b7.test.ts
 */

describe("PG-C1 body trend series", () => {
  const history = [
    { dateOnly: "2026-09-20", weight: 72.4, muscleMass: 31.0, bodyFatPct: 20 },
    { dateOnly: "2026-08-01", weight: 74, muscleMass: 0 },
    { dateOnly: "05/09/2026", weight: 73.1, muscleMass: 30.6 },
    { weight: 99 }, // no date → never plotted
  ];
  it("orders oldest → newest across date formats, skips missing readings and undated rows", () => {
    assert.deepEqual(
      bodySeries(history, "weight").map((p) => [p.label, p.value]),
      [
        ["01/08", 74],
        ["05/09", 73.1],
        ["20/09", 72.4],
      ],
    );
    assert.deepEqual(bodySeries(history, "muscleMass").map((p) => p.value), [30.6, 31]);
    assert.deepEqual(bodySeries(null, "weight"), []);
  });
  it("keeps only the last `max` points", () => {
    assert.equal(bodySeries(history, "weight", 2)[0].value, 73.1);
  });
  it("delta is newest minus the one before, signed", () => {
    const d = seriesDelta(bodySeries(history, "weight"), "kg")!;
    assert.equal(d.text, "-0.7 kg");
    assert.ok(Math.abs(d.diff + 0.7) < 1e-9);
    assert.equal(seriesDelta(bodySeries(history, "bodyFatPct"), "%"), null);
  });
});

describe("PG-C1 sparkline", () => {
  it("spans the padded box, highest value at the top", () => {
    assert.equal(sparklinePoints([1, 3], 100, 50, 5), "5,45 95,5");
  });
  it("a flat or single series sits at mid-height", () => {
    assert.equal(sparklinePoints([2, 2], 100, 50, 0), "0,25 100,25");
    assert.equal(sparklinePoints([7], 100, 50, 0), "50,25");
    assert.equal(sparklinePoints([], 100, 50), "");
  });
});

describe("PG-C1 active program + recent workouts", () => {
  it("counts days and exercises, falling back to daysPerWeek", () => {
    assert.deepEqual(programSummary({ name: "Push Pull", days: [{ exercises: [1, 2] }, { exercises: [3] }] }), {
      name: "Push Pull",
      days: 2,
      exercises: 3,
    });
    assert.deepEqual(programSummary({ daysPerWeek: 4 }), { name: "Chương trình tập hiện tại", days: 4, exercises: 0 });
    assert.equal(programSummary(null), null);
  });
  it("reads the real Workout fields (name, duration) — not web's title/durationMinutes", () => {
    const rows = recentWorkouts([
      { id: "w1", name: "Ngực - Vai", date: "2026-10-04T00:00:00.000Z", duration: 55, exercises: [{}, {}] },
      { id: "w2", title: "Cũ", date: "2026-10-01", duration: null },
    ]);
    assert.deepEqual(rows[0], { id: "w1", name: "Ngực - Vai", date: "2026-10-04T00:00:00.000Z", minutes: 55, exercises: 2 });
    assert.equal(rows[1].name, "Cũ");
    assert.equal(rows[1].minutes, null);
    assert.equal(recentWorkouts({ data: [{ id: "x" }] }).length, 1);
    assert.equal(recentWorkouts(new Array(9).fill({})).length, 4);
  });
});

describe("PG-C5 PT detail: method + target groups", () => {
  const detail = {
    userId: "pt1",
    ptApplication: {
      trainingMethodsApproach: "  Tập theo chu kỳ  ",
      targetClientGroups: ["beginners", "", 3],
      primaryTrainingGoals: ["fat_loss"],
      educationBackground: "",
      previousWorkExperience: "5 năm ở California",
    },
  };
  it("normalizes the application fields, trimming and dropping junk", () => {
    const pt = normalizePt(detail);
    assert.equal(pt.methods, "Tập theo chu kỳ");
    assert.deepEqual(pt.targetGroups, ["beginners"]);
    assert.deepEqual(pt.trainingGoals, ["fat_loss"]);
    assert.equal(pt.education, null);
    assert.equal(pt.workExperience, "5 năm ở California");
  });
  it("the detail wins over the list row, the list row fills what the detail lacks", () => {
    const listRow = normalizePt({ userId: "pt1", ptApplication: { educationBackground: "ĐH TDTT", targetClientGroups: ["seniors"] } });
    const merged = mergePtSources(detail, listRow)!;
    assert.equal(merged.education, "ĐH TDTT");
    assert.deepEqual(merged.targetGroups, ["beginners"]);
    const emptyDetail = mergePtSources({ userId: "pt1" }, listRow)!;
    assert.deepEqual(emptyDetail.targetGroups, ["seniors"]);
  });
});

describe("PG-C3 body balance against reference ranges", () => {
  const entry = (over: Record<string, unknown>) => normalizeEntry({ id: "e", dateOnly: "2026-10-04", weight: 70, muscleMass: 30, bodyFat: 14, ...over });
  const labels = (b: ReturnType<typeof bodyBalance>) => b.rows.map((r) => [r.key, r.valueText, r.verdictLabel]);

  it("BMI from the sheet, or computed from the profile height and said so", () => {
    assert.deepEqual(labels(bodyBalance(entry({ bmi: 24.2 }), null))[0], ["bmi", "24.2", "Bình thường"]);
    const b = bodyBalance(entry({}), { heightCm: 165 });
    assert.deepEqual(b.rows[0].valueText, "25.7");
    assert.equal(b.rows[0].verdictLabel, "Thừa cân");
    assert.match(b.rows[0].note, /trong hồ sơ \(165 cm\)/);
    assert.match(bodyBalance(entry({}), null).missing[0], /cần chiều cao/);
  });

  it("body fat % uses the sex-specific InBody band; the same 24 % is high for a man, normal for a woman", () => {
    assert.deepEqual(labels(bodyBalance(entry({ bodyFatPct: 24 }), { gender: "MALE" })).find((r) => r[0] === "bodyFatPct"), ["bodyFatPct", "24%", "Cao"]);
    assert.deepEqual(labels(bodyBalance(entry({ bodyFatPct: 24 }), { gender: "FEMALE" })).find((r) => r[0] === "bodyFatPct"), ["bodyFatPct", "24%", "Bình thường"]);
    assert.equal(bodyBalance(entry({ bodyFatPct: 26 }), { gender: "MALE" }).rows.find((r) => r.key === "bodyFatPct")!.verdictLabel, "Rất cao");
    assert.match(bodyBalance(entry({ bodyFatPct: 24 }), null).missing.join(), /cần giới tính/);
  });

  it("falls back to fat kg ÷ weight when the % is missing", () => {
    const row = bodyBalance(entry({ bodyFat: 14 }), { gender: "MALE" }).rows.find((r) => r.key === "bodyFatPct")!;
    assert.equal(row.valueText, "20%");
    assert.match(row.note, /tính từ mỡ/);
  });

  it("visceral fat: below level 10 is normal", () => {
    assert.equal(bodyBalance(entry({ visceralFat: 9 }), null).rows.find((r) => r.key === "visceralFat")!.verdictLabel, "Bình thường");
    assert.equal(bodyBalance(entry({ visceralFat: 12 }), null).rows.find((r) => r.key === "visceralFat")!.verdictLabel, "Cao");
  });

  it("limb balance uses ai-service's 5 % / 10 % thresholds and names the weaker side", () => {
    const b = bodyBalance(entry({ rightArmMuscle: 3.4, leftArmMuscle: 3.1, rightLegMuscle: 9.5, leftLegMuscle: 9.4 }), null);
    assert.deepEqual(labels(b).filter((r) => r[0] === "arms" || r[0] === "legs"), [
      ["arms", "Bên trái kém 8.8%", "Lệch nhẹ"],
      ["legs", "Lệch 1.1%", "Cân bằng"],
    ]);
  });

  it("gauge position is clamped to the scale", () => {
    assert.equal(gaugePosition(25, [15, 35]), 0.5);
    assert.equal(gaugePosition(50, [15, 35]), 1);
    assert.equal(gaugePosition(5, [15, 35]), 0);
  });
});
