import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { z } from "zod";
import { GoalImageSchema } from "./fitness-goal-vision.service";
import { converseVisionTool } from "./bedrock.client";

/**
 * General-purpose "send a photo + a question" vision chat — distinct from
 * fitness-goal-vision.service.ts's single-purpose goal-reference-photo
 * analysis (fixed schema, no question). Added after real user feedback
 * that a plain free-text answer read "too generic" — the model classifies
 * the photo first (equipment / a workout-schedule photo / anything else)
 * and returns fields specific to that case, matching this app's own
 * "structured, not a paragraph" convention elsewhere (Roadmap TDEE
 * breakdown, goal-image attributes).
 *
 * `targetMuscles` intentionally reuses the exact same 7-value vocabulary
 * as GoalVisualAttributesSchema's focusMuscles (frontend's `focusLabels`
 * map covers both) — one vocabulary, not a second one to keep in sync.
 */
export const ImageChatRequestSchema = z.object({
  image: GoalImageSchema,
  question: z.string().max(500).optional(),
}).strict();

const MUSCLE_GROUPS = ["SHOULDERS", "CHEST", "BACK", "ARMS", "LEGS", "GLUTES", "GENERAL"] as const;

// Flat schema (every field present, most nullable/empty depending on
// `type`) rather than a nested oneOf — a local/small vision model is far
// more reliable at filling a flat, always-present shape than correctly
// picking and nesting a schema branch (same lesson as the roadmap-draft
// LLM schema-mismatch fix this session: tool-use JSON-schema forcing
// still needs the *shape* to be simple, not just declared).
const toolSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["EQUIPMENT", "WORKOUT_SCHEDULE", "GENERAL"] },
    answer: { type: "string" },
    equipmentName: { type: ["string", "null"] },
    targetMuscles: { type: "array", items: { type: "string", enum: MUSCLE_GROUPS as unknown as string[] }, maxItems: 7 },
    howToUse: { type: ["string", "null"] },
    safetyNote: { type: ["string", "null"] },
    summary: { type: ["string", "null"] },
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { label: { type: "string" }, exercises: { type: "array", items: { type: "string" } } },
        required: ["label", "exercises"],
      },
    },
  },
  required: ["type", "answer", "targetMuscles", "days"],
};

const FlatResultSchema = z.object({
  type: z.enum(["EQUIPMENT", "WORKOUT_SCHEDULE", "GENERAL"]),
  answer: z.string(),
  equipmentName: z.string().nullable().optional(),
  targetMuscles: z.array(z.enum(MUSCLE_GROUPS)).max(7).default([]),
  howToUse: z.string().nullable().optional(),
  safetyNote: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  days: z.array(z.object({ label: z.string(), exercises: z.array(z.string()) })).default([]),
});

export const ImageChatResultSchema = FlatResultSchema.transform((v) => {
  if (v.type === "EQUIPMENT") {
    return {
      type: "EQUIPMENT" as const,
      equipmentName: v.equipmentName ?? "Không xác định được tên thiết bị",
      targetMuscles: v.targetMuscles,
      howToUse: v.howToUse ?? "",
      safetyNote: v.safetyNote ?? "",
      answer: v.answer,
    };
  }
  if (v.type === "WORKOUT_SCHEDULE") {
    return {
      type: "WORKOUT_SCHEDULE" as const,
      summary: v.summary ?? "",
      days: v.days,
      answer: v.answer,
    };
  }
  return { type: "GENERAL" as const, answer: v.answer };
});
export type ImageChatResult = z.infer<typeof ImageChatResultSchema>;

/** Real numbers only — every field optional, since a user may have no
 * profile/InBody data at all yet. Built from profile_extractor.ts's
 * PersonalizationContext, the same source `/ai/ask`'s orchestrator
 * already uses (confirmed live: that pipeline correctly grounds its
 * answers in this data). Fixes a real bug found live this session: the
 * image-chat route never fetched this at all, so "phân tích thể trạng
 * cho tôi" answers stayed generic even for an account with real InBody
 * history (76.3kg / 16.4% body fat / 35.2kg muscle on file). */
export type ImageChatUserContext = {
  gender?: string | null;
  age?: number | null;
  heightCm?: number | null;
  currentWeightKg?: number | null;
  goal?: string | null;
  activityLevel?: string | null;
  experienceLevel?: string | null;
  bodyFatPct?: number | null;
  muscleMassKg?: number | null;
  inBodyMeasuredAt?: string | null;
};

function describeUserContext(ctx: ImageChatUserContext | undefined): string {
  if (!ctx) return "Không có dữ liệu hồ sơ/InBody nào của người dùng.";
  const lines: string[] = [];
  if (ctx.gender) lines.push(`Giới tính: ${ctx.gender}`);
  if (ctx.age != null) lines.push(`Tuổi: ${ctx.age}`);
  if (ctx.heightCm != null) lines.push(`Chiều cao: ${ctx.heightCm}cm`);
  if (ctx.currentWeightKg != null) lines.push(`Cân nặng hiện tại: ${ctx.currentWeightKg}kg`);
  if (ctx.bodyFatPct != null) lines.push(`Tỷ lệ mỡ (InBody đo thật${ctx.inBodyMeasuredAt ? ` lúc ${ctx.inBodyMeasuredAt}` : ""}): ${ctx.bodyFatPct}%`);
  if (ctx.muscleMassKg != null) lines.push(`Khối cơ (InBody đo thật): ${ctx.muscleMassKg}kg`);
  if (ctx.goal) lines.push(`Mục tiêu đã đặt: ${ctx.goal}`);
  if (ctx.activityLevel) lines.push(`Mức độ vận động: ${ctx.activityLevel}`);
  if (ctx.experienceLevel) lines.push(`Trình độ tập: ${ctx.experienceLevel}`);
  return lines.length > 0
    ? lines.join("; ")
    : "Người dùng chưa có dữ liệu hồ sơ/InBody nào trong hệ thống.";
}

const prompt = (question: string, userContext?: ImageChatUserContext) =>
  `Bạn là AI Coach của Gymini, một trợ lý thể hình. Người dùng gửi 1 ảnh kèm câu hỏi: "${question}".

Dữ liệu THẬT của người dùng hiện có trong hệ thống (LUÔN ưu tiên dùng số liệu này khi so sánh với ảnh, phân tích thể trạng, hoặc lên lộ trình — KHÔNG được tự giả định hay bịa số liệu khi đã có số thật ở đây; chỉ khi mục nào trống thì mới nói rõ là "chưa có dữ liệu" thay vì đoán):
${describeUserContext(userContext)}

Trước tiên xác định ảnh thuộc loại nào:
- EQUIPMENT: ảnh chụp máy tập/dụng cụ gym. Điền equipmentName (tên máy), targetMuscles (nhóm cơ tác động chính, chỉ dùng đúng các giá trị: ${MUSCLE_GROUPS.join(", ")}), howToUse (cách dùng cơ bản, ngắn gọn), safetyNote (lưu ý an toàn — KHÔNG khẳng định máy an toàn/không an toàn cho một người cụ thể, chỉ mô tả chung và gợi ý hỏi nhân viên phòng gym/PT khi dùng lần đầu).
- WORKOUT_SCHEDULE: ảnh chụp lịch tập/giáo án. Điền summary (tóm tắt ngắn) và days (danh sách từng ngày + bài tập ĐỌC ĐƯỢC THẬT từ ảnh — để trống days nếu ảnh không đọc rõ được, TUYỆT ĐỐI không bịa bài tập).
- GENERAL: ảnh khác hoặc không liên quan gym/dinh dưỡng/thể hình.
Luôn điền answer (khoảng 150-250 chữ, đủ ý, không lan man): trả lời TRỰC TIẾP câu hỏi của người dùng, dù ảnh thuộc loại nào, có nhắc tới số liệu thật ở trên nếu liên quan.
TUYỆT ĐỐI không chẩn đoán chấn thương, không đưa lời khuyên y tế, không mô tả đặc điểm cơ thể người trong ảnh. Nếu câu hỏi hoặc ảnh không liên quan gym/dinh dưỡng/thể hình, trả lời type=GENERAL và answer lịch sự từ chối.
Chỉ trả lời qua tool đã cung cấp, không thêm văn bản khác.`;

export const fitnessVisionChatDeps = {
  async analyze(image: z.infer<typeof GoalImageSchema>, question: string, userContext?: ImageChatUserContext): Promise<unknown> {
    const text = prompt(question, userContext);
    if (process.env.LLM_PROVIDER === "bedrock") {
      // Same forced-tool request as the Anthropic branch below, through
      // Bedrock Converse with the Lambda execution role (no API key). The
      // image bytes exist only inside this request — never stored or logged.
      const input = await converseVisionTool({
        image,
        text,
        toolName: "describe_image_chat_result",
        toolDescription: "Structured, type-specific answer about the photo",
        inputSchema: toolSchema,
        maxTokens: 1500,
        timeoutMs: 45000,
      });
      if (input === undefined) throw new Error("Vision returned no result");
      return input;
    }
    if (process.env.ANTHROPIC_API_KEY) {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45000, maxRetries: 0 });
      const response = await client.messages.create({
        model: process.env.GOAL_VISION_MODEL ?? process.env.INBODY_VISION_MODEL ?? "claude-sonnet-4-6",
        // Was 900 — real bug found live: with the added real-data context
        // section in the prompt, a detailed EQUIPMENT/WORKOUT_SCHEDULE
        // response could hit this cap mid-generation, producing an
        // incomplete tool_use payload missing the (required) `answer`
        // field entirely (confirmed: a real 400 "answer: Required" on an
        // account with InBody data, which lengthens the prompt/answer).
        max_tokens: 1500,
        tools: [{ name: "describe_image_chat_result", description: "Structured, type-specific answer about the photo", input_schema: toolSchema as any }],
        tool_choice: { type: "tool", name: "describe_image_chat_result" },
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } }, { type: "text", text }] }],
      });
      const output = response.content.find((b) => b.type === "tool_use");
      if (!output || output.type !== "tool_use") throw new Error("Vision returned no result");
      return output.input;
    }
    if (!process.env.GOAL_VISION_MODEL) throw Object.assign(new Error("Vision unavailable. Please try again later."), { status: 503 });
    const { data } = await axios.post(
      `${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}/api/chat`,
      { model: process.env.GOAL_VISION_MODEL, stream: false, format: toolSchema, messages: [{ role: "user", content: text, images: [image.base64] }], options: { temperature: 0 } },
      { timeout: 45000 },
    );
    return JSON.parse(data.message.content);
  },
};

export async function analyzeImageChat(
  rawImage: unknown,
  question: string | undefined,
  userContext?: ImageChatUserContext,
): Promise<ImageChatResult> {
  const image = GoalImageSchema.parse(rawImage);
  const buffer = Buffer.from(image.base64, "base64");
  const valid = image.mediaType === "image/png"
    ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (!valid || buffer.length > 4 * 1024 * 1024) throw Object.assign(new Error("Upload a JPEG or PNG under 4 MB"), { status: 400 });
  const effectiveQuestion = question?.trim() || "Đây là gì? Hãy phân tích ảnh này.";
  // Raw images are sent only to the configured vision provider; never stored or logged
  // (same discipline as fitness-goal-vision.service.ts).
  return ImageChatResultSchema.parse(await fitnessVisionChatDeps.analyze(image, effectiveQuestion, userContext));
}
