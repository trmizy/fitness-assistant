/**
 * WB-11 logic — FitnessRoadmap journey + guided wizard helpers.
 *
 * Runs with: npx tsx --test src/features/__tests__/roadmap.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildDiagnosisInput,
  buildManualRoadmap,
  deficitLabel,
  draftTotalWeeks,
  effectiveBodyFatPct,
  getPhaseReadiness,
  groupForecasts,
  hasMinimumEnergyInputs,
  manualRoadmapError,
  prefillFromProfileAndInBody,
  translateRoadmapError,
  trendLabel,
  wizardStepError,
  type WizardBody,
} from "../roadmap/roadmap";

const body = (over: Partial<WizardBody> = {}): WizardBody => ({
  weightKg: "70",
  heightCm: "175",
  age: "28",
  gender: "MALE",
  bodyFatMethod: "manual",
  bodyFatPct: "",
  inbodyBodyFatPct: null,
  activityLevel: "MODERATELY_ACTIVE",
  trainingDaysPerWeek: 3,
  dailyGoalSteps: 8000,
  goal: "WEIGHT_LOSS",
  targetWeightKg: "",
  targetBodyFatPercent: "",
  timeframeWeeks: 24,
  ...over,
});

const phase = (cycles: any[], id = "ph1") => ({ id, trainingCycles: cycles }) as any;

describe("journey readiness", () => {
  it("maps cycle states to what the client can do next", () => {
    assert.equal(getPhaseReadiness(phase([{ status: "ACTIVE" }]), null).kind, "ACTIVE_CYCLE");
    assert.equal(getPhaseReadiness(phase([{ status: "ANALYZED", cycleIndex: 1 }]), { phaseId: "ph1", assessmentId: "a", cycleId: "c" }).kind, "PENDING_REBUILD");
    assert.equal(getPhaseReadiness(phase([]), null).kind, "NO_CYCLE_YET");
    assert.equal(getPhaseReadiness(phase([{ status: "COMPLETED", cycleIndex: 1 }]), null).kind, "ANALYZING");
    assert.equal(getPhaseReadiness(phase([{ status: "ANALYZED", decision: "INSUFFICIENT_DATA", cycleIndex: 1 }]), null).kind, "INSUFFICIENT_DATA");
    const ready = getPhaseReadiness(phase([{ status: "CANCELLED", cycleIndex: 1 }, { status: "ANALYZED", decision: "PROGRESS", cycleIndex: 2 }]), null);
    assert.deepEqual(ready, { kind: "READY_TO_ADVANCE", lastDecision: "PROGRESS" });
    assert.equal(getPhaseReadiness(phase([{ status: "CANCELLED", cycleIndex: 3 }]), null).kind, "CYCLE_CANCELLED");
  });
});

describe("wizard", () => {
  it("InBody body fat outranks a typed value; manual is parsed", () => {
    assert.equal(effectiveBodyFatPct({ bodyFatMethod: "inbody", inbodyBodyFatPct: 16.4, bodyFatPct: "30" }), 16.4);
    assert.equal(effectiveBodyFatPct({ bodyFatMethod: "manual", inbodyBodyFatPct: 16.4, bodyFatPct: "22" }), 22);
    assert.equal(effectiveBodyFatPct({ bodyFatMethod: "manual", inbodyBodyFatPct: null, bodyFatPct: "" }), undefined);
  });

  it("diagnosis input only carries what the user gave", () => {
    const input = buildDiagnosisInput(body({ age: "", targetWeightKg: "65" }));
    assert.equal(input.age, undefined);
    assert.equal(input.targetWeightKg, 65);
    assert.equal(input.bodyFatPct, undefined);
    assert.equal(buildDiagnosisInput(body({ bodyFatPct: "20" })).bodyFatMethod, "manual");
  });

  it("step gates", () => {
    assert.ok(wizardStepError(1, body({ gender: "" })));
    assert.ok(wizardStepError(1, body({ weightKg: "-5" })));
    assert.equal(wizardStepError(1, body()), null);
    assert.ok(wizardStepError(2, body({ activityLevel: "" })));
    assert.equal(hasMinimumEnergyInputs(body({ activityLevel: "" })), false);
  });

  it("prefill: InBody weight wins over the stored profile weight", () => {
    const p = prefillFromProfileAndInBody({ age: 30, gender: "FEMALE", currentWeight: 60 }, [{ bodyFatPct: 24, weight: 58.2, date: "2026-09-01" }]);
    assert.equal(p.weightKg, "58.2");
    assert.equal(p.bodyFatMethod, "inbody");
    assert.equal(p.inbodyBodyFatPct, 24);
    assert.equal(prefillFromProfileAndInBody(null, []).weightKg, undefined);
  });

  it("total weeks and forecast grouping", () => {
    assert.equal(draftTotalWeeks([{ plannedStartAt: "2026-09-01", plannedEndAt: "2026-09-29" }, { plannedStartAt: "2026-09-29", plannedEndAt: "2026-10-13" }]), 6);
    const groups = groupForecasts({
      strategyGroups: [{ key: "K1", bucket: "CUT", phaseIndexes: [1, 2] }],
      phaseForecasts: [
        { phaseIndex: 1, durationWeeks: 8, projectedCalories: 2000 } as any,
        { phaseIndex: 2, durationWeeks: 2, projectedCalories: 2400 } as any,
      ],
    });
    assert.equal(groups[0].weeks, 10);
    assert.equal(groups[0].avgKcal, 2200);
  });

  it("labels", () => {
    assert.equal(deficitLabel({ projectedDeficitOrSurplusPercent: -0.2 }), "Thâm hụt ~20%");
    assert.equal(deficitLabel({ projectedDeficitOrSurplusPercent: 0 }), "Mức duy trì");
    assert.equal(trendLabel({ direction: "down", changePerWeek: -0.45 }, "kg"), "↓ 0.5kg/tuần");
    assert.equal(trendLabel(null, "kg"), null);
  });
});

describe("advanced create", () => {
  it("chains phases back-to-back from today with maxCycles = ceil(weeks/4)", () => {
    const body = buildManualRoadmap(
      { name: " ", goalType: "WEIGHT_LOSS", phases: [{ phaseType: "FAT_LOSS", weeks: 8 }, { phaseType: "DIET_BREAK", weeks: 2 }] },
      new Date(2026, 8, 22, 18, 0),
    );
    assert.equal(body.name, "Lộ trình của tôi");
    assert.equal(body.plannedStartAt, "2026-09-22");
    assert.equal(body.phases[0].plannedEndAt, "2026-11-17");
    assert.equal(body.phases[1].plannedStartAt, "2026-11-17");
    assert.equal(body.phases[1].plannedEndAt, "2026-12-01");
    assert.deepEqual(body.phases.map((p) => p.objective.maxCycles), [2, 1]);
    assert.deepEqual(body.phases.map((p) => p.phaseIndex), [1, 2]);
  });

  it("bounds", () => {
    assert.ok(manualRoadmapError([]));
    assert.ok(manualRoadmapError([{ phaseType: "FAT_LOSS", weeks: 27 }]));
    assert.equal(manualRoadmapError([{ phaseType: "FAT_LOSS", weeks: 8 }]), null);
  });

  it("server errors read in Vietnamese", () => {
    assert.match(translateRoadmapError("No completed cycle is ready for roadmap advancement"), /Chưa có chu kỳ/);
    assert.equal(translateRoadmapError("something else"), "something else");
  });
});
