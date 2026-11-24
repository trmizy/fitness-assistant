// TEST FIXTURE: D4 rule table (pure function). Run: npx tsx --test src/app/utils/__tests__/goalVerdict.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyCompVerdict, goalDisplayName, D4_TEXT, type VerdictInput } from "../goalVerdict";

const gain: VerdictInput = { effectiveGoal: "MUSCLE_GAIN", coherent: true, cycle: { goal: "MUSCLE_GAIN", bodyComposition: "up", deltaSMM: 0.5, deltaPBF: -0.2 } };
const cut: VerdictInput = { effectiveGoal: "WEIGHT_LOSS", coherent: true, cycle: { goal: "WEIGHT_LOSS", bodyComposition: "up", deltaSMM: -0.1, deltaPBF: -1.1 } };

test("weight is never judged", () => {
  for (const i of [gain, cut]) assert.equal(bodyCompVerdict("weight", i).label, null);
});

test("approved MUSCLE_GAIN sentences", () => {
  const w = (b: "up" | "flat" | "down") => bodyCompVerdict("muscle", { ...gain, cycle: { ...gain.cycle!, bodyComposition: b } }).label;
  assert.equal(w("up"), "Khối cơ tăng so với kỳ trước.");
  assert.equal(w("down"), "Khối cơ giảm so với kỳ trước.");
  assert.equal(w("flat"), "Khối cơ ổn định trong kỳ.");
});

test("approved WEIGHT_LOSS sentences (backend up = body-fat % went down)", () => {
  const w = (b: "up" | "flat" | "down") => bodyCompVerdict("fat", { ...cut, cycle: { ...cut.cycle!, bodyComposition: b } }).label;
  assert.equal(w("up"), "Tỷ lệ mỡ cơ thể giảm so với kỳ trước.");
  assert.equal(w("down"), "Tỷ lệ mỡ cơ thể tăng so với kỳ trước.");
  assert.equal(w("flat"), "Tỷ lệ mỡ cơ thể ổn định trong kỳ.");
});

test("missing data never reads as stable", () => {
  for (const c of [{ ...gain.cycle!, deltaSMM: null }, { ...gain.cycle!, bodyComposition: null }, null]) {
    const v = bodyCompVerdict("muscle", { ...gain, cycle: c as VerdictInput["cycle"] });
    assert.equal(v.label, D4_TEXT.noData); assert.equal(v.tone, "neutral"); assert.doesNotMatch(v.label!, /ổn định/);
  }
});

test("only the goal's own metric; other goals stay silent", () => {
  assert.equal(bodyCompVerdict("fat", gain).label, null);
  assert.equal(bodyCompVerdict("muscle", cut).label, null);
  for (const g of ["MAINTENANCE", "ATHLETIC_PERFORMANCE", null])
    for (const m of ["muscle", "fat"] as const) assert.equal(bodyCompVerdict(m, { ...gain, effectiveGoal: g }).label, null);
});

test("RECOMPOSITION: own name, never judged, never 'Duy trì'", () => {
  const r: VerdictInput = { effectiveGoal: "MAINTENANCE", phaseType: "RECOMPOSITION", coherent: true, cycle: gain.cycle };
  assert.equal(goalDisplayName(r), "Tái cấu trúc cơ thể");
  assert.equal(goalDisplayName({ effectiveGoal: "MAINTENANCE" }), "Duy trì");
  for (const m of ["muscle", "fat", "weight"] as const) assert.equal(bodyCompVerdict(m, r).label, null);
});

test("goal conflict or cycle assessed under another goal → silent", () => {
  assert.equal(bodyCompVerdict("muscle", { ...gain, coherent: false }).label, null);
  assert.equal(bodyCompVerdict("muscle", { ...gain, cycle: { ...gain.cycle!, goal: "WEIGHT_LOSS" } }).label, null);
});

test("coloured verdicts always carry an icon; no health or success claims", () => {
  for (const b of ["up", "down"] as const) {
    const v = bodyCompVerdict("muscle", { ...gain, cycle: { ...gain.cycle!, bodyComposition: b } });
    assert.notEqual(v.tone, "neutral"); assert.ok(v.icon);
  }
  const all = [...Object.values(D4_TEXT.muscle), ...Object.values(D4_TEXT.fat), D4_TEXT.noData];
  for (const t of all) assert.doesNotMatch(t, /sức khỏe|bệnh|nguy hiểm|béo phì|thành công|đạt mục tiêu|tốt|xấu/i);
});
