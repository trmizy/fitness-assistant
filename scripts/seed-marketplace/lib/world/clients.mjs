// ~1,000 clients: auth account (CUSTOMER) + UserProfile + (for ~40 %) a few InBody scans. Everything deterministic.
import { did, makeHelpers, rngFrom, seedEmail, daysBefore, normalizeVi } from "../util.mjs";
import { EQUIPMENT, INJURIES, DIETS } from "./constants.mjs";

export const CLIENT_COUNT = Number(process.env.SEED_MARKETPLACE_CLIENTS || 1000);
/** The account the plan reserves for search demos. */
export const SEARCH_ACCOUNT = { full: "Phạm Thu Uyên", gender: "FEMALE" };

const CITY_WEIGHTS = [["HCM", 58], ["HN", 30], ["DN", 12]];
const REGION_BY_CITY = { HCM: "NAM", HN: "BAC", DN: "TRUNG" };

const GOALS = [["WEIGHT_LOSS", 40], ["MUSCLE_GAIN", 35], ["MAINTENANCE", 15], ["ATHLETIC_PERFORMANCE", 10]];
const ACTIVITY = [["SEDENTARY", 18], ["LIGHTLY_ACTIVE", 32], ["MODERATELY_ACTIVE", 30], ["VERY_ACTIVE", 15], ["EXTREMELY_ACTIVE", 5]];
const EXPERIENCE = [["BEGINNER", 50], ["INTERMEDIATE", 38], ["ADVANCED", 12]];

export function buildClients(names) {
  const rng = rngFrom("clients");
  const h = makeHelpers(rng);
  const out = [];
  for (let i = 0; i < CLIENT_COUNT; i++) {
    const person = i === 0 ? names.reserve(SEARCH_ACCOUNT.full, SEARCH_ACCOUNT.gender) : names.next();
    const gender = person.gender;
    const city = h.weighted(CITY_WEIGHTS);
    const age = h.int(18, 58);
    const birthYear = 2026 - age;
    const dob = new Date(Date.UTC(birthYear, h.int(0, 11), h.int(1, 28)));
    const heightCm = gender === "MALE" ? h.int(163, 188) : h.int(150, 172);
    const goal = h.weighted(GOALS);
    const bmi = goal === "WEIGHT_LOSS" ? h.float(25, 31) : goal === "MUSCLE_GAIN" ? h.float(18.8, 23.5) : h.float(20.5, 25.5);
    const currentWeight = Number((bmi * (heightCm / 100) ** 2).toFixed(1));
    const targetWeight =
      goal === "WEIGHT_LOSS" ? Number((currentWeight - h.float(4, 14)).toFixed(1))
      : goal === "MUSCLE_GAIN" ? Number((currentWeight + h.float(3, 8)).toFixed(1))
      : currentWeight;
    const startingWeight =
      goal === "WEIGHT_LOSS" ? Number((currentWeight + h.float(1, 5)).toFixed(1))
      : goal === "MUSCLE_GAIN" ? Number((currentWeight - h.float(1, 4)).toFixed(1))
      : currentWeight;
    const experienceLevel = h.weighted(EXPERIENCE);
    const hasInjury = h.chance(0.15);
    const flags = hasInjury && h.chance(0.4) ? ["joint_problem"] : [];
    const onboarded = h.chance(0.92);
    const withInbody = h.chance(0.4);

    const profile = {
      userId: did("client", person.slug),
      profileId: did("client-profile", person.slug),
      firstName: person.firstName,
      lastName: person.lastName,
      email: seedEmail(person.slug),
      isPT: false,
      dateOfBirth: dob,
      age,
      gender,
      heightCm,
      goal,
      activityLevel: h.weighted(ACTIVITY),
      experienceLevel,
      competesInSport: goal === "ATHLETIC_PERFORMANCE" && h.chance(0.3),
      safetyScreeningStatus: onboarded ? (flags.length ? "FOLLOW_UP_SUGGESTED" : "CLEARED") : "UNKNOWN",
      safetyScreeningFlags: onboarded ? flags : [],
      preferredTrainingDays: h.sample([1, 2, 3, 4, 5, 6, 0], h.int(2, 5)).sort((a, b) => a - b),
      availableEquipment: h.sample(EQUIPMENT, h.int(2, 5)),
      injuries: hasInjury ? h.sample(INJURIES, h.int(1, 2)) : [],
      preferredSplit: onboarded ? h.pick(["Full Body", "Upper/Lower", "Push/Pull/Legs", "Bro Split"]) : null,
      hasCompletedOnboarding: onboarded,
      currentWeight,
      targetWeight,
      startingWeight,
      startingWeightSource: "ONBOARDING",
      dietaryPreference: h.pick(DIETS),
      nutritionBudgetLevel: h.weighted([["LOW", 25], ["NORMAL", 55], ["FLEXIBLE", 20]]),
      region: REGION_BY_CITY[city],
      sessionDurationMinutes: h.pick([45, 60, 60, 75, 90]),
      ptBudgetVnd: h.chance(0.5) ? h.pick([300000, 400000, 500000, 600000, 800000, 1000000]) : null,
      firstNameNormalized: normalizeVi(person.firstName),
      lastNameNormalized: normalizeVi(person.lastName),
      createdAt: daysBefore(h.int(20, 400)),
    };

    const inbody = [];
    if (withInbody) {
      const scans = h.int(2, 4);
      let w = startingWeight;
      const bodyFatPct0 = gender === "MALE" ? h.float(16, 30) : h.float(24, 38);
      const ago = new Array(scans);
      ago[scans - 1] = h.int(2, 10);
      for (let s = scans - 2; s >= 0; s--) ago[s] = ago[s + 1] + h.int(14, 28);
      for (let s = 0; s < scans; s++) {
        const daysAgo = ago[s];
        const progress = scans === 1 ? 1 : s / (scans - 1);
        w = Number((startingWeight + (currentWeight - startingWeight) * progress).toFixed(1));
        const pct = Number((bodyFatPct0 - progress * (goal === "WEIGHT_LOSS" ? h.float(0.5, 3) : 0.3)).toFixed(1));
        const fatKg = Number(((w * pct) / 100).toFixed(1));
        const muscle = Number((w * (gender === "MALE" ? 0.46 : 0.38) + h.float(-1.2, 1.2)).toFixed(1));
        const ffm = w - fatKg;
        const date = daysBefore(daysAgo, 8 + (s % 5));
        inbody.push({
          id: did("inbody", person.slug, String(s)),
          userId: profile.userId,
          date,
          dateOnly: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
          weight: w,
          height: heightCm,
          bmi: Number((w / (heightCm / 100) ** 2).toFixed(1)),
          bodyFat: fatKg,
          bodyFatPct: pct,
          muscleMass: muscle,
          visceralFat: Math.max(1, Math.round(pct / 3.2)),
          bmr: Math.round(370 + 21.6 * ffm),
          rightArmMuscle: Number((muscle * 0.065).toFixed(2)),
          leftArmMuscle: Number((muscle * 0.063).toFixed(2)),
          trunkMuscle: Number((muscle * 0.48).toFixed(2)),
          rightLegMuscle: Number((muscle * 0.19).toFixed(2)),
          leftLegMuscle: Number((muscle * 0.19).toFixed(2)),
          rightArmFat: Number((fatKg * 0.05).toFixed(2)),
          leftArmFat: Number((fatKg * 0.05).toFixed(2)),
          trunkFat: Number((fatKg * 0.52).toFixed(2)),
          rightLegFat: Number((fatKg * 0.19).toFixed(2)),
          leftLegFat: Number((fatKg * 0.19).toFixed(2)),
          status: "manual",
        });
      }
      // the profile mirrors the newest scan, like the app does
      profile.currentWeight = inbody[inbody.length - 1].weight;
      profile.startingWeight = inbody[0].weight;
    }

    out.push({
      key: `client:${person.slug}`,
      kind: "CLIENT",
      slug: person.slug,
      person,
      city,
      profile,
      inbody,
      isSearchAccount: i === 0,
    });
  }
  return out;
}
