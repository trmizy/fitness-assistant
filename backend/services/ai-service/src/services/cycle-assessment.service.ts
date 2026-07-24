import { logger } from "@gym-coach/shared";
import { retriever } from "../llm/retriever";
import { callLlmJson } from "../llm/json_llm_call.util";
import { evidenceUsedFromDocs, formatEvidenceForPlanPrompt } from "../llm/plan_evidence";
import {
  AssessCycleOutputSchema,
  type AssessCycleRequest,
  type AssessCycleOutput,
} from "../schemas/cycle-assessment.schemas";
import type { EvidenceUsed } from "../llm/types";

export interface AssessCycleResult extends AssessCycleOutput {
  citations: EvidenceUsed[];
}

const DECISION_LABEL: Record<AssessCycleRequest["decision"]["value"], string> = {
  KEEP: "giữ nguyên chương trình hiện tại",
  PROGRESS: "tăng tải/khối lượng tập luyện",
  ADJUST: "điều chỉnh nhỏ (bài tập/rep-range/tần suất)",
  DELOAD: "giảm tải để phục hồi",
  REBUILD: "xây dựng lại chương trình từ đầu",
  INSUFFICIENT_DATA: "chưa đủ dữ liệu để kết luận",
};

function buildRagQueries(req: AssessCycleRequest): string[] {
  const decision = req.decision.value;
  const queries: string[] = [];
  if (decision === "PROGRESS") queries.push("nguyên tắc progressive overload tăng tải an toàn và hiệu quả");
  else if (decision === "DELOAD") queries.push("kỹ thuật deload giảm tải khi mệt mỏi tích lũy hoặc hiệu suất giảm");
  else if (decision === "ADJUST") queries.push("điều chỉnh rep range, tần suất, hoặc bài tập khi chững lại (plateau)");
  else if (decision === "REBUILD") queries.push("nguyên tắc periodization xây dựng lại chương trình tập luyện");
  else queries.push("nguyên tắc theo dõi tiến độ tập luyện và RPE/RIR");

  if (req.safetyFlags.length > 0) queries.push("hướng dẫn tập luyện an toàn khi có đau hoặc dấu hiệu chấn thương");
  return queries;
}

function buildAssessmentPrompt(req: AssessCycleRequest, evidenceText: string): string {
  const decision = req.decision.value;
  return `Bạn là một huấn luyện viên thể hình giàu kinh nghiệm. Một hệ thống tính toán (Decision Engine) đã PHÂN TÍCH XONG chu kỳ tập luyện này và đưa ra quyết định — nhiệm vụ của bạn CHỈ là GIẢI THÍCH quyết định đó bằng tiếng Việt dễ hiểu, KHÔNG được tự tính lại số liệu, KHÔNG được đổi quyết định.

QUYẾT ĐỊNH ĐÃ CHỐT (không được thay đổi): "${decision}" (${DECISION_LABEL[decision]})

Nhiệm vụ của bạn:
- Giải thích quyết định trên bằng ngôn ngữ dễ hiểu, dựa trên reasonCodes và computedMetrics bên dưới.
- Liệt kê dữ liệu nào ủng hộ quyết định này (positiveSignals) và dữ liệu nào đáng lưu ý/cảnh báo (warningSignals).
- Nêu rõ dữ liệu còn thiếu nếu có (missingData) — dựa trên dataQuality bên dưới.
- Nếu allowedChanges không rỗng, đề xuất proposedChanges cụ thể, CHỈ dùng các type nằm trong allowedChanges: [${req.allowedChanges.join(", ") || "(không có thay đổi nào được phép — để proposedChanges rỗng)"}].
- Nếu có safetyFlags, PHẢI đưa cảnh báo vào safetyNotice, KHÔNG được đề xuất tăng tải, KHÔNG được khuyên tập xuyên qua chấn thương, KHÔNG được chẩn đoán nguyên nhân — chỉ khuyên dừng bài gây đau và tham khảo chuyên gia y tế/PT phù hợp.
- KHÔNG được bịa citation hay số liệu không có trong dữ liệu bên dưới.
- KHÔNG được đề xuất steroid, hormone, hoặc chất cấm.
- requiresConfirmation LUÔN là true — người dùng phải xác nhận trước khi áp dụng bất kỳ thay đổi nào.

Chỉ trả lời bằng JSON hợp lệ theo ĐÚNG shape sau, không markdown, không giải thích ngoài JSON:
{"decision": "${decision}", "headline": string, "summary": string, "positiveSignals": string[], "warningSignals": string[], "proposedChanges": [{"type": "VOLUME"|"LOAD"|"REPS"|"EXERCISE"|"FREQUENCY"|"DELOAD", "target": string, "currentValue": string, "proposedValue": string, "reason": string}], "missingData": string[], "safetyNotice": string|null, "requiresConfirmation": true}

Dữ liệu chu kỳ:
- Tên: ${req.cycle.name ?? "(không đặt tên)"}, mục tiêu: ${req.cycle.goalType ?? "không rõ"}, chu kỳ số ${req.cycle.cycleIndex}, độ dài ${req.cycle.durationDays} ngày
- confidenceScore: ${req.decision.confidenceScore}, recommendedActionScope: ${req.decision.recommendedActionScope}
- reasonCodes: ${JSON.stringify(req.reasonCodes)}
- safetyFlags: ${JSON.stringify(req.safetyFlags)}
- dataQuality: ${JSON.stringify(req.dataQuality)}
- computedMetrics: ${JSON.stringify(req.computedMetrics)}
- currentPlanSummary: ${JSON.stringify(req.currentPlanSummary ?? {})}

Kiến thức huấn luyện liên quan (tham khảo, không trích dẫn nguồn thủ công — hệ thống tự gắn citation):
${evidenceText}

Câu hỏi của user: Hãy giải thích quyết định "${decision}" cho chu kỳ này dưới dạng JSON theo đúng schema.`;
}

/** Mechanical, non-LLM fallback built directly from the Decision Engine's
 * own reasonCodes/safetyFlags/dataQuality — used when the LLM call fails
 * validation after retries. Still genuinely informative (not a generic
 * "AI unavailable" apology) since reasonCodes are already human-auditable
 * strings from cycle-decision.engine.ts. */
function buildDeterministicFallback(req: AssessCycleRequest): AssessCycleOutput {
  const decision = req.decision.value;
  const criticalFlag = req.safetyFlags.find((f) => f.severity === "critical");
  return {
    decision,
    headline: `Chu kỳ được đánh giá: ${DECISION_LABEL[decision]}`,
    summary:
      "AI không tạo được phần giải thích chi tiết — dưới đây là các lý do được hệ thống tính toán trực tiếp.",
    positiveSignals: req.reasonCodes.filter((c) => !/PAIN|FATIGUE|INSUFFICIENT|DECLIN|CONFLICT/i.test(c)),
    warningSignals: req.reasonCodes.filter((c) => /PAIN|FATIGUE|INSUFFICIENT|DECLIN|CONFLICT/i.test(c)),
    proposedChanges: [],
    missingData: req.dataQuality.qualityFlags,
    safetyNotice: criticalFlag?.message ?? req.safetyFlags[0]?.message ?? null,
    requiresConfirmation: true,
  };
}

export const cycleAssessmentService = {
  async assessCycle(req: AssessCycleRequest): Promise<AssessCycleResult> {
    const queries = buildRagQueries(req);
    const evidenceDocs = await retriever.retrieveEvidence(queries);
    const evidenceText = formatEvidenceForPlanPrompt(evidenceDocs);
    const citations = evidenceUsedFromDocs(evidenceDocs);

    const prompt = buildAssessmentPrompt(req, evidenceText);
    const result = await callLlmJson(prompt, AssessCycleOutputSchema, {
      userId: req.userId,
      phase: "assess-cycle",
      numPredict: 900,
      attempts: 3,
      logPrefix: "[cycle-assessment]",
    });

    const output = result ?? buildDeterministicFallback(req);

    // Belt-and-braces: the Decision Engine's decision is final. Even if the
    // model somehow echoed a different value despite the prompt (and Zod
    // only validates it's ONE of the 6 valid enum values, not that it
    // matches this specific request), force it back.
    if (output.decision !== req.decision.value) {
      logger.warn(
        { llmDecision: output.decision, engineDecision: req.decision.value, userId: req.userId },
        "[cycle-assessment] LLM echoed a different decision than the Decision Engine — overriding with the engine's value",
      );
      output.decision = req.decision.value;
    }

    // requiresConfirmation is a non-negotiable product/safety rule (spec:
    // "luôn yêu cầu user confirmation trước khi áp dụng thay đổi") — not
    // something the model gets to decide. Force true unconditionally,
    // regardless of what the LLM returned.
    if (!output.requiresConfirmation) {
      logger.warn(
        { userId: req.userId },
        "[cycle-assessment] LLM set requiresConfirmation=false — overriding to true (non-negotiable)",
      );
      output.requiresConfirmation = true;
    }

    return { ...output, citations };
  },
};
