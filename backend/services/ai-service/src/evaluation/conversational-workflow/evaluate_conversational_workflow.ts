import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../../repositories/conversation.repository";
import { fitnessAgent, fitnessAgentDeps } from "../../services/fitness-agent.service";
import {
  parseAge,
  parseBudgetVnd,
  parseHeightCm,
  parseMinutes,
  parseTrainingDays,
  parseWeightKg,
} from "../../agent-workflow/slot-values";

type CaseStatus = "PASS" | "FAIL" | "INFO" | "BLOCKED";
type CaseResult = {
  id: string;
  status: CaseStatus;
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  summary: string;
  observed?: unknown;
};

const ROADMAP_REQUEST = "tôi muốn tạo lộ trình và chương trình tập cho tôi";

const original = {
  getUserFitnessContext: fitnessAgentDeps.tools.getUserFitnessContext,
  updateProfileFields: fitnessAgentDeps.tools.updateProfileFields,
  generateRoadmapDraft: fitnessAgentDeps.tools.generateRoadmapDraft,
  findTrainingPrograms: fitnessAgentDeps.tools.findTrainingPrograms,
  findPTCandidates: fitnessAgentDeps.tools.findPTCandidates,
  getScientificEvidence: fitnessAgentDeps.tools.getScientificEvidence,
  acceptRoadmapDraft: fitnessAgentDeps.tools.acceptRoadmapDraft,
  activateRoadmap: fitnessAgentDeps.tools.activateRoadmap,
  applyTrainingPlan: fitnessAgentDeps.tools.applyTrainingPlan,
  bootstrapNutrition: fitnessAgentDeps.tools.bootstrapNutrition,
  createPTContractDraft: fitnessAgentDeps.tools.createPTContractDraft,
  confirmPTContract: fitnessAgentDeps.tools.confirmPTContract,
  extract: fitnessAgentDeps.profileExtractor.extract,
  narrateRecommendations: fitnessAgentDeps.narrateRecommendations,
  narrateProgramRecommendations: fitnessAgentDeps.narrateProgramRecommendations,
};

function restore() {
  fitnessAgentDeps.tools.getUserFitnessContext = original.getUserFitnessContext;
  fitnessAgentDeps.tools.updateProfileFields = original.updateProfileFields;
  fitnessAgentDeps.tools.generateRoadmapDraft = original.generateRoadmapDraft;
  fitnessAgentDeps.tools.findTrainingPrograms = original.findTrainingPrograms;
  fitnessAgentDeps.tools.findPTCandidates = original.findPTCandidates;
  fitnessAgentDeps.tools.getScientificEvidence = original.getScientificEvidence;
  fitnessAgentDeps.tools.acceptRoadmapDraft = original.acceptRoadmapDraft;
  fitnessAgentDeps.tools.activateRoadmap = original.activateRoadmap;
  fitnessAgentDeps.tools.applyTrainingPlan = original.applyTrainingPlan;
  fitnessAgentDeps.tools.bootstrapNutrition = original.bootstrapNutrition;
  fitnessAgentDeps.tools.createPTContractDraft = original.createPTContractDraft;
  fitnessAgentDeps.tools.confirmPTContract = original.confirmPTContract;
  fitnessAgentDeps.profileExtractor.extract = original.extract;
  fitnessAgentDeps.narrateRecommendations = original.narrateRecommendations;
  fitnessAgentDeps.narrateProgramRecommendations = original.narrateProgramRecommendations;
}

async function seedSession(userId: string) {
  return prisma.chatSession.create({ data: { userId, title: "Codex conversational workflow evaluation" } });
}

async function cleanup(userId: string, sessionId?: string) {
  await prisma.fitnessAgentAction.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.fitnessRecommendation.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.agentWorkflowSession.deleteMany({ where: { userId } }).catch(() => {});
  if (sessionId) await prisma.chatSession.deleteMany({ where: { id: sessionId } }).catch(() => {});
}

function installRoadmapStubs(profileOverrides: Record<string, unknown> = {}, opts: { updateFails?: boolean } = {}) {
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
    if (opts.updateFails) throw Object.assign(new Error("profile unavailable"), { status: 503 });
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
    return {
      goalType: input.goalType,
      summary: "Codex evaluation roadmap draft",
      reasoningSummary: "fixture",
      confidence: 0.8,
      warnings: [],
      assumptions: [],
      plannedStartAt: new Date().toISOString(),
      phases: [{
        phaseType: "FAT_LOSS",
        plannedStartAt: new Date().toISOString(),
        plannedEndAt: new Date(Date.now() + 8 * 7 * 86_400_000).toISOString(),
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
        estimatedMinutes: 50,
        experienceLevel: "BEGINNER",
        focusMuscles: ["CHEST"],
        fingerprint: "fp-codex-program",
        dataOrigin: "REAL",
        days: [],
      }],
      warnings: [],
    } as any;
  };
  fitnessAgentDeps.tools.acceptRoadmapDraft = async () => {
    calls.acceptRoadmapDraft++;
    return { roadmap: { id: "roadmap-codex" } } as any;
  };
  fitnessAgentDeps.tools.activateRoadmap = async () => {
    calls.activateRoadmap++;
    return {} as any;
  };
  fitnessAgentDeps.tools.applyTrainingPlan = async () => {
    calls.applyTrainingPlan++;
    return { createdProgramId: "program-codex", nextUrl: "/client/training" } as any;
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
      historyAuditId: "audit-codex",
      truncated: false,
      candidates: [{
        id: "22222222-2222-4222-8222-222222222222",
        name: "PT Codex",
        packages: [{ id: "33333333-3333-4333-8333-333333333333", price: 1_500_000, sessions: 8 }],
        dataOrigin: "REAL",
        history: { count: 0, note: "No history" },
        specialties: ["WEIGHT_LOSS"],
        availableDays: [1, 3, 5],
        averageRating: null,
        reviewCount: 0,
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

async function runCase(id: string, summary: string, fn: () => Promise<CaseResult>): Promise<CaseResult> {
  try {
    return await fn();
  } catch (err) {
    return {
      id,
      status: "BLOCKED",
      severity: "INFO",
      summary,
      observed: { error: (err as Error).message, stack: (err as Error).stack?.split("\n").slice(0, 3) },
    };
  } finally {
    restore();
  }
}

async function useOnceProfileFactCase(field: "targetWeight" | "age" | "heightCm" | "currentWeight" | "gender" | "goal", answer: string) {
  const missingOverrides: Record<string, unknown> = {
    targetWeight: 72,
  };
  if (field === "currentWeight") missingOverrides.currentWeight = null;
  else missingOverrides[field] = null;
  if (field === "targetWeight") missingOverrides.targetWeight = null;
  if (field === "goal") {
    missingOverrides.goal = null;
    missingOverrides.targetWeight = 72;
  }
  const { profile, calls } = installRoadmapStubs(missingOverrides);
  const userId = `codex-use-once-${field}-${randomUUID()}`;
  const session = await seedSession(userId);
  try {
    const identity = { userId } as any;
    await fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id);
    await fitnessAgent.tryTurn(answer, identity, session.id);
    const before = { ...profile };
    const r3 = await fitnessAgent.tryTurn("Chỉ dùng cho lần này", identity, session.id);
    const row = await prisma.agentWorkflowSession.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    const proceeded = r3?.blocks?.[0]?.type === "ACTION_CONFIRMATION";
    const reaskedByLegacyMissing = !proceeded && r3?.blocks?.length === 0 && /cần thêm vài thông tin/i.test(r3?.answer ?? "");
    // Original Codex evaluation (2026-09-15) hardcoded `status: "FAIL"` as a
    // literal here — this function's job at the time was only to CAPTURE
    // `observed` evidence of the then-real bug ("Chỉ dùng cho lần này" was
    // silently accepted for PROFILE_FACT), never to compute a live verdict.
    // Now that orchestrator.ts's handleConfirmationReply rejects use-once
    // for every PROFILE_FACT (see allowsUseOnce()), PASS is the exact
    // negation of the original bug signature: the reply must NOT have
    // proceeded, NOT written anything, and the profile must be byte-for-byte
    // unchanged. Computed from the same `observed` fields Codex's own
    // report already inspected — no new data collected, no threshold
    // invented (docs/conversational-ai-coach-remediation-2.md §1).
    const profileUnchanged = JSON.stringify(before) === JSON.stringify(profile);
    const ok = !proceeded
      && calls.updateProfileFields.length === 0
      && profileUnchanged
      && row?.status === "AWAITING_SLOT_CONFIRMATION";
    const status: CaseStatus = ok ? "PASS" : "FAIL";
    return {
      status,
      observed: {
        field,
        answer,
        profileBeforeUseOnce: before,
        profileAfterUseOnce: profile,
        updateProfileCalls: calls.updateProfileFields,
        responseType: r3?.blocks?.[0]?.type ?? null,
        responseAnswer: r3?.answer,
        workflowStatus: row?.status,
        proceeded,
        reaskedByLegacyMissing,
      },
    };
  } finally {
    await cleanup(userId, session.id);
  }
}

async function main() {
  const cases: CaseResult[] = [];

  cases.push(await runCase("roadmap-flagship-confirm-resume", "Flagship CREATE_ROADMAP confirm path should persist once and auto-resume.", async () => {
    const { profile, calls } = installRoadmapStubs({ targetWeight: null });
    const userId = `codex-flagship-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      const r1 = await fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id);
      const r2 = await fitnessAgent.tryTurn("72 kg", identity, session.id);
      const r3 = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
      const ok = r1?.blocks?.[0]?.type === "WORKFLOW_MISSING_DATA"
        && r2?.blocks?.[0]?.type === "PROFILE_UPDATE_CONFIRMATION"
        && calls.updateProfileFields.length === 1
        && profile.targetWeight === 72
        && r3?.blocks?.[0]?.type === "ACTION_CONFIRMATION"
        && calls.generateRoadmapDraft.length === 1;
      return {
        id: "roadmap-flagship-confirm-resume",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "MEDIUM",
        summary: "Flagship CREATE_ROADMAP confirm path should persist once and auto-resume.",
        observed: { r1: r1?.blocks?.[0]?.type, r2: r2?.blocks?.[0]?.type, r3: r3?.blocks?.[0]?.type, calls, profile },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  for (const [field, answer] of [
    ["goal", "giảm mỡ"],
    ["targetWeight", "72 kg"],
    ["age", "25 tuổi"],
    ["heightCm", "175 cm"],
    ["currentWeight", "80 kg"],
    ["gender", "nam"],
  ] as const) {
    cases.push(await runCase(`use-once-${field}`, `Use-once must not be offered/accepted for PROFILE_FACT field ${field}.`, async () => {
      const observed = await useOnceProfileFactCase(field, answer);
      const ok = observed.status === "PASS";
      return {
        id: `use-once-${field}`,
        status: observed.status,
        severity: ok ? "INFO" : (field === "targetWeight" ? "HIGH" : "MEDIUM"),
        summary: ok
          ? `Use-once is correctly rejected for PROFILE_FACT field ${field} — no write, unchanged profile, workflow stays AWAITING_SLOT_CONFIRMATION.`
          : `Use-once is accepted for PROFILE_FACT ${field}; downstream either proceeds with stale profile or re-asks/fails.`,
        observed: observed.observed,
      };
    }));
  }

  cases.push(await runCase("initial-message-multislot-ignored", "Initiating message should contribute explicit slot values.", async () => {
    installRoadmapStubs({ goal: null, age: null, heightCm: null, currentWeight: null, gender: null, targetWeight: null });
    const userId = `codex-initial-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const r = await fitnessAgent.tryTurn(`${ROADMAP_REQUEST}. Tôi muốn giảm mỡ, 25 tuổi, cao 175cm, 80kg, mục tiêu 72kg.`, { userId } as any, session.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
      const slots = (row?.slotsJson ?? {}) as Record<string, unknown>;
      // Original Codex evaluation hardcoded `status: "FAIL"` — this was a
      // bug-capture, not a live check. startWorkflow() now calls
      // extractFromMessage (roadmap.workflow.ts::extractRoadmapSlotsFromMessage)
      // before resolving missing slots. PASS requires every stated value was
      // actually extracted AND the only remaining question is for `gender`
      // — the one field this message never mentioned (extractRoadmapSlotsFromMessage
      // deliberately never guesses gender from free text — see its own
      // comment on "ở Việt Nam" false positives). If this ever regresses to
      // asking for `goal` again, that is exactly the original bug signature.
      const ok = row?.expectedSlot === "gender"
        && slots.goal === "WEIGHT_LOSS" && slots.age === 25 && slots.heightCm === 175
        && slots.currentWeightKg === 80 && slots.targetWeight === 72;
      return {
        id: "initial-message-multislot-ignored",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "MEDIUM",
        summary: ok
          ? "Initiating message's goal/age/height/current-weight/target-weight were all extracted; only the un-stated gender is still asked."
          : "startWorkflow resolves missing slots from EnterpriseContext only; explicit values in the initiating message are ignored.",
        observed: { responseType: r?.blocks?.[0]?.type, answer: r?.answer, slotsJson: row?.slotsJson, expectedSlot: row?.expectedSlot },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("correction-before-confirm", "A corrected value before confirmation should replace the pending proposal.", async () => {
    const { profile, calls } = installRoadmapStubs({ targetWeight: null });
    const userId = `codex-correction-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id);
      await fitnessAgent.tryTurn("72 kg", identity, session.id);
      const r = await fitnessAgent.tryTurn("Không, 70 kg.", identity, session.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
      const pending = (row?.pendingProfileUpdate ?? []) as Array<{ slotKey: string; newValue: unknown }>;
      const targetChange = pending.find((c) => c.slotKey === "targetWeight");
      // Original Codex evaluation hardcoded `status: "FAIL"` — bug-capture,
      // not a live check. PASS requires: (a) a NEW PROFILE_UPDATE_CONFIRMATION
      // was shown (not a decline/use-once completion), (b) its pending
      // proposal now holds 70, not 72, and (c) nothing was written yet —
      // confirmation is still required for the corrected value, exactly
      // like the original 72 proposal was never auto-written either.
      const ok = r?.blocks?.[0]?.type === "PROFILE_UPDATE_CONFIRMATION"
        && targetChange?.newValue === 70
        && calls.updateProfileFields.length === 0
        && profile.targetWeight === null;
      return {
        id: "correction-before-confirm",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "MEDIUM",
        summary: ok
          ? "Correction reply (Không, 70 kg) replaced the pending 72kg proposal with 70kg, still awaiting confirmation, nothing written."
          : "Correction text containing a new valid value is treated as decline/use-once, not as replacing 72 with 70.",
        observed: { responseType: r?.blocks?.[0]?.type ?? null, answer: r?.answer, pendingProfileUpdate: pending, profile, updateProfileCalls: calls.updateProfileFields },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("unsafe-target-weight-accepted", "Contextual safety should reject physiologically unsafe target weight before profile write.", async () => {
    const { profile, calls } = installRoadmapStubs({ heightCm: 180, currentWeight: 80, targetWeight: null });
    const userId = `codex-unsafe-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id);
      const r2 = await fitnessAgent.tryTurn("30 kg", identity, session.id);
      const r3 = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
      return {
        id: "unsafe-target-weight-accepted",
        status: profile.targetWeight === 30 ? "FAIL" : "PASS",
        severity: profile.targetWeight === 30 ? "HIGH" : "INFO",
        summary: "A 30kg target for 180cm/80kg passes parser and is written after confirmation; no contextual safety gate was found in workflow.",
        observed: { proposalType: r2?.blocks?.[0]?.type, resumeType: r3?.blocks?.[0]?.type ?? null, profile, updateProfileCalls: calls.updateProfileFields },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("stale-profile-confirm-rejected", "Stale profile update should not overwrite newer truth.", async () => {
    const { profile, calls } = installRoadmapStubs({ targetWeight: null });
    const userId = `codex-stale-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id);
      await fitnessAgent.tryTurn("72 kg", identity, session.id);
      profile.targetWeight = 70;
      const r = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
      const ok = profile.targetWeight === 70 && calls.updateProfileFields.length === 0 && /đã thay đổi/i.test(r?.answer ?? "");
      return {
        id: "stale-profile-confirm-rejected",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "MEDIUM",
        summary: "Stale profile update should not overwrite newer truth.",
        observed: { answer: r?.answer, profile, updateProfileCalls: calls.updateProfileFields },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("expired-confirm-no-write", "Expired workflow confirmation should not write profile.", async () => {
    const { profile, calls } = installRoadmapStubs({ targetWeight: null });
    const userId = `codex-expired-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id);
      await fitnessAgent.tryTurn("72 kg", identity, session.id);
      const row = await prisma.agentWorkflowSession.findFirstOrThrow({ where: { userId } });
      await prisma.agentWorkflowSession.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
      const r = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
      const expired = await prisma.agentWorkflowSession.findUnique({ where: { id: row.id } });
      const ok = calls.updateProfileFields.length === 0 && profile.targetWeight === null && expired?.status === "EXPIRED" && r === null;
      return {
        id: "expired-confirm-no-write",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "HIGH",
        summary: "Expired workflow confirmation should not write profile.",
        observed: { response: r, workflowStatus: expired?.status, profile, updateProfileCalls: calls.updateProfileFields },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("failed-profile-write-does-not-resume", "Failed profile write must not complete workflow or resume roadmap generation.", async () => {
    const { calls } = installRoadmapStubs({ targetWeight: null }, { updateFails: true });
    const userId = `codex-writefail-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      await fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id);
      await fitnessAgent.tryTurn("72 kg", identity, session.id);
      const r = await fitnessAgent.tryTurn("Xác nhận cập nhật", identity, session.id);
      const row = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
      const ok = row?.status === "AWAITING_SLOT_CONFIRMATION" && calls.generateRoadmapDraft.length === 0;
      return {
        id: "failed-profile-write-does-not-resume",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "HIGH",
        summary: "Failed profile write must not complete workflow or resume roadmap generation.",
        observed: { answer: r?.answer, workflowStatus: row?.status, calls },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("concurrent-start-can-create-two-active", "Concurrent workflow starts should not create multiple active rows for one user/session.", async () => {
    installRoadmapStubs({ targetWeight: null });
    const userId = `codex-concurrent-start-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      await Promise.all([
        fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id),
        fitnessAgent.tryTurn(ROADMAP_REQUEST, identity, session.id),
      ]);
      const rows = await prisma.agentWorkflowSession.findMany({ where: { userId, sessionId: session.id, status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED"] } } });
      return {
        id: "concurrent-start-can-create-two-active",
        status: rows.length > 1 ? "FAIL" : "PASS",
        severity: rows.length > 1 ? "MEDIUM" : "INFO",
        summary: "Concurrent workflow starts should not create multiple active rows for one user/session.",
        observed: { activeRowCount: rows.length, rows: rows.map(r => ({ id: r.id, status: r.status, expectedSlot: r.expectedSlot, createdAt: r.createdAt })) },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push((() => {
    // Original Codex evaluation hardcoded this entire case as a static
    // object literal (no computation at all) — a snapshot of the schema
    // BEFORE migration 20260916090000_agent_workflow_session_active_unique
    // existed. A hardcoded "no invariant" verdict can never reflect a fix
    // that lands after the evaluator script itself was written, so this is
    // rewritten to actually read the real migrations directory and confirm
    // the exact SQL Codex asked for is really on disk — a real, falsifiable
    // check, not a comment or a trust-the-migration-name assumption. Prisma
    // schema DSL cannot express a WHERE-conditioned unique index (see that
    // migration's own header comment and schema.prisma's mirrored comment
    // on the AgentWorkflowSession model) — this is why it's raw SQL, not
    // Prisma's `@@unique`, and why this check is a text scan of the
    // migration file rather than reading schema.prisma. Complements (does
    // not replace) the dynamic `concurrent-start-can-create-two-active`
    // case above, which proves the invariant actually holds against the
    // live local DB — this proves it is a structural constraint, not a
    // race the dynamic test simply happened not to lose.
    const migrationsDir = join(process.cwd(), "backend/services/ai-service/prisma/migrations");
    let matchedFile: string | null = null;
    try {
      for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const sqlPath = join(migrationsDir, entry.name, "migration.sql");
        let sql: string;
        try {
          sql = readFileSync(sqlPath, "utf8");
        } catch {
          continue;
        }
        if (
          /CREATE\s+UNIQUE\s+INDEX/i.test(sql) &&
          /agent_workflow_sessions/i.test(sql) &&
          /WHERE\s+status\s+NOT\s+IN/i.test(sql)
        ) {
          matchedFile = entry.name;
          break;
        }
      }
    } catch (err) {
      return {
        id: "schema-no-db-active-workflow-invariant",
        status: "BLOCKED" as CaseStatus,
        severity: "INFO" as const,
        summary: "Could not read the migrations directory to verify the active-workflow partial unique index.",
        observed: { error: (err as Error).message, migrationsDir },
      };
    }
    const ok = matchedFile !== null;
    return {
      id: "schema-no-db-active-workflow-invariant",
      status: (ok ? "PASS" : "FAIL") as CaseStatus,
      severity: ok ? ("INFO" as const) : ("MEDIUM" as const),
      summary: ok
        ? `A partial unique index on agent_workflow_sessions(user_id, session_id) WHERE status NOT IN (...) is present in migration ${matchedFile}, enforced at the database level.`
        : "No migration on disk defines a partial unique index enforcing one active AgentWorkflowSession per (user_id, session_id).",
      observed: { model: "AgentWorkflowSession", migrationsDir, matchedFile },
    };
  })());

  cases.push(await runCase("find-pt-dedicated-e2e", "FIND_PT should collect budget as WORKFLOW_ONLY and resume into PT_RECOMMENDATIONS.", async () => {
    const { profile, calls } = installPtStubs({ budgetVnd: null });
    const userId = `codex-findpt-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      const r1 = await fitnessAgent.tryTurn("Tìm PT phù hợp cho tôi", identity, session.id);
      const r2 = await fitnessAgent.tryTurn("1.500.000", identity, session.id);
      const ok = r1?.blocks?.[0]?.type === "WORKFLOW_MISSING_DATA"
        && r2?.blocks?.[0]?.type === "PT_RECOMMENDATIONS"
        && calls.findPTCandidates.length === 1
        && (calls.findPTCandidates[0] as any).budgetVnd === 1_500_000
        && profile.budgetVnd === null;
      return {
        id: "find-pt-dedicated-e2e",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "MEDIUM",
        summary: "FIND_PT should collect budget as WORKFLOW_ONLY and resume into PT_RECOMMENDATIONS.",
        observed: { r1Type: r1?.blocks?.[0]?.type, r2Type: r2?.blocks?.[0]?.type, profile, calls },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("find-pt-existing-budget-no-ask", "Existing profile budget should avoid budget re-ask.", async () => {
    const { calls } = installPtStubs({ budgetVnd: 1_500_000 });
    const userId = `codex-findpt-budget-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const r = await fitnessAgent.tryTurn("Tìm PT phù hợp cho tôi", { userId } as any, session.id);
      const ok = r?.blocks?.[0]?.type === "PT_RECOMMENDATIONS" && calls.findPTCandidates.length === 1;
      return {
        id: "find-pt-existing-budget-no-ask",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "MEDIUM",
        summary: "Existing profile budget should avoid budget re-ask.",
        observed: { responseType: r?.blocks?.[0]?.type, calls },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("find-pt-unlimited-budget-traps-user", "No-budget PT search answer should resume into real results using a typed no-cap sentinel, never a re-ask.", async () => {
    const { calls } = installPtStubs({ budgetVnd: null });
    const userId = `codex-findpt-unlimited-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      await fitnessAgent.tryTurn("Tìm PT phù hợp cho tôi", identity, session.id);
      const r = await fitnessAgent.tryTurn("Ngân sách không quan trọng", identity, session.id);
      // Original Codex evaluation hardcoded `status: "FAIL"` (LOW severity)
      // as a bug-capture pointing at a real product gap, not a live check.
      // Task follow-up §7 requires an explicit typed no-cap representation
      // rather than the intermediate "explain and re-ask" decision that
      // followed Codex's report. PASS requires: real PT results (not
      // another re-ask), and the resulting search call's budgetVnd is
      // real `undefined` — never `0` (would look "missing" upstream), never
      // `Number.MAX_VALUE` (fake money smuggled into a currency field).
      const sentBudget = (calls.findPTCandidates[0] as { budgetVnd?: unknown } | undefined)?.budgetVnd;
      const ok = r?.blocks?.[0]?.type === "PT_RECOMMENDATIONS"
        && calls.findPTCandidates.length === 1
        && sentBudget === undefined;
      return {
        id: "find-pt-unlimited-budget-traps-user",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "LOW",
        summary: ok
          ? "\"Ngân sách không quan trọng\" resolves the FIND_PT budget slot to a typed no-cap sentinel and resumes into real PT_RECOMMENDATIONS with no budget filter, never a fake numeric budget."
          : "Budget parser accepts only positive numbers; natural no-budget answers re-ask and can trap users if underlying search could support no cap.",
        observed: { answer: r?.answer, responseType: r?.blocks?.[0]?.type ?? null, sentBudget, calls },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push(await runCase("pt-search-to-hire-two-step", "PT search results should still use existing draft confirmation plus critical contract confirmation.", async () => {
    const { calls } = installPtStubs({ budgetVnd: 1_500_000 });
    const userId = `codex-hirept-${randomUUID()}`;
    const session = await seedSession(userId);
    try {
      const identity = { userId } as any;
      const r1 = await fitnessAgent.tryTurn("Tìm PT phù hợp cho tôi", identity, session.id);
      const recId = (r1?.blocks?.[0] as any)?.recommendationId;
      const candidateId = ((r1?.blocks?.[0] as any)?.candidates ?? [])[0]?.id;
      const confirmDraft = await fitnessAgent.prepare(identity, recId, candidateId) as any;
      const draftResult = await fitnessAgent.execute(identity, confirmDraft.actionId, true) as any;
      const criticalResult = await fitnessAgent.execute(identity, draftResult.actionId, true) as any;
      const ok = confirmDraft.kind === "CREATE_PT_CONTRACT_DRAFT"
        && draftResult.kind === "CONFIRM_PT_CONTRACT"
        && criticalResult.type === "ACTION_RESULT"
        && calls.createPTContractDraft.length === 1
        && calls.confirmPTContract.length === 1;
      return {
        id: "pt-search-to-hire-two-step",
        status: ok ? "PASS" : "FAIL",
        severity: ok ? "INFO" : "CRITICAL",
        summary: "PT search results should still use existing draft confirmation plus critical contract confirmation.",
        observed: { searchType: r1?.blocks?.[0]?.type, confirmDraft, draftResult, criticalResult, calls },
      };
    } finally {
      await cleanup(userId, session.id);
    }
  }));

  cases.push({
    id: "parser-quality-snapshot",
    status: "INFO",
    severity: "INFO",
    summary: "Deterministic parser behavior snapshot for realistic variants.",
    observed: {
      weight: {
        "72kg": parseWeightKg("72kg"),
        "72 kg": parseWeightKg("72 kg"),
        "72 ký": parseWeightKg("72 ký"),
        "72 kí": parseWeightKg("72 kí"),
        "72 cân": parseWeightKg("72 cân"),
        "72 kg... à không 70 kg": parseWeightKg("72 kg... à không 70 kg"),
      },
      days: {
        "thứ 2 4 6": parseTrainingDays("thứ 2 4 6"),
        "T2 T4 T6": parseTrainingDays("T2 T4 T6"),
        "3 buổi mỗi tuần": parseTrainingDays("3 buổi mỗi tuần"),
      },
      budget: {
        "1.5 triệu": parseBudgetVnd("1.5 triệu"),
        "1500000": parseBudgetVnd("1500000"),
        "1tr5": parseBudgetVnd("1tr5"),
        "không giới hạn": parseBudgetVnd("không giới hạn"),
      },
      duration: {
        "60 phút": parseMinutes("60 phút"),
        "1 tiếng": parseMinutes("1 tiếng"),
        "1 giờ": parseMinutes("1 giờ"),
      },
      age: { "25 tuổi": parseAge("25 tuổi") },
      height: { "1m75": parseHeightCm("1m75"), "175cm": parseHeightCm("175cm") },
    },
  });

  const summary = cases.reduce<Record<CaseStatus, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, { PASS: 0, FAIL: 0, INFO: 0, BLOCKED: 0 });
  const report = {
    evaluator: "codex-conversational-ai-coach-evaluation-1",
    generatedAt: new Date().toISOString(),
    decision: "RETURN_TO_CLAUDE",
    summary,
    cases,
  };
  const out = join(process.cwd(), "backend/services/ai-service/src/evaluation/conversational-workflow/results/conversational-workflow-evaluation-1.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  restore();
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
