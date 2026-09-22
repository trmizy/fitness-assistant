/**
 * Phase 8 logic — CL-18 (AI plans + market), CL-23 (wizard), CL-12 (1-1 order).
 * Status sets are the ones in ai-service's personalized-service.service.ts (read 22/9).
 *
 * Runs with: npx tsx --test src/features/__tests__/plans.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  chooseLatestPlan,
  countInvalidExerciseIds,
  dayExerciseSummary,
  filterPlans,
  friendlyPlanFailReason,
  getPlanEvidence,
  initialFilter,
  jobProgress,
  JOB_PHASES,
  localizeDayGoal,
  localizePlanNote,
  parseAdjustInput,
  parseRepeatWeeks,
  planExerciseIds,
  planLocation,
  replacesOtherProgram,
  saveDaysPerWeek,
  sortPlans,
  suggestedWeekdays,
  toggleWeekday,
  validateGenerate,
  LLM_TIMEOUT_MESSAGE,
  LLM_NOT_READY_MESSAGE,
} from "../plans/aiPlans";
import {
  adoptBlockedReason,
  adoptErrorMessage,
  buildCustomizedSchedule,
  canRepublish,
  defaultAdoptWeekdays,
  lowestPackagePrice,
  toggleAdoptWeekday,
} from "../plans/marketplace";
import {
  buildCheckInPayload,
  buildIntakePayload,
  canCancel,
  canDispute,
  canRequestRefund,
  canRequestRevision,
  checkInBlockedReason,
  defaultCheckIn,
  draftExerciseIds,
  emptyIntake,
  intakeBlockedReason,
  intakeFromProfile,
  ORDER_STATUS_LABEL,
  revisionsLabel,
  timelineIndex,
} from "../plans/personalizedOrder";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-9222-222222222222";

const plan = (over: any) => ({ id: "p", status: "COMPLETED", ...over });

describe("AI plans — list", () => {
  it("sorts newest first by max(updatedAt, createdAt), then version", () => {
    const sorted = sortPlans([
      plan({ id: "old", createdAt: "2026-01-01", updatedAt: "2026-01-02" }),
      plan({ id: "new", createdAt: "2026-02-01" }),
      plan({ id: "v2", createdAt: "2026-01-01", updatedAt: "2026-01-02", version: 2 }),
    ] as any);
    assert.deepEqual(sorted.map((p) => p.id), ["new", "v2", "old"]);
  });

  it("opens on running plans first, then completed, then failed", () => {
    assert.equal(initialFilter([plan({ status: "PROCESSING" }), plan({})] as any), "active");
    assert.equal(initialFilter([plan({ status: "FAILED" }), plan({})] as any), "completed");
    assert.equal(initialFilter([plan({ status: "FAILED" })] as any), "failed");
    assert.equal(initialFilter([]), "all");
  });

  it("filters QUEUED + PROCESSING as active", () => {
    const all = [plan({ status: "QUEUED" }), plan({ status: "PROCESSING" }), plan({})] as any;
    assert.equal(filterPlans(all, "active").length, 2);
  });

  it("prefers the newest COMPLETED plan over a newer failed one", () => {
    const latest = chooseLatestPlan([
      plan({ id: "f", status: "FAILED", createdAt: "2026-03-01" }),
      plan({ id: "c", createdAt: "2026-02-01" }),
    ] as any);
    assert.equal(latest?.id, "c");
  });
});

describe("AI plans — content", () => {
  const schedule = [
    { day: 1, exercises: [{ exerciseId: ID1, name: "Bench" }, { exerciseId: "bench-press", name: "Row" }] },
    { day: 2, exercises: [{ exerciseId: ID1, name: "Squat" }, { exerciseId: ID2, name: "RDL" }, { name: "Lunge" }] },
  ];

  it("counts exercises whose id is not a real catalog UUID", () => {
    assert.equal(countInvalidExerciseIds(schedule as any), 2);
    assert.equal(countInvalidExerciseIds(null), 0);
  });

  it("collects distinct valid ids for one catalog lookup", () => {
    assert.deepEqual(planExerciseIds(schedule as any).sort(), [ID1, ID2]);
  });

  it("summarizes a day from real names", () => {
    assert.equal(dayExerciseSummary(schedule[1] as any, 2), "Squat · RDL · +1");
  });

  it("clamps the save form's days/week to 1..7, plan content first", () => {
    assert.equal(saveDaysPerWeek(plan({ plan: { daysPerWeek: 5 }, daysPerWeek: 3 }) as any), 5);
    assert.equal(saveDaysPerWeek(plan({ daysPerWeek: 9 }) as any), 7);
    assert.equal(saveDaysPerWeek(null, 4), 4);
  });

  it("reads training location from plan metadata only when valid", () => {
    assert.equal(planLocation(plan({ plan: { _metadata: { trainingLocation: "HOME" } } }) as any), "HOME");
    assert.equal(planLocation(plan({ plan: { _metadata: { trainingLocation: "BEACH" } } }) as any), null);
  });

  it("reads evidence in either snake_case or camelCase", () => {
    assert.equal(getPlanEvidence({ evidence_used: [{ title: "a" }] } as any).evidenceUsed.length, 1);
    assert.equal(getPlanEvidence({ safetyNotes: ["x"] } as any).safetyNotes.length, 1);
  });

  it("localizes known English notes and replaces garbled text", () => {
    assert.match(localizePlanNote("Sleep 7-9 hours and keep at least one recovery day weekly."), /^Ngủ 7-9 giờ/);
    assert.match(localizePlanNote("Ng? 7-9 gi?"), /^Ngủ 7-9 giờ/);
    assert.equal(localizePlanNote("Giữ lưng thẳng"), "Giữ lưng thẳng");
    assert.equal(localizeDayGoal("", 2), "Buổi tập 3");
    assert.equal(localizeDayGoal("Ng?c + tay sau", 0), "Ngực + Vai + Tay sau");
  });

  it("turns LLM failures into friendly text", () => {
    assert.equal(friendlyPlanFailReason("Request timed out after 120s"), LLM_TIMEOUT_MESSAGE);
    assert.equal(friendlyPlanFailReason("Ollama unreachable"), LLM_NOT_READY_MESSAGE);
    assert.equal(friendlyPlanFailReason("Không đủ bài tập"), "Không đủ bài tập");
  });
});

describe("AI plans — forms", () => {
  it("validates the same ranges the server does", () => {
    const ok = { goal: "Tăng cơ", durationWeeks: 8, daysPerWeek: 4, exercisesPerDay: 4 };
    assert.equal(validateGenerate(ok), null);
    assert.ok(validateGenerate({ ...ok, goal: "  " }));
    assert.ok(validateGenerate({ ...ok, durationWeeks: 53 }));
    assert.ok(validateGenerate({ ...ok, daysPerWeek: 0 }));
    assert.ok(validateGenerate({ ...ok, exercisesPerDay: 9 }));
  });

  it("parses adjust overrides, blanks meaning keep", () => {
    assert.deepEqual(parseAdjustInput({ adjustments: " thêm cardio ", daysPerWeek: "", exercisesPerDay: "" }), {
      ok: true,
      adjustments: "thêm cardio",
      daysPerWeek: undefined,
      exercisesPerDay: undefined,
    });
    assert.equal(parseAdjustInput({ adjustments: "x", daysPerWeek: "8", exercisesPerDay: "" }).ok, false);
    assert.equal(parseAdjustInput({ adjustments: "", daysPerWeek: "", exercisesPerDay: "" }).ok, false);
  });

  it("repeat weeks is optional but bounded", () => {
    assert.deepEqual(parseRepeatWeeks(""), { ok: true });
    assert.deepEqual(parseRepeatWeeks("12"), { ok: true, value: 12 });
    assert.equal(parseRepeatWeeks("60").ok, false);
  });

  it("weekday toggle keeps Monday-first order and respects the cap", () => {
    assert.deepEqual(toggleWeekday([1, 3], 0, 3).selected, [1, 3, 0]);
    assert.deepEqual(toggleWeekday([5], 2, 3).selected, [2, 5]);
    const capped = toggleWeekday([1, 3, 5], 2, 3);
    assert.deepEqual(capped.selected, [1, 3, 5]);
    assert.ok(capped.warning);
    assert.deepEqual(toggleWeekday([1, 3], 3, 3).selected, [1]);
    assert.equal(suggestedWeekdays(4).length, 4);
  });

  it("only asks to confirm when a DIFFERENT program would be replaced", () => {
    assert.equal(replacesOtherProgram({ id: "prog", sourcePlanId: "p1" }, "p1"), false);
    assert.equal(replacesOtherProgram({ id: "prog", sourcePlanId: "p0" }, "p1"), true);
    assert.equal(replacesOtherProgram({ id: "prog" }, "p1"), true);
    assert.equal(replacesOtherProgram(null, "p1"), false);
  });

  it("job progress never reports done before COMPLETED", () => {
    const late = jobProgress("PROCESSING", 10 * 60_000);
    assert.ok(late.progress < 1);
    assert.ok(late.activePhase < JOB_PHASES.length);
    assert.equal(jobProgress("QUEUED", 0).activePhase, 0);
    assert.equal(jobProgress("COMPLETED", 0).progress, 1);
  });
});

describe("Market", () => {
  it("lowest package price, null when free", () => {
    assert.equal(lowestPackagePrice({ packages: [{ price: 300 }, { price: 150 }] } as any), 150);
    assert.equal(lowestPackagePrice({ packages: [] } as any), null);
  });

  it("default adopt weekdays and capped toggle", () => {
    assert.deepEqual(defaultAdoptWeekdays(3), [1, 3, 5]);
    assert.deepEqual(toggleAdoptWeekday([1, 3, 5], 2, 3), [1, 3, 5]);
    assert.deepEqual(toggleAdoptWeekday([3, 1], 0, 3), [0, 1, 3]);
  });

  it("customized schedule only when changed, and flags an emptied day", () => {
    const days = [
      { day: "Day 1", exercises: [{ exerciseId: ID1, name: "A", sets: 3, reps: "10" }] },
      { day: "Day 2", exercises: [{ exerciseId: ID2, name: "B", sets: 4, reps: "8" }] },
    ];
    assert.equal(buildCustomizedSchedule(days, new Set(), {}).customized, undefined);
    const trimmed = buildCustomizedSchedule(days, new Set(["0:0"]), { "1:0": 5 });
    assert.equal(trimmed.emptyDay, true);
    assert.equal(trimmed.customized![1].exercises[0].sets, 5);
  });

  it("adopt needs exact weekday count, no empty day, and replace consent", () => {
    const base = { selectedWeekdays: [1, 3], daysPerWeek: 2, confirmedReplace: true, emptyDay: false };
    assert.equal(adoptBlockedReason(base), null);
    assert.ok(adoptBlockedReason({ ...base, selectedWeekdays: [1] }));
    assert.ok(adoptBlockedReason({ ...base, confirmedReplace: false }));
    assert.ok(adoptBlockedReason({ ...base, emptyDay: true }));
  });

  it("402 on adopt means buy a package first", () => {
    assert.match(adoptErrorMessage({ response: { status: 402 } }), /mua gói/);
  });

  it("republish from APPROVED or REJECTED only", () => {
    assert.equal(canRepublish("APPROVED"), true);
    assert.equal(canRepublish("REJECTED"), true);
    assert.equal(canRepublish("SUBMITTED"), false);
  });
});

describe("1-1 order", () => {
  const statuses = Object.keys(ORDER_STATUS_LABEL) as any[];

  it("labels all 16 server statuses", () => {
    assert.equal(statuses.length, 16);
  });

  it("every status is on the timeline or explicitly off it", () => {
    const off = statuses.filter((s) => timelineIndex(s) === null).sort();
    assert.deepEqual(off, ["CANCELLED", "DISPUTED", "PENDING_PAYMENT", "REFUNDED", "REFUND_REQUESTED"]);
    assert.equal(timelineIndex("REVISION_REQUESTED"), 2);
    assert.equal(timelineIndex("COMPLETED"), 4);
  });

  it("cancel exactly in the server's pre-work set", () => {
    assert.deepEqual(statuses.filter(canCancel).sort(), [
      "INTAKE_PENDING",
      "INTAKE_SUBMITTED",
      "PENDING_PAYMENT",
      "PURCHASED",
    ]);
  });

  it("refund only after the PT started, never on closed or flagged orders", () => {
    assert.equal(canRequestRefund("INTAKE_SUBMITTED"), false);
    assert.equal(canRequestRefund("PT_REVIEWING"), true);
    assert.equal(canRequestRefund("ACTIVE"), true);
    for (const s of ["COMPLETED", "CANCELLED", "REFUNDED", "REFUND_REQUESTED", "DISPUTED"])
      assert.equal(canRequestRefund(s as any), false, s);
  });

  it("dispute is its own door, closed on unpaid/closed/flagged orders", () => {
    assert.equal(canDispute("INTAKE_PENDING"), true);
    assert.equal(canDispute("DRAFT_DELIVERED"), true);
    for (const s of ["PENDING_PAYMENT", "COMPLETED", "CANCELLED", "REFUNDED", "REFUND_REQUESTED", "DISPUTED"])
      assert.equal(canDispute(s as any), false, s);
  });

  it("revision limit comes from the snapshot", () => {
    assert.equal(canRequestRevision({ status: "DRAFT_DELIVERED", revisionCount: 2, revisionLimitSnapshot: 2 }), false);
    assert.equal(canRequestRevision({ status: "DRAFT_DELIVERED", revisionCount: 5, revisionLimitSnapshot: null }), true);
    assert.equal(canRequestRevision({ status: "ACTIVE", revisionCount: 0, revisionLimitSnapshot: 2 }), false);
    assert.equal(revisionsLabel({ revisionCount: 1, revisionLimitSnapshot: 2 }), "Còn 1/2 lượt yêu cầu chỉnh sửa");
  });

  it("intake pre-fills from the profile and builds web's payload", () => {
    const form = intakeFromProfile({ age: 28, gender: "MALE", currentWeight: 70, injuries: ["gối", "vai"] });
    assert.equal(form.weight, "70");
    assert.equal(form.injuries, "gối, vai");
    const payload = buildIntakePayload({ ...form, notes: " " }, ["basic_info"]);
    assert.deepEqual(payload.intakeData.injuries, ["gối", "vai"]);
    assert.equal(payload.intakeData.heightCm, undefined);
    assert.equal(payload.intakeData.notes, undefined);
    assert.equal(payload.intakeData.daysPerWeek, 4);
  });

  it("intake needs consent and sane numbers", () => {
    assert.ok(intakeBlockedReason(emptyIntake(), []));
    assert.ok(intakeBlockedReason({ ...emptyIntake(), daysPerWeek: "9" }, ["basic_info"]));
    assert.ok(intakeBlockedReason({ ...emptyIntake(), weight: "-3" }, ["basic_info"]));
    assert.equal(intakeBlockedReason(emptyIntake(), ["basic_info"]), null);
  });

  it("check-in bounds and payload", () => {
    const form = defaultCheckIn();
    assert.equal(checkInBlockedReason(form), null);
    assert.ok(checkInBlockedReason({ ...form, overallRpe: "11" }));
    assert.ok(checkInBlockedReason({ ...form, workoutAdherence: "120" }));
    assert.equal(buildCheckInPayload(form).overallRpe, 7);
  });

  it("draft exercise ids are distinct", () => {
    const draft = { days: [{ exercises: [{ exerciseId: ID1 }, { exerciseId: ID2 }] }, { exercises: [{ exerciseId: ID1 }] }] };
    assert.deepEqual(draftExerciseIds(draft), [ID1, ID2]);
    assert.deepEqual(draftExerciseIds(null), []);
  });
});

describe("AI plans — retry + start dates", () => {
  it("retry re-sends the failed plan's own parameters", async () => {
    const { retryPayload } = await import("../plans/aiPlans");
    const p = retryPayload({
      id: "x",
      status: "FAILED",
      goal: "Tăng cơ",
      duration: 6,
      daysPerWeek: 3,
      plan: { exercisesPerDay: 5, _metadata: { trainingLocation: "HOME" } },
    } as any);
    assert.deepEqual(p, {
      goal: "Tăng cơ",
      durationWeeks: 6,
      daysPerWeek: 3,
      exercisesPerDay: 5,
      trainingLocation: "HOME",
      equipmentPreference: "MIXED_GYM",
    });
  });

  it("start dates are local YYYY-MM-DD from today, across a month end", async () => {
    const { startDateOptions } = await import("../plans/aiPlans");
    const opts = startDateOptions(new Date(2026, 8, 29, 23, 30), 4);
    assert.deepEqual(opts.map((o) => o.value), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    assert.equal(opts[0].label, "Hôm nay");
    assert.equal(opts[2].sub, "1/10");
  });
});

describe("AI nutrition plans", () => {
  it("builds web's payload, blanks omitted, durationWeeks 1", async () => {
    const { buildNutritionPayload, defaultNutritionForm } = await import("../plans/nutritionAiPlans");
    const p = buildNutritionPayload({ ...defaultNutritionForm(), weightKg: "70", customRestriction: " không cay ", restrictions: ["Không sữa"] });
    assert.equal(p.durationWeeks, 1);
    assert.equal(p.weightKg, 70);
    assert.equal("heightCm" in p, false);
    assert.deepEqual(p.restrictions, ["Không sữa", "không cay"]);
    assert.equal("gender" in p, false);
  });

  it("catches what the server schema rejects, and web's macro-vs-calorie rule", async () => {
    const { nutritionFormError, defaultNutritionForm } = await import("../plans/nutritionAiPlans");
    const base = defaultNutritionForm();
    assert.equal(nutritionFormError(base), null);
    assert.ok(nutritionFormError({ ...base, dailyCaloriesTarget: "400" }));
    assert.ok(nutritionFormError({ ...base, age: "25.5" }));
    assert.ok(nutritionFormError({ ...base, mealsPerDay: 1 }));
    // 150*4 + 250*4 + 70*9 = 2230 vs 2200 → within 110 kcal (5%)
    assert.equal(nutritionFormError({ ...base, dailyCaloriesTarget: "2200", proteinTargetG: "150", carbTargetG: "250", fatTargetG: "70" }), null);
    assert.match(nutritionFormError({ ...base, dailyCaloriesTarget: "2200", proteinTargetG: "150", carbTargetG: "100", fatTargetG: "50" })!, /chưa khớp/);
  });

  it("end date only for spans longer than the 7-day menu", async () => {
    const { endDateFor } = await import("../plans/nutritionAiPlans");
    assert.equal(endDateFor("2026-09-28", 7), undefined);
    assert.equal(endDateFor("2026-09-28", 14), "2026-10-11");
  });
});
