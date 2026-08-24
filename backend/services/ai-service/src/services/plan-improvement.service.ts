import { logger } from "@gym-coach/shared";
import { callLlmJson } from "../llm/json_llm_call.util";
import {
  GeneratePlanImprovementOutputSchema,
  type GeneratePlanImprovementRequest,
  type GeneratePlanImprovementOutput,
} from "../schemas/plan-improvement.schemas";

function buildPrompt(req: GeneratePlanImprovementRequest): string {
  return `Bạn là chuyên gia phân tích chương trình tập luyện. Một hệ thống RULE-BASED (không dùng AI) đã tính toán XONG điểm chất lượng và thống kê phàn nàn phổ biến của kế hoạch này (qualityScoreResult bên dưới) — nhiệm vụ của bạn CHỈ là ĐỀ XUẤT cải thiện cho người xuất bản (publisher), KHÔNG được tự sửa hay tự xuất bản bất kỳ thay đổi nào.

Nguyên tắc BẮT BUỘC:
- Đề xuất phải dựa trên dữ liệu thực (qualityScoreResult, complaintTags, freeText mẫu) — KHÔNG tự bịa vấn đề không có trong dữ liệu.
- Đây CHỈ là gợi ý — publisher phải tự tạo phiên bản mới (new version) nếu muốn áp dụng, hệ thống không tự động sửa/publish.
- Không đề xuất sao chép chương trình tập thương mại/có bản quyền khác.

Chỉ trả lời bằng JSON hợp lệ theo ĐÚNG shape sau, không markdown:
{"suggestions": string[], "summary": string}

Kế hoạch: "${req.planTitle}" (mục tiêu: ${req.planGoal})
qualityScoreResult (đã tính bằng rule, không phải AI): ${JSON.stringify(req.qualityScoreResult)}
Mẫu phản hồi tự do từ người dùng (tối đa 30, có thể ít hơn): ${JSON.stringify(req.reviewFreeTextSample)}

Hãy đề xuất cải thiện dưới dạng JSON theo đúng schema.`;
}

function buildDeterministicFallback(req: GeneratePlanImprovementRequest): GeneratePlanImprovementOutput {
  const qs = req.qualityScoreResult as any;
  const complaints = Array.isArray(qs?.commonComplaints) ? qs.commonComplaints : [];
  return {
    suggestions:
      complaints.length > 0
        ? complaints.map((c: any) => `Xem xét lại vấn đề "${c.tag}" — được ${c.count} người đánh giá nhắc đến.`)
        : ["AI không tạo được đề xuất chi tiết — hãy tự xem lại các đánh giá gần đây."],
    summary: "Không thể tạo phân tích chi tiết bằng AI lúc này — dưới đây là tóm tắt trực tiếp từ số liệu đã tính.",
  };
}

export const planImprovementService = {
  async generateSuggestions(req: GeneratePlanImprovementRequest): Promise<GeneratePlanImprovementOutput> {
    const prompt = buildPrompt(req);
    const result = await callLlmJson(prompt, GeneratePlanImprovementOutputSchema, {
      userId: req.userId,
      phase: "plan-improvement-suggestion",
      numPredict: 700,
      attempts: 3,
      logPrefix: "[plan-improvement]",
    });
    if (!result) {
      logger.warn({ userId: req.userId }, "[plan-improvement] LLM failed after retries — using deterministic fallback");
    }
    return result ?? buildDeterministicFallback(req);
  },
};
