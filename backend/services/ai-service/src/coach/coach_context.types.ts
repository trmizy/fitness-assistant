import type { EvidenceUsed } from "../llm/types";

export type CoachSex = "male" | "female" | "other" | null;
export type CoachGoal =
  | "weight_loss"
  | "muscle_gain"
  | "maintenance"
  | "athletic_performance"
  | "recomposition"
  | "general_fitness"
  | null;
export type CoachExperienceLevel =
  | "beginner"
  | "intermediate"
  | "advanced"
  | null;

export interface UserProfileContext {
  user_id?: string;
  age: number | null;
  sex: CoachSex;
  height_cm: number | null;
  weight_kg: number | null;
  target_weight_kg: number | null;
  goal: CoachGoal;
  activity_level: string | null;
  experience_level: CoachExperienceLevel;
}

export interface InBodyContext {
  measured_at: string | null;
  weight_kg: number | null;
  body_fat_percent: number | null;
  skeletal_muscle_mass_kg: number | null;
  body_fat_mass_kg: number | null;
  lean_body_mass_kg: number | null;
  bmr_kcal: number | null;
  bmi: number | null;
  visceral_fat_level: number | null;
  ecw_tbw: number | null;
}

export interface InBodyTrendContext {
  first_measured_at: string | null;
  latest_measured_at: string | null;
  weight_change_kg: number | null;
  body_fat_percent_change: number | null;
  skeletal_muscle_mass_change_kg: number | null;
  direction: "improving" | "declining" | "mixed" | "stable" | "unknown";
}

export interface TrainingSummaryContext {
  sessions_per_week: number | null;
  weekly_sets_by_muscle: Record<string, number>;
  average_rpe: number | null;
  average_rir: number | null;
  progression_status: "progressing" | "maintaining" | "regressing" | "unknown";
  missed_sessions: number | null;
  recent_session_count: number;
}

export interface NutritionSummaryContext {
  avg_calories: number | null;
  avg_protein_g: number | null;
  avg_carbs_g: number | null;
  avg_fat_g: number | null;
  adherence_percent: number | null;
  weight_trend: "up" | "down" | "stable" | "unknown";
}

export interface RecoveryContext {
  sleep_hours_avg: number | null;
  soreness_level: number | null;
  fatigue_level: number | null;
  rest_days_per_week: number | null;
}

export interface GoalContext {
  primary_goal: CoachGoal;
  requested_days_per_week: number | null;
  requested_session_duration_minutes: number | null;
  timeframe_weeks: number | null;
}

export interface CoachConstraintsContext {
  injuries: string[];
  equipment: string[];
  available_days: number[] | null;
  session_duration_minutes: number | null;
}

export interface CoachContext {
  profile: UserProfileContext;
  inbody_latest: InBodyContext;
  inbody_trend: InBodyTrendContext;
  training_summary: TrainingSummaryContext;
  nutrition_summary: NutritionSummaryContext;
  recovery: RecoveryContext;
  goal: GoalContext;
  constraints: CoachConstraintsContext;
  safety_flags: string[];
  missing_fields: string[];
  evidence_used?: EvidenceUsed[];
}
