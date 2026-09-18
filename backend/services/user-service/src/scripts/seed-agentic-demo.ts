/**
 * SYNTHETIC / DEMONSTRATION DATA SEEDER — NOT REAL PT PERFORMANCE DATA,
 * NOT EVIDENCE OF REAL-WORLD EFFECTIVENESS.
 *
 * Populates a realistic-shaped PT roster + ClientJourney cohort for
 * demonstrating/evaluating the AI PT-recommendation pipeline (`scorePT`,
 * `journeySimilarity`, `summarizeJourneys`) end-to-end, since the real
 * platform currently has zero PT/journey data in any environment (see
 * docs/ai-agent-system-feasibility-audit.md §2.6, §11).
 *
 * Methodology and every distribution/range choice is documented in
 * docs/synthetic-agentic-dataset-methodology.md — read that before
 * changing the generation logic here.
 *
 * SAFETY:
 * - Refuses to run when NODE_ENV=production (hard guard, not just a
 *   comment) or when ENABLE_AGENTIC_DEMO is not explicitly "true".
 * - Every row this script writes is tagged dataOrigin: "SYNTHETIC" (PT
 *   UserProfile, Contract, ClientJourney) or a plainly-fake email/name
 *   (client UserProfiles) — never mixed with real rows, always filterable.
 * - Deterministic: every id is derived from GYMINI_AGENTIC_SEED (default
 *   below) via a seeded hash, and every write is an upsert keyed by that
 *   id — running this script twice produces the same rows, not
 *   duplicates.
 *
 * Usage: npx tsx src/scripts/seed-agentic-demo.ts
 *   (requires ENABLE_AGENTIC_DEMO=true in the environment)
 */
import { createHash } from "node:crypto";
import { PrismaClient, ContractStatus, ContractSource, PackageType, SessionMode, DayOfWeek, SessionStatus, Gender, Goal, ActivityLevel, ExperienceLevel } from "../generated/prisma";

if (process.env.NODE_ENV === "production") {
  throw new Error("[seed-agentic-demo] Refusing to run: NODE_ENV=production. This seeder is non-production-only.");
}
if (process.env.ENABLE_AGENTIC_DEMO !== "true") {
  throw new Error("[seed-agentic-demo] Refusing to run: set ENABLE_AGENTIC_DEMO=true to confirm you intend to seed synthetic demo data.");
}

const prisma = new PrismaClient();
const SEED = process.env.GYMINI_AGENTIC_SEED ?? "gymini-agentic-demo-v1";

// Deterministic UUID (same construction as agentic-fitness.service.ts's
// createDraft — a real, already-reviewed pattern in this codebase, not a
// new invention) so re-running this script upserts the same rows.
function did(...parts: string[]): string {
  const hex = createHash("sha256").update(`${SEED}:${parts.join(":")}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Deterministic PRNG (mulberry32) — no external dependency, reproducible
// across machines/runs for the same SEED.
function mulberry32(seedStr: string) {
  let a = 0;
  for (let i = 0; i < seedStr.length; i++) a = (a * 31 + seedStr.charCodeAt(i)) >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
const int = (min: number, max: number) => Math.floor(min + rng() * (max - min + 1));
const float = (min: number, max: number, decimals = 1) => Number((min + rng() * (max - min)).toFixed(decimals));

const GOALS: Goal[] = ["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"];
const GOAL_SPECIALTY_ALIASES: Record<Goal, string[]> = {
  WEIGHT_LOSS: ["Giảm mỡ", "Body Recomposition"],
  MUSCLE_GAIN: ["Tăng cơ", "Hypertrophy"],
  MAINTENANCE: ["General Fitness"],
  ATHLETIC_PERFORMANCE: ["Powerlifting", "Sports Performance"],
};
const EXPERIENCE: ExperienceLevel[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];
const FIRST_NAMES = ["Minh", "Huy", "Linh", "Trang", "Nam", "An", "Hà", "Quân", "Phương", "Đức", "Thảo", "Long", "Vy", "Khoa", "Ngọc"];
const LAST_NAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ"];

type PtArchetype = "COLD_START" | "ESTABLISHED_STRONG" | "ESTABLISHED_MIXED" | "ESTABLISHED_WEAK" | "NEW_STRONG_CREDENTIALS" | "EXPERIENCED_AVERAGE_REVIEWS";

const N_PT = 60;
// Distribution across archetypes — deliberately NOT "60 amazing PTs" (see
// docs/synthetic-agentic-dataset-methodology.md §"Non-ideal cases").
const ARCHETYPE_WEIGHTS: Array<[PtArchetype, number]> = [
  ["COLD_START", 15], ["ESTABLISHED_STRONG", 15], ["ESTABLISHED_MIXED", 12],
  ["ESTABLISHED_WEAK", 8], ["NEW_STRONG_CREDENTIALS", 5], ["EXPERIENCED_AVERAGE_REVIEWS", 5],
];
function archetypeFor(index: number): PtArchetype {
  const total = ARCHETYPE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let cursor = index % total;
  for (const [archetype, weight] of ARCHETYPE_WEIGHTS) {
    if (cursor < weight) return archetype;
    cursor -= weight;
  }
  return "COLD_START";
}

async function upsertSyntheticClient(index: number, goal: Goal, experience: ExperienceLevel) {
  const userId = did("client", String(index));
  await prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      firstName: pick(FIRST_NAMES), lastName: pick(LAST_NAMES),
      email: `synthetic-client-${index}@demo.gymini.invalid`,
      isPT: false, dataOrigin: "SYNTHETIC",
      gender: pick<Gender>(["MALE", "FEMALE"]), age: int(20, 45), heightCm: float(155, 185, 0),
      goal, experienceLevel: experience, activityLevel: pick<ActivityLevel>(["LIGHTLY_ACTIVE", "MODERATELY_ACTIVE", "VERY_ACTIVE"]),
      preferredTrainingDays: [1, 3, 5], injuries: [],
    },
  });
  return userId;
}

async function upsertPT(i: number) {
  const archetype = archetypeFor(i);
  const userId = did("pt", String(i));
  const goal = GOALS[i % GOALS.length];
  const specialties = [...new Set([...GOAL_SPECIALTY_ALIASES[goal], ...(rng() > 0.6 ? GOAL_SPECIALTY_ALIASES[pick(GOALS)] : [])])];
  const priceTier = pick(["LOW", "MID", "HIGH"] as const);
  const priceBase = priceTier === "LOW" ? int(150_000, 300_000) : priceTier === "MID" ? int(300_000, 600_000) : int(600_000, 1_200_000);
  const yearsExperience = archetype === "NEW_STRONG_CREDENTIALS" || archetype === "COLD_START" ? String(int(0, 2)) : String(int(2, 12));

  await prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      firstName: pick(FIRST_NAMES), lastName: pick(LAST_NAMES),
      email: `synthetic-pt-${i}@demo.gymini.invalid`,
      isPT: true, ptSuspended: false, isAcceptingClients: true, dataOrigin: "SYNTHETIC",
      specialties, gender: pick<Gender>(["MALE", "FEMALE"]), age: int(24, 45),
      sessionDurationMinutes: 60,
    },
  });

  const applicationId = did("pt-application", String(i));
  await prisma.pTApplication.upsert({
    where: { userProfileId: (await prisma.userProfile.findUniqueOrThrow({ where: { userId }, select: { id: true } })).id },
    update: {},
    create: {
      id: applicationId,
      userProfileId: (await prisma.userProfile.findUniqueOrThrow({ where: { userId }, select: { id: true } })).id,
      status: "APPROVED", approvedAt: new Date(), submittedAt: new Date(),
      yearsOfExperience: yearsExperience, languages: rng() > 0.7 ? ["vi", "en"] : ["vi"],
      mainSpecialties: specialties, targetClientGroups: [pick(["Người mới bắt đầu", "Người có kinh nghiệm", "Vận động viên"])],
      professionalBio: `PT chuyên ${specialties.join(", ")} — dữ liệu demo, không phải hồ sơ thật.`,
      serviceMode: pick<"ONLINE" | "OFFLINE" | "HYBRID">(["ONLINE", "OFFLINE", "HYBRID"]),
      desiredSessionPrice: priceBase, sessionsPerPackage: 10, sessionDurationMinutes: 60,
    },
  });

  if (archetype === "NEW_STRONG_CREDENTIALS" || rng() > 0.5) {
    await prisma.pTApplicationCertificate.upsert({
      where: { id: did("cert", String(i)) },
      update: {},
      create: {
        id: did("cert", String(i)), applicationId,
        certificateName: pick(["NASM-CPT", "ACE-CPT", "ISSA-CPT", "ACSM-CPT"]),
        issuingOrganization: "Demo Certification Body", isCurrentlyValid: true,
        verificationStatus: archetype === "NEW_STRONG_CREDENTIALS" ? "VERIFIED" : pick(["VERIFIED", "UNVERIFIED"]),
      },
    });
  }

  // 1-2 service packages, ONLINE/OFFLINE only (schema constraint — never HYBRID on a package).
  const packageCount = rng() > 0.5 ? 2 : 1;
  for (let p = 0; p < packageCount; p++) {
    await prisma.pTServicePackage.upsert({
      where: { id: did("package", String(i), String(p)) },
      update: {},
      create: {
        id: did("package", String(i), String(p)), ptUserId: userId,
        name: `Gói ${p === 0 ? "10" : "5"} buổi`, sessionCount: p === 0 ? 10 : 5,
        price: priceBase * (p === 0 ? 10 : 5), sessionMode: p === 0 ? "OFFLINE" : "ONLINE",
        sessionDurationMinutes: 60, isActive: true,
      },
    });
  }

  // Availability: 2-5 weekdays, cold-start/new PTs get wide-open availability
  // (a real product incentive — new PTs need bookable slots), established
  // PTs get moderate availability (busier).
  const days: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
  const dayCount = archetype === "COLD_START" || archetype === "NEW_STRONG_CREDENTIALS" ? int(4, 6) : int(2, 4);
  const chosenDays = [...days].sort(() => rng() - 0.5).slice(0, dayCount);
  for (const day of chosenDays) {
    await prisma.pTAvailability.upsert({
      where: { id: did("availability", String(i), day) },
      update: {},
      create: { id: did("availability", String(i), day), ptUserId: userId, dayOfWeek: day, startTime: "08:00", endTime: "20:00", isActive: true },
    });
  }

  return { userId, archetype, goal, applicationId };
}

type OutcomeProfile = { adherenceRange: [number, number]; weightDeltaRange: [number, number]; bodyFatDeltaRange: [number, number]; ratingRange: [number, number]; completesEndingInBody: number };
const OUTCOME_PROFILES: Record<Exclude<PtArchetype, "COLD_START">, OutcomeProfile> = {
  ESTABLISHED_STRONG: { adherenceRange: [0.8, 1.0], weightDeltaRange: [-6, -2], bodyFatDeltaRange: [-4, -1.5], ratingRange: [4, 5], completesEndingInBody: 0.9 },
  ESTABLISHED_MIXED: { adherenceRange: [0.4, 0.9], weightDeltaRange: [-3, 1], bodyFatDeltaRange: [-2, 1], ratingRange: [3, 5], completesEndingInBody: 0.7 },
  ESTABLISHED_WEAK: { adherenceRange: [0.2, 0.6], weightDeltaRange: [-1, 2], bodyFatDeltaRange: [-0.5, 2], ratingRange: [2, 4], completesEndingInBody: 0.5 },
  NEW_STRONG_CREDENTIALS: { adherenceRange: [0.7, 1.0], weightDeltaRange: [-4, -1], bodyFatDeltaRange: [-3, -1], ratingRange: [4, 5], completesEndingInBody: 0.8 },
  EXPERIENCED_AVERAGE_REVIEWS: { adherenceRange: [0.5, 0.85], weightDeltaRange: [-3, 0], bodyFatDeltaRange: [-1.5, 0.5], ratingRange: [3, 4], completesEndingInBody: 0.75 },
};

async function seedJourneysAndReviews(pt: { userId: string; archetype: PtArchetype; goal: Goal }, index: number) {
  if (pt.archetype === "COLD_START") return { journeyCount: 0, reviewCount: 0 };
  const profile = OUTCOME_PROFILES[pt.archetype];
  // Enough clients per PT to legitimately clear FITNESS_SCORING.minimumCohort
  // (5) for STRONG/NEW_STRONG archetypes (so the demo can show a real,
  // non-empty historical cohort), while WEAK/AVERAGE archetypes stay closer
  // to the threshold (some clear it, some don't — a realistic mix, not "all
  // PTs have perfect data").
  // Sized so that ~75% concentrating on one experience level (see below)
  // comfortably clears FITNESS_SCORING.minimumCohort (5) for the
  // strong/mixed archetypes, while WEAK/AVERAGE stay closer to (and
  // sometimes below) the threshold — the intended "some clear it, some
  // don't" realism, not "all PTs have exactly enough data".
  const clientCount = pt.archetype === "ESTABLISHED_STRONG" || pt.archetype === "NEW_STRONG_CREDENTIALS" ? int(8, 12)
    : pt.archetype === "ESTABLISHED_MIXED" ? int(6, 10) : int(2, 5);

  // Real PTs tend to attract a concentrated client profile (a beginner-
  // focused coach mostly sees beginners), not a uniform spread across
  // experience levels — and journeySimilarity()/the candidates() DB query
  // both hard-filter on an EXACT experience match against the requester,
  // so a uniform spread would silently dilute every PT's cohort below
  // FITNESS_SCORING.minimumCohort (5) no matter how many clients are
  // seeded. ~75% of each PT's clients share one "primary" experience
  // level (deterministic per PT index); the rest vary, so the dataset
  // still has some cross-level diversity.
  const primaryExperience = EXPERIENCE[index % EXPERIENCE.length];
  let journeyCount = 0, reviewCount = 0;
  for (let c = 0; c < clientCount; c++) {
    const experience = rng() < 0.75 ? primaryExperience : pick(EXPERIENCE);
    const clientUserId = await upsertSyntheticClient(index * 100 + c, pt.goal, experience);
    const baselineWeight = float(60, 95, 1);
    const durationWeeks = int(8, 16);
    const startDate = new Date(Date.now() - (durationWeeks + 2) * 7 * 86_400_000);
    const completedAt = new Date(startDate.getTime() + durationWeeks * 7 * 86_400_000);
    const totalSessions = durationWeeks; // roughly 1 session/week baseline
    const adherence = float(...profile.adherenceRange, 2);
    const sessionsCompleted = Math.round(totalSessions * adherence);

    const contractId = did("contract", String(index), String(c));
    await prisma.contract.upsert({
      where: { id: contractId },
      update: {},
      create: {
        id: contractId, ptUserId: pt.userId, clientUserId, status: ContractStatus.COMPLETED,
        packageType: PackageType.PACKAGE, packageName: "Gói demo", sessionMode: SessionMode.OFFLINE,
        totalSessions, usedSessions: sessionsCompleted, price: 2_000_000, pricePerSession: 200_000,
        startDate, endDate: completedAt, completedAt, sessionDurationMinutes: 60,
        source: ContractSource.INDEPENDENT, dataOrigin: "SYNTHETIC",
      },
    });

    // One representative Session + SessionReview per contract (enough for
    // ptReviewRepository.aggregateForPts to have real rows to average —
    // not one row per prescribed session, which would be a lot of rows for
    // no additional signal quality).
    const sessionId = did("session", String(index), String(c));
    await prisma.session.upsert({
      where: { id: sessionId },
      update: {},
      create: {
        id: sessionId, contractId, clientUserId, ptUserId: pt.userId, status: SessionStatus.COMPLETED,
        sessionMode: SessionMode.OFFLINE, scheduledStartAt: startDate, scheduledEndAt: new Date(startDate.getTime() + 60 * 60000),
        completedAt, sessionDeducted: true,
      },
    });
    const rating = int(...profile.ratingRange);
    await prisma.sessionReview.upsert({
      where: { sessionId },
      update: {},
      create: { id: did("review", String(index), String(c)), sessionId, contractId, clientUserId, rating, comment: "Dữ liệu demo (SYNTHETIC) — không phải đánh giá thật." },
    });
    reviewCount++;

    // Ending InBody presence varies per outcome profile — some journeys
    // intentionally have no ending measurement (a real, common data gap).
    const hasEnding = rng() < profile.completesEndingInBody;
    const weightDelta = hasEnding ? float(...profile.weightDeltaRange) : null;
    const bodyFatDelta = hasEnding ? float(...profile.bodyFatDeltaRange) : null;
    const baselineBodyFat = float(15, 32);

    await prisma.clientJourney.upsert({
      where: { id: did("journey", String(index), String(c)) },
      update: {},
      create: {
        id: did("journey", String(index), String(c)),
        userId: clientUserId, ptId: pt.userId, contractId,
        goal: pt.goal, experience,
        baselineWeight, baselineBodyFat, baselineLeanMass: null,
        trainingDays: int(2, 5), sessionMinutes: 60, constraints: [],
        durationWeeks, sessionsPrescribed: totalSessions, sessionsCompleted,
        nutritionAdherence: rng() > 0.3 ? float(0.4, 1.0, 2) : null,
        endingWeight: hasEnding ? Math.round((baselineWeight + weightDelta!) * 10) / 10 : null,
        endingBodyFat: hasEnding ? Math.round((baselineBodyFat + bodyFatDelta!) * 10) / 10 : null,
        endingLeanMass: null, strengthChangePercent: null,
        goalAchievement: hasEnding ? (weightDelta! < -1 ? "IMPROVED" : weightDelta! > 1 ? "REGRESSED" : "NO_CHANGE") : "UNKNOWN",
        verificationStatus: "SYNTHETIC", dataOrigin: "SYNTHETIC", status: "COMPLETED",
        startedAt: startDate, endedAt: completedAt,
      },
    });
    journeyCount++;
  }
  return { journeyCount, reviewCount };
}

async function main() {
  console.log(`[seed-agentic-demo] seeding ${N_PT} synthetic PTs with seed="${SEED}" ...`);
  let totalJourneys = 0, totalReviews = 0;
  const archetypeCounts: Record<string, number> = {};
  for (let i = 0; i < N_PT; i++) {
    const pt = await upsertPT(i);
    archetypeCounts[pt.archetype] = (archetypeCounts[pt.archetype] ?? 0) + 1;
    const { journeyCount, reviewCount } = await seedJourneysAndReviews(pt, i);
    totalJourneys += journeyCount; totalReviews += reviewCount;
    if ((i + 1) % 10 === 0) console.log(`  ... ${i + 1}/${N_PT} PTs done`);
  }
  console.log("[seed-agentic-demo] done.");
  console.log("  Archetype distribution:", archetypeCounts);
  console.log(`  Total ClientJourney rows: ${totalJourneys}`);
  console.log(`  Total SessionReview rows: ${totalReviews}`);
  console.log("  All rows tagged dataOrigin=SYNTHETIC (PT profiles, contracts, journeys) — never real evidence.");
}

main()
  .catch((err) => { console.error("[seed-agentic-demo] failed:", err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
