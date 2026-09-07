import { randomUUID } from "node:crypto";
import { AgentPreferencesSchema, FITNESS_SCORING, scorePT, agentActionRisk, type AgentPreferences, type AgentActionKind } from "@gym-coach/shared";
import { prisma } from "../repositories/conversation.repository";
import { fitnessAgentTools, type AgentIdentity } from "./fitness-agent-tools";
import { parseFitnessAgentIntent } from "./fitness-agent-intent";
import { isLikelyFoodSubstitutionMessage, extractFoodSubstitutionIntent } from "./food-substitution-extractor";

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
export type AgentBlock = { type: "PT_RECOMMENDATIONS" | "PROGRAM_RECOMMENDATIONS" | "ACTION_CONFIRMATION" | "GOAL_ANALYSIS" | "ACTION_RESULT" | "SUBSTITUTE_RESULT" | "CYCLE_EVALUATION_RESULT"; [key: string]: unknown };
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
export const fitnessAgentDeps = { tools: fitnessAgentTools, extractFoodSubstitutionIntent };

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
};
