import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBmi,
  estimateTdeeRange,
  recommendProteinTarget,
} from "../coach/fitness_calculations";
import {
  buildCoachContext,
  sanitizeCoachContextForPrompt,
} from "../coach/coach_context_builder";
import {
  validateStructuredPlan,
  type StructuredCoachPlan,
} from "../coach/plan_schema";

test("coach calculations compute BMI, TDEE, and protein targets", () => {
  assert.equal(calculateBmi(80, 180), 24.7);

  const tdee = estimateTdeeRange({
    weightKg: 80,
    heightCm: 180,
    age: 30,
    sex: "male",
    activityLevel: "MODERATELY_ACTIVE",
    bodyFatPercent: 20,
  });
  assert.equal(tdee.formula, "katch_mcardle");
  assert.ok((tdee.low_kcal ?? 0) > 2000);

  const protein = recommendProteinTarget(80, "muscle_gain", "intermediate");
  assert.equal(protein.grams_per_day, 144);
});

test("coach context builder sanitizes user identity and reports missing fields", () => {
  const context = buildCoachContext({
    userId: "user-123",
    profile: {
      age: 29,
      gender: "MALE",
      heightCm: 175,
      currentWeightKg: 78,
      goal: "RECOMPOSITION",
      experienceLevel: "BEGINNER",
      activityLevel: "MODERATELY_ACTIVE",
      training: {
        availableEquipment: ["barbell", "dumbbell"],
        injuries: ["knee pain"],
        preferredTrainingDays: [1, 3, 5],
      } as any,
    },
    latestInBody: {
      weightKg: 77.5,
      bodyFatPct: 22,
      skeletalMuscleKg: 34,
      measuredAt: "2026-07-01",
    },
    inBodyHistory: [
      { weight: 77.5, bodyFatPct: 22, muscleMass: 34, date: "2026-07-01" },
      { weight: 80, bodyFatPct: 25, muscleMass: 33, date: "2026-05-01" },
    ],
    workoutHistory: [],
    nutritionHistory: [{ calories: 2200, protein: 140, carbs: 240, fat: 70 }],
    requestedDaysPerWeek: 3,
    timeframeWeeks: 8,
  });

  assert.equal(context.profile.weight_kg, 77.5);
  assert.equal(context.inbody_trend.direction, "improving");
  assert.ok(context.safety_flags.includes("injury_constraints_present"));

  const sanitized = sanitizeCoachContextForPrompt(context);
  assert.equal("user_id" in sanitized.profile, false);
});

// Onboarding/Safety redesign — docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §3.6.
test("coach context builder folds a FOLLOW_UP_SUGGESTED safety screening into safety_flags with a screening: prefix", () => {
  const base = {
    userId: "user-456",
    profile: {
      age: 40,
      gender: "MALE" as const,
      heightCm: 175,
      currentWeightKg: 80,
      goal: "MAINTENANCE" as const,
      experienceLevel: "INTERMEDIATE" as const,
      training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } as any,
    },
    workoutHistory: [],
    nutritionHistory: [],
  };

  const flagged = buildCoachContext({
    ...base,
    profile: {
      ...base.profile,
      safetyScreeningStatus: "FOLLOW_UP_SUGGESTED",
      safetyScreeningFlags: ["heart_condition", "chest_pain"],
    },
  });
  assert.ok(flagged.safety_flags.includes("screening:heart_condition"));
  assert.ok(flagged.safety_flags.includes("screening:chest_pain"));
  assert.equal(flagged.profile.safety_screening_status, "FOLLOW_UP_SUGGESTED");

  // CLEARED (zero concerns, but genuinely screened) contributes nothing — must not be
  // conflated with UNKNOWN (never screened), but also must not fabricate a concern.
  const cleared = buildCoachContext({
    ...base,
    profile: { ...base.profile, safetyScreeningStatus: "CLEARED", safetyScreeningFlags: [] },
  });
  assert.equal(cleared.safety_flags.some((f) => f.startsWith("screening:")), false);
  assert.equal(cleared.profile.safety_screening_status, "CLEARED");

  // UNKNOWN (never screened) — same as CLEARED for safety_flags purposes (nothing to add),
  // but the status itself must stay distinguishable from CLEARED for any consumer that
  // reads safety_screening_status directly instead of the derived flags list.
  const unknown = buildCoachContext(base);
  assert.equal(unknown.safety_flags.some((f) => f.startsWith("screening:")), false);
  assert.equal(unknown.profile.safety_screening_status, null);
});

test("structured plan validator catches available-day and injury safety issues", () => {
  const context = buildCoachContext({
    profile: {
      age: 25,
      gender: "MALE",
      heightCm: 170,
      currentWeightKg: 70,
      goal: "MUSCLE_GAIN",
      experienceLevel: "BEGINNER",
      training: {
        availableEquipment: ["machine"],
        injuries: ["shoulder pain"],
        preferredTrainingDays: [1, 3],
      } as any,
    },
    requestedDaysPerWeek: 4,
  });

  const plan: StructuredCoachPlan = {
    assessment: {
      goal_summary: "gain muscle",
      readiness: "medium",
      key_limitations: [],
    },
    nutrition_plan: {
      target_calories: 2400,
      protein_grams: 130,
      rationale: "controlled_surplus",
    },
    training_plan: {
      days_per_week: 4,
      session_duration_minutes: 60,
      weekly_schedule: [
        {
          day: "Day 1",
          focus: "Upper body",
          exercises: [
            { name: "Bench Press", sets: 5, reps: "8-12", rest_seconds: 90 },
            { name: "Overhead Press", sets: 5, reps: "8-12", rest_seconds: 90 },
            { name: "Dip", sets: 5, reps: "8-12", rest_seconds: 90 },
            { name: "Fly", sets: 5, reps: "8-12", rest_seconds: 90 },
            { name: "Push-up", sets: 5, reps: "AMRAP", rest_seconds: 90 },
          ],
        },
      ],
    },
    progression_rule: "Add load weekly.",
    deload_rule: "Deload if tired.",
    safety_notes: [],
    missing_data_questions: [],
    evidence_used: [],
  };

  const result = validateStructuredPlan(plan, context);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((item) => item.code === "available_days_exceeded"),
  );
  assert.ok(
    result.errors.some((item) => item.code === "injury_warning_missing"),
  );
});
