import { createHash } from "node:crypto";
import { AgentPreferencesSchema, GoalIntentSchema, GOAL_SPECIALTIES, FITNESS_SCORING, journeySimilarity, summarizeJourneys, type AgentPreferences, type PTCandidate, type DataOrigin } from "@gym-coach/shared";
import { prisma } from "../repositories/profile.repository";
import { Prisma } from "../generated/prisma";
import { countSlotsFromRows } from "./availability.service";
import { availabilityRepository } from "../repositories/availability.repository";
import { sessionRepository } from "../repositories/session.repository";
import { ptReviewRepository } from "../repositories/ptReview.repository";
import { contractService } from "./contract.service";

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const DAY_NUMBERS: Record<string, number> = { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 };
export const agenticFitnessDeps = { requestContract: contractService.requestContract.bind(contractService) };
function originFor(preferences: AgentPreferences): DataOrigin {
  if (preferences.demo && (process.env.NODE_ENV === "production" || process.env.ENABLE_AGENTIC_DEMO !== "true")) throw fail("Demo data is unavailable", 403);
  return preferences.demo ? "SYNTHETIC" : "REAL";
}
async function requireProfile(userId: string) {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) throw fail("Complete your profile first", 422);
  return profile;
}
export const agenticFitnessService = {
  async context(userId: string) {
    const p = await requireProfile(userId);
    return {
      goal: p.goal, goalIntent: p.goalIntent, experience: p.experienceLevel,
      age: p.age, gender: p.gender, heightCm: p.heightCm,
      startingWeight: p.startingWeight, currentWeight: p.currentWeight, targetWeight: p.targetWeight,
      activityLevel: p.activityLevel, days: p.preferredTrainingDays,
      sessionMinutes: p.sessionDurationMinutes, budgetVnd: p.ptBudgetVnd,
      injuries: p.injuries, equipment: p.availableEquipment, gymId: p.gymId,
      safetyScreeningStatus: p.safetyScreeningStatus,
      reviewRequired: p.safetyScreeningStatus === "FOLLOW_UP_SUGGESTED" || p.safetyScreeningFlags.length > 0,
    };
  },
  async confirmGoal(userId: string, raw: unknown) {
    const goal = GoalIntentSchema.parse(raw);
    await requireProfile(userId);
    const confirmed = { ...goal, version: "goal-intent-v1", confirmedAt: new Date().toISOString() };
    await prisma.userProfile.update({ where: { userId }, data: { goal: goal.primaryGoal, goalIntent: confirmed } });
    return confirmed;
  },
  async candidates(userId: string, raw: unknown) {
    const request = AgentPreferencesSchema.parse(raw);
    const profile = await requireProfile(userId);
    const preferences = AgentPreferencesSchema.parse({ ...request, goal: request.goal ?? profile.goal ?? undefined,
      days: request.days ?? (profile.preferredTrainingDays.length ? profile.preferredTrainingDays : undefined),
      sessionMinutes: request.sessionMinutes ?? profile.sessionDurationMinutes,
      budgetVnd: request.budgetVnd ?? profile.ptBudgetVnd ?? undefined });
    const origin = originFor(preferences);
    if (!preferences.goal || !preferences.days || !preferences.budgetVnd) throw fail("Please provide goal, training days and PT budget", 422);
    const packageWhere: Prisma.PTServicePackageWhereInput = { isActive: true, archivedAt: null,
      price: { lte: preferences.budgetVnd }, sessionDurationMinutes: { lte: preferences.sessionMinutes },
      ...(preferences.mode ? { sessionMode: preferences.mode } : {}) };
    const profiles = await prisma.userProfile.findMany({
      where: { userId: { not: userId }, isPT: true, ptSuspended: false, isAcceptingClients: true, dataOrigin: origin,
        ptApplication: { is: { status: "APPROVED" } },
        specialties: { hasSome: GOAL_SPECIALTIES[preferences.goal] ?? [] },
        servicePackages: { some: packageWhere },
        ...(preferences.provinceCode ? { trainingLocations: { some: { provinceCode: preferences.provinceCode, isActive: true } } } : {}),
      }, take: 60, orderBy: { userId: "asc" },
      select: { userId: true, firstName: true, lastName: true, photoUrl: true, specialties: true,
        servicePackages: { where: packageWhere, take: 10, orderBy: { price: "asc" } },
        ptApplication: { select: { yearsOfExperience: true, languages: true, certificates: { select: {
          certificateName: true, issuingOrganization: true, verificationStatus: true, expirationDate: true,
        } } } } },
    });
    const ids = profiles.map(p => p.userId);
    const from = new Date(), to = new Date(from.getTime() + 28 * 86400000);
    const [availability, exceptions, booked, ratings, contracts, sessions, latest] = await Promise.all([
      availabilityRepository.findByPTs(ids), availabilityRepository.findExceptionsByPTsAndRange(ids, from, to),
      sessionRepository.findBookedByPTsAndRange(ids, from, to), ptReviewRepository.aggregateForPts(ids),
      prisma.contract.groupBy({ by: ["ptUserId", "status"], where: { ptUserId: { in: ids }, dataOrigin: origin }, _count: { _all: true } }),
      prisma.session.groupBy({ by: ["ptUserId", "status"], where: { ptUserId: { in: ids }, contract: { dataOrigin: origin } }, _count: { _all: true } }),
      prisma.inBodyEntry.findFirst({ where: { userId }, orderBy: { date: "desc" } }),
    ]);
    const weight = latest?.weight ?? profile.currentWeight;
    const baseline = { goal: preferences.goal, experience: profile.experienceLevel ?? "UNKNOWN", baselineWeight: weight ?? 0,
      baselineBodyFat: latest?.bodyFatPct ?? null, trainingDays: preferences.days.length,
      sessionMinutes: preferences.sessionMinutes!, durationWeeks: preferences.durationWeeks ?? 12, constraints: profile.injuries };
    // Bound the DB cohort before computing similarity. Missing baseline means no evidence.
    const journeys = weight && profile.experienceLevel ? await prisma.clientJourney.findMany({
      where: { ptId: { in: ids }, dataOrigin: origin, goal: preferences.goal, experience: profile.experienceLevel,
        status: { in: ["COMPLETED", "ENDED"] }, endingWeight: { not: null },
        baselineWeight: { gte: weight - 30, lte: weight + 30 },
        verificationStatus: { in: origin === "SYNTHETIC" ? ["SYNTHETIC"] : ["SYSTEM_DERIVED", "MEASUREMENT_VERIFIED"] } },
      orderBy: [{ endedAt: "desc" }, { id: "asc" }], take: 400,
    }) : [];
    const usedJourneyIds: string[] = [];
    const candidates: PTCandidate[] = [];
    for (const p of profiles) {
      const slots = availability.filter(a => a.ptUserId === p.userId && a.isActive && preferences.days!.includes(DAY_NUMBERS[a.dayOfWeek]));
      const availableDays = [...new Set(slots.map(a => DAY_NUMBERS[a.dayOfWeek]))];
      if (!preferences.days.every(d => availableDays.includes(d))) continue;
      const packages = p.servicePackages.filter(pkg => (countSlotsFromRows({ ptUserIds: [p.userId], availabilities: slots,
        exceptions, bookedSessions: booked, fromDate: from, toDate: to, sessionDurationMinutes: pkg.sessionDurationMinutes })[p.userId] ?? 0) >= pkg.sessionCount);
      if (!packages.length) continue;
      const availableSlots = countSlotsFromRows({ ptUserIds: [p.userId], availabilities: slots, exceptions,
        bookedSessions: booked, fromDate: from, toDate: to, sessionDurationMinutes: packages[0].sessionDurationMinutes })[p.userId] ?? 0;
      const cohort = journeys.filter(j => j.ptId === p.userId).map(j => ({ j, score: journeySimilarity(baseline, j) }))
        .filter(x => x.score >= 0.65).sort((a, b) => b.score - a.score || a.j.id.localeCompare(b.j.id)).slice(0, FITNESS_SCORING.maximumCohort).map(x => x.j);
      usedJourneyIds.push(...cohort.map(j => j.id));
      const stats = contracts.filter(c => c.ptUserId === p.userId), sessionStats = sessions.filter(s => s.ptUserId === p.userId);
      const started = stats.reduce((n, r) => n + r._count._all, 0), completed = stats.filter(r => r.status === "COMPLETED").reduce((n, r) => n + r._count._all, 0);
      const sessionCount = sessionStats.reduce((n, r) => n + r._count._all, 0), rating = ratings.get(p.userId);
      candidates.push({ id: p.userId, name: [p.firstName, p.lastName].filter(Boolean).join(" "), photoUrl: p.photoUrl,
        specialties: p.specialties, yearsExperience: p.ptApplication?.yearsOfExperience ?? null, languages: p.ptApplication?.languages ?? [],
        certificates: (p.ptApplication?.certificates ?? []).map(c => ({ name: c.certificateName, issuer: c.issuingOrganization,
          verificationStatus: c.expirationDate && c.expirationDate < new Date() ? "EXPIRED" : c.verificationStatus })),
        packages: packages.map(pkg => ({ id: pkg.id, name: pkg.name, price: Number(pkg.price), sessions: pkg.sessionCount, sessionMinutes: pkg.sessionDurationMinutes, mode: pkg.sessionMode })),
        availableDays, availableSlots, averageRating: rating?.avgRating ?? null, reviewCount: rating?.ratingCount ?? 0,
        clientsStarted: started, clientsCompleted: completed,
        cancellationRate: started ? stats.filter(s => String(s.status).includes("CANCEL")).reduce((n, r) => n + r._count._all, 0) / started : null,
        noShowRate: sessionCount ? sessionStats.filter(s => s.status === "NO_SHOW").reduce((n, r) => n + r._count._all, 0) / sessionCount : null,
        dataOrigin: origin, history: summarizeJourneys(cohort, origin),
      });
    }
    const audit = await prisma.auditLog.create({ data: { actorUserId: userId, action: "AGENT_PT_RETRIEVAL", entityType: "PT_PROFILE", entityId: userId,
      metadata: { candidateIds: candidates.map(c => c.id), historicalJourneyIds: usedJourneyIds, similarityVersion: FITNESS_SCORING.similarityVersion, dataOrigin: origin } } });
    return { candidates, preferences, historyAuditId: audit.id, truncated: profiles.length === 60 || journeys.length === 400 };
  },
  async createDraft(userId: string, ptId: string, packageId: string, preferences: AgentPreferences, actionId: string) {
    const hex = createHash("sha256").update(`pt-draft:${userId}:${actionId}`).digest("hex");
    const draftId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const prior = await prisma.agentContractDraft.findUnique({ where: { id: draftId } });
    if (prior) {
      if (prior.ptId !== ptId || prior.packageId !== packageId) throw fail("Action payload changed", 409);
      return { id: prior.id, snapshot: prior.snapshot, expiresAt: prior.expiresAt, status: prior.status };
    }
    const eligible = await this.candidates(userId, preferences);
    const pt = eligible.candidates.find(p => p.id === ptId), pkg = pt?.packages.find(p => p.id === packageId);
    if (!pt || !pkg) throw fail("PT/package is no longer eligible. Refresh recommendations.", 409);
    if (pt.dataOrigin === "SYNTHETIC") throw fail("Demo recommendations cannot create paid contracts", 409);
    const draft = await prisma.agentContractDraft.upsert({ where: { id: draftId }, update: {}, create: { id: draftId, userId, ptId, packageId,
      snapshot: { ptName: pt.name, ...pkg, preferences }, expiresAt: new Date(Date.now() + 15 * 60000) } });
    return { id: draft.id, snapshot: draft.snapshot, expiresAt: draft.expiresAt, status: draft.status };
  },
  async confirmDraft(userId: string, draftId: string, confirmed: boolean) {
    if (confirmed !== true) throw fail("Explicit confirmation required", 400);
    return prisma.$transaction(async tx => {
      // Same-user confirmations serialize; the contract's unique action key also survives
      // a successful domain write followed by a lost response or draft-update failure.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"agent-contract:" + userId}, 0))`;
      const draft = await tx.agentContractDraft.findFirst({ where: { id: draftId, userId } });
      if (!draft) throw fail("Draft not found", 404);
      const existing = await tx.contract.findUnique({ where: { agentActionId: draft.id } });
      if (existing) return { contractId: existing.id, status: existing.status, nextUrl: "/client/contracts" };
      if (draft.expiresAt < new Date()) throw fail("Draft expired. Refresh and confirm again.", 409);
      const snapshot = draft.snapshot as any;
      const eligible = await this.candidates(userId, snapshot.preferences);
      if (!eligible.candidates.some(p => p.id === draft.ptId && p.packages.some(pkg => pkg.id === draft.packageId))) throw fail("Availability changed. Choose another PT or refresh.", 409);
      const contract = await agenticFitnessDeps.requestContract(userId, { ptUserId: draft.ptId, packageId: draft.packageId }, {
        actionId: draft.id, expectedPrice: snapshot.price, expectedSessions: snapshot.sessions,
        expectedMinutes: snapshot.sessionMinutes, expectedMode: snapshot.mode,
      });
      await tx.agentContractDraft.update({ where: { id: draft.id }, data: { status: "CONFIRMED", contractId: contract.id } });
      await tx.auditLog.create({ data: { actorUserId: userId, action: "AGENT_CONTRACT_CONFIRMED", entityType: "CONTRACT", entityId: contract.id, metadata: { draftId } } });
      return { contractId: contract.id, status: contract.status, nextUrl: "/client/contracts" };
    }, { timeout: 30000 });
  },
};
