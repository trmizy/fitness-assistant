/** Deterministic half of "Giải thích thể trạng InBody" (docs/ai-product/inbody-interpretation-design.md). */
import test from "node:test";
import assert from "node:assert/strict";
import { interpretInBody } from "../llm/inbody-interpretation";

const man = { age: 30, gender: "MALE", heightCm: 175 };
const base = { date: "2026-11-01", weight: 85, height: 175, bodyFat: 23.8, muscleMass: 34, rightArmMuscle: 3.6, leftArmMuscle: 3.5, rightLegMuscle: 9.8, leftLegMuscle: 9.7 };

test("classifies body fat with the plan-generation thresholds and labels provenance", () => {
  const r = interpretInBody(base, null, man);
  const bf = r.metrics.find((m) => m.key === "bodyFatPct")!;
  assert.equal(bf.value, 28);
  assert.equal(bf.status, "high");
  assert.equal(bf.source, "MEASURED");
  assert.equal(r.metrics.find((m) => m.key === "ffmi")!.source, "COMPUTED");
  assert.equal(r.bodyType?.code, "C");
});

test("a lean, muscular profile is type D; a balanced one is I", () => {
  const d = interpretInBody({ ...base, weight: 80, bodyFat: 10, muscleMass: 40 }, null, man);
  assert.equal(d.bodyType?.code, "D");
  const i = interpretInBody({ ...base, weight: 70, bodyFat: 11, muscleMass: 32 }, null, man);
  assert.equal(i.bodyType?.code, "I");
});

test("changes below the device noise are not called real", () => {
  const prev = { ...base, date: "2026-10-20", weight: 85.3, bodyFat: 24.1, muscleMass: 33.8 };
  const r = interpretInBody(base, prev, man);
  assert.ok(r.changes.every((c) => !c.meaningful));
  assert.ok(r.dataQuality.some((q) => /chưa nên kết luận/.test(q)));
  assert.ok(r.dataQuality.some((q) => /cách nhau 12 ngày/.test(q)));
  const later = interpretInBody({ ...base, date: "2026-12-01", weight: 82, bodyFat: 20 }, base, man);
  assert.equal(later.changes.find((c) => c.key === "weight")!.meaningful, true);
});

test("visceral fat, limb balance and the low-limb-muscle check are flags, never diagnoses", () => {
  const r = interpretInBody({ ...base, visceralFat: 12, leftArmMuscle: 3.0 }, null, { ...man, age: 55 });
  assert.ok(r.flags.some((f) => f.code === "VISCERAL_HIGH"));
  assert.equal(r.balance.find((b) => b.partVi === "Tay")!.status, "significant");
  const weak = interpretInBody({ ...base, rightArmMuscle: 1.8, leftArmMuscle: 1.8, rightLegMuscle: 6, leftLegMuscle: 6 }, null, { ...man, age: 60 });
  const flag = weak.flags.find((f) => f.code === "LOW_LIMB_MUSCLE_CHECK")!;
  assert.match(flag.messageVi, /không phải chẩn đoán/);
  assert.doesNotMatch(JSON.stringify(weak), /sarcopenia|thiếu cơ/i);
  assert.equal(interpretInBody({ ...base, rightArmMuscle: 1.8, leftArmMuscle: 1.8, rightLegMuscle: 6, leftLegMuscle: 6 }, null, { ...man, age: 30 }).flags.length, 0, "only from age 40");
});

test("missing data is said plainly; women use their own thresholds", () => {
  const sparse = interpretInBody({ date: "2026-11-01", weight: 60 }, null, { gender: "FEMALE" });
  assert.ok(sparse.dataQuality.some((q) => /thiếu một số chỉ số/.test(q)));
  const w = interpretInBody({ date: "2026-11-01", weight: 55, height: 160, bodyFat: 15.4, muscleMass: 22 }, null, { gender: "FEMALE", age: 26 });
  assert.equal(w.metrics.find((m) => m.key === "bodyFatPct")!.status, "slightly_high");
});
