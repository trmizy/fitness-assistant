// Creates the synthetic test users through the REAL auth + profile APIs (register -> dev OTP -> verify -> PUT /profile/me).
// A: complete profile; B: different profile; C: intentionally incomplete; D/E: clean users with no plans (used by journeys).
// Writes .tmp-stack/users.json (tokens are test-only, isolated DB). Run from repo root: node test/ai-chat-full-verification/setup-users.mjs
import fs from "node:fs";
import { registerUser, putProfile, http } from "./lib.mjs";

const spec = {
  A: { email: "chat.a@gymini-test.local", name: "Tester A", profile: { age: 22, gender: "MALE", heightCm: 178, goal: "WEIGHT_LOSS", activityLevel: "SEDENTARY", experienceLevel: "BEGINNER", currentWeight: 113.6, targetWeight: 80, preferredTrainingDays: [1, 3, 5], availableEquipment: ["dumbbell", "bodyweight"], hasCompletedOnboarding: true, nutritionBudgetLevel: "LOW" } },
  B: { email: "chat.b@gymini-test.local", name: "Tester B", profile: { age: 28, gender: "FEMALE", heightCm: 165, goal: "MUSCLE_GAIN", activityLevel: "LIGHTLY_ACTIVE", experienceLevel: "INTERMEDIATE", currentWeight: 62, targetWeight: 65, preferredTrainingDays: [0, 2, 4], hasCompletedOnboarding: true } },
  C: { email: "chat.c@gymini-test.local", name: "Tester C", profile: { goal: "WEIGHT_LOSS" } },
  D: { email: "chat.d@gymini-test.local", name: "Tester D", profile: { age: 30, gender: "MALE", heightCm: 175, goal: "MAINTENANCE", activityLevel: "MODERATELY_ACTIVE", experienceLevel: "BEGINNER", currentWeight: 78, targetWeight: 76, hasCompletedOnboarding: true } },
  F: { email: "chat.f@gymini-test.local", name: "Tester F", profile: { goal: "WEIGHT_LOSS" } },
  E: { email: "chat.e@gymini-test.local", name: "Tester E", profile: { age: 26, gender: "MALE", heightCm: 172, goal: "WEIGHT_LOSS", activityLevel: "LIGHTLY_ACTIVE", experienceLevel: "BEGINNER", currentWeight: 82, targetWeight: 72, hasCompletedOnboarding: false } },
};
const out = {};
for (const [k, s] of Object.entries(spec)) {
  const u = await registerUser(s.email, s.name);
  const p = await putProfile(u, s.profile);
  out[k] = { ...u, profileStatus: p.status };
  console.log(k, u.userId, "profile", p.status);
}
fs.writeFileSync(".tmp-stack/users.json", JSON.stringify(out, null, 1));
