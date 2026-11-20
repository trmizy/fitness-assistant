import test from "node:test";
import assert from "node:assert/strict";
import {
  bodyFatCategory,
  computeBmi,
  recommendGoalFromBody,
  STALE_AFTER_DAYS,
  type GoalRecommendationInput,
} from "../services/goal-recommendation.engine";

const NOW = new Date("2026-11-21T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function input(over: Partial<GoalRecommendationInput> = {}): GoalRecommendationInput {
  return {
    age: 30, gender: "MALE", heightCm: 175, weightKg: 80, bodyFatPct: null, bodyFatSource: null, bodyFatMeasuredAt: null,
    experienceLevel: "BEGINNER", professionalReviewRequired: false, now: NOW, ...over,
  };
}
const inbody = (pct: number, days = 5) => ({ bodyFatPct: pct, bodyFatSource: "MEASURED" as const, bodyFatMeasuredAt: daysAgo(days) });

test("missing height/weight/age -> INSUFFICIENT_DATA naming what is missing, no recommendation", () => {
  const r = recommendGoalFromBody(input({ heightCm: null, age: null }));
  assert.equal(r.status, "INSUFFICIENT_DATA");
  assert.deepEqual(r.missing, ["chiều cao", "tuổi"]);
  assert.equal(r.recommended, null);
});

test("safety gates: minor, 65+, screening flags and very low BMI never get a lose/gain direction", () => {
  for (const [label, over, code] of [
    ["minor", { age: 16 }, "MINOR"],
    ["65+", { age: 65 }, "AGE_65_PLUS"],
    ["flags", { professionalReviewRequired: true }, "SCREENING_FLAGS"],
    ["very low BMI", { weightKg: 45 }, "VERY_LOW_BMI"], // 175 cm / 45 kg = 14.7
  ] as const) {
    const r = recommendGoalFromBody(input({ ...over, ...inbody(30) }));
    assert.equal(r.status, "REVIEW_FIRST", label);
    assert.equal(r.recommended, "MAINTENANCE", label);
    assert.deepEqual(r.options, ["MAINTENANCE"], label);
    assert.ok(r.reasonCodes.includes(code), `${label}: ${r.reasonCodes}`);
  }
});

test("measured high body fat -> WEIGHT_LOSS with a HIGH tier; a stale reading lowers the tier and says so", () => {
  const fresh = recommendGoalFromBody(input({ weightKg: 84, ...inbody(28) })); // BMI 27.4, male 30y, bf 28% (obese band >=25)
  assert.equal(fresh.status, "RECOMMENDED");
  assert.equal(fresh.recommended, "WEIGHT_LOSS");
  assert.equal(fresh.confidence, "HIGH");
  assert.equal(fresh.basis, "BODY_FAT");
  assert.ok(fresh.evidence.some((e) => e.kind === "MEASURED" && e.label.includes("mỡ")));

  const stale = recommendGoalFromBody(input({ weightKg: 84, ...inbody(28, STALE_AFTER_DAYS + 30) }));
  assert.equal(stale.recommended, "WEIGHT_LOSS");
  assert.equal(stale.confidence, "MEDIUM");
  assert.ok(stale.caveats.some((c) => c.includes("đã cũ")));
});

test("a self-entered body fat is used but never trusted as much as a measured one", () => {
  const r = recommendGoalFromBody(input({ weightKg: 84, bodyFatPct: 28, bodyFatSource: "USER_ENTERED" }));
  assert.equal(r.recommended, "WEIGHT_LOSS");
  assert.equal(r.confidence, "MEDIUM");
  assert.ok(r.evidence.some((e) => e.kind === "USER_ENTERED"));
});

test("a body fat guessed from a photo is NEVER used as a basis (falls back to BMI) and is reported as ignored", () => {
  const r = recommendGoalFromBody(input({ weightKg: 84, bodyFatPct: 30, bodyFatSource: "VISUAL_ESTIMATE" }));
  assert.equal(r.basis, "BMI");
  assert.ok(r.reasonCodes.includes("VISUAL_BODY_FAT_IGNORED"));
  assert.ok(!r.evidence.some((e) => e.label.includes("mỡ cơ thể")), "an estimated figure must not appear as evidence");
});

test("high BMI but healthy body fat (muscular) is the user's choice and never offers weight loss", () => {
  const r = recommendGoalFromBody(input({ weightKg: 88, ...inbody(15) })); // BMI 28.7, bf 15% healthy for a 30y man
  assert.equal(r.status, "USER_CHOICE");
  assert.equal(r.recommended, null);
  assert.ok(!r.options.includes("WEIGHT_LOSS"));
  assert.ok(r.reasonCodes.includes("HIGH_BMI_HEALTHY_BODY_FAT"));
});

test("high body fat at a normal BMI offers fat loss OR muscle gain, no single direction", () => {
  const r = recommendGoalFromBody(input({ gender: "FEMALE", heightCm: 165, weightKg: 60, ...inbody(36) })); // BMI 22.0, bf 36% (overweight band 33-38.9)
  assert.equal(r.status, "USER_CHOICE");
  assert.equal(r.recommended, null);
  assert.deepEqual([...r.options].sort(), ["MUSCLE_GAIN", "WEIGHT_LOSS"]);
});

test("underweight BMI with a high body fat is never told to lose weight", () => {
  const r = recommendGoalFromBody(input({ gender: "FEMALE", heightCm: 170, weightKg: 52, ...inbody(36) })); // BMI 18.0
  assert.equal(r.recommended, "MUSCLE_GAIN");
  assert.ok(!r.options.includes("WEIGHT_LOSS"));
});

test("healthy body fat with lean mass in the lower half of the reference range suggests muscle gain; otherwise it is the user's choice", () => {
  const lowLean = recommendGoalFromBody(input({ age: 25, heightCm: 175, weightKg: 62, ...inbody(14) })); // FFMI 17.4 < 18.25
  assert.equal(lowLean.recommended, "MUSCLE_GAIN");
  assert.equal(lowLean.confidence, "MEDIUM");
  const wellBuilt = recommendGoalFromBody(input({ age: 25, heightCm: 180, weightKg: 78, ...inbody(14) })); // FFMI 20.7
  assert.equal(wellBuilt.status, "USER_CHOICE");
  assert.equal(wellBuilt.recommended, null);
});

test("BMI-only path: obese -> WEIGHT_LOSS; overweight trained -> user's choice; overweight beginner -> WEIGHT_LOSS (LOW); underweight -> MUSCLE_GAIN; normal -> user's choice", () => {
  const w = (bmi: number) => Math.round(bmi * 1.75 * 1.75); // for 175 cm
  const obese = recommendGoalFromBody(input({ weightKg: w(32) }));
  assert.equal(obese.recommended, "WEIGHT_LOSS");
  assert.equal(obese.basis, "BMI");
  assert.ok(obese.caveats.some((c) => c.includes("InBody")));

  assert.equal(recommendGoalFromBody(input({ weightKg: w(26.5), experienceLevel: "ADVANCED" })).status, "USER_CHOICE");
  const overweightBeginner = recommendGoalFromBody(input({ weightKg: w(26.5) }));
  assert.equal(overweightBeginner.recommended, "WEIGHT_LOSS");
  assert.equal(overweightBeginner.confidence, "LOW");
  assert.equal(recommendGoalFromBody(input({ weightKg: w(17.5) })).recommended, "MUSCLE_GAIN");
  assert.equal(recommendGoalFromBody(input({ weightKg: w(21) })).status, "USER_CHOICE");
  const borderline = recommendGoalFromBody(input({ weightKg: w(23.5) }));
  assert.equal(borderline.status, "USER_CHOICE");
  assert.ok(borderline.reasonCodes.includes("BMI_BORDERLINE_ASIAN"));
});

test("a gender without reference bands (OTHER/unknown) or an age above 64 uses BMI, with a caveat", () => {
  const other = recommendGoalFromBody(input({ gender: "OTHER", weightKg: 84, ...inbody(28) }));
  assert.equal(other.basis, "BMI");
  assert.ok(other.caveats.some((c) => c.includes("nam và nữ")));
});

test("body-fat bands follow the published 20-39 rows exactly at the boundaries", () => {
  assert.equal(bodyFatCategory("MALE", 30, 7.9), "UNDER");
  assert.equal(bodyFatCategory("MALE", 30, 8), "HEALTHY");
  assert.equal(bodyFatCategory("MALE", 30, 19.9), "HEALTHY");
  assert.equal(bodyFatCategory("MALE", 30, 20), "OVERWEIGHT");
  assert.equal(bodyFatCategory("MALE", 30, 25), "OBESE");
  assert.equal(bodyFatCategory("FEMALE", 30, 20.9), "UNDER");
  assert.equal(bodyFatCategory("FEMALE", 30, 21), "HEALTHY");
  assert.equal(bodyFatCategory("FEMALE", 30, 32.9), "HEALTHY");
  assert.equal(bodyFatCategory("FEMALE", 30, 33), "OVERWEIGHT");
  assert.equal(bodyFatCategory("FEMALE", 30, 39), "OBESE");
  assert.equal(computeBmi(80, 175), 26.1);
});

test("safety invariant over a grid: no input ever yields WEIGHT_LOSS for a minor, 65+, flagged user or BMI < 18.5", () => {
  const sources = [null, "MEASURED", "USER_ENTERED", "VISUAL_ESTIMATE"] as const;
  for (const age of [12, 16, 17, 18, 19, 25, 40, 64, 65, 80]) {
    for (const gender of ["MALE", "FEMALE", "OTHER", null] as const) {
      for (const weightKg of [38, 45, 50, 55, 60, 70, 80, 95, 120]) {
        for (const bf of [null, 6, 12, 18, 25, 32, 40, 48]) {
          for (const src of sources) {
            for (const flags of [false, true]) {
              const r = recommendGoalFromBody(input({ age, gender, weightKg, bodyFatPct: bf, bodyFatSource: bf == null ? null : src, bodyFatMeasuredAt: daysAgo(3), professionalReviewRequired: flags }));
              const bmi = computeBmi(weightKg, 175);
              const mustNotLose = age < 18 || age >= 65 || flags || bmi < 18.5;
              if (mustNotLose) {
                assert.notEqual(r.recommended, "WEIGHT_LOSS", `age ${age} ${gender} ${weightKg}kg bf ${bf} ${src} flags ${flags}`);
                assert.ok(!r.options.includes("WEIGHT_LOSS"), `options leaked WEIGHT_LOSS: age ${age} ${gender} ${weightKg}kg bf ${bf} ${src} flags ${flags}`);
              }
              // the suggestion is always explained
              assert.ok(r.headline.length > 0 && r.reasons.length > 0);
            }
          }
        }
      }
    }
  }
});
