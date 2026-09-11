import { randomUUID } from "node:crypto";
import { AgentPreferencesSchema, FITNESS_SCORING, scorePT, agentActionRisk, type AgentPreferences, type AgentActionKind } from "@gym-coach/shared";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgentTools, type AgentIdentity } from "./fitness-agent-tools";
import { parseFitnessAgentIntent } from "./fitness-agent-intent";
import { isLikelyFoodSubstitutionMessage, extractFoodSubstitutionIntent } from "./food-substitution-extractor";
import { profileExtractor } from "../llm/profile_extractor";
import { intentRouter } from "../llm/intent_router";
import { inputParser } from "../llm/input_parser";
import { recommendationEngine } from "../llm/recommendation_engine";

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
export type AgentBlock = { type: "PT_RECOMMENDATIONS" | "PROGRAM_RECOMMENDATIONS" | "ACTION_CONFIRMATION" | "GOAL_ANALYSIS" | "ACTION_RESULT" | "SUBSTITUTE_RESULT" | "CYCLE_EVALUATION_RESULT" | "IMAGE_CHAT"; [key: string]: unknown };
const TRAINING_DECISION_LABEL_VI: Record<string, string> = {
  KEEP: "Giữ nguyên", PROGRESS: "Tăng tải", ADJUST: "Điều chỉnh nhỏ", DELOAD: "Giảm tải (deload)",
  REBUILD: "Xây lại chương trình", INSUFFICIENT_DATA: "Chưa đủ dữ liệu",
};
const NUTRITION_DECISION_LABEL_VI: Record<string, string> = {
  KEEP_PLAN: "Giữ nguyên dinh dưỡng", PROPOSE_ADJUSTMENT: "Đề xuất điều chỉnh", PROPOSE_DIET_BREAK: "Đề xuất nghỉ diet break",
  REQUEST_MORE_DATA: "Cần thêm dữ liệu", EARLY_REVIEW: "Cần xem xét sớm", ESCALATE: "Cần chuyên gia xem xét",
};
// Mutable dependency object — ESM named imports can't be reassigned, so
// tests stub fitnessAgentDeps.tools.* / .extractFoodSubstitutionIntent
// directly rather than mocking the module.
export const fitnessAgentDeps = { tools: fitnessAgentTools, extractFoodSubstitutionIntent, profileExtractor };

async function ownSession(identity: AgentIdentity, sessionId: string) {
  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId: identity.userId, archivedAt: null } });
  if (!session) throw fail("Conversation not found", 404);
}
export const fitnessAgent = {
  async tryTurn(question: string, identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    const intent = parseFitnessAgentIntent(question);
    if (!intent.kind) {
      // Not PT/PROGRAM/SELECT — check for a food-substitution request
      // before falling through to the normal RAG/LLM chat pipeline (see
      // docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_PLAN.md). Cheap
      // keyword gate first so this doesn't add an LLM call to every
      // unrelated chat message.
      if (isLikelyFoodSubstitutionMessage(question)) {
        const substitutionResult = await this.trySubstitution(question, identity, sessionId);
        if (substitutionResult) return substitutionResult;
      }
      return null;
    }
    await ownSession(identity, sessionId);
    if (intent.kind === "EVALUATE") return this.tryEvaluateCycle(identity);
    if (intent.kind === "CREATE_PLAN_BUNDLE") return this.proposePlanBundle(identity, sessionId);
    if (intent.kind === "SAVE_GENERATED_PLAN") return this.proposeSaveGeneratedPlan(identity, sessionId);
    if (intent.kind === "ROADMAP_STATUS") return this.answerRoadmapStatus(identity);
    if (intent.kind === "ROADMAP_ADVANCE") return this.proposeRoadmapAdvance(identity, sessionId);
    if (intent.kind === "ROADMAP_REBUILD") return this.proposeRoadmapRebuild(identity, sessionId);
    if (intent.kind === "ROADMAP_ARCHIVE") return this.proposeRoadmapArchive(identity, sessionId);
    if (intent.kind === "REVIEW") return this.tryReviewRecommendation(intent.reviewDecision!, intent.reviewTarget, identity, sessionId);
    if (intent.kind === "SELECT") {
      const recommendation = await prisma.fitnessRecommendation.findFirst({ where: { userId: identity.userId, sessionId }, orderBy: { createdAt: "desc" } });
      if (!recommendation) return { answer: "Hãy tìm PT hoặc chương trình phù hợp trước khi chọn.", blocks: [] };
      if (!intent.candidateNumber && recommendation.candidateIds.length !== 1) return { answer: "Bạn muốn chọn mục nào? Hãy dùng nút Chọn hoặc nói số thứ tự để tránh chọn nhầm.", blocks: [recommendation.result as AgentBlock] };
      const candidateId = recommendation.candidateIds[(intent.candidateNumber ?? 1) - 1];
      if (!candidateId) return { answer: "Số thứ tự không có trong danh sách hiện tại.", blocks: [recommendation.result as AgentBlock] };
      const block = await this.prepare(identity, recommendation.id, candidateId);
      return { answer: "Hãy kiểm tra thông tin bên dưới và xác nhận trước khi thay đổi kế hoạch hoặc đăng ký PT.", blocks: [block] };
    }
    const context = await fitnessAgentDeps.tools.getUserFitnessContext(identity);
    const previous = await prisma.fitnessRecommendation.findFirst({ where: { userId: identity.userId, sessionId }, orderBy: { createdAt: "desc" } });
    const previousPreferences = previous ? (previous.contextSnapshot as any)?.preferences : {};
    const preferences = AgentPreferencesSchema.parse({
      goal: context.profile.goal ?? undefined, days: context.profile.days.length ? context.profile.days : undefined,
      sessionMinutes: context.profile.sessionMinutes, budgetVnd: context.profile.budgetVnd ?? undefined,
      ...previousPreferences, ...intent.preferences,
    });
    if (!preferences.goal || !preferences.days?.length || (intent.kind === "PT" && !preferences.budgetVnd)) {
      return { answer: "Để tìm lựa chọn phù hợp, hãy cho biết mục tiêu, các ngày bạn tập được (ví dụ T2-T4-T6), thời lượng mỗi buổi và ngân sách nếu cần PT.", blocks: [] };
    }
    const evidence = fitnessAgentDeps.tools.getScientificEvidence(preferences.goal);
    const recommendationId = randomUUID();
    let block: AgentBlock;
    let historyAuditId: string | null = null;
    if (intent.kind === "PT") {
      const retrieval = await fitnessAgentDeps.tools.findPTCandidates(identity, preferences);
      historyAuditId = retrieval.historyAuditId;
      const candidates = retrieval.candidates.map(pt => ({ ...pt, compatibility: scorePT(pt, preferences), why: [
        "Chuyên môn phù hợp mục tiêu đã chọn", "Có lịch trống và gói trong giới hạn ngân sách",
        pt.history.note,
      ] })).sort((a, b) => b.compatibility.total - a.compatibility.total || a.id.localeCompare(b.id)).slice(0, 5);
      block = { type: "PT_RECOMMENDATIONS", recommendationId, candidates, evidence,
        warnings: context.profile.reviewRequired ? ["Bạn đã báo cáo yếu tố sức khỏe cần chuyên gia xem xét."] : [],
        truncated: retrieval.truncated };
    } else {
      const retrieval = await fitnessAgentDeps.tools.findTrainingPrograms(identity, preferences);
      const candidates = retrieval.programs.map(program => ({ ...program,
        compatibility: { total: Math.round(100 * (0.75 + 0.25 * Math.min(1, program.estimatedMinutes / (preferences.sessionMinutes ?? 60)))), scoringVersion: "program-fit-v1",
          components: { goal: 1, days: 1, experience: 1, equipment: 1, timeUtilization: program.estimatedMinutes / (preferences.sessionMinutes ?? 60) } },
        why: ["Mục tiêu, trình độ, thiết bị và số ngày phù hợp", "Thời lượng ước tính nằm trong giới hạn của bạn"],
        history: { count: 0, note: "Not enough historical evidence.", dataOrigin: program.dataOrigin },
      })).sort((a, b) => b.compatibility.total - a.compatibility.total || a.id.localeCompare(b.id)).slice(0, 5);
      block = { type: "PROGRAM_RECOMMENDATIONS", recommendationId, candidates, evidence, warnings: retrieval.warnings };
    }
    const candidates = block.candidates as Array<{ id: string }>;
    await prisma.fitnessRecommendation.create({ data: {
      id: recommendationId, userId: identity.userId, sessionId, type: intent.kind,
      contextSnapshot: { preferences, experience: context.profile.experience, reviewRequired: context.profile.reviewRequired, historyAuditId,
        trainingSummary: { ...context.coach.training_summary }, nutritionSummary: { ...context.coach.nutrition_summary } },
      candidateIds: candidates.map(c => c.id), scoringVersion: intent.kind === "PT" ? FITNESS_SCORING.version : "program-fit-v1",
      similarityVersion: FITNESS_SCORING.similarityVersion, evidenceIds: evidence.map(e => e.id), historicalJourneyIds: [], result: block as any,
    } });
    return { answer: candidates.length
      ? "Đây là các lựa chọn phù hợp từ dữ liệu Gymini. Compatibility Score là điểm phù hợp, không phải xác suất thành công. Mở từng thẻ để xem lý do và nguồn bằng chứng."
      : "Chưa có lựa chọn phù hợp với các điều kiện hiện tại. Bạn có thể đổi lịch, ngân sách hoặc hình thức tập rồi thử lại.", blocks: [block] };
  },
  async prepare(identity: AgentIdentity, recommendationId: string, candidateId: string, packageId?: string): Promise<AgentBlock> {
    const rec = await prisma.fitnessRecommendation.findFirst({ where: { id: recommendationId, userId: identity.userId } });
    if (!rec || !rec.candidateIds.includes(candidateId)) throw fail("Recommendation not found", 404);
    await ownSession(identity, rec.sessionId);
    if (Date.now() - rec.createdAt.getTime() > 30 * 60000) throw fail("Recommendation expired. Search again.", 409);
    const candidates = (rec.result as any).candidates as any[];
    const candidate = candidates.find(c => c.id === candidateId);
    const preferences = (rec.contextSnapshot as any).preferences as AgentPreferences;
    const kind: AgentActionKind = rec.type === "PT" ? "CREATE_PT_CONTRACT_DRAFT" : "APPLY_TRAINING_PLAN";
    const selectedPackage = rec.type === "PT" ? candidate.packages.find((p: any) => packageId ? p.id === packageId : p.id === candidate.packages[0]?.id) : null;
    if (rec.type === "PT" && !selectedPackage) throw fail("Package not found", 404);
    const action = await prisma.fitnessAgentAction.create({ data: {
      userId: identity.userId, sessionId: rec.sessionId, recommendationId: rec.id, kind, risk: agentActionRisk(kind),
      payload: rec.type === "PT" ? { ptId: candidateId, packageId: selectedPackage.id, preferences }
        : { templateId: candidateId, fingerprint: candidate.fingerprint, preferences, startDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()) },
      expiresAt: new Date(Date.now() + 15 * 60000),
    } });
    await prisma.fitnessRecommendation.update({ where: { id: rec.id }, data: { selectedCandidateId: candidateId } });
    return { type: "ACTION_CONFIRMATION", actionId: action.id, kind, risk: action.risk,
      title: candidate.name, summary: selectedPackage ?? { days: candidate.daysPerWeek, durationWeeks: candidate.durationWeeks, replacesCurrentPlan: true },
      expiresAt: action.expiresAt.toISOString(), note: rec.type === "PT" ? "Tạo bản nháp; chưa thanh toán. PT vẫn phải duyệt yêu cầu qua quy trình hợp đồng hiện có." : "Áp dụng sẽ thay thế lịch chưa hoàn thành và liên kết chương trình với chu kỳ tập." };
  },
  async execute(identity: AgentIdentity, actionId: string, confirmed: boolean): Promise<AgentBlock> {
    if (confirmed !== true) throw fail("Explicit confirmation required");
    const action = await prisma.fitnessAgentAction.findFirst({ where: { id: actionId, userId: identity.userId } });
    if (!action) throw fail("Action not found", 404);
    await ownSession(identity, action.sessionId);
    if (action.status === "COMPLETED") return action.result as AgentBlock;
    if (action.expiresAt < new Date()) throw fail("Action expired. Refresh the recommendation.", 409);
    const payload = action.payload as any;
    let block: AgentBlock;
    if (action.kind === "CREATE_PT_CONTRACT_DRAFT") {
      const draft = await fitnessAgentDeps.tools.createPTContractDraft(identity, { ...payload, actionId: action.id });
      // Stable second action ID allows recovery after an upstream success/lost response.
      const confirmation = await prisma.fitnessAgentAction.upsert({ where: { id: draft.id }, update: {}, create: {
        id: draft.id, userId: identity.userId, sessionId: action.sessionId, recommendationId: action.recommendationId,
        kind: "CONFIRM_PT_CONTRACT", risk: "HIGH", payload: { draftId: draft.id }, expiresAt: new Date(draft.expiresAt),
      } });
      block = { type: "ACTION_CONFIRMATION", actionId: confirmation.id, kind: confirmation.kind, risk: "HIGH", title: "Xác nhận yêu cầu hợp đồng PT",
        summary: draft.snapshot, expiresAt: draft.expiresAt, note: "Chỉ gửi yêu cầu hợp đồng. PT duyệt và bạn thanh toán qua quy trình hiện có; chưa tự động trừ tiền." };
    } else if (action.kind === "CONFIRM_PT_CONTRACT") {
      block = { type: "ACTION_RESULT", ...await fitnessAgentDeps.tools.confirmPTContract(identity, payload.draftId) };
    } else if (action.kind === "APPLY_TRAINING_PLAN") {
      block = { type: "ACTION_RESULT", ...await fitnessAgentDeps.tools.applyTrainingPlan(identity, { ...payload, actionId: action.id, confirmed: true }) };
    } else if (
      action.kind === "ACCEPT_TRAINING_RECOMMENDATION" || action.kind === "REJECT_TRAINING_RECOMMENDATION" ||
      action.kind === "ACCEPT_NUTRITION_RECOMMENDATION" || action.kind === "REJECT_NUTRITION_RECOMMENDATION"
    ) {
      await fitnessAgentDeps.tools.reviewRecommendation(identity, payload);
      const isNutrition = action.kind.includes("NUTRITION");
      const isAccept = action.kind.startsWith("ACCEPT");
      block = { type: "ACTION_RESULT", message: `Đã ${isAccept ? "chấp nhận" : "từ chối"} đề xuất ${isNutrition ? "dinh dưỡng" : "tập luyện"}.`, nextUrl: "/client/training" };
    } else if (action.kind === "CREATE_PLAN_BUNDLE") {
      // Three real, independent writes in sequence, each already a
      // separately-tested existing operation. Never claim full success on
      // partial failure — report exactly which step failed, and DON'T
      // retry a step that already succeeded if this whole action is
      // re-confirmed after a partial failure (status stays PENDING on
      // error below, but each individual create/apply call below is
      // itself idempotent-ish: activateRoadmap on an already-ACTIVE
      // roadmap and bootstrapNutrition on an existing goal are both no-ops
      // per their own service logic, not duplicate-creators).
      const draft = payload.roadmapDraft as any;
      const steps: { step: string; ok: boolean; detail?: string }[] = [];
      let roadmapId: string | null = null;
      try {
        const accepted = await fitnessAgentDeps.tools.acceptRoadmapDraft(identity, {
          name: "Lộ trình do AI Coach tạo", goalType: draft.goalType, plannedStartAt: draft.plannedStartAt,
          phases: draft.phases,
          configuration: { aiDraft: { summary: draft.summary, reasoningSummary: draft.reasoningSummary, confidence: draft.confidence, warnings: draft.warnings, assumptions: draft.assumptions } },
        });
        roadmapId = (accepted as any).roadmap.id;
        await fitnessAgentDeps.tools.activateRoadmap(identity, roadmapId!);
        steps.push({ step: "roadmap", ok: true });
      } catch (err: any) {
        steps.push({ step: "roadmap", ok: false, detail: err?.message ?? "Không tạo được lộ trình" });
      }
      if (payload.workoutCandidate) {
        try {
          await fitnessAgentDeps.tools.applyTrainingPlan(identity, {
            templateId: payload.workoutCandidate.id, fingerprint: payload.workoutCandidate.fingerprint,
            preferences: payload.preferences,
            startDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()),
            actionId: action.id, confirmed: true,
          });
          steps.push({ step: "workout", ok: true });
        } catch (err: any) {
          steps.push({ step: "workout", ok: false, detail: err?.message ?? "Không tạo được chương trình tập" });
        }
      } else {
        steps.push({ step: "workout", ok: false, detail: "Không có chương trình tập phù hợp để áp dụng" });
      }
      try {
        const nutritionResult = await fitnessAgentDeps.tools.bootstrapNutrition(identity);
        steps.push({ step: "nutrition", ok: true, detail: (nutritionResult as any).data?.status });
      } catch (err: any) {
        steps.push({ step: "nutrition", ok: false, detail: err?.message ?? "Không tạo được mục tiêu dinh dưỡng" });
      }
      const allOk = steps.every(s => s.ok);
      const label: Record<string, string> = { roadmap: "Lộ trình", workout: "Chương trình tập", nutrition: "Mục tiêu dinh dưỡng" };
      const summaryLines = steps.map(s => `${s.ok ? "✅" : "❌"} ${label[s.step]}${s.detail ? ` — ${s.detail}` : ""}`);
      block = {
        type: "ACTION_RESULT",
        message: allOk
          ? "Đã tạo và kích hoạt lộ trình, chương trình tập và mục tiêu dinh dưỡng thật trên hệ thống."
          : "Một số phần chưa tạo được — xem chi tiết bên dưới, các phần còn lại vẫn đã được tạo thật.",
        steps: summaryLines,
        nextUrl: "/client/dashboard",
      };
    } else if (action.kind === "SAVE_GENERATED_PLAN") {
      // weeklySchedule was already resolved to real exerciseIds at propose
      // time (see proposeSaveGeneratedPlan) — what's confirmed here is
      // exactly what was previewed, no re-generation/re-matching step that
      // could drift from what the user actually saw and agreed to.
      try {
        const result = await fitnessAgentDeps.tools.importAiPlanToSchedule(identity, {
          sourcePlanId: action.id, sourcePlanName: "Lịch tập vừa đề xuất",
          goal: payload.goal, durationWeeks: 8, daysPerWeek: payload.daysPerWeek,
          startDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()),
          repeatWeeks: 8, weeklySchedule: payload.weeklySchedule, replaceExisting: true,
        });
        block = { type: "ACTION_RESULT", message: "Đã lưu lịch tập vào hệ thống, thay thế lịch tập chưa hoàn thành hiện tại.",
          steps: [`✅ Chương trình tập — ${(result as any).message ?? "đã lưu"}`], nextUrl: "/client/training" };
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không lưu được lịch tập — ${err?.message ?? "lỗi không xác định"}.`,
          steps: [`❌ Chương trình tập — ${err?.message ?? "lỗi không xác định"}`], nextUrl: "/client/training" };
      }
    } else if (action.kind === "ROADMAP_ADVANCE") {
      try {
        await fitnessAgentDeps.tools.advanceRoadmapPhase(identity, payload.roadmapId as string);
        // advanceRoadmap can 200-OK without changing anything — confirmed
        // live, two distinct no-op reasons with the exact same HTTP
        // response: (1) the phase still has an ACTIVE cycle, or (2) the
        // most recent cycle closed with no COMPLETED CycleAssessment (e.g.
        // too few logged sessions to assess — "insufficient data"), which
        // the real engine treats as BLOCKED_PENDING_REVIEW/no-op rather
        // than an error. Verify the active phase actually changed, and
        // distinguish which of the two no-op reasons applies so the
        // message stays accurate instead of always blaming "still active".
        const after = await fitnessAgentDeps.tools.getCurrentRoadmap(identity);
        const newActivePhaseId = (after as any).activePhase?.id ?? null;
        if (newActivePhaseId && newActivePhaseId !== payload.activePhaseIdBefore) {
          block = { type: "ACTION_RESULT", message: "Đã chuyển lộ trình sang giai đoạn tiếp theo.", nextUrl: "/client/dashboard" };
        } else if ((after as any).activeCycle) {
          block = { type: "ACTION_RESULT", message: "Chưa chuyển được giai đoạn — chu kỳ tập hiện tại vẫn đang chạy (ACTIVE), cần hoàn thành trước khi chuyển giai đoạn.", nextUrl: "/client/dashboard" };
        } else {
          block = { type: "ACTION_RESULT", message: "Chưa chuyển được giai đoạn — chu kỳ tập gần nhất chưa có đánh giá đầy đủ (ví dụ chưa đủ buổi tập được ghi nhận), cần dữ liệu tập luyện thật trước khi có thể chuyển giai đoạn.", nextUrl: "/client/dashboard" };
        }
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không chuyển được giai đoạn — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/dashboard" };
      }
    } else if (action.kind === "ROADMAP_REBUILD") {
      try {
        await fitnessAgentDeps.tools.applyRoadmapRebuild(identity, payload.roadmapId as string, payload.assessmentId as string);
        block = { type: "ACTION_RESULT", message: "Đã xây lại lộ trình với các giai đoạn mới.", nextUrl: "/client/dashboard" };
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không xây lại được lộ trình — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/dashboard" };
      }
    } else if (action.kind === "ROADMAP_ARCHIVE") {
      try {
        await fitnessAgentDeps.tools.archiveRoadmap(identity, payload.roadmapId as string);
        block = { type: "ACTION_RESULT", message: "Đã lưu trữ lộ trình.", nextUrl: "/client/dashboard" };
      } catch (err: any) {
        block = { type: "ACTION_RESULT", message: `Không lưu trữ được lộ trình — ${err?.message ?? "lỗi không xác định"}.`, nextUrl: "/client/dashboard" };
      }
    } else throw fail("Unsupported action");
    await prisma.fitnessAgentAction.update({ where: { id: action.id }, data: { status: "COMPLETED", result: block as any } });
    return block;
  },
  /** Food-substitution path (docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_
   * PLAN.md) — deliberately does NOT go through prepare()/execute(): LOW
   * risk (free, reversible, nutrient-equivalent, never touches the
   * calorie/macro target), confirmed with the product owner to apply in
   * one turn instead. Returns null (never throws) on anything that isn't
   * clearly a substitution request, so the caller falls through to the
   * normal chat pipeline exactly like an unrecognized PT/PROGRAM/SELECT
   * intent would. */
  async trySubstitution(question: string, identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] } | null> {
    const extraction = await fitnessAgentDeps.extractFoodSubstitutionIntent(question, identity.userId);
    if (!extraction || !extraction.isFoodSubstitutionRequest || !extraction.currentFoodMention) return null;
    await ownSession(identity, sessionId);
    const result = await fitnessAgentDeps.tools.substituteMealItem(identity, {
      currentFoodMention: extraction.currentFoodMention,
      desiredFoodMention: extraction.desiredFoodMention,
      mealHint: extraction.mealHint,
    });
    const block: AgentBlock = { type: "SUBSTITUTE_RESULT", ...result };
    let answer: string;
    if (result.status === "APPLIED") answer = (result as any).message;
    else if (result.status === "AMBIGUOUS_MEAL" || result.status === "AMBIGUOUS_ITEM") {
      const list = ((result as any).candidates ?? [])
        .map((c: any) => `• ${c.label ?? c.itemName}`)
        .join("\n");
      answer = `${(result as any).message}\n${list}\n\nHãy nói rõ hơn (ví dụ nêu tên bữa) rồi thử lại.`;
    } else answer = (result as any).message;
    return { answer, blocks: [block] };
  },
  /** Cycle-evaluation-via-chat (docs/agentic-fitness/01_NUTRITION_AGENT_
   * TOOLS_PLAN.md, phase C) — wraps the EXISTING evaluateCycle() verbatim
   * (same call inbody-reassessment.service.ts already reuses; no new
   * decision logic here at all) and formats its already-computed aiSummary/
   * nutritionAiHeadline/nutritionAiExplanation (produced once during
   * evaluateCycle's own ai-service call) into a chat answer — no separate
   * LLM call needed for this formatting step. Read-only from the user's
   * point of view (accepting/rejecting is a separate REVIEW turn), so runs
   * directly without prepare()/confirm(), same as PT_RECOMMENDATIONS. */
  async tryEvaluateCycle(identity: AgentIdentity): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let active: Awaited<ReturnType<typeof fitnessAgentDeps.tools.getActiveCycle>>;
    try {
      active = await fitnessAgentDeps.tools.getActiveCycle(identity);
    } catch (err: any) {
      if (err.status === 404) return { answer: "Bạn chưa có chu kỳ tập nào đang hoạt động.", blocks: [] };
      throw err;
    }
    const assessment = await fitnessAgentDeps.tools.evaluateCycle(identity, active.cycle.id);
    const trainingLabel = assessment.decision ? (TRAINING_DECISION_LABEL_VI[assessment.decision] ?? assessment.decision) : "Chưa xác định";
    let answer = `Đánh giá chu kỳ tập: ${trainingLabel}.`;
    if (assessment.aiSummary) answer += ` ${assessment.aiSummary}`;
    if (assessment.nutritionDecision) {
      const nutritionLabel = NUTRITION_DECISION_LABEL_VI[assessment.nutritionDecision] ?? assessment.nutritionDecision;
      answer += `\n\nDinh dưỡng: ${nutritionLabel}.`;
      if (assessment.nutritionAiHeadline) answer += ` ${assessment.nutritionAiHeadline}`;
      if (assessment.nutritionAiExplanation) answer += ` ${assessment.nutritionAiExplanation}`;
    }
    const pending: string[] = [];
    if (assessment.userDecision === "PENDING" && assessment.decision) pending.push("tập luyện");
    if (assessment.nutritionUserDecision === "PENDING" && assessment.nutritionDecision) pending.push("dinh dưỡng");
    if (pending.length) answer += `\n\nBạn có thể nói "chấp nhận" hoặc "từ chối" cho đề xuất ${pending.join(" và ")}.`;
    return { answer, blocks: [{ type: "CYCLE_EVALUATION_RESULT", ...assessment }] };
  },
  /** Accept/reject-via-chat (docs/agentic-fitness/01_NUTRITION_AGENT_TOOLS_
   * PLAN.md, phase D) — wraps the EXISTING accept/reject endpoints
   * verbatim (same real prescription-change logic TrainingCyclePage's own
   * Accept/Reject buttons call). Real prescription change, so — unlike
   * substitution — this keeps the prepare()/confirm()/execute() flow: this
   * method only ever returns an ACTION_CONFIRMATION, never applies
   * anything itself. Never guesses which target (training/nutrition) when
   * both are pending and the message didn't say — asks instead, same rule
   * as trySubstitution's ambiguous-meal handling. */
  async tryReviewRecommendation(
    decision: "ACCEPT" | "REJECT",
    target: "TRAINING" | "NUTRITION" | undefined,
    identity: AgentIdentity,
    sessionId: string,
  ): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let active: Awaited<ReturnType<typeof fitnessAgentDeps.tools.getActiveCycle>>;
    try {
      active = await fitnessAgentDeps.tools.getActiveCycle(identity);
    } catch (err: any) {
      if (err.status === 404) return { answer: "Bạn chưa có chu kỳ tập nào đang hoạt động.", blocks: [] };
      throw err;
    }
    let assessment: Awaited<ReturnType<typeof fitnessAgentDeps.tools.getLatestAssessment>>;
    try {
      assessment = await fitnessAgentDeps.tools.getLatestAssessment(identity, active.cycle.id);
    } catch (err: any) {
      if (err.status === 404) return { answer: "Chưa có đánh giá nào cho chu kỳ hiện tại — hãy yêu cầu đánh giá trước.", blocks: [] };
      throw err;
    }
    const trainingPending = assessment.userDecision === "PENDING" && !!assessment.decision;
    const nutritionPending = assessment.nutritionUserDecision === "PENDING" && !!assessment.nutritionDecision;
    let resolvedTarget = target;
    if (!resolvedTarget) {
      if (trainingPending && nutritionPending) {
        return { answer: 'Cả đề xuất tập luyện và dinh dưỡng đều đang chờ. Bạn muốn xử lý đề xuất nào — nói rõ "tập luyện" hoặc "dinh dưỡng".', blocks: [] };
      }
      resolvedTarget = trainingPending ? "TRAINING" : nutritionPending ? "NUTRITION" : undefined;
    }
    if (!resolvedTarget) return { answer: "Hiện không có đề xuất nào đang chờ để chấp nhận hoặc từ chối.", blocks: [] };
    const isPending = resolvedTarget === "NUTRITION" ? nutritionPending : trainingPending;
    if (!isPending) {
      return { answer: `Đề xuất ${resolvedTarget === "NUTRITION" ? "dinh dưỡng" : "tập luyện"} hiện không có gì đang chờ xử lý.`, blocks: [] };
    }
    const kind: AgentActionKind = `${decision === "ACCEPT" ? "ACCEPT" : "REJECT"}_${resolvedTarget}_RECOMMENDATION` as AgentActionKind;
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null, kind, risk: agentActionRisk(kind),
        payload: { cycleId: active.cycle.id, assessmentId: assessment.id, target: resolvedTarget, decision },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    const block: AgentBlock = {
      type: "ACTION_CONFIRMATION", actionId: action.id, kind, risk: action.risk,
      title: `${decision === "ACCEPT" ? "Chấp nhận" : "Từ chối"} đề xuất ${resolvedTarget === "NUTRITION" ? "dinh dưỡng" : "tập luyện"}`,
      expiresAt: action.expiresAt.toISOString(),
      note: resolvedTarget === "NUTRITION"
        ? "Chấp nhận sẽ tạo phiên bản mục tiêu dinh dưỡng mới theo đề xuất."
        : "Chấp nhận sẽ ghi nhận đề xuất; áp dụng chương trình tập mới (nếu có) vẫn là bước riêng.",
    };
    return { answer: "Hãy kiểm tra thông tin bên dưới và xác nhận.", blocks: [block] };
  },
  /** Agent automation — "hãy tạo và gán lộ trình + plan tập + dinh dưỡng vào
   * hệ thống". Everything below is READ-ONLY (a real AI roadmap draft +
   * a real matched workout candidate, both already-existing endpoints
   * GuidedRoadmapWizard.tsx / the program-recommendation flow already call)
   * — nothing is created/activated until the user explicitly confirms via
   * the normal execute()/ACTION_CONFIRMATION flow below, same as every
   * other real write in this file. */
  async proposePlanBundle(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    const personalization = await fitnessAgentDeps.profileExtractor.extract(identity.userId, identity.authorizationHeader);
    const profile = personalization.profile;
    const missing: string[] = [];
    if (!profile.goal) missing.push("mục tiêu (giảm mỡ/tăng cơ/duy trì/hiệu suất)");
    if (profile.age == null) missing.push("tuổi");
    if (profile.heightCm == null) missing.push("chiều cao");
    if (profile.currentWeightKg == null) missing.push("cân nặng");
    if (!profile.gender) missing.push("giới tính");
    if (missing.length > 0) {
      return {
        answer: `Mình cần thêm vài thông tin trong hồ sơ của bạn trước khi lên lộ trình thật: ${missing.join(", ")}. Hãy cập nhật hồ sơ (hoặc đo InBody) rồi thử lại — mình sẽ không tự giả định số liệu cho một lộ trình sắp được kích hoạt thật.`,
        blocks: [],
      };
    }
    const goalType = profile.goal as "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE";

    const draft = await fitnessAgentDeps.tools.generateRoadmapDraft(identity, {
      goalType,
      timeframeWeeks: 16,
    }) as any;

    const preferredDays = profile.training?.preferredTrainingDays?.length
      ? profile.training.preferredTrainingDays
      : profile.training?.trainingDaysPerWeek
        ? Array.from({ length: Math.min(7, profile.training.trainingDaysPerWeek) }, (_, i) => i + 1)
        : [1, 3, 5];
    const preferences = AgentPreferencesSchema.parse({
      goal: goalType,
      days: preferredDays,
      sessionMinutes: 60,
    });
    let workoutCandidate: any = null;
    try {
      const programs = await fitnessAgentDeps.tools.findTrainingPrograms(identity, preferences);
      // Top-ranked candidate only — this flow is "create everything with one
      // confirm", not another round of choosing between programs (that's
      // what the existing PROGRAM_RECOMMENDATIONS flow is already for).
      workoutCandidate = programs.programs[0] ?? null;
    } catch (err: any) {
      // Non-fatal: the roadmap + nutrition parts can still be proposed even
      // if no matching workout template exists right now.
      workoutCandidate = null;
    }

    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "CREATE_PLAN_BUNDLE", risk: agentActionRisk("CREATE_PLAN_BUNDLE"),
        payload: { roadmapDraft: draft, workoutCandidate, preferences },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });

    const phaseCount = Array.isArray(draft?.phases) ? draft.phases.length : 0;
    const totalWeeks = Array.isArray(draft?.phases)
      ? draft.phases.reduce((sum: number, p: any) => {
          const start = new Date(p.plannedStartAt).getTime();
          const end = new Date(p.plannedEndAt).getTime();
          return sum + (Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / (7 * 86_400_000)) : 0);
        }, 0)
      : 0;
    const block: AgentBlock = {
      type: "ACTION_CONFIRMATION", actionId: action.id, kind: "CREATE_PLAN_BUNDLE", risk: action.risk,
      title: "Tạo lộ trình + chương trình tập + dinh dưỡng",
      summary: {
        roadmapSummary: draft?.summary ?? null,
        phaseCount, totalWeeks,
        workoutName: workoutCandidate?.name ?? null,
        workoutDaysPerWeek: workoutCandidate?.daysPerWeek ?? null,
      },
      expiresAt: action.expiresAt.toISOString(),
      note: "Xác nhận sẽ: (1) kích hoạt lộ trình mới này (thay thế lộ trình đang hoạt động nếu có), (2) áp dụng chương trình tập bên trên (thay lịch tập chưa hoàn thành), (3) tạo mục tiêu dinh dưỡng thật dựa trên hồ sơ/InBody hiện tại của bạn. Đây là thay đổi thật trên hệ thống.",
    };
    return {
      answer: draft?.summary
        ? `Đây là lộ trình mình đề xuất dựa trên hồ sơ thật của bạn:\n\n${draft.summary}\n\nKiểm tra chi tiết bên dưới và xác nhận nếu bạn muốn tạo thật.`
        : "Kiểm tra thông tin bên dưới và xác nhận nếu bạn muốn tạo thật.",
      blocks: [block],
    };
  },
  // "gán/lưu lịch tập [vừa tạo] vào hệ thống" — the chat "hãy tạo lịch tập"
  // answer is produced by recommendation_engine.ts, a DETERMINISTIC template
  // (pure function of profile+question) that is never persisted anywhere —
  // no WorkoutPlan row, no id. So "save what you just showed me" means:
  // find the question that produced it (Conversation.routeIntent), re-run
  // the exact same deterministic computation to reproduce it byte-for-byte,
  // resolve its free-text exercise names against the real catalog (the
  // template has no exerciseId at all), and only then build a real,
  // importable weeklySchedule. What gets previewed here is exactly what
  // gets created on confirm — no separate regeneration step.
  async proposeSaveGeneratedPlan(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    const WORKOUT_PLAN_INTENTS = ["workout_plan_request", "body_recomposition_request", "frequency_change_request", "combined_plan_request"];
    const sourceTurn = await prisma.conversation.findFirst({
      where: { userId: identity.userId, sessionId, routeIntent: { in: WORKOUT_PLAN_INTENTS } },
      orderBy: { createdAt: "desc" },
    });
    if (!sourceTurn) {
      return {
        answer: "Mình chưa thấy lịch tập nào bạn vừa nhờ mình tạo trong đoạn hội thoại này để lưu. Hãy nhờ mình tạo lịch tập trước (ví dụ: \"hãy tạo lịch tập cho tôi\"), sau đó nói lại \"gán vào lịch tập\" — mình sẽ lưu đúng lịch đó vào hệ thống.",
        blocks: [],
      };
    }
    const personalization = await fitnessAgentDeps.profileExtractor.extract(identity.userId, identity.authorizationHeader);
    const profile = personalization.profile;
    const routedIntent = intentRouter.route(sourceTurn.question, profile);
    const parsedInput = inputParser.parse(sourceTurn.question, profile);
    parsedInput.routeIntent = routedIntent.intent;
    parsedInput.goalHint = routedIntent.goalHint || parsedInput.goalHint;
    const recommendation = recommendationEngine.recommend(profile, parsedInput, "vi");
    const days = recommendation.workoutPlan?.days ?? [];
    if (!days.length) {
      return {
        answer: "Mình không tái tạo lại được lịch tập đã hiển thị trước đó. Bạn có thể nhờ mình tạo lại lịch tập rồi thử lưu lại.",
        blocks: [],
      };
    }
    // Resolve every unique exercise name once (not once per occurrence).
    const uniqueNames = [...new Set(days.flatMap(d => d.exercises.map(e => e.name)))];
    const resolutions = new Map<string, { id: string; exerciseName: string } | null>();
    await Promise.all(uniqueNames.map(async name => {
      resolutions.set(name, await fitnessAgentDeps.tools.searchExerciseByName(identity, name).catch(() => null));
    }));
    const unmatched = new Set<string>();
    const weeklySchedule = days.map(day => ({
      day: day.day, goal: day.goal,
      exercises: day.exercises.flatMap(e => {
        const match = resolutions.get(e.name);
        if (!match) { unmatched.add(e.name); return []; }
        return [{ exerciseId: match.id, name: match.exerciseName, order: e.order, sets: e.sets, reps: e.reps, restSeconds: e.restSeconds, note: e.note }];
      }),
    })).filter(d => d.exercises.length > 0);
    if (!weeklySchedule.length) {
      return {
        answer: "Mình không khớp được bài tập nào trong lịch vừa đề xuất với thư viện bài tập thật, nên chưa thể lưu. Bạn có thể nhờ mình tạo lại lịch tập với các bài phổ biến hơn.",
        blocks: [],
      };
    }
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "SAVE_GENERATED_PLAN", risk: agentActionRisk("SAVE_GENERATED_PLAN"),
        payload: { goal: profile.goal ?? "MUSCLE_GAIN", daysPerWeek: weeklySchedule.length, weeklySchedule },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    const unmatchedNote = unmatched.size > 0
      ? ` Lưu ý: ${unmatched.size} bài tập (${[...unmatched].join(", ")}) không khớp được với thư viện bài tập nên sẽ không có trong lịch được lưu.`
      : "";
    return {
      answer: `Mình sẽ lưu đúng lịch tập đã đề xuất (${weeklySchedule.length} ngày/tuần) vào lịch tập thật của bạn, thay thế lịch chưa hoàn thành hiện tại.${unmatchedNote} Xác nhận bên dưới nếu bạn đồng ý.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "SAVE_GENERATED_PLAN", risk: action.risk,
        title: "Lịch tập vừa đề xuất",
        summary: { planName: "Lịch tập vừa đề xuất", daysPerWeek: weeklySchedule.length, durationWeeks: 8, goal: profile.goal, unmatchedCount: unmatched.size },
        expiresAt: action.expiresAt.toISOString(),
        note: "Xác nhận sẽ lưu đúng lịch tập này vào hệ thống, thay thế lịch chưa hoàn thành hiện tại.",
      }],
    };
  },
  // Roadmap management via chat, for an EXISTING roadmap. Read-only status
  // check answers directly (no confirm needed, same as the workout-schedule
  // lookup elsewhere); advance/rebuild/archive all go through the same
  // propose -> ACTION_CONFIRMATION -> execute() flow as every other real
  // write in this file.
  async answerRoadmapStatus(identity: AgentIdentity): Promise<{ answer: string; blocks: AgentBlock[] }> {
    // Response shape confirmed live: { roadmap, phases, activePhase,
    // activeCycle, ... } — phases/activePhase/activeCycle are siblings of
    // roadmap, not nested inside it.
    let data: any;
    try {
      data = await fitnessAgentDeps.tools.getCurrentRoadmap(identity);
    } catch (err: any) {
      if (err?.status === 404) {
        return { answer: "Bạn chưa có lộ trình nào đang hoạt động. Hãy nhờ mình lên lộ trình mới nếu bạn muốn.", blocks: [] };
      }
      return { answer: "Mình chưa lấy được thông tin lộ trình của bạn lúc này. Vui lòng thử lại sau.", blocks: [] };
    }
    const phases = Array.isArray(data.phases) ? data.phases : [];
    const activePhase = data.activePhase ?? null;
    const activeIndex = activePhase ? phases.findIndex((p: any) => p.id === activePhase.id) : -1;
    const lines = [
      `Lộ trình hiện tại của bạn: mục tiêu ${data.roadmap?.goalType ?? "chưa rõ"}, đang ở giai đoạn ${activeIndex >= 0 ? activeIndex + 1 : "?"}/${phases.length}${activePhase?.name ? ` (${activePhase.name})` : ""}.`,
    ];
    if (activePhase) {
      lines.push(data.activeCycle
        ? "Bạn đang có 1 chu kỳ tập đang chạy trong giai đoạn này."
        : "Giai đoạn này chưa có chu kỳ tập nào đang chạy.");
    }
    return { answer: lines.join(" "), blocks: [] };
  },
  async proposeRoadmapAdvance(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let data: any;
    try {
      data = await fitnessAgentDeps.tools.getCurrentRoadmap(identity);
    } catch {
      return { answer: "Bạn chưa có lộ trình nào đang hoạt động để chuyển giai đoạn.", blocks: [] };
    }
    const roadmap = data.roadmap;
    const phases = Array.isArray(data.phases) ? data.phases : [];
    const activePhase = data.activePhase ?? null;
    const activeIndex = activePhase ? phases.findIndex((p: any) => p.id === activePhase.id) : -1;
    const nextPhase = activeIndex >= 0 ? phases[activeIndex + 1] : null;
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "ROADMAP_ADVANCE", risk: agentActionRisk("ROADMAP_ADVANCE"),
        // activePhaseId captured now so execute() can verify a transition
        // actually happened — confirmed live: fitness-roadmap.service.ts's
        // advanceRoadmap silently no-ops (200 OK, nothing changed) when the
        // current phase still has an ACTIVE cycle, with no field in its
        // response distinguishing that from a real transition.
        payload: { roadmapId: roadmap.id, activePhaseIdBefore: activePhase?.id ?? null },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return {
      answer: `Bạn đang ở giai đoạn ${activeIndex >= 0 ? activeIndex + 1 : "?"}/${phases.length}${activePhase?.name ? ` (${activePhase.name})` : ""}. Xác nhận sẽ chuyển sang giai đoạn tiếp theo${nextPhase?.name ? ` (${nextPhase.name})` : ""} nếu đủ điều kiện.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "ROADMAP_ADVANCE", risk: action.risk,
        title: "Chuyển sang giai đoạn tiếp theo",
        summary: { currentPhase: activePhase?.name ?? null, nextPhase: nextPhase?.name ?? null },
        expiresAt: action.expiresAt.toISOString(),
        note: "Nếu chưa có chu kỳ tập nào hoàn thành và được đánh giá trong giai đoạn hiện tại, thao tác này sẽ báo lỗi và không thay đổi gì.",
      }],
    };
  },
  async proposeRoadmapRebuild(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let roadmap: any;
    try {
      roadmap = (await fitnessAgentDeps.tools.getCurrentRoadmap(identity)).roadmap;
    } catch {
      return { answer: "Bạn chưa có lộ trình nào đang hoạt động để xây lại.", blocks: [] };
    }
    let proposal: any;
    try {
      proposal = await fitnessAgentDeps.tools.previewRoadmapRebuild(identity, roadmap.id as string);
    } catch (err: any) {
      return { answer: `Mình chưa xây lại được lộ trình lúc này — ${err?.message ?? "cần có một chu kỳ tập vừa được đánh giá (ADJUST/DELOAD/REBUILD) trước khi xây lại"}.`, blocks: [] };
    }
    const proposedPhases = Array.isArray(proposal.proposedPhases) ? proposal.proposedPhases : [];
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "ROADMAP_REBUILD", risk: agentActionRisk("ROADMAP_REBUILD"),
        payload: { roadmapId: roadmap.id, assessmentId: proposal.assessmentId },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return {
      answer: `Mình đề xuất xây lại ${proposedPhases.length} giai đoạn còn lại của lộ trình dựa trên đánh giá chu kỳ gần nhất. Xác nhận bên dưới nếu bạn muốn áp dụng thật — các giai đoạn chưa bắt đầu hiện tại sẽ được thay thế.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "ROADMAP_REBUILD", risk: action.risk,
        title: "Xây lại lộ trình",
        summary: { phaseCount: proposedPhases.length, phases: proposedPhases.map((p: any) => p.name).filter(Boolean) },
        expiresAt: action.expiresAt.toISOString(),
        note: "Xác nhận sẽ hoàn thành giai đoạn hiện tại, bỏ các giai đoạn cũ chưa bắt đầu, và tạo + kích hoạt các giai đoạn mới này.",
      }],
    };
  },
  async proposeRoadmapArchive(identity: AgentIdentity, sessionId: string): Promise<{ answer: string; blocks: AgentBlock[] }> {
    let roadmap: any;
    let isDraft = false;
    try {
      roadmap = (await fitnessAgentDeps.tools.getCurrentRoadmap(identity)).roadmap;
    } catch {
      try {
        roadmap = (await fitnessAgentDeps.tools.getCurrentDraftRoadmap(identity)).roadmap;
        isDraft = true;
      } catch {
        return { answer: "Bạn chưa có lộ trình nào (đang hoạt động hoặc bản nháp) để lưu trữ.", blocks: [] };
      }
    }
    const action = await prisma.fitnessAgentAction.create({
      data: {
        userId: identity.userId, sessionId, recommendationId: null,
        kind: "ROADMAP_ARCHIVE", risk: agentActionRisk("ROADMAP_ARCHIVE"),
        payload: { roadmapId: roadmap.id },
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return {
      answer: `Xác nhận sẽ lưu trữ (archive) ${isDraft ? "bản nháp" : "lộ trình đang hoạt động"} mục tiêu ${roadmap.goalType ?? ""} hiện tại của bạn. Sau đó bạn có thể tạo lộ trình mới.`,
      blocks: [{
        type: "ACTION_CONFIRMATION", actionId: action.id, kind: "ROADMAP_ARCHIVE", risk: action.risk,
        title: "Lưu trữ lộ trình hiện tại",
        summary: { goalType: roadmap.goalType ?? null, isDraft },
        expiresAt: action.expiresAt.toISOString(),
        note: isDraft ? undefined : "Không thể lưu trữ khi đang có giai đoạn ACTIVE — hãy hoàn thành hoặc chuyển giai đoạn trước nếu cần.",
      }],
    };
  },
};
