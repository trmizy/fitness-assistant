import { z } from "zod";
import { callLlmJson } from "../llm/json_llm_call.util";

/**
 * AI Coach nutrition actions (2026-09-07, docs/agentic-fitness/
 * 01_NUTRITION_AGENT_TOOLS_PLAN.md) — the concrete example: "tôi muốn ăn cá
 * hồi thay ức gà vào buổi nào đó". fitness-agent-intent.ts's
 * parseFitnessAgentIntent is deliberately closed-set regex (PT/PROGRAM/
 * SELECT only, explicit "never inferred by a model" for RANKING/
 * PRESCRIPTION/ACTION EXECUTION) — but which two food names a free-form
 * Vietnamese sentence mentions is a text-extraction problem, not a
 * ranking/prescription/execution decision, so it follows the SAME
 * precedent already established for structured LLM extraction elsewhere in
 * this service (cycle-assessment.service.ts's callLlmJson usage): the
 * model extracts MENTIONS only, never decides anything nutritional. The
 * actual substitute (which real catalog food, what quantity, whether it's
 * calorie-equivalent) is 100% nutrition-food-substitution.engine.ts,
 * unchanged — this extractor never sees or influences that math.
 *
 * A cheap keyword gate (isLikelyFoodSubstitutionMessage) runs BEFORE this
 * to avoid an LLM call on every chat message; only messages that already
 * look like a substitution request reach here.
 */

const ExtractionSchema = z.object({
  isFoodSubstitutionRequest: z.boolean(),
  currentFoodMention: z.string().nullable(),
  desiredFoodMention: z.string().nullable(),
  mealHint: z.string().nullable(),
});
export type FoodSubstitutionExtraction = z.infer<typeof ExtractionSchema>;

// Found while testing (2026-09-07): JS regex `\b` only recognizes ASCII
// [A-Za-z0-9_] as "word" characters — Vietnamese diacritic letters like
// "đ"/"ổ" fall outside \w, so `\bđổi\b` silently fails to match "đổi" at
// the start of a string or next to whitespace/punctuation (both sides of
// the boundary end up \W, so no transition is ever detected). Matching
// against a diacritic-stripped, lowercased copy of the text instead — same
// normalizeVietnamese technique fitness-service already uses everywhere
// for Vietnamese text matching — makes \b behave correctly again, since
// the normalized string is plain ASCII.
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

const KEYWORD_GATE = /\b(thay|doi|swap|substitute)\b/i;

/** Cheap pre-filter — regex only, no LLM call. Not a claim of correctness
 * on its own (a false positive just means one wasted LLM call that then
 * returns isFoodSubstitutionRequest=false; a false negative here would
 * incorrectly skip a real request, so this stays intentionally broad). */
export function isLikelyFoodSubstitutionMessage(text: string): boolean {
  return KEYWORD_GATE.test(normalizeVietnamese(text));
}

export async function extractFoodSubstitutionIntent(
  question: string,
  userId: string,
): Promise<FoodSubstitutionExtraction | null> {
  const prompt = `Người dùng đang chat với AI Coach dinh dưỡng. Xác định xem tin nhắn này có phải yêu cầu ĐỔI MÓN ĂN trong thực đơn hiện tại hay không, và nếu có thì trích xuất tên món.

Tin nhắn: "${question.replace(/"/g, '\\"')}"

Trả về CHÍNH XÁC một object JSON với các trường:
- isFoodSubstitutionRequest: true nếu đây là yêu cầu đổi một món ăn cụ thể trong thực đơn thành món khác, false nếu không phải (ví dụ: chỉ hỏi thông tin, hỏi về PT, hỏi về chương trình tập, hoặc không liên quan đến đổi món).
- currentFoodMention: tên món ĂN HIỆN TẠI người dùng muốn đổi (ví dụ "ức gà"), null nếu không rõ.
- desiredFoodMention: tên món MUỐN ĐỔI SANG nếu người dùng nói rõ (ví dụ "cá hồi"), null nếu người dùng chỉ muốn đổi món mà không chỉ định món thay thế cụ thể.
- mealHint: gợi ý về bữa nào (ví dụ "bữa trưa", "bữa tối", "ngày 2") nếu có được nhắc tới, null nếu không có.

Chỉ trả về JSON, không giải thích thêm.`;

  return callLlmJson(prompt, ExtractionSchema, {
    userId,
    phase: "food-substitution-extraction",
    numPredict: 200,
    attempts: 2,
    logPrefix: "[food-substitution-extractor]",
  });
}
