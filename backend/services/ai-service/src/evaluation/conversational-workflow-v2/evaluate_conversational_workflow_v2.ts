import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../../services/fitness-agent.service";
import {
  parseBudgetVnd,
  parseMinutes,
  parseTrainingDays,
  parseWeightKg,
} from "../../agent-workflow/slot-values";

type CaseStatus = "PASS" | "FAIL" | "INFO" | "BLOCKED";
type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
type CaseResult = {
  id: string;
  status: CaseStatus;
  severity: Severity;
  summary: string;
  observed?: unknown;
};

const ROADMAP_REQUEST = "tôi muốn tạo lộ trình và chương trình tập cho tôi";
const PT_REQUEST = "Tìm PT phù hợp cho tôi";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  updateProfileFields: fitnessAgentDeps.tools.updateProfileFields,
  generateRoadmapDraft: fitnessAgentDeps.tools.generateRoadmapDraft,
  findTrainingPrograms: fitnessAgentDeps.tools.findTrainingPrograms,
  findPTCandidates: fitnessAgentDeps.tools.findPTCandidates,
  getScientificEvidence: fitnessAgentDeps.tools.getScientificEvidence,
  createPTContractDraft: fitnessAgentDeps.tools.createPTContractDraft,
  confirmPTContract: fitnessAgentDeps.tools.confirmPTContract,
  acceptRoadmapDraft: fitnessAgentDeps.tools.acceptRoadmapDraft,
  activateRoadmap: fitnessAgentDeps.tools.activateRoadmap,
  applyTrainingPlan: fitnessAgentDeps.tools.applyTrainingPlan,
  bootstrapNutrition: fitnessAgentDeps.tools.bootstrapNutrition,
  extract: fitnessAgentDeps.profileExtractor.extract,
  narrateRecommendations: fitnessAgentDeps.narrateRecommendations,
};

function restore() {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.tools.updateProfileFields = original.updateProfileFields;
  fitnessAgentDeps.tools.generateRoadmapDraft = original.generateRoadmapDraft;
  fitnessAgentDeps.tools.findTrainingPrograms = original.findTrainingPrograms;
  fitnessAgentDeps.tools.findPTCandidates = original.findPTCandidates;
  fitnessAgentDeps.tools.getScientificEvidence = original.getScientificEvidence;
  fitnessAgentDeps.tools.createPTContractDraft = original.createPTContractDraft;
  fitnessAgentDeps.tools.confirmPTContract = original.confirmPTContract;
  fitnessAgentDeps.tools.acceptRoadmapDraft = original.acceptRoadmapDraft;
  fitnessAgentDeps.tools.activateRoadmap = original.activateRoadmap;
  fitnessAgentDeps.tools.applyTrainingPlan = original.applyTrainingPlan;
  fitnessAgentDeps.tools.bootstrapNutrition = original.bootstrapNutrition;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.narrateRecommendations = original.narrateRecommendations;
}

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Codex conversational workflow v2 evaluation" } });
}

async function cleanup(userId: string, sessionId?: string) {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.fitnessRecommendation.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } }).catch(() => {});
  if (sessionId) await prisma.chatSession.deleteMany({ where: { id: sessionId } }).catch(() => {});
}

function installRoadmapStubs(profileOverrides: Record<string, unknown> = {}, opts: { updateFails?: boolean; slowUpdateMs?: number } = {}) {
  const profile: Record<string, unknown> = {
    goal: "WEIGHT_LOSS",
    age: 30,
    gender: "MALE",
    heightCm: 170,
    currentWeight: 80,
    targetWeight: null,
    days: [1, 3, 5],
    sessionMinutes: 60,
    budgetVnd: null,
    reviewRequired: false,
    injuries: [],
    equipment: [],
    experience: "BEGINNER",
    goalIntent: null,
    ...profileOverrides,
  };
  const calls = {
    updateProfileFields: [] as Record<string, unknown>[],
    generateRoadmapDraft: [] as unknown[],
    findTrainingPrograms: [] as unknown[],
    acceptRoadmapDraft: 0,
    activateRoadmap: 0,
    applyTrainingPlan: 0,
    bootstrapNutrition: 0,
  };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({
    profile: { ...profile },
    coach: { training_summary: {}, nutrition_summary: {} },
  } as any);
  fitnessAgentDeps.tools.updateProfileFields = async (_identity: any, fields: any) => {
    calls.updateProfileFields.push(fields);
    if (opts.slowUpdateMs) await new Promise((resolve) => setTimeout(resolve, opts.slowUpdateMs));
    if (opts.updateFails) throw new Error("profile unavailable");
    Object.assign(profile, fields);
    return {};
  };
  fitnessAgentDeps.profileExtractor.extract = async () => ({
    profile: {
      goal: profile.goal,
      age: profile.age,
      heightCm: profile.heightCm,
      currentWeightKg: profile.currentWeight,
      gender: profile.gender,
      training: {
        preferredTrainingDays: profile.days,
        trainingDaysPerWeek: Array.isArray(profile.days) ? profile.days.length : undefined,
      },
    },
  } as any);
  fitnessAgentDeps.tools.generateRoadmapDraft = async (_identity: any, input: any) => {
    calls.generateRoadmapDraft.push(input);
    const now = new Date();
    return {
      goalType: input.goalType,
      summary: "Codex v2 roadmap draft",
      reasoningSummary: "fixture",
      confidence: 0.8,
      warnings: [],
      assumptions: [],
      plannedStartAt: now.toISOString(),
      phases: [{
        phaseType: "FAT_LOSS",
        plannedStartAt: now.toISOString(),
        plannedEndAt: new Date(now.getTime() + 8 * 7 * 86_400_000).toISOString(),
        name: "Phase 1",
      }],
    };
  };
  fitnessAgentDeps.tools.findTrainingPrograms = async (_identity: any, preferences: any) => {
    calls.findTrainingPrograms.push(preferences);
    return {
      programs: [{
        id: "11111111-1111-4111-8111-111111111111",
        name: "Codex Program",
        goal: preferences.goal,
        daysPerWeek: preferences.days?.length ?? 3,
        durationWeeks: 8,
        estimatedMinutes: 60,
        experienceLevel: "BEGINNER",
        focusMuscles: [],
        fingerprint: "fp-program",
        dataOrigin: "REAL",
        days: [],
      }],
      warnings: [],
    } as any;
  };
  fitnessAgentDeps.tools.acceptRoadmapDraft = async () => {
    calls.acceptRoadmapDraft++;
    return { roadmap: { id: "roadmap" } } as any;
  };
  fitnessAgentDeps.tools.activateRoadmap = async () => {
    calls.activateRoadmap++;
    return {} as any;
  };
  fitnessAgentDeps.tools.applyTrainingPlan = async () => {
    calls.applyTrainingPlan++;
    return { createdProgramId: "program", nextUrl: "/client/training" } as any;
  };
  fitnessAgentDeps.tools.bootstrapNutrition = async () => {
    calls.bootstrapNutrition++;
    return {} as any;
  };
  return { profile, calls };
}

function installPtStubs(profileOverrides: Record<string, unknown> = {}) {
  const profile: Record<string, unknown> = {
    goal: "WEIGHT_LOSS",
    age: 30,
    gender: "MALE",
    heightCm: 170,
    currentWeight: 80,
    targetWeight: 72,
    days: [1, 3, 5],
    sessionMinutes: 60,
    budgetVnd: null,
    reviewRequired: false,
    injuries: [],
    equipment: [],
    experience: "BEGINNER",
    goalIntent: null,
    ...profileOverrides,
  };
  const calls = {
    findPTCandidates: [] as unknown[],
    createPTContractDraft: [] as unknown[],
    confirmPTContract: [] as unknown[],
  };
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({
    profile: { ...profile },
    coach: { training_summary: {}, nutrition_summary: {} },
  } as any);
  fitnessAgentDeps.tools.findPTCandidates = async (_identity: any, preferences: any) => {
    calls.findPTCandidates.push(preferences);
    return {
      historyAuditId: "audit",
      truncated: false,
      candidates: [{
        id: "22222222-2222-4222-8222-222222222222",
        name: "PT Codex",
        packages: [{ id: "33333333-3333-4333-8333-333333333333", price: 1_500_000, sessions: 8 }],
        dataOrigin: "REAL",
        history: { count: 0, note: "none" },
        specialties: ["WEIGHT_LOSS"],
        availableDays: [1, 3, 5],
        certifications: [],
      }],
    } as any;
  };
  fitnessAgentDeps.tools.getScientificEvidence = () => [] as any;
  fitnessAgentDeps.narrateRecommendations = async (candidates: any[]) => ({
    usedFallback: true,
    narrations: candidates.map((c: any) => ({
      candidateId: c.candidate.id,
      summary: "fixture",
      strengths: [],
      tradeoffs: [],
      uncertainty: [],
      evidenceRefs: [],
    })),
  } as any);
  fitnessAgentDeps.tools.createPTContractDraft = async (_identity: any, payload: any) => {
    calls.createPTContractDraft.push(payload);
    return {
      id: "44444444-4444-4444-8444-444444444444",
      snapshot: payload,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      status: "DRAFT",
    } as any;
  };
  fitnessAgentDeps.tools.confirmPTContract = async (_identity: any, draftId: string) => {
    calls.confirmPTContract.push(draftId);
    return { contractId: "55555555-5555-4555-8555-555555555555", status: "ACTIVE", nextUrl: "/client/contracts" } as any;
  };
  return { profile, calls };
}

async function runCase(id: string, severity: Severity, summary: string, fn: () => Promise<CaseResult>): Promise<CaseResult> {
  try {
    return await fn();
  } catch (err) {
    return {
      id,
      status: "BLOCKED",
      severity,
      summary,
      observed: { error: (err as Error).message, stack: (err as Error).stack?.split("\n").slice(0, 4) },
    };
  } finally {
    restore();
  }
}

async function useOnceCase(field: string, answer: string, overrides: Record<string, unknown>) {
  const { profile, calls } = installRoadmapStubs(overrides);
  const userId = `v2-use-once-${field}-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const identity = { userId } as any;
    await fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id);
    const proposal = await fitnessAgent.tryTurn(answer, identity, session.id);
    const rejected = await fitnessAgent.tryTurn("Chỉ dùng cho lần này", identity, session.id);
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    const ok = proposal?.blocks?.[0]?.type === "PROFILE_UPDATE_CONFIRMATION"
      && (proposal.blocks[0] as any).allowUseOnce === false
      && rejected?.blocks?.length === 0
      && calls.updateProfileFields.length === 0
      && calls.generateRoadmapDraft.length === 0
      && row?.status === "AWAITING_SLOT_CONFIRMATION";
    return { ok, observed: { proposalBlock: proposal?.blocks?.[0], rejectedAnswer: rejected?.answer, workflowStatus: row?.status, calls, profile } };
  } finally {
    await cleanup(userId, session.id);
  }
}

async function main() {
  const cases: CaseResult[] = [];

  for (const spec of [
    ["goal", "giảm mỡ", { goal: null, targetWeight: 72 }],
    ["targetWeight", "72 kg", { targetWeight: null }],
    ["age", "25 tuổi", { age: null, targetWeight: 72 }],
    ["height", "175 cm", { heightCm: null, targetWeight: 72 }],
    ["currentWeight", "80 kg", { currentWeight: null, targetWeight: 72 }],
    ["gender", "nam", { gender: null, targetWeight: 72 }],
  ] as const) {
    cases.push(await runCase(`profile-fact-use-once-${spec[0]}`, spec[0] === "targetWeight" ? "HIGH" : "MEDIUM", `PROFILE_FACT ${spec[0]} must reject use-once server-side.`, async () => {
      const result = await useOnceCase(spec[0], spec[1], spec[2]);
      return { id: `profile-fact-use-once-${spec[0]}`, status: result.ok ? "PASS" : "FAIL", severity: result.ok ? "INFO" : (spec[0] === "targetWeight" ? "HIGH" : "MEDIUM"), summary: `PROFILE_FACT ${spec[0]} use-once check.`, observed: result.observed };
    }));
  }

  cases.push(await runCase("unsafe-target-known-context", "HIGH", "30kg target at 180cm/80kg must not become a confirmation or write.", async () => {
    const { profile, calls } = installRoadmapStubs({ heightCm: 180, currentWeight: 80, targetWeight: null });
    const userId = `v2-unsafe-known-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId } as any, session.id);
      const r = await fitnessAgent.tryTurn("30 kg", { userId } as any, session.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
      const ok = r?.blocks?.[0]?.type !== "PROFILE_UPDATE_CONFIRMATION" && calls.updateProfileFields.length === 0 && profile.targetWeight === null && row?.status === "COLLECTING_SLOTS";
      return { id: "unsafe-target-known-context", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "HIGH", summary: "Contextually unsafe target with known context is rejected before confirmation.", observed: { response: r, row, calls, profile } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("unsafe-target-deferred-context-before-confirm", "HIGH", "Unsafe extracted target must be revalidated before showing confirmation once missing context becomes known.", async () => {
    const { profile, calls } = installRoadmapStubs({ goal: null, age: null, heightCm: null, currentWeight: null, gender: "MALE", targetWeight: null });
    const userId = `v2-unsafe-deferred-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const r1 = await fitnessAgent.tryTurn(`${ROADMAP_REQUEST}. Tôi muốn giảm mỡ, 30 tuổi, cao 180cm, mục tiêu 30kg.`, { userId } as any, session.id);
      const r2 = await fitnessAgent.tryTurn("hiện 80kg", { userId } as any, session.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
      const ok = r2?.blocks?.[0]?.type !== "PROFILE_UPDATE_CONFIRMATION" && calls.updateProfileFields.length === 0 && profile.targetWeight === null;
      return { id: "unsafe-target-deferred-context-before-confirm", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "HIGH", summary: "Unsafe target extracted before full context should not become a confirmable profile update later.", observed: { first: r1, second: r2, row, calls, profile } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("valid-targets", "HIGH", "Realistic weight-loss and muscle-gain targets must still reach confirmation.", async () => {
    const loss = installRoadmapStubs({ heightCm: 180, currentWeight: 80, targetWeight: null, goal: "WEIGHT_LOSS" });
    const userLoss = `v2-valid-loss-${randomUUID()}`;
    const sessionLoss = await seedSession(userLoss);
    let lossType: string | undefined;
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId: userLoss } as any, sessionLoss.id);
      const r = await fitnessAgent.tryTurn("72 kg", { userId: userLoss } as any, sessionLoss.id);
      lossType = r?.blocks?.[0]?.type;
    } finally {
      await cleanup(userLoss, sessionLoss.id);
    }
    restore();
    const gain = installRoadmapStubs({ heightCm: 175, currentWeight: 65, targetWeight: null, goal: "MUSCLE_GAIN" });
    const userGain = `v2-valid-gain-${randomUUID()}`;
    const sessionGain = await seedSession(userGain);
    let gainType: string | undefined;
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId: userGain } as any, sessionGain.id);
      const r = await fitnessAgent.tryTurn("72 kg", { userId: userGain } as any, sessionGain.id);
      gainType = r?.blocks?.[0]?.type;
    } finally {
      await cleanup(userGain, sessionGain.id);
    }
    const ok = lossType === "PROFILE_UPDATE_CONFIRMATION" && gainType === "PROFILE_UPDATE_CONFIRMATION" && loss.calls.updateProfileFields.length === 0 && gain.calls.updateProfileFields.length === 0;
    return { id: "valid-targets", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "HIGH", summary: "Valid targets are not over-rejected.", observed: { lossType, gainType } };
  }));

  cases.push(await runCase("safety-stale-context-prewrite", "HIGH", "Target safety must re-run immediately before write using fresh context.", async () => {
    const { profile, calls } = installRoadmapStubs({ heightCm: 180, currentWeight: 80, targetWeight: null });
    const userId = `v2-safety-stale-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId } as any, session.id);
      const proposed = await fitnessAgent.tryTurn("65 kg", { userId } as any, session.id);
      profile.heightCm = 200;
      const confirmed = await fitnessAgent.tryTurn("Xác nhận cập nhật", { userId } as any, session.id);
      const ok = proposed?.blocks?.[0]?.type === "PROFILE_UPDATE_CONFIRMATION" && confirmed?.blocks?.[0]?.type !== "ACTION_CONFIRMATION" && calls.updateProfileFields.length === 0 && profile.targetWeight === null;
      return { id: "safety-stale-context-prewrite", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "HIGH", summary: "Fresh-context safety check blocks values that became unsafe before confirm.", observed: { proposed, confirmed, calls, profile } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("initial-multislot-batch-confirmation", "MEDIUM", "Rich initial message should extract values and produce one batch confirmation after gender.", async () => {
    const { calls } = installRoadmapStubs({ goal: null, age: null, heightCm: null, currentWeight: null, gender: null, targetWeight: null });
    const userId = `v2-initial-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const r1 = await fitnessAgent.tryTurn(`${ROADMAP_REQUEST}. Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, 80kg, mục tiêu 72kg.`, { userId } as any, session.id);
      const row1 = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
      const slots = (row1?.slotsJson ?? {}) as Record<string, unknown>;
      const r2 = await fitnessAgent.tryTurn("nam", { userId } as any, session.id);
      const changes = (r2?.blocks?.[0] as any)?.changes ?? [];
      const ok = slots.goal === "WEIGHT_LOSS" && slots.age === 25 && slots.heightCm === 175 && slots.currentWeightKg === 80 && slots.targetWeight === 72 && row1?.expectedSlot === "gender" && r2?.blocks?.[0]?.type === "PROFILE_UPDATE_CONFIRMATION" && changes.length === 6 && calls.updateProfileFields.length === 0;
      return { id: "initial-multislot-batch-confirmation", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Initial multi-slot extraction and batch confirmation.", observed: { r1, slots, expectedSlot: row1?.expectedSlot, r2, changes, calls } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("authoritative-profile-conflict", "MEDIUM", "Message target conflicts with profile target and must require confirmation.", async () => {
    installRoadmapStubs({ targetWeight: 75 });
    const userId = `v2-conflict-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const r = await fitnessAgent.tryTurn(`${ROADMAP_REQUEST}. Tôi muốn xuống 72kg.`, { userId } as any, session.id);
      const change = ((r?.blocks?.[0] as any)?.changes ?? []).find((c: any) => c.field === "targetWeight");
      const ok = r?.blocks?.[0]?.type === "PROFILE_UPDATE_CONFIRMATION" && change?.oldValue === 75 && change?.newValue === 72;
      return { id: "authoritative-profile-conflict", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Profile conflict is proposed, not silently overwritten.", observed: { response: r, change } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("ambiguous-multislot", "MEDIUM", "Unlabeled '80, 72' must not assign current/target arbitrarily.", async () => {
    installRoadmapStubs({ goal: null, age: null, heightCm: null, currentWeight: null, gender: null, targetWeight: null });
    const userId = `v2-ambiguous-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      await fitnessAgent.tryTurn(`${ROADMAP_REQUEST}. 80, 72.`, { userId } as any, session.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
      const slots = (row?.slotsJson ?? {}) as Record<string, unknown>;
      const ok = slots.currentWeightKg === undefined && slots.targetWeight === undefined;
      return { id: "ambiguous-multislot", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Ambiguous numbers are not guessed.", observed: { slots, expectedSlot: row?.expectedSlot } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("follow-up-multislot", "MEDIUM", "A reply to one missing slot can fill other unambiguous missing slots.", async () => {
    installRoadmapStubs({ age: null, heightCm: null, currentWeight: null, targetWeight: null });
    const userId = `v2-followup-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId } as any, session.id);
      const r2 = await fitnessAgent.tryTurn("25 tuổi, cao 175cm, hiện 80kg, mục tiêu 72kg", { userId } as any, session.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
      const slots = (row?.slotsJson ?? {}) as Record<string, unknown>;
      const ok = r2?.blocks?.[0]?.type === "PROFILE_UPDATE_CONFIRMATION" && slots.age === 25 && slots.heightCm === 175 && slots.currentWeightKg === 80 && slots.targetWeight === 72;
      return { id: "follow-up-multislot", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Follow-up multi-slot extraction.", observed: { r2, slots } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  for (const text of ["Không, 70kg", "Ý tôi là 70kg", "Đổi thành 70kg", "72kg... à không 70kg"] as const) {
    cases.push(await runCase(`correction-${text.replaceAll(" ", "-").replace(/[^\w-]/g, "")}`, "MEDIUM", `Correction variant '${text}' should replace pending target.`, async () => {
      const { profile, calls } = installRoadmapStubs({ targetWeight: null });
      const userId = `v2-correction-${randomUUID()}`;
      const session = await seedSession(userId);
      try {
        await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId } as any, session.id);
        await fitnessAgent.tryTurn("72 kg", { userId } as any, session.id);
        const r = await fitnessAgent.tryTurn(text, { userId } as any, session.id);
        const change = ((r?.blocks?.[0] as any)?.changes ?? []).find((c: any) => c.field === "targetWeight");
        const ok = r?.blocks?.[0]?.type === "PROFILE_UPDATE_CONFIRMATION" && change?.newValue === 70 && calls.updateProfileFields.length === 0 && profile.targetWeight === null;
        return { id: `correction-${text}`, status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Correction before confirmation.", observed: { response: r, change, calls, profile } };
      } finally {
        await cleanup(userId, session.id);
      }
    }));
  }

  cases.push(await runCase("unsafe-correction", "HIGH", "Unsafe correction must not replace or write.", async () => {
    const { profile, calls } = installRoadmapStubs({ heightCm: 180, currentWeight: 80, targetWeight: null });
    const userId = `v2-unsafe-correction-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId } as any, session.id);
      await fitnessAgent.tryTurn("72 kg", { userId } as any, session.id);
      const r = await fitnessAgent.tryTurn("Không, 30kg", { userId } as any, session.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
      const pending = (row?.pendingProfileUpdate as any[]) ?? [];
      const ok = r?.blocks?.[0]?.type !== "PROFILE_UPDATE_CONFIRMATION" && pending[0]?.newValue === 72 && calls.updateProfileFields.length === 0 && profile.targetWeight === null;
      return { id: "unsafe-correction", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "HIGH", summary: "Unsafe correction does not replace a safe pending value or write.", observed: { response: r, pending, calls, profile } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("concurrent-start-20", "MEDIUM", "20 concurrent starts produce exactly one active workflow.", async () => {
    installRoadmapStubs({ targetWeight: null });
    const userId = `v2-concurrent-start-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const results = await Promise.all(Array.from({ length: 20 }, () => fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId } as any, session.id)));
      const activeRows = await prisma.agentWorkflowSession.findMany({ where: { userId, sessionId: session.id, status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED"] } } });
      const ok = results.every(Boolean) && activeRows.length === 1;
      return { id: "concurrent-start-20", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Concurrent start invariant.", observed: { responseCount: results.length, activeRows } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("concurrent-different-workflows", "MEDIUM", "Concurrent CREATE_ROADMAP and FIND_PT must not leave two active rows.", async () => {
    installRoadmapStubs({ targetWeight: null });
    const userId = `v2-concurrent-types-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const [a, b] = await Promise.all([
        fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId } as any, session.id),
        fitnessAgent.tryTurn(PT_REQUEST, { userId } as any, session.id),
      ]);
      const activeRows = await prisma.agentWorkflowSession.findMany({ where: { userId, sessionId: session.id, status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED"] } } });
      const ok = activeRows.length <= 1;
      return { id: "concurrent-different-workflows", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Different workflow race invariant.", observed: { a, b, activeRows } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("concurrent-slot-replies", "MEDIUM", "Concurrent 72kg/70kg replies must leave one coherent pending proposal.", async () => {
    installRoadmapStubs({ targetWeight: null });
    const userId = `v2-concurrent-slots-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId } as any, session.id);
      const [a, b] = await Promise.all([
        fitnessAgent.tryTurn("72 kg", { userId } as any, session.id),
        fitnessAgent.tryTurn("70 kg", { userId } as any, session.id),
      ]);
      const rows = await prisma.agentWorkflowSession.findMany({ where: { userId, sessionId: session.id, status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED"] } } });
      const pending = (rows[0]?.pendingProfileUpdate as any[]) ?? [];
      const ok = rows.length === 1 && rows[0]?.status === "AWAITING_SLOT_CONFIRMATION" && pending.length === 1 && [70, 72].includes(pending[0]?.newValue);
      return { id: "concurrent-slot-replies", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Concurrent slot reply coherence.", observed: { aType: a?.blocks?.[0]?.type, bType: b?.blocks?.[0]?.type, rows, pending } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("concurrent-confirm", "HIGH", "Concurrent confirmations must produce at most one profile write and one roadmap draft.", async () => {
    const { profile, calls } = installRoadmapStubs({ targetWeight: null }, { slowUpdateMs: 100 });
    const userId = `v2-concurrent-confirm-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId } as any, session.id);
      await fitnessAgent.tryTurn("72 kg", { userId } as any, session.id);
      const [a, b] = await Promise.all([
        fitnessAgent.tryTurn("Xác nhận cập nhật", { userId } as any, session.id),
        fitnessAgent.tryTurn("Xác nhận cập nhật", { userId } as any, session.id),
      ]);
      const ok = calls.updateProfileFields.length === 1 && calls.generateRoadmapDraft.length === 1 && profile.targetWeight === 72;
      return { id: "concurrent-confirm", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "HIGH", summary: "Concurrent confirm is write-claimed.", observed: { aType: a?.blocks?.[0]?.type, bType: b?.blocks?.[0]?.type, calls, profile } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("budget-parser", "MEDIUM", "Vietnamese budget forms must parse to intended VND.", async () => {
    const inputs = ["1500000", "1.500.000", "1,500,000", "1.5 triệu", "1,5 triệu", "1tr5", "1tr500", "1 triệu 500"];
    const observed = Object.fromEntries(inputs.map((input) => [input, parseBudgetVnd(input)]));
    const ok = inputs.every((input) => (observed[input] as any).ok && (observed[input] as any).value === 1_500_000);
    return { id: "budget-parser", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Budget parser matrix.", observed };
  }));

  for (const text of ["1.500.000", "Không giới hạn", "Ngân sách không quan trọng"] as const) {
    cases.push(await runCase(`find-pt-budget-${text.replaceAll(" ", "-").replace(/[^\w-]/g, "")}`, "MEDIUM", `FIND_PT budget reply '${text}' should resume safely.`, async () => {
      const { profile, calls } = installPtStubs({ budgetVnd: null });
      const userId = `v2-pt-budget-${randomUUID()}`;
      const session = await seedSession(userId);
      try {
        const r1 = await fitnessAgent.tryTurn(PT_REQUEST, { userId } as any, session.id);
        const r2 = await fitnessAgent.tryTurn(text, { userId } as any, session.id);
        const prefs = calls.findPTCandidates[0] as any;
        const expectedBudget = text === "1.500.000" ? 1_500_000 : undefined;
        const ok = r1?.blocks?.[0]?.type === "WORKFLOW_MISSING_DATA"
          && r2?.blocks?.[0]?.type === "PT_RECOMMENDATIONS"
          && prefs?.budgetVnd === expectedBudget
          && profile.budgetVnd === null;
        return { id: `find-pt-budget-${text}`, status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "FIND_PT budget E2E.", observed: { r1, r2Type: r2?.blocks?.[0]?.type, prefs, profile } };
      } finally {
        await cleanup(userId, session.id);
      }
    }));
  }

  cases.push(await runCase("pt-search-to-hire-two-step", "CRITICAL", "PT search to hire must preserve draft and critical confirmation.", async () => {
    const { calls } = installPtStubs({ budgetVnd: 1_500_000 });
    const userId = `v2-pt-hire-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      await fitnessAgent.tryTurn(PT_REQUEST, identity, session.id);
      const selected = await fitnessAgent.tryTurn("Chọn PT 1", identity, session.id);
      const draft = await fitnessAgent.execute(identity, (selected!.blocks[0] as any).actionId, true) as any;
      const final = await fitnessAgent.execute(identity, draft.actionId, true) as any;
      const ok = selected?.blocks?.[0]?.type === "ACTION_CONFIRMATION" && draft.type === "ACTION_CONFIRMATION" && final.type === "ACTION_RESULT" && calls.createPTContractDraft.length === 1 && calls.confirmPTContract.length === 1;
      return { id: "pt-search-to-hire-two-step", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "CRITICAL", summary: "PT two-step contract flow.", observed: { selected: selected?.blocks?.[0], draft, final, calls } };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("parser-days-duration-weight", "LOW", "Parser snapshots for days, duration, and correction weight.", async () => {
    const observed = {
      days: {
        "T2 T4 T6": parseTrainingDays("T2 T4 T6"),
        "thứ 2 4 6": parseTrainingDays("thứ 2 4 6"),
        "thứ 2, thứ 4, thứ 6": parseTrainingDays("thứ 2, thứ 4, thứ 6"),
      },
      duration: {
        "60 phút": parseMinutes("60 phút"),
        "1 giờ": parseMinutes("1 giờ"),
        "1 tiếng": parseMinutes("1 tiếng"),
        "1 giờ 30 phút": parseMinutes("1 giờ 30 phút"),
        "90 phút": parseMinutes("90 phút"),
      },
      weight: {
        "72kg... à không 70kg": parseWeightKg("72kg... à không 70kg"),
      },
    };
    const ok = JSON.stringify((observed.days["T2 T4 T6"] as any).value) === JSON.stringify([1, 3, 5])
      && JSON.stringify((observed.days["thứ 2 4 6"] as any).value) === JSON.stringify([1, 3, 5])
      && JSON.stringify((observed.days["thứ 2, thứ 4, thứ 6"] as any).value) === JSON.stringify([1, 3, 5])
      && (observed.duration["1 giờ"] as any).value === 60
      && (observed.duration["1 tiếng"] as any).value === 60
      && (observed.duration["1 giờ 30 phút"] as any).value === 90
      && (observed.weight["72kg... à không 70kg"] as any).value === 70;
    return { id: "parser-days-duration-weight", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "LOW", summary: "Parser low-risk variants.", observed };
  }));

  cases.push(await runCase("failed-stale-expired-cancel-switch", "MEDIUM", "Core lifecycle cases should remain safe.", async () => {
    const failed = installRoadmapStubs({ targetWeight: null }, { updateFails: true });
    const userFailed = `v2-failed-${randomUUID()}`;
    const sessionFailed = await seedSession(userFailed);
    let failedOk = false;
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId: userFailed } as any, sessionFailed.id);
      await fitnessAgent.tryTurn("72 kg", { userId: userFailed } as any, sessionFailed.id);
      await fitnessAgent.tryTurn("Xác nhận cập nhật", { userId: userFailed } as any, sessionFailed.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId: userFailed } });
      failedOk = row?.status === "AWAITING_SLOT_CONFIRMATION" && failed.calls.generateRoadmapDraft.length === 0;
    } finally {
      await cleanup(userFailed, sessionFailed.id);
    }
    restore();

    const stale = installRoadmapStubs({ targetWeight: null });
    const userStale = `v2-stale-${randomUUID()}`;
    const sessionStale = await seedSession(userStale);
    let staleOk = false;
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId: userStale } as any, sessionStale.id);
      await fitnessAgent.tryTurn("72 kg", { userId: userStale } as any, sessionStale.id);
      stale.profile.targetWeight = 70;
      await fitnessAgent.tryTurn("Xác nhận cập nhật", { userId: userStale } as any, sessionStale.id);
      staleOk = stale.profile.targetWeight === 70 && stale.calls.updateProfileFields.length === 0 && stale.calls.generateRoadmapDraft.length === 0;
    } finally {
      await cleanup(userStale, sessionStale.id);
    }
    restore();

    const expiry = installRoadmapStubs({ targetWeight: null });
    const userExpiry = `v2-expiry-${randomUUID()}`;
    const sessionExpiry = await seedSession(userExpiry);
    let expiryOk = false;
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId: userExpiry } as any, sessionExpiry.id);
      await fitnessAgent.tryTurn("72 kg", { userId: userExpiry } as any, sessionExpiry.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId: userExpiry } });
      await prisma.agentWorkflowSession.update({ where: { id: row!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const r = await fitnessAgent.tryTurn("Xác nhận cập nhật", { userId: userExpiry } as any, sessionExpiry.id);
      expiryOk = r === null && expiry.calls.updateProfileFields.length === 0;
    } finally {
      await cleanup(userExpiry, sessionExpiry.id);
    }
    restore();

    const cancel = installRoadmapStubs({ targetWeight: null });
    const userCancel = `v2-cancel-${randomUUID()}`;
    const sessionCancel = await seedSession(userCancel);
    let cancelOk = false;
    try {
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, { userId: userCancel } as any, sessionCancel.id);
      await fitnessAgent.tryTurn("Thôi hủy", { userId: userCancel } as any, sessionCancel.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId: userCancel } });
      cancelOk = row?.status === "CANCELLED" && cancel.calls.updateProfileFields.length === 0;
    } finally {
      await cleanup(userCancel, sessionCancel.id);
    }

    const ok = failedOk && staleOk && expiryOk && cancelOk;
    return { id: "failed-stale-expired-cancel-switch", status: ok ? "PASS" : "FAIL", severity: ok ? "INFO" : "MEDIUM", summary: "Failed write, stale confirm, expiry, cancel.", observed: { failedOk, staleOk, expiryOk, cancelOk } };
  }));

  const highOrWorse = cases.filter((c) => c.status === "FAIL" && (c.severity === "CRITICAL" || c.severity === "HIGH")).length;
  const medium = cases.filter((c) => c.status === "FAIL" && c.severity === "MEDIUM").length;
  const decision = highOrWorse === 0 && medium === 0
    ? "GO_WITH_DOCUMENTED_LIMITATIONS"
    : "RETURN_TO_CLAUDE";
  const summary = cases.reduce<Record<CaseStatus, number>>((acc, c) => {
    acc[c.status]++;
    return acc;
  }, { PASS: 0, FAIL: 0, INFO: 0, BLOCKED: 0 });

  const out = {
    evaluator: "codex-conversational-ai-coach-evaluation-2",
    generatedAt: new Date().toISOString(),
    decision,
    summary,
    cases,
  };
  const outputPath = join(__dirname, "results", "conversational-workflow-evaluation-2.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().finally(async () => {
  restore();
  await prisma.$disconnect();
});
