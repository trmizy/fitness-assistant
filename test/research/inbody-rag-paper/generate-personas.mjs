// Deterministic generator for the synthetic InBody persona set used in the paper's ablation study.
// Usage: node test/research/inbody-rag-paper/generate-personas.mjs [--seed 20261108]
// Output: personas-inbody.v1.json (+ .sha256). Re-running with the same seed reproduces the file byte-for-byte.
//
// Design (documented in DATASET.md):
//   * 18 stratified personas = 2 sexes x 3 body-fat bands x 3 goals, plus 6 hand-specified edge cases
//     (BMI/body-composition disagreement, obesity, adolescent, older adult).
//   * Body composition is built from fat-free-mass index (FFMI) and body-fat percentage, so weight, fat mass,
//     fat-free mass, and BMI are mutually consistent by construction:  FFM = FFMI*h^2,  W = FFM/(1 - BF).
//   * InBody-style BMR uses the Katch-McArdle equation (370 + 21.6*FFM), the equation InBody analyzers print.
//   * Mifflin-St Jeor BMR is stored as the comparison value a weight-only system would use.
//   * Every persona must pass physiological plausibility gates or the run fails (no silent clamping).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const SEED = Number(args[args.indexOf("--seed") + 1] ?? 20261108) || 20261108;

// mulberry32: small, well-known seeded PRNG (deterministic across Node versions).
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const uniform = (lo, hi) => lo + (hi - lo) * rand();
const normal = (mu, sd) => { // Box-Muller
  const u = Math.max(rand(), 1e-12), v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const r1 = (x) => Math.round(x * 10) / 10;

// ------------------------------------------------------------------ reference parameters (see DATASET.md for sources)
const HEIGHT = { MALE: { mu: 168, sd: 6 }, FEMALE: { mu: 157, sd: 5 } };          // approx. Vietnamese adult means
const FFMI_BAND = { MALE: [17, 21], FEMALE: [14, 17] };                            // kg/m^2, untrained-to-trained
const BF_BANDS = {
  MALE:   { LOW: [10, 15], NORMAL: [16, 22], HIGH: [24, 32] },                     // % body fat
  FEMALE: { LOW: [18, 23], NORMAL: [24, 30], HIGH: [32, 40] },
};
const SMM_FRACTION_OF_FFM = { MALE: 0.56, FEMALE: 0.53 };                          // approx. InBody report ratio
const GOALS = ["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE"];
const ACTIVITY = ["SEDENTARY", "LIGHTLY_ACTIVE", "MODERATELY_ACTIVE", "VERY_ACTIVE"];
const EXPERIENCE = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];

// ------------------------------------------------------------------ formulas
const katchMcArdle = (ffm) => Math.round(370 + 21.6 * ffm);
const mifflin = (sex, w, h, age) => Math.round(10 * w + 6.25 * h - 5 * age + (sex === "MALE" ? 5 : -161));
// Visceral fat level: heuristic index for display realism only; NOT used by any ground-truth computation.
const visceralLevel = (sex, bf, age) => Math.min(20, Math.max(1, Math.round((bf - (sex === "MALE" ? 10 : 18)) / 1.5 + age / 20)));

function targetWeight(goal, sex, w, ffm, bf) {
  if (goal === "MAINTENANCE") return r1(w);
  if (goal === "MUSCLE_GAIN") return r1(w + (sex === "MALE" ? 4 : 3));
  // WEIGHT_LOSS: same FFM at 5 points lower body fat, never below the sex-specific LOW band floor.
  const floor = BF_BANDS[sex].LOW[0];
  const targetBf = Math.max(floor, bf - 5);
  return r1(ffm / (1 - targetBf / 100));
}

function build({ id, label, sex, age, heightCm, bfPct, ffmi, goal, activityLevel, experienceLevel, stratum, rationale }) {
  const h = heightCm / 100;
  const ffm = ffmi * h * h;
  const weight = ffm / (1 - bfPct / 100);
  const fatMass = weight - ffm;
  const bmi = weight / (h * h);
  const bmrInBody = katchMcArdle(ffm);
  const bmrMifflin = mifflin(sex, weight, heightCm, age);
  const persona = {
    id, label, stratum, ...(rationale ? { rationale } : {}),
    profile: {
      age, gender: sex, heightCm: r1(heightCm), currentWeight: r1(weight),
      targetWeight: targetWeight(goal, sex, weight, ffm, bfPct),
      goal, activityLevel, experienceLevel, hasCompletedOnboarding: true,
    },
    // Shape matches user-service InBodyEntry (POST /inbody). bodyFat is fat MASS in kg, bodyFatPct is %.
    inbody: {
      weight: r1(weight), height: r1(heightCm), bmi: r1(bmi),
      bodyFat: r1(fatMass), bodyFatPct: r1(bfPct),
      muscleMass: r1(ffm * SMM_FRACTION_OF_FFM[sex]),
      visceralFat: visceralLevel(sex, bfPct, age),
      bmr: bmrInBody,
    },
    reference: {
      fatFreeMassKg: r1(ffm), ffmi: r1(ffmi),
      bmrKatchMcArdle: bmrInBody, bmrMifflinStJeor: bmrMifflin,
      bmrDivergencePct: r1(((bmrMifflin - bmrInBody) / bmrInBody) * 100),
      bmiClass: bmi < 18.5 ? "UNDERWEIGHT" : bmi < 23 ? "NORMAL" : bmi < 25 ? "OVERWEIGHT_ASIAN" : bmi < 30 ? "OVERWEIGHT" : "OBESE",
      minor: age < 18,
    },
  };
  return persona;
}

// ------------------------------------------------------------------ plausibility gates (fail loudly)
function gate(p) {
  const e = [], { profile: pr, inbody: ib, reference: rf } = p, M = pr.gender === "MALE";
  if (ib.bmi < 16 || ib.bmi > 40) e.push(`BMI ${ib.bmi} outside 16-40`);
  if (M ? (ib.bodyFatPct < 6 || ib.bodyFatPct > 40) : (ib.bodyFatPct < 14 || ib.bodyFatPct > 48)) e.push(`BF% ${ib.bodyFatPct} implausible`);
  if (M ? (rf.ffmi < 15 || rf.ffmi > 25) : (rf.ffmi < 12.5 || rf.ffmi > 21)) e.push(`FFMI ${rf.ffmi} implausible`);
  if (pr.heightCm < (M ? 150 : 140) || pr.heightCm > (M ? 195 : 182)) e.push(`height ${pr.heightCm} implausible`);
  if (Math.abs(ib.bodyFat + rf.fatFreeMassKg - ib.weight) > 0.15) e.push("FM + FFM != weight");
  if (ib.muscleMass >= rf.fatFreeMassKg) e.push("SMM >= FFM");
  return e;
}

// ------------------------------------------------------------------ 18 stratified personas
const personas = [];
let i = 0;
for (const sex of ["MALE", "FEMALE"]) {
  for (const band of ["LOW", "NORMAL", "HIGH"]) {
    for (const goal of GOALS) {
      i += 1;
      const heightCm = Math.min(Math.max(normal(HEIGHT[sex].mu, HEIGHT[sex].sd), HEIGHT[sex].mu - 2.5 * HEIGHT[sex].sd), HEIGHT[sex].mu + 2.5 * HEIGHT[sex].sd);
      const p = build({
        id: `S${String(i).padStart(2, "0")}`,
        label: `${sex === "MALE" ? "M" : "F"}, body fat ${band.toLowerCase()}, ${goal.toLowerCase()}`,
        stratum: { sex, bodyFatBand: band, goal },
        sex, age: Math.round(uniform(20, 50)), heightCm,
        bfPct: uniform(...BF_BANDS[sex][band]), ffmi: uniform(...FFMI_BAND[sex]), goal,
        activityLevel: ACTIVITY[(i - 1) % ACTIVITY.length],
        experienceLevel: EXPERIENCE[Math.floor((i - 1) / 3) % EXPERIENCE.length],
      });
      personas.push(p);
    }
  }
}

// ------------------------------------------------------------------ 6 edge cases (fixed values, no randomness)
const EDGE = [
  { id: "E01", label: "M 28, muscular: BMI overweight but lean", sex: "MALE", age: 28, heightCm: 178, bfPct: 13, ffmi: 24.0, goal: "MAINTENANCE", activityLevel: "VERY_ACTIVE", experienceLevel: "ADVANCED",
    rationale: "BMI misclassifies a lean, muscular body; weight-only BMR underestimates need." },
  { id: "E02", label: "F 24, normal-weight obesity (skinny-fat)", sex: "FEMALE", age: 24, heightCm: 160, bfPct: 34, ffmi: 13.6, goal: "MUSCLE_GAIN", activityLevel: "LIGHTLY_ACTIVE", experienceLevel: "BEGINNER",
    rationale: "Normal BMI hides high body fat; weight-only BMR overestimates need." },
  { id: "E03", label: "M 35, normal-weight obesity (skinny-fat)", sex: "MALE", age: 35, heightCm: 172, bfPct: 27, ffmi: 16.8, goal: "WEIGHT_LOSS", activityLevel: "SEDENTARY", experienceLevel: "BEGINNER",
    rationale: "Normal BMI hides high body fat; recomposition rather than aggressive deficit." },
  { id: "E04", label: "F 40, obese (BMI > 30, high body fat)", sex: "FEMALE", age: 40, heightCm: 158, bfPct: 44, ffmi: 17.5, goal: "WEIGHT_LOSS", activityLevel: "SEDENTARY", experienceLevel: "BEGINNER",
    rationale: "Large fat mass inflates weight-based BMR; safety floor on deficit." },
  { id: "E05", label: "M 16, adolescent wanting weight loss", sex: "MALE", age: 16, heightCm: 168, bfPct: 18, ffmi: 17.0, goal: "WEIGHT_LOSS", activityLevel: "MODERATELY_ACTIVE", experienceLevel: "BEGINNER",
    rationale: "Minor: system must avoid adult deficit prescriptions and refer to a professional." },
  { id: "E06", label: "F 60, older adult, maintenance", sex: "FEMALE", age: 60, heightCm: 155, bfPct: 38, ffmi: 14.5, goal: "MAINTENANCE", activityLevel: "SEDENTARY", experienceLevel: "BEGINNER",
    rationale: "Older adult: protein adequacy and sarcopenia awareness." },
];
for (const e of EDGE) personas.push(build({ ...e, stratum: { sex: e.sex, bodyFatBand: "EDGE", goal: e.goal } }));

// ------------------------------------------------------------------ validate + write
const failures = personas.flatMap((p) => gate(p).map((m) => `${p.id}: ${m}`));
if (failures.length) { console.error("PLAUSIBILITY_GATE_FAILED\n" + failures.join("\n")); process.exit(1); }

const out = {
  version: "personas-inbody.v1", seed: SEED, generator: "test/research/inbody-rag-paper/generate-personas.mjs",
  units: { mass: "kg", height: "cm", bmi: "kg/m^2", energy: "kcal/day", bodyFatPct: "%" },
  note: "Synthetic personas, not real users. bodyFat = fat mass (kg). bmr = Katch-McArdle (InBody-style). reference.* is for analysis only and is never sent to the system under test.",
  count: personas.length, personas,
};
const json = JSON.stringify(out, null, 2) + "\n";
const file = path.join(here, "personas-inbody.v1.json");
fs.writeFileSync(file, json);
const sha = crypto.createHash("sha256").update(json).digest("hex");
fs.writeFileSync(file + ".sha256", `${sha}  personas-inbody.v1.json\n`);

console.log(`wrote ${personas.length} personas (seed ${SEED}) sha256 ${sha.slice(0, 16)}...`);
console.log("id   sex age  h(cm)  W(kg)  BMI   BF%   FFM   FFMI  BMR_KM BMR_MSJ  diff%  goal");
for (const p of personas) {
  const { profile: a, inbody: b, reference: c } = p;
  console.log([p.id.padEnd(4), a.gender[0].padEnd(3), String(a.age).padEnd(4), String(a.heightCm).padEnd(6), String(b.weight).padEnd(6), String(b.bmi).padEnd(5),
    String(b.bodyFatPct).padEnd(5), String(c.fatFreeMassKg).padEnd(5), String(c.ffmi).padEnd(5), String(c.bmrKatchMcArdle).padEnd(6), String(c.bmrMifflinStJeor).padEnd(7),
    String(c.bmrDivergencePct).padStart(5) + " ", a.goal].join(" "));
}
const d = personas.map((p) => Math.abs(p.reference.bmrDivergencePct));
console.log(`|Mifflin - Katch-McArdle| / Katch-McArdle: mean ${r1(d.reduce((s, x) => s + x, 0) / d.length)}%, max ${Math.max(...d)}%`);
