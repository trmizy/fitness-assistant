/**
 * V2.3A.6 read-only audit utility. Reproduces interpreter.ts's buildPrompt()
 * output verbatim (it is a pure, non-exported string template with no side
 * effects -- copied here exactly as written, never executed in place of or
 * instead of the real function) and feeds it through the REAL, UNMODIFIED,
 * EXPORTED buildOllamaMessages() from llm.service.ts to empirically confirm
 * the role-split behavior. Does not import/execute/modify any production
 * module beyond importing the one exported pure function under test.
 */
import { buildOllamaMessages } from "../../../backend/services/ai-service/src/services/llm.service";

// Verbatim copy of interpreter.ts's buildPrompt() body (lines 110-122 at
// audit time) -- reproduced for inspection only, not re-exported or reused
// anywhere else.
function buildPromptCopy(text: string, expectedSlot?: string | null): string {
  return [
    "Bạn là bộ phân tích ngữ nghĩa cho một trợ lý thể hình tiếng Việt. CHỈ trả về một JSON object, không giải thích.",
    "Nhiệm vụ: đọc MỘT tin nhắn của người dùng và trích xuất ý định + dữ kiện. Không tự bịa số; mọi giá trị phải xuất hiện trong tin nhắn.",
    "Quy tắc đơn vị: '1m73' hoặc '173cm' là HEIGHT_CM=173 (KHÔNG BAO GIỜ là cân nặng). '80kg' là WEIGHT_KG (cân hiện tại) trừ khi câu nói đó là mục tiêu, khi đó là TARGET_WEIGHT_KG.",
    "primaryIntent ∈ ANSWER_QUESTION|START_WORKFLOW|PROVIDE_INFORMATION|CORRECT_INFORMATION|ASK_RECOMMENDATION|CONFIRM|DISMISS|UNKNOWN. ASK_RECOMMENDATION = người dùng nhờ trợ lý tự đề xuất/chọn giúp.",
    "entities: mảng {type,value,sourceText,negated?}; type ∈ HEIGHT_CM|WEIGHT_KG|TARGET_WEIGHT_KG|AGE|SESSIONS_PER_WEEK|SESSION_MINUTES|MEALS_PER_DAY|BUDGET_VND. negated=true nếu người dùng PHỦ ĐỊNH giá trị đó.",
    "goalSignals: mảng {goal,strength,negatesGoal?,sourceText}; goal ∈ WEIGHT_LOSS|MUSCLE_GAIN|MAINTENANCE|ATHLETIC_PERFORMANCE; strength ∈ EXPLICIT|IMPLICIT.",
    expectedSlot ? `Trợ lý vừa hỏi về ô: ${expectedSlot}.` : "",
    `Tin nhắn: """${text.slice(0, 500)}"""`,
    'Ví dụ đầu ra: {"primaryIntent":"PROVIDE_INFORMATION","entities":[{"type":"HEIGHT_CM","value":173,"sourceText":"1m73"}],"goalSignals":[],"asksRecommendation":false,"isCorrection":false}',
  ].filter(Boolean).join("\n");
}

const sampleMessage = "Đổi giúp tôi PT này đi.";
const prompt = buildPromptCopy(sampleMessage, null);

console.log("=== Reconstructed buildPrompt() output ===");
console.log(prompt);
console.log("\n=== Contains 'Câu hỏi của user:' marker? ===");
console.log(prompt.includes("Câu hỏi của user:"));

console.log("\n=== Real buildOllamaMessages() result ===");
const messages = buildOllamaMessages(prompt);
console.log(JSON.stringify(messages, null, 2));

console.log("\n=== Summary ===");
console.log("message count:", messages.length);
console.log("roles:", messages.map((m) => m.role));
console.log("system role present:", messages.some((m) => m.role === "system"));
console.log("user role present:", messages.some((m) => m.role === "user"));
