/**
 * Pure pieces of SH-03's onboarding wizard (`app/client/onboarding.tsx`): the `PUT /profile/me`
 * payload and the per-step gating. Ported from web's `OnboardingWizardPage.tsx`; kept out of the
 * screen so the rules that protect downstream calculations can be unit-tested.
 */

export type OnboardingAnswers = {
  experienceLevel: string;
  goal: string;
  trainingDays: number[];
  sessionDurationMinutes: string;
  splitMode: "auto" | "manual";
  preferredSplit: string;
  injuriesText: string;
  competesInSport: boolean;
  safetyFlags: ReadonlySet<string>;
  safetyStepReached: boolean;
  activityLevel: string;
  age: string;
  gender: string;
  /** Canonical cm. */
  heightCm: string;
  /** Canonical kg. */
  currentWeight: string;
  /** Canonical kg. */
  targetWeight: string;
};

/** The wizard's step indexes that gate "Tiếp tục". */
export const LEVEL_STEP = 0;
export const BODY_STEP = 4;

/** Vietnamese numeric keyboards type a decimal comma. */
export function normalizeDecimal(value: string): string {
  return value.replace(",", ".");
}

export function canAdvanceOnboardingStep(
  step: number,
  answers: Pick<OnboardingAnswers, "experienceLevel" | "goal" | "activityLevel">,
): boolean {
  if (step === LEVEL_STEP) return !!answers.experienceLevel && !!answers.goal;
  // activityLevel is required, never silently defaulted — "Bỏ qua" stays the escape hatch.
  if (step === BODY_STEP) return !!answers.activityLevel;
  return true;
}

export function buildOnboardingPayload(a: OnboardingAnswers) {
  return {
    experienceLevel: a.experienceLevel || undefined,
    goal: a.goal || undefined,
    preferredTrainingDays: a.trainingDays,
    sessionDurationMinutes: a.sessionDurationMinutes
      ? parseInt(a.sessionDurationMinutes, 10)
      : undefined,
    // Explicit null (not undefined) so switching back to "auto" clears an earlier manual choice.
    preferredSplit:
      a.splitMode === "manual" && a.preferredSplit && a.preferredSplit !== "Chưa xác định"
        ? a.preferredSplit
        : null,
    // availableEquipment deliberately omitted — PUT /equipment/me is the one write path for it.
    injuries: a.injuriesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    competesInSport: a.competesInSport,
    // Real value only, never a fabricated default: a silent default here defeated the nutrition
    // safety net on web once (docs/ONBOARDING_PT_INTAKE_SAFETY_REDESIGN.md §2).
    activityLevel: a.activityLevel || undefined,
    // Only recorded if the user actually reached the safety step: an empty flag set alone cannot
    // tell "screened, no concerns" from "never asked".
    ...(a.safetyStepReached
      ? {
          safetyScreeningStatus:
            a.safetyFlags.size > 0 ? ("FOLLOW_UP_SUGGESTED" as const) : ("CLEARED" as const),
          safetyScreeningFlags: Array.from(a.safetyFlags),
        }
      : {}),
    age: a.age ? parseInt(a.age, 10) : undefined,
    gender: a.gender || undefined,
    heightCm: a.heightCm ? parseFloat(a.heightCm) : undefined,
    currentWeight: a.currentWeight ? parseFloat(a.currentWeight) : undefined,
    targetWeight: a.targetWeight ? parseFloat(a.targetWeight) : undefined,
    // True on every submission, "Bỏ qua" included — otherwise RequireOnboarding would bounce the user
    // straight back into the wizard and skipping would be a dead end.
    hasCompletedOnboarding: true,
  };
}
