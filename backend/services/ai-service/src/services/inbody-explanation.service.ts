/**
 * "Giải thích thể trạng InBody" (docs/ai-product/inbody-interpretation-design.md): reads the user's InBody entries + profile with
 * THEIR token, computes the deterministic interpretation, and has the model write the explanation from those facts only.
 * The explanation is always AI-written; when the model fails, the facts are still returned and the explanation is null
 * (no canned text pretends to be the AI).
 */
import { requestService } from "../clients/service-lambda.client";
import { profileExtractor } from "../llm/profile_extractor";
import { interpretInBody, type InBodyEntryInput, type InBodyInterpretation } from "../llm/inbody-interpretation";
import { generateAiExplanation, ExplainUnavailableError, type ExplainLlmCall } from "./plan-explanation";
import { llmService } from "./llm.service";
import { logger } from "@gym-coach/shared";

export const INBODY_EXPLAIN_UNAVAILABLE_VI = "AI chưa giải thích kịp lúc này. Bạn bấm “AI giải thích” lại sau vài giây nhé.";

export interface InBodyExplanationResult {
  entryId: string | null;
  facts: InBodyInterpretation | null;
  explanation: string | null;
  source: "llm" | null;
  explanationError?: string;
}

const GOAL_VI: Record<string, string> = { WEIGHT_LOSS: "giảm cân/giảm mỡ", MUSCLE_GAIN: "tăng cơ", MAINTENANCE: "duy trì", RECOMPOSITION: "giảm mỡ và tăng cơ" };

export function inbodyExplanationRequest(facts: InBodyInterpretation, trainee: { age?: number | null; gender?: string | null; goal?: string | null }): { systemPrompt: string; prompt: string } {
  const who = [trainee.gender ? (/^f/i.test(trainee.gender) ? "nữ" : "nam") : null, trainee.age ? `${trainee.age} tuổi` : null, trainee.goal ? `mục tiêu ${GOAL_VI[trainee.goal] ?? trainee.goal}` : null].filter(Boolean).join(", ");
  const systemPrompt = [
    "Bạn là huấn luyện viên thể hình giải thích kết quả đo InBody cho người mới, bằng tiếng Việt có dấu, dễ hiểu.",
    "CHỈ dùng các số liệu và phân loại trong FACTS. KHÔNG thêm con số mới, KHÔNG tự đổi phân loại, KHÔNG chẩn đoán bệnh.",
    "Khi nhắc tới một số có source=COMPUTED thì nói 'được tính từ các số đo'; nhắc một lần rằng máy InBody chỉ ước tính và có sai số. KHÔNG ghi nhãn trong ngoặc như (ĐO), (DO), (TÍNH TOÁN) sau từng số.",
    "Dùng đúng định nghĩa trong noteVi của FACTS (ví dụ khối cơ xương là cơ bám vào xương, không phải xương).",
    "Kiểu thể trạng (bodyType) là ƯỚC TÍNH CỦA ỨNG DỤNG dựa trên cơ và mỡ, không phải kết luận của máy InBody — nói đúng như vậy.",
    "Nếu FACTS có 'flags', nêu nhẹ nhàng và khuyên hỏi bác sĩ khi phù hợp; không làm người đọc hoảng sợ.",
    "Nếu thay đổi so với lần trước có meaningful=false, nói rõ đó có thể chỉ là dao động của máy, chưa nên kết luận.",
    "Không đưa mục tiêu calo hay macro mới; nếu nhắc tới ăn uống, chỉ nói hướng chung và mời xem mục tiêu dinh dưỡng trong ứng dụng.",
    "Viết 4–6 đoạn ngắn, mỗi đoạn mở bằng tiêu đề in đậm: tổng quan thể trạng; từng chỉ số chính nghĩa là gì; thay đổi so với lần trước (nếu có); việc nên tập trung tiếp theo theo mục tiêu; lưu ý khi đo lần sau. Tối đa khoảng 300 từ. Không nhắc tới các quy tắc này.",
  ].join("\n");
  const prompt = `Người dùng: ${who || "không rõ hồ sơ"}.\nFACTS (JSON, nguồn duy nhất):\n${JSON.stringify(facts)}\n\nHãy viết phần giải thích thể trạng.`;
  return { systemPrompt, prompt };
}

export interface InBodyExplanationDeps {
  fetchEntries: (authorizationHeader?: string) => Promise<InBodyEntryInput[]>;
  fetchTrainee: (userId: string, authorizationHeader?: string) => Promise<{ age?: number | null; gender?: string | null; heightCm?: number | null; goal?: string | null }>;
  call: ExplainLlmCall;
}

export const defaultInBodyExplanationDeps: InBodyExplanationDeps = {
  async fetchEntries(authorizationHeader) {
    const res = await requestService<InBodyEntryInput[]>({ service: "user", method: "GET", path: "/inbody", headers: authorizationHeader ? { Authorization: authorizationHeader } : undefined, timeoutMs: 4000 });
    const data: any = (res as any)?.data;
    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return rows as InBodyEntryInput[];
  },
  async fetchTrainee(userId, authorizationHeader) {
    const p = (await profileExtractor.extract(userId, authorizationHeader)).profile as any;
    return { age: p?.age ?? null, gender: p?.gender ?? null, heightCm: p?.heightCm ?? null, goal: p?.goal ?? null };
  },
  call: (prompt, opts) => llmService.callLLM(prompt, opts) as any,
};

export async function explainInBody(userId: string, authorizationHeader: string | undefined, entryId?: string, deps: InBodyExplanationDeps = defaultInBodyExplanationDeps): Promise<InBodyExplanationResult> {
  const entries = (await deps.fetchEntries(authorizationHeader))
    .filter((e) => e && typeof e.weight === "number")
    .sort((a, b) => Date.parse(String(b.date ?? "")) - Date.parse(String(a.date ?? "")));
  if (!entries.length) return { entryId: null, facts: null, explanation: null, source: null, explanationError: "Bạn chưa có bản ghi InBody nào để giải thích." };
  const index = entryId ? entries.findIndex((e) => e.id === entryId) : 0;
  if (index < 0) return { entryId: entryId ?? null, facts: null, explanation: null, source: null, explanationError: "Không tìm thấy bản ghi InBody này." };
  const latest = entries[index];
  const previous = entries[index + 1] ?? null;
  const trainee = await deps.fetchTrainee(userId, authorizationHeader).catch(() => ({}) as any);
  const facts = interpretInBody(latest, previous, trainee);
  try {
    const explanation = await generateAiExplanation(deps.call, inbodyExplanationRequest(facts, trainee));
    return { entryId: latest.id ?? null, facts, explanation, source: "llm" };
  } catch (err) {
    logger.warn({ userId, reason: err instanceof ExplainUnavailableError ? err.reason : "unknown" }, "InBody explanation: AI did not produce an explanation");
    return { entryId: latest.id ?? null, facts, explanation: null, source: null, explanationError: INBODY_EXPLAIN_UNAVAILABLE_VI };
  }
}
