import { logger } from "@gym-coach/shared";
import { retriever } from "../llm/retriever";
import { callLlmJson } from "../llm/json_llm_call.util";
import { evidenceUsedFromDocs, formatEvidenceForPlanPrompt } from "../llm/plan_evidence";
import {
  AnalyzeFeedbackOutputSchema,
  type AnalyzeFeedbackRequest,
  type AnalyzeFeedbackOutput,
} from "../schemas/feedback-analysis.schemas";
import type { EvidenceUsed } from "../llm/types";

export interface AnalyzeFeedbackResult extends AnalyzeFeedbackOutput {
  citations: EvidenceUsed[];
  /** true when the LLM call never returned valid JSON after retries and the
   * deterministic (rule-only) template was used instead — callers should
   * treat a fallback analysis with lower confidence than a real LLM read. */
  usedFallback: boolean;
}

/** Fields cycle-feedback-aggregator.ts guarantees exist on
 * cycleFeedbackSummary — read defensively since it arrives as
 * z.record(unknown) over the wire (the request schema doesn't re-declare
 * the aggregator's full shape, to avoid two copies of ~30 fields drifting
 * apart; correctness of the summary itself is the aggregator's job, already
 * covered by cycle-feedback-aggregator.test.ts). */
function readSummary(summary: Record<string, unknown>) {
  return {
    feedbackSubmittedCount: Number(summary.feedbackSubmittedCount ?? 0),
    dataQualityScore: Number(summary.dataQualityScore ?? 0),
    feedbackSentimentByRules: String(summary.feedbackSentimentByRules ?? "insufficient_feedback"),
    safetyFlags: Array.isArray(summary.safetyFlags) ? (summary.safetyFlags as string[]) : [],
    sessionsMarkedTooHard: Number(summary.sessionsMarkedTooHard ?? 0),
    sessionsMarkedTooEasy: Number(summary.sessionsMarkedTooEasy ?? 0),
    averagePain: summary.averagePain == null ? null : Number(summary.averagePain),
  };
}

function buildFeedbackAnalysisPrompt(req: AnalyzeFeedbackRequest, evidenceText: string): string {
  const level = req.cycle.experienceLevel ?? "UNKNOWN";
  const isBeginner = level === "BEGINNER" || level === "UNKNOWN";
  const isProfessional = level === "ADVANCED" && req.cycle.competesInSport === true;
  const levelGuidance = isBeginner
    ? "Người dùng ở trình độ MỚI BẮT ĐẦU. Đừng vội kết luận phàn nàn là do chương trình sai — người mới thường đánh giá 'quá nặng' ngay cả khi tải phù hợp; hãy đối chiếu với dữ liệu thực tế trước khi validate phàn nàn."
    : isProfessional
      ? "Người dùng là VẬN ĐỘNG VIÊN THI ĐẤU. Yêu cầu chất lượng dữ liệu cao hơn trước khi coi một phàn nàn là supported_by_data — nếu dữ liệu mỏng, dùng insufficient_data thay vì kết luận mạnh."
      : "Người dùng ở trình độ trung bình/nâng cao — có thể đối chiếu phàn nàn với xu hướng metrics chi tiết hơn.";

  return `Bạn là một chuyên gia phân tích phản hồi tập luyện. Một hệ thống RULE-BASED (không dùng AI) đã tính toán XONG toàn bộ số liệu tổng hợp phản hồi của chu kỳ này (cycleFeedbackSummary bên dưới) — nhiệm vụ của bạn CHỈ là DIỄN GIẢI, KHÔNG được tự bịa số liệu, KHÔNG được tự tính lại các con số.

${levelGuidance}

Nguyên tắc BẮT BUỘC:
- Phản hồi của user (vd: "buổi tập quá nặng") KHÔNG được tự động coi là đúng tuyệt đối. Hãy đối chiếu với computedMetrics/cycleFeedbackSummary thực tế trước khi kết luận complaintValidity.
- complaintValidity: "supported_by_data" chỉ khi có bằng chứng số liệu rõ ràng ủng hộ; "partially_supported" khi có một phần bằng chứng; "not_supported" khi số liệu mâu thuẫn với phàn nàn; "insufficient_data" khi feedbackSubmittedCount hoặc dataQualityScore quá thấp để kết luận.
- Nếu dữ liệu còn ít (feedbackSubmittedCount thấp, dataQualityScore thấp), TUYỆT ĐỐI KHÔNG kết luận mạnh — dùng sentiment/complaintValidity phản ánh sự không chắc chắn, và recommendedDecisionInfluence = "none".
- Nếu sentiment tổng thể là positive NHƯNG có báo cáo đau nhiều (safetyFlags chứa HIGH_PAIN_REPORTED hoặc averagePain cao), PHẢI đưa cảnh báo an toàn vào riskFlags — không được bỏ qua chỉ vì cảm nhận chung là tích cực.
- recommendedDecisionInfluence là GỢI Ý duy nhất — hệ thống quyết định cuối cùng vẫn do Decision Engine (rule-based) quyết định, không phải bạn. Không dùng "deload"/"rebuild_consideration" trừ khi có bằng chứng rõ ràng (đau nhiều, phàn nàn "quá nặng" lặp lại kèm dữ liệu ủng hộ).
- explanationForUser: ngôn ngữ đơn giản, ngắn gọn, không thuật ngữ kỹ thuật, tối đa vài câu.
- explanationForCoach: chi tiết hơn, có thể dùng thuật ngữ chuyên môn, nêu rõ căn cứ số liệu.
- KHÔNG chẩn đoán y khoa, KHÔNG đề xuất thuốc/chất cấm.

Chỉ trả lời bằng JSON hợp lệ theo ĐÚNG shape sau, không markdown, không giải thích ngoài JSON:
{"feedbackInterpretation": string, "sentiment": "positive"|"negative"|"neutral"|"mixed"|"insufficient_feedback", "complaintValidity": "supported_by_data"|"partially_supported"|"not_supported"|"insufficient_data", "complaintCategories": string[] (chỉ dùng: too_hard, too_easy, pain_or_injury_risk, equipment_mismatch, boredom_or_motivation, schedule_conflict, exercise_selection, plan_clarity, progress_dissatisfaction, other), "suggestedImprovementAreas": string[], "riskFlags": string[], "recommendedDecisionInfluence": "none"|"minor_adjust"|"adjust"|"deload"|"rebuild_consideration", "explanationForUser": string, "explanationForCoach": string}

Dữ liệu chu kỳ:
- Tên: ${req.cycle.name ?? "(không đặt tên)"}, mục tiêu: ${req.cycle.goalType ?? "không rõ"}, trình độ: ${level}${req.cycle.competesInSport ? " (competesInSport=true)" : ""}
- cycleFeedbackSummary (đã tính bằng rule, không phải AI): ${JSON.stringify(req.cycleFeedbackSummary)}
- computedMetrics (nếu có): ${JSON.stringify(req.computedMetrics ?? {})}
- currentDecision (nếu Decision Engine đã chạy): ${JSON.stringify(req.currentDecision ?? {})}

Kiến thức huấn luyện liên quan (tham khảo, hệ thống tự gắn citation):
${evidenceText}

Hãy phân tích phản hồi của chu kỳ này dưới dạng JSON theo đúng schema.`;
}

/** Mechanical, non-LLM fallback built directly from the rule-computed
 * cycleFeedbackSummary — used when the LLM call fails validation after
 * retries. Deliberately conservative: never asserts a complaint is
 * supported_by_data without the LLM's cross-check, so it always reports
 * insufficient_data/none rather than guessing. */
function buildDeterministicFallback(req: AnalyzeFeedbackRequest): AnalyzeFeedbackOutput {
  const s = readSummary(req.cycleFeedbackSummary);
  const riskFlags: string[] = [...s.safetyFlags];
  if (s.feedbackSentimentByRules === "positive" && (s.safetyFlags.includes("HIGH_PAIN_REPORTED") || (s.averagePain ?? 0) >= 7)) {
    riskFlags.push("POSITIVE_FEEDBACK_BUT_HIGH_PAIN");
  }
  const sentiment = (["positive", "negative", "neutral", "mixed", "insufficient_feedback"] as const).includes(
    s.feedbackSentimentByRules as any,
  )
    ? (s.feedbackSentimentByRules as AnalyzeFeedbackOutput["sentiment"])
    : "insufficient_feedback";

  return {
    feedbackInterpretation:
      "AI không tạo được phần diễn giải chi tiết — dưới đây là tóm tắt trực tiếp từ số liệu đã tính (rule-based), chưa qua phân tích AI.",
    sentiment,
    complaintValidity: s.feedbackSubmittedCount < 2 ? "insufficient_data" : "partially_supported",
    complaintCategories: [],
    suggestedImprovementAreas: [],
    riskFlags,
    recommendedDecisionInfluence: "none",
    explanationForUser: "Chưa thể tạo giải thích chi tiết lúc này. Số liệu phản hồi của bạn đã được ghi nhận.",
    explanationForCoach:
      `feedbackSubmittedCount=${s.feedbackSubmittedCount}, dataQualityScore=${s.dataQualityScore}, sentimentByRules=${s.feedbackSentimentByRules}. AI diễn giải thất bại — cần xem trực tiếp cycleFeedbackSummary.`,
  };
}

export const feedbackAnalysisService = {
  async analyzeFeedback(req: AnalyzeFeedbackRequest): Promise<AnalyzeFeedbackResult> {
    const s = readSummary(req.cycleFeedbackSummary);

    const queries: string[] = ["nguyên tắc lắng nghe phản hồi người tập và điều chỉnh chương trình dựa trên RPE/cảm nhận"];
    if (s.safetyFlags.length > 0 || (s.averagePain ?? 0) >= 5) {
      queries.push("hướng dẫn xử lý khi người tập báo cáo đau trong quá trình tập luyện");
    }
    const evidenceDocs = await retriever.retrieveEvidence(queries);
    const evidenceText = formatEvidenceForPlanPrompt(evidenceDocs);
    const citations = evidenceUsedFromDocs(evidenceDocs);

    const prompt = buildFeedbackAnalysisPrompt(req, evidenceText);
    const result = await callLlmJson(prompt, AnalyzeFeedbackOutputSchema, {
      userId: req.userId,
      phase: "analyze-feedback",
      numPredict: 800,
      attempts: 3,
      logPrefix: "[feedback-analysis]",
    });

    const output = result ?? buildDeterministicFallback(req);

    // Belt-and-braces #1: never let a low-data-quality analysis conclude
    // strongly. The prompt asks for this, but a small/local model doesn't
    // reliably self-police numeric thresholds — enforce it server-side.
    const lowData = s.feedbackSubmittedCount < 2 || s.dataQualityScore < 0.34;
    if (lowData) {
      if (output.complaintValidity !== "insufficient_data") {
        logger.warn(
          { userId: req.userId, feedbackSubmittedCount: s.feedbackSubmittedCount, dataQualityScore: s.dataQualityScore },
          "[feedback-analysis] low feedback data quality — overriding complaintValidity to insufficient_data",
        );
        output.complaintValidity = "insufficient_data";
      }
      if (output.recommendedDecisionInfluence !== "none") {
        logger.warn(
          { userId: req.userId },
          "[feedback-analysis] low feedback data quality — overriding recommendedDecisionInfluence to none",
        );
        output.recommendedDecisionInfluence = "none";
      }
    }

    // Belt-and-braces #2: an unsupported/not-validated complaint must never
    // drive a real decision change on its own.
    if (
      (output.complaintValidity === "not_supported" || output.complaintValidity === "insufficient_data") &&
      output.recommendedDecisionInfluence !== "none"
    ) {
      logger.warn(
        { userId: req.userId, complaintValidity: output.complaintValidity, llmInfluence: output.recommendedDecisionInfluence },
        "[feedback-analysis] complaint not supported by data — forcing recommendedDecisionInfluence to none",
      );
      output.recommendedDecisionInfluence = "none";
    }

    // Belt-and-braces #3: positive sentiment must never silently swallow a
    // real pain signal — force the risk flag even if the model missed it.
    const highPain = s.safetyFlags.includes("HIGH_PAIN_REPORTED") || (s.averagePain ?? 0) >= 7;
    if (output.sentiment === "positive" && highPain && !output.riskFlags.includes("POSITIVE_FEEDBACK_BUT_HIGH_PAIN")) {
      logger.warn({ userId: req.userId }, "[feedback-analysis] positive sentiment with high pain — forcing risk flag");
      output.riskFlags = [...output.riskFlags, "POSITIVE_FEEDBACK_BUT_HIGH_PAIN"];
    }

    // Belt-and-braces #4: rebuild_consideration is a large, expensive
    // action — never accept it from the model when the underlying rule-
    // based sentiment isn't itself negative/mixed. Downgrade rather than
    // drop entirely, so a genuinely strong signal still reaches "adjust".
    if (output.recommendedDecisionInfluence === "rebuild_consideration" && s.feedbackSentimentByRules !== "negative") {
      logger.warn(
        { userId: req.userId, ruleSentiment: s.feedbackSentimentByRules },
        "[feedback-analysis] rebuild_consideration without rule-confirmed negative sentiment — downgrading to adjust",
      );
      output.recommendedDecisionInfluence = "adjust";
    }

    return { ...output, citations, usedFallback: result === null };
  },
};
