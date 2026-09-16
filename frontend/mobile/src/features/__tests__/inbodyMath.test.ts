/**
 * CL-14 arithmetic. The fixtures are john.doe's real `GET /inbody` rows and the real create rules,
 * probed against the running backend on 2026-09-16 — including the one that bites: a create with no
 * `muscleMass` returns a raw 500, so the form has to demand it.
 *
 * Runs with: npx tsx --test src/features/__tests__/inbodyMath.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_FORM,
  SEGMENT_NORMS,
  hasSegmental,
  segmentVerdict,
  buildEntryPayload,
  deriveBodyFatKg,
  formErrors,
  formFromExtracted,
  metricDelta,
  normalizeEntry,
  normalizeHistory,
} from "../inbody/inbodyMath";

/** A sheet with only the basics — the shape a manual entry produces. */
const realSheetBase = {
  id: "base",
  date: "2026-08-31T00:00:00.000Z",
  dateOnly: "2026-08-31T00:00:00.000Z",
  weight: 71.3,
  muscleMass: 35.2,
  bodyFat: 11.7,
  bodyFatPct: 16.4,
  status: "manual",
};

/** Two real rows, deliberately given to the parser newest-last to prove it sorts. */
const rows = [
  {
    id: "old",
    date: "2026-08-30T00:00:00.000Z",
    dateOnly: "2026-08-30T00:00:00.000Z",
    weight: 88.7,
    muscleMass: 35.2,
    bodyFat: 14.5,
    bodyFatPct: 16.3,
    bmi: null,
    bmr: null,
    visceralFat: null,
    height: null,
    status: "manual",
    notes: null,
  },
  {
    id: "new",
    date: "2026-08-31T00:00:00.000Z",
    dateOnly: "2026-08-31T00:00:00.000Z",
    weight: 71.3,
    muscleMass: 35.2,
    bodyFat: 11.7,
    bodyFatPct: 16.4,
    bmi: null,
    bmr: null,
    visceralFat: null,
    height: null,
    status: "manual",
    notes: null,
  },
];

describe("normalizeEntry / normalizeHistory", () => {
  it("keeps the measurement day, which is what the server's one-per-day rule uses", () => {
    const entry = normalizeEntry(rows[1]);
    assert.equal(entry.dateOnly, "2026-08-31");
    assert.equal(entry.weight, 71.3);
    assert.equal(entry.bodyFat, 11.7, "bodyFat is a mass in kg");
    assert.equal(entry.bodyFatPct, 16.4);
    assert.equal(entry.bmi, null, "an unmeasured field stays null rather than becoming 0");
  });

  it("sorts newest measurement first, whatever order the API returned", () => {
    const history = normalizeHistory(rows);
    assert.deepEqual(history.map((e) => e.id), ["new", "old"]);
  });

  it("accepts the wrapped shapes and survives junk", () => {
    assert.equal(normalizeHistory({ entries: rows }).length, 2);
    assert.equal(normalizeHistory({ data: rows }).length, 2);
    assert.deepEqual(normalizeHistory(null), []);
    assert.deepEqual(normalizeHistory({ error: "nope" }), []);
  });
});

describe("deriveBodyFatKg", () => {
  it("matches the server's own derivation to one decimal", () => {
    assert.equal(deriveBodyFatKg(70, 18), 12.6);
    assert.equal(deriveBodyFatKg(71.3, 16.4), 11.7);
  });
});

describe("metricDelta", () => {
  const [older, newer] = [normalizeEntry(rows[0]), normalizeEntry(rows[1])];

  it("reads a drop in weight as progress and a drop in muscle as not", () => {
    const weight = metricDelta(newer, older, "weight");
    assert.equal(weight.delta, -17.4);
    assert.equal(weight.good, true, "less weight is the good direction");

    const muscleDown = metricDelta({ ...newer, muscleMass: 33 }, older, "muscleMass");
    assert.equal(muscleDown.delta, -2.2);
    assert.equal(muscleDown.good, false, "less muscle is not");
  });

  it("has no verdict when nothing changed or there is nothing to compare with", () => {
    assert.deepEqual(metricDelta(newer, older, "muscleMass"), { value: 35.2, delta: 0, good: null });
    assert.deepEqual(metricDelta(newer, null, "weight"), { value: 71.3, delta: null, good: null });
    assert.deepEqual(metricDelta(newer, newer, "weight"), { value: 71.3, delta: null, good: null });
    assert.deepEqual(metricDelta(newer, older, "bmi"), { value: null, delta: null, good: null });
  });
});

describe("formErrors", () => {
  const valid = { ...EMPTY_FORM, date: "2026-09-16", weight: "71.3", muscleMass: "35.2", bodyFatPct: "16.4" };

  it("accepts a complete, sane measurement", () => {
    assert.deepEqual(formErrors(valid), {});
  });

  it("demands muscle mass — without it the server answers 500, not a message", () => {
    assert.equal(formErrors({ ...valid, muscleMass: "" }).muscleMass, "Cần nhập khối cơ (kg)");
    assert.equal(formErrors({ ...valid, muscleMass: "0" }).muscleMass, "Cần nhập khối cơ (kg)");
  });

  it("refuses impossible bodies", () => {
    assert.ok(formErrors({ ...valid, weight: "0" }).weight);
    assert.ok(formErrors({ ...valid, weight: "500" }).weight);
    assert.ok(formErrors({ ...valid, muscleMass: "80" }).muscleMass, "muscle cannot exceed weight");
    assert.ok(formErrors({ ...valid, bodyFatPct: "0" }).bodyFatPct);
    assert.ok(formErrors({ ...valid, bodyFatPct: "150" }).bodyFatPct);
    assert.ok(formErrors({ ...valid, height: "40" }).height);
  });

  it("takes a Vietnamese decimal comma, which is what the number keyboard gives", () => {
    assert.deepEqual(formErrors({ ...valid, weight: "71,3" }), {});
  });
});

describe("buildEntryPayload", () => {
  const form = { ...EMPTY_FORM, date: "2026-09-16", weight: "70", muscleMass: "33", bodyFatPct: "18" };

  it("sends the fat mass the server would have derived anyway", () => {
    const payload = buildEntryPayload(form);
    assert.equal(payload.weight, 70);
    assert.equal(payload.muscleMass, 33);
    assert.equal(payload.bodyFatPct, 18);
    assert.equal(payload.bodyFat, 12.6);
    assert.equal(payload.date, "2026-09-16T00:00:00.000Z");
  });

  it("leaves out what was not measured instead of sending zeroes", () => {
    const payload = buildEntryPayload(form);
    assert.equal("height" in payload, false);
    assert.equal("bmr" in payload, false);
    assert.equal("visceralFat" in payload, false);
    assert.equal("notes" in payload, false);
  });

  it("carries the optional numbers when they are given", () => {
    const payload = buildEntryPayload({ ...form, height: "172", bmr: "1650.4", visceralFat: "7", notes: " sau buổi tập " });
    assert.equal(payload.height, 172);
    assert.equal(payload.bmr, 1650, "BMR is an integer column");
    assert.equal(payload.visceralFat, 7);
    assert.equal(payload.notes, "sau buổi tập");
  });
});

describe("formFromExtracted", () => {
  it("fills what OCR read and leaves the rest blank", () => {
    const form = formFromExtracted(
      { weight: 71.3, muscleMass: 35.2, bodyFatPct: 16.4, bmr: 1620 },
      "2026-09-16",
    );
    assert.equal(form.weight, "71.3");
    assert.equal(form.muscleMass, "35.2");
    assert.equal(form.bodyFatPct, "16.4");
    assert.equal(form.bmr, "1620");
    assert.equal(form.height, "", "not read → left for the user, not guessed");
  });

  it("turns a fat MASS into the percentage the form asks for", () => {
    const form = formFromExtracted({ weight: 70, bodyFat: 12.6 }, "2026-09-16");
    assert.equal(form.bodyFatPct, "18");
  });

  it("uses the scan's own date when it has one, else today", () => {
    assert.equal(formFromExtracted({ date: "2026-08-31T00:00:00.000Z" }, "2026-09-16").date, "2026-08-31");
    assert.equal(formFromExtracted({}, "2026-09-16").date, "2026-09-16");
  });
});

describe("segmental analysis", () => {
  const sheet = {
    ...realSheetBase,
    rightArmMuscle: 3.4,
    leftArmMuscle: 2.7,
    trunkMuscle: 24.5,
    rightLegMuscle: 9.6,
    leftLegMuscle: 9.4,
    trunkFat: 9.2,
  };

  it("keeps every segmental field, null where the sheet had none", () => {
    const entry = normalizeEntry(sheet);
    assert.equal(entry.segmental.rightArmMuscle, 3.4);
    assert.equal(entry.segmental.trunkFat, 9.2);
    assert.equal(entry.segmental.rightArmFat, null, "not on the sheet → null, not 0");
  });

  it("knows whether a sheet carries a muscle or fat breakdown at all", () => {
    assert.equal(hasSegmental(normalizeEntry(sheet), "muscle"), true);
    assert.equal(hasSegmental(normalizeEntry(sheet), "fat"), true, "trunkFat alone counts");
    assert.equal(hasSegmental(normalizeEntry(realSheetBase), "muscle"), false);
    assert.equal(hasSegmental(null, "muscle"), false);
  });

  it("judges a segment against web's own thresholds: under 90%, over 110%", () => {
    assert.deepEqual(segmentVerdict(3.2, SEGMENT_NORMS.muscle.arm), { pct: 100, label: "Bình thường" });
    assert.deepEqual(segmentVerdict(2.7, SEGMENT_NORMS.muscle.arm), { pct: 84, label: "Thấp" });
    assert.deepEqual(segmentVerdict(3.6, SEGMENT_NORMS.muscle.arm), { pct: 113, label: "Cao" });
    // Exactly on the boundary is still normal, same as web's `< 90` / `> 110`.
    assert.equal(segmentVerdict(2.88, SEGMENT_NORMS.muscle.arm).label, "Bình thường");
    assert.deepEqual(segmentVerdict(null, SEGMENT_NORMS.fat.trunk), { pct: null, label: "—" });
  });

  it("sends segmental values only when they were filled in", () => {
    const base = { ...EMPTY_FORM, date: "2026-09-16", weight: "70", muscleMass: "33", bodyFatPct: "18" };
    assert.equal("trunkMuscle" in buildEntryPayload(base), false);
    const withSegments = buildEntryPayload({ ...base, trunkMuscle: "24.5", rightArmFat: "1,1" });
    assert.equal(withSegments.trunkMuscle, 24.5);
    assert.equal(withSegments.rightArmFat, 1.1, "decimal comma from the number keyboard");
    assert.equal("leftLegFat" in withSegments, false);
  });

  it("carries the segmental table OCR read off a real printout", () => {
    const form = formFromExtracted({ weight: 71.3, trunkMuscle: 24.5, leftLegFat: 2.1 }, "2026-09-16");
    assert.equal(form.trunkMuscle, "24.5");
    assert.equal(form.leftLegFat, "2.1");
    assert.equal(form.rightArmMuscle, "");
  });
});
