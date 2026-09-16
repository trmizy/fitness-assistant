import { z } from "zod";
import { callLlmJson } from "../llm/json_llm_call.util";

/**
 * "Log bữa ăn qua chat" — same precedent as food-substitution-extractor.ts:
 * WHICH food the user mentions and roughly HOW MUCH is a text-extraction
 * problem (LLM-appropriate), but the real calories/macros logged always
 * come from the real Food catalog search (see fitness-agent-tools.ts's
 * searchFood) — this extractor never invents a nutrition number itself.
 *
 * A cheap keyword gate (isLikelyMealLogMessage) runs first so this never
 * adds an LLM call to unrelated chat messages.
 */

const ExtractionSchema = z.object({
  isMealLogRequest: z.boolean(),
  foodMention: z.string().nullable(),
  quantityMultiplier: z.number().positive().max(20).nullable(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable(),
});
export type MealLogExtraction = z.infer<typeof ExtractionSchema>;

const COMBINING_DIACRITICS_RE = new RegExp("[̀-ͯ]", "g");
function normalizeVietnamese(input: string): string {
  return input
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_RE, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, " ");
}

const KEYWORD_GATE = /\b(vua an|da an|toi an|ghi lai|log|ăn xong)\b/i;

export function isLikelyMealLogMessage(text: string): boolean {
  return KEYWORD_GATE.test(normalizeVietnamese(text));
}

export async function extractMealLogIntent(
  question: string,
  userId: string,
): Promise<MealLogExtraction | null> {
  const prompt = `Người dùng đang chat với AI Coach dinh dưỡng. Xác định xem tin nhắn này có phải là báo/ghi lại một BỮA ĂN đã ăn hay không, và nếu có thì trích xuất thông tin.

Tin nhắn: "${question.replace(/"/g, '\\"')}"

Trả về CHÍNH XÁC một object JSON với các trường:
- isMealLogRequest: true nếu người dùng đang báo họ vừa ăn/đã ăn một món cụ thể và muốn ghi lại, false nếu không phải (ví dụ: chỉ hỏi thông tin, hỏi gợi ý món ăn, hoặc không liên quan).
- foodMention: tên NGUYÊN LIỆU/MÓN ĂN CƠ BẢN, NGẮN NHẤT có thể để tìm trong thư viện món ăn — KHÔNG bao gồm số lượng (ví dụ bỏ "200g", "2 bát") và KHÔNG bao gồm cách chế biến nếu không cần thiết (ví dụ "ức gà luộc" → chỉ ghi "ức gà"; "cơm rang" → giữ "cơm rang" vì đó là tên món riêng). null nếu không rõ món cụ thể nào.
- quantityMultiplier: số lượng ước tính so với 1 phần ăn thông thường (ví dụ "2 bát" = 2, "nửa phần" = 0.5), null nếu không rõ hoặc mặc định 1 phần.
- mealType: một trong "breakfast", "lunch", "dinner", "snack" nếu người dùng có nhắc bữa nào (sáng/trưa/tối/ăn vặt), null nếu không rõ.

Chỉ trả về JSON, không giải thích thêm.`;

  return callLlmJson(prompt, ExtractionSchema, {
    userId,
    phase: "meal-log-extraction",
    numPredict: 200,
    attempts: 2,
    logPrefix: "[meal-log-extractor]",
  });
}
