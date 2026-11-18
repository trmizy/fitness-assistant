/**
 * AI-01 (partner retest 2026-11-18): the AI coach greeting printed "Cân nặng: --- (↑ 0 kg)" for a user with no InBody result.
 * Run: npx tsx --test src/app/utils/__tests__/aiCoachGreeting.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildInitialCoachText } from "../aiCoachGreeting";

describe("buildInitialCoachText", () => {
  it("no InBody at all: says so, no placeholders and no invented trend", () => {
    const t = buildInitialCoachText(undefined, undefined);
    assert.match(t, /chưa có kết quả InBody/);
    assert.doesNotMatch(t, /---|↑|↓|0 kg|undefined|NaN/);
    assert.equal(buildInitialCoachText(null, null), t);
  });

  it("one InBody result: shows the values and NO trend arrow (nothing to compare with)", () => {
    const t = buildInitialCoachText({ weight: 70, muscleMass: 30, bodyFatPct: 20 }, undefined);
    assert.match(t, /Cân nặng: 70 kg\n/);
    assert.match(t, /Cơ: 30 kg\n/);
    assert.match(t, /Mỡ cơ thể: 20%/);
    assert.doesNotMatch(t, /↑|↓|không đổi|undefined|NaN/);
  });

  it("two results: signed one-decimal change with the right arrow", () => {
    const t = buildInitialCoachText({ weight: 69.5, muscleMass: 30.4, bodyFatPct: 19 }, { weight: 70, muscleMass: 30, bodyFatPct: 20 });
    assert.match(t, /Cân nặng: 69.5 kg \(↓ 0.5 kg\)/);
    assert.match(t, /Cơ: 30.4 kg \(↑ 0.4 kg\)/);
  });

  it("an unchanged value reads 'không đổi', not '(↑ 0 kg)'", () => {
    const t = buildInitialCoachText({ weight: 70, muscleMass: 30, bodyFatPct: 20 }, { weight: 70, muscleMass: 30, bodyFatPct: 21 });
    assert.match(t, /Cân nặng: 70 kg \(không đổi\)/);
    assert.doesNotMatch(t, /\(↑ 0 kg\)|\(↓ 0 kg\)/);
  });

  it("a previous result with a missing field does not produce NaN", () => {
    const t = buildInitialCoachText({ weight: 70, muscleMass: 30, bodyFatPct: 20 }, { weight: 71 });
    assert.match(t, /Cân nặng: 70 kg \(↓ 1.0 kg\)/);
    assert.match(t, /Cơ: 30 kg\n/);
    assert.doesNotMatch(t, /NaN|undefined/);
  });
});
