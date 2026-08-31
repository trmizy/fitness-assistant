import { logger } from "@gym-coach/shared";
import { callLlmJson } from "../llm/json_llm_call.util";
import {
  ExplainExerciseProgressionOutputSchema,
  type ExplainExerciseProgressionRequest,
  type ExplainExerciseProgressionOutput,
} from "../schemas/exercise-progression-explanation.schemas";

const STATUS_LABEL: Record<ExplainExerciseProgressionRequest["status"], string> = {
  KEEP: "giữ nguyên mức hiện tại",
  INCREASE_LOAD: "tăng tải",
  INCREASE_REPS: "tăng số rep",
  INCREASE_SETS: "tăng số set",
  DELOAD: "giảm tải để phục hồi",
  REVIEW: "xem lại trước khi thay đổi",
  INSUFFICIENT_DATA: "chưa đủ dữ liệu để kết luận",
};

function buildPrompt(req: ExplainExerciseProgressionRequest): string {
  const level = req.experienceLevel ?? "UNKNOWN";
  return `Bạn là một huấn luyện viên thể hình. Một hệ thống tính toán (deterministic progression engine) đã PHÂN TÍCH XONG bài tập này và đưa ra quyết định — nhiệm vụ của bạn CHỈ là GIẢI THÍCH quyết định đó bằng tiếng Việt tự nhiên, dễ hiểu. TUYỆT ĐỐI KHÔNG được tự đề xuất một quyết định khác, KHÔNG được đổi mức tạ/rep/thời gian mục tiêu, KHÔNG được tính lại số liệu.

QUYẾT ĐỊNH ĐÃ CHỐT (không được thay đổi): "${req.status}" (${STATUS_LABEL[req.status]})
Bài tập: ${req.exerciseName} (chế độ ghi log: ${req.loggingMode})
Trình độ người dùng: ${level}
Hiệu suất hiện tại: ${JSON.stringify(req.currentPerformance)}
Mục tiêu buổi tới (đã tính sẵn, không được đổi): ${JSON.stringify(req.nextTarget)}
Lý do (mã máy, dùng để giải thích, không đọc nguyên văn): ${JSON.stringify(req.reasonCodes)}
Bối cảnh chu kỳ tập hiện tại: ${req.cycleContext}

Chỉ trả lời bằng JSON hợp lệ theo ĐÚNG shape sau, không markdown, không giải thích ngoài JSON, không thêm trường nào khác:
{"explanation": string}

Viết "explanation" thành 1-2 câu tiếng Việt tự nhiên, thân thiện, giải thích TẠI SAO hệ thống đưa ra quyết định "${req.status}" cho bài "${req.exerciseName}", dựa trên hiệu suất và lý do ở trên.`;
}

/** Mechanical, non-LLM fallback built directly from reasonCodes — same
 * "never a generic apology, always genuinely informative" principle as
 * cycle-assessment.service.ts's buildDeterministicFallback. */
function buildDeterministicFallback(req: ExplainExerciseProgressionRequest): ExplainExerciseProgressionOutput {
  const reasons = req.reasonCodes.length > 0 ? req.reasonCodes.join(", ") : "dữ liệu buổi tập gần đây";
  return {
    explanation: `Hệ thống đề xuất "${STATUS_LABEL[req.status]}" cho ${req.exerciseName}, dựa trên: ${reasons}.`,
  };
}

export const exerciseProgressionExplanationService = {
  /**
   * Never throws — always returns a real explanation, from the LLM when
   * available and valid, otherwise the deterministic fallback above. The
   * caller (fitness-service) treats this as a slow, optional enrichment
   * call, never a dependency for the progression decision itself (which is
   * already fully computed and returned by a separate, faster, always-
   * deterministic endpoint — see docs/TRAINING_PROGRESSION_ARCHITECTURE.md
   * §5's "AI unavailable fallback" rule).
   */
  async explain(
    req: ExplainExerciseProgressionRequest,
  ): Promise<{ explanation: string; source: "ai" | "deterministic-fallback" }> {
    const prompt = buildPrompt(req);
    const result = await callLlmJson(prompt, ExplainExerciseProgressionOutputSchema, {
      userId: req.userId,
      phase: "explain-exercise-progression",
      numPredict: 300,
      attempts: 2,
      logPrefix: "[exercise-progression-explanation]",
    });

    if (result) {
      return { explanation: result.explanation, source: "ai" };
    }

    logger.info(
      { userId: req.userId, exerciseName: req.exerciseName },
      "[exercise-progression-explanation] LLM unavailable/invalid — using deterministic fallback",
    );
    return { ...buildDeterministicFallback(req), source: "deterministic-fallback" };
  },
};
