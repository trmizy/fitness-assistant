import { logger } from "@gym-coach/shared";
import { callLlmJson } from "../llm/json_llm_call.util";
import {
  AnalyzePlanModerationOutputSchema,
  type AnalyzePlanModerationRequest,
  type AnalyzePlanModerationOutput,
} from "../schemas/plan-moderation-analysis.schemas";

/** Deterministic rule flags that are objectively serious enough that the AI
 * must never be allowed to wave them off with a "likely_safe" verdict —
 * belt-and-braces, same rationale as every other override in this codebase
 * (feedback-analysis.service.ts, cycle-decision.engine.ts). A small/local
 * model asked not to do this in the prompt still occasionally does it
 * anyway. */
const SEVERE_RULE_FLAGS = new Set(["NO_REST_DAY", "EXCESSIVE_VOLUME_PER_SESSION", "EMPTY_SCHEDULE"]);

function buildPrompt(req: AnalyzePlanModerationRequest): string {
  return `Bạn là chuyên gia rà soát chất lượng chương trình tập luyện trước khi admin duyệt đăng lên chợ kế hoạch. Một hệ thống RULE-BASED (không dùng AI) đã tính toán XONG các số liệu khách quan bên dưới — nhiệm vụ của bạn CHỈ là ĐỌC HIỂU và GIẢI THÍCH cho admin, KHÔNG được tự quyết định duyệt hay từ chối (đó là việc của admin).

Nguyên tắc BẮT BUỘC:
- Chỉ nhận xét dựa trên computedStats/ruleFlags/daySummaries bên dưới — KHÔNG tự bịa vấn đề không có trong dữ liệu.
- Nếu ruleFlags có cờ nghiêm trọng (vd: NO_REST_DAY, EXCESSIVE_VOLUME_PER_SESSION), recommendation KHÔNG được là "likely_safe".
- confidenceScore thấp khi dữ liệu ít/mơ hồ, đừng tự tin thái quá.
- similarListings cho biết kế hoạch này có thể trùng lặp với kế hoạch khác đã có — nếu similarityScore cao, hãy nhắc admin kiểm tra khả năng trùng lặp trong explanationForAdmin.
- Đây KHÔNG phải chẩn đoán y khoa — chỉ là rà soát cấu trúc chương trình tập.

Chỉ trả lời bằng JSON hợp lệ theo ĐÚNG shape sau, không markdown:
{"concerns": string[], "confidenceScore": number (0-1), "recommendation": "likely_safe"|"needs_review"|"likely_unsafe", "explanationForAdmin": string}

Kế hoạch: "${req.planTitle}" (mục tiêu: ${req.planGoal})
computedStats: ${JSON.stringify(req.computedStats)}
ruleFlags: ${JSON.stringify(req.ruleFlags)}
similarListings: ${JSON.stringify(req.similarListings)}
Tóm tắt từng buổi tập:
${req.daySummaries.join("\n")}

Hãy đưa ra báo cáo dưới dạng JSON theo đúng schema.`;
}

function buildDeterministicFallback(req: AnalyzePlanModerationRequest): AnalyzePlanModerationOutput {
  const hasSevereFlag = req.ruleFlags.some((f) => SEVERE_RULE_FLAGS.has(f));
  return {
    concerns: req.ruleFlags,
    confidenceScore: 0.3,
    recommendation: hasSevereFlag ? "likely_unsafe" : req.ruleFlags.length > 0 ? "needs_review" : "needs_review",
    explanationForAdmin:
      "AI không tạo được báo cáo chi tiết — đây là danh sách cờ cảnh báo được hệ thống tính toán trực tiếp (rule-based), admin cần tự xem lại nội dung kế hoạch trước khi duyệt.",
  };
}

export const planModerationAnalysisService = {
  async analyze(req: AnalyzePlanModerationRequest): Promise<AnalyzePlanModerationOutput & { usedFallback: boolean }> {
    const prompt = buildPrompt(req);
    const result = await callLlmJson(prompt, AnalyzePlanModerationOutputSchema, {
      userId: req.userId,
      phase: "plan-moderation-analysis",
      numPredict: 700,
      attempts: 3,
      logPrefix: "[plan-moderation-analysis]",
    });

    const output = result ?? buildDeterministicFallback(req);

    // Belt-and-braces: a severe deterministic rule flag can never be
    // reported to the admin as "likely_safe", regardless of what the model
    // concluded.
    const hasSevereFlag = req.ruleFlags.some((f) => SEVERE_RULE_FLAGS.has(f));
    if (hasSevereFlag && output.recommendation === "likely_safe") {
      logger.warn(
        { userId: req.userId, ruleFlags: req.ruleFlags },
        "[plan-moderation-analysis] severe rule flag present — overriding likely_safe recommendation",
      );
      output.recommendation = "needs_review";
    }

    // High-similarity duplicate is also a hard signal worth surfacing even
    // if the model didn't mention it.
    const highSimilarity = req.similarListings.some((s) => s.similarityScore >= 0.8);
    if (highSimilarity && !output.concerns.some((c) => /trùng|giống|duplicate|similar/i.test(c))) {
      output.concerns = [...output.concerns, "Nội dung có khả năng trùng lặp cao với một kế hoạch đã đăng khác."];
    }

    return { ...output, usedFallback: result === null };
  },
};
