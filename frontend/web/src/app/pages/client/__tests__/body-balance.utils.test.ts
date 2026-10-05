/**
 * "Cân bằng cơ thể" reference-range rules — must stay identical to the mobile app's
 * (frontend/mobile/src/features/__tests__/cluster14b7.test.ts covers the same cases there).
 *
 * Run with: npx tsx --test src/app/pages/client/__tests__/body-balance.utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bodyBalance, gaugePosition } from "../body-balance.utils";

const base = { weight: 70, muscleMass: 30, bodyFat: 14 };
const row = (b: ReturnType<typeof bodyBalance>, key: string) => b.rows.find((r) => r.key === key);

describe("body balance against reference ranges", () => {
  it("BMI from the sheet, or computed from the profile height and said so", () => {
    assert.equal(row(bodyBalance({ ...base, bmi: 24.2 }), "bmi")!.verdictLabel, "Bình thường");
    const b = bodyBalance(base, { heightCm: 165 });
    assert.equal(row(b, "bmi")!.valueText, "25.7");
    assert.equal(row(b, "bmi")!.verdictLabel, "Thừa cân");
    assert.match(row(b, "bmi")!.note, /trong hồ sơ \(165 cm\)/);
    assert.match(bodyBalance(base, null).missing[0], /cần chiều cao/);
  });

  it("body fat % uses the sex-specific InBody band", () => {
    assert.equal(row(bodyBalance({ ...base, bodyFatPct: 24 }, { gender: "MALE" }), "bodyFatPct")!.verdictLabel, "Cao");
    assert.equal(row(bodyBalance({ ...base, bodyFatPct: 24 }, { gender: "FEMALE" }), "bodyFatPct")!.verdictLabel, "Bình thường");
    assert.equal(row(bodyBalance({ ...base, bodyFatPct: 26 }, { gender: "MALE" }), "bodyFatPct")!.verdictLabel, "Rất cao");
    assert.match(bodyBalance({ ...base, bodyFatPct: 24 }, null).missing.join(), /cần giới tính/);
  });

  it("falls back to fat kg ÷ weight", () => {
    const r = row(bodyBalance(base, { gender: "MALE" }), "bodyFatPct")!;
    assert.equal(r.valueText, "20%");
    assert.match(r.note, /tính từ mỡ/);
  });

  it("visceral fat below level 10 is normal; limb balance names the weaker side", () => {
    assert.equal(row(bodyBalance({ ...base, visceralFat: 12 }), "visceralFat")!.verdictLabel, "Cao");
    const b = bodyBalance({ ...base, rightArmMuscle: 3.4, leftArmMuscle: 3.1, rightLegMuscle: 9.5, leftLegMuscle: 9.4 });
    assert.deepEqual([row(b, "arms")!.valueText, row(b, "arms")!.verdictLabel], ["Bên trái kém 8.8%", "Lệch nhẹ"]);
    assert.deepEqual([row(b, "legs")!.valueText, row(b, "legs")!.verdictLabel], ["Lệch 1.1%", "Cân bằng"]);
  });

  it("gauge position is clamped", () => {
    assert.equal(gaugePosition(25, [15, 35]), 0.5);
    assert.equal(gaugePosition(50, [15, 35]), 1);
    assert.equal(gaugePosition(5, [15, 35]), 0);
  });
});
