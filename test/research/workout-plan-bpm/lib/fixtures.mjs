// Business fixtures, exactly as specified in results/research/workout-plan-bpm/<RUN>/annotation-guideline.md §9 (frozen).
// Fields NOT named by §9 are deliberately left unset (the production default applies). Nothing is invented.
// Note: sessionDurationMinutes has a production default of 60 (user-service schema), so F_MG_NO_DAYS may carry 60 on file.
// The baseline snapshot records the real seeded profile per case so this can be audited instead of assumed.
export const FIXTURES = {
  F_MG_NO_DAYS: { hasCompletedOnboarding: true, goal: "MUSCLE_GAIN", currentWeight: 95, heightCm: 172, age: 28 },
  F_WL_DAYS: { hasCompletedOnboarding: true, goal: "WEIGHT_LOSS", currentWeight: 80, heightCm: 172, age: 28, preferredTrainingDays: [1, 3, 5], sessionDurationMinutes: 60 },
  F_MG_DAYS: { hasCompletedOnboarding: true, goal: "MUSCLE_GAIN", currentWeight: 95, heightCm: 172, age: 28, preferredTrainingDays: [1, 3, 5], sessionDurationMinutes: 60 },
};

/** Seeds the fixture through the real profile endpoint. Throws on a non-2xx status: a seed failure is an ERROR, never silently skipped. */
export async function seedFixture(user, fixtureId, putProfile) {
  const body = FIXTURES[fixtureId];
  if (!body) throw new Error(`UNKNOWN_FIXTURE ${fixtureId} (F_NOT_ONBOARDED is defined in §9 but used by no case)`);
  const r = await putProfile(user, body);
  if (r.status >= 300) throw new Error(`FIXTURE_SEED_FAILED ${fixtureId} status=${r.status}`);
  return { fixtureId, putStatus: r.status, requested: body };
}
