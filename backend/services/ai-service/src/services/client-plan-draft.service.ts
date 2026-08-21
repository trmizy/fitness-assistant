import { logger } from "@gym-coach/shared";
import { callLlmJson } from "../llm/json_llm_call.util";
import {
  GenerateClientPlanDraftOutputSchema,
  type GenerateClientPlanDraftRequest,
  type GenerateClientPlanDraftOutput,
} from "../schemas/client-plan-draft.schemas";

// Exercise.bodyPart is the coarse BodyPart enum (UPPER_BODY | LOWER_BODY |
// CORE | FULL_BODY — see fitness-service/prisma/schema.prisma). Any
// reported injury also excludes FULL_BODY exercises, since those
// necessarily load every region including an injured one.
const INJURY_KEYWORD_TO_BODYPART: Record<string, string[]> = {
  back: ["CORE", "LOWER_BODY"],
  spine: ["CORE", "LOWER_BODY"],
  knee: ["LOWER_BODY"],
  hip: ["LOWER_BODY"],
  shoulder: ["UPPER_BODY"],
  wrist: ["UPPER_BODY"],
  elbow: ["UPPER_BODY"],
  neck: ["UPPER_BODY"],
  ankle: ["LOWER_BODY"],
};

/** Deliberately conservative, deterministic pre-filter — removes any
 * catalog exercise whose bodyPart plausibly loads a reported injury area,
 * BEFORE the model ever sees it. This is belt-and-braces: the prompt also
 * instructs the model to avoid these, but a small/local model can't be
 * trusted to reliably self-police this on its own (same rationale as every
 * other belt-and-braces filter in this codebase — see cycle-assessment and
 * feedback-analysis services). */
function filterExercisesForInjuries(
  exercises: GenerateClientPlanDraftRequest["allowedExercises"],
  injuries: string[],
): { safe: GenerateClientPlanDraftRequest["allowedExercises"]; excludedBodyParts: Set<string> } {
  if (injuries.length === 0) return { safe: exercises, excludedBodyParts: new Set() };
  const excludedBodyParts = new Set<string>();
  for (const injury of injuries) {
    const lower = injury.toLowerCase();
    for (const [keyword, bodyParts] of Object.entries(INJURY_KEYWORD_TO_BODYPART)) {
      if (lower.includes(keyword)) bodyParts.forEach((bp) => excludedBodyParts.add(bp));
    }
  }
  if (excludedBodyParts.size === 0) return { safe: exercises, excludedBodyParts };
  excludedBodyParts.add("FULL_BODY"); // any injury excludes whole-body exercises too
  const safe = exercises.filter((e) => !e.bodyPart || !excludedBodyParts.has(e.bodyPart.toUpperCase()));
  return { safe, excludedBodyParts };
}

function buildDraftPrompt(
  req: GenerateClientPlanDraftRequest,
  allowedExercises: GenerateClientPlanDraftRequest["allowedExercises"],
  excludedBodyParts: Set<string>,
): string {
  const level = req.client.experienceLevel ?? "UNKNOWN";
  const isBeginner = level === "BEGINNER" || level === "UNKNOWN";
  const isProfessional = level === "ADVANCED" && req.client.competesInSport === true;
  const levelGuidance = isBeginner
    ? "Khách hàng ở trình độ MỚI BẮT ĐẦU. Ưu tiên bài compound cơ bản, kỹ thuật đơn giản, KHÔNG dùng kỹ thuật nâng cao (drop-set, rest-pause, FST-7...). Khối lượng vừa phải."
    : isProfessional
      ? "Khách hàng là VẬN ĐỘNG VIÊN THI ĐẤU. Có thể dùng khối lượng/kỹ thuật nâng cao hơn nhưng PT vẫn phải tự xác nhận trước khi giao."
      : "Khách hàng đã có kinh nghiệm tập — có thể tăng độ đa dạng bài tập vừa phải.";

  const catalogLines = allowedExercises
    .slice(0, 150)
    .map((e) => `${e.id} | ${e.exerciseName} | ${e.bodyPart ?? "?"} | ${e.typeOfEquipment ?? "?"}`)
    .join("\n");

  const injuryNote =
    req.client.injuries.length > 0
      ? `CẢNH BÁO CHẤN THƯƠNG: khách hàng báo cáo vấn đề ở: ${req.client.injuries.join(", ")}. ${
          excludedBodyParts.size > 0
            ? `Danh sách bài tập bên dưới ĐÃ được lọc bỏ trước các bài thuộc nhóm: ${[...excludedBodyParts].join(", ")} — TUYỆT ĐỐI không đề xuất bài nào tác động lên vùng chấn thương này, kể cả gián tiếp.`
            : "Hãy cẩn trọng không đề xuất bài tập gây áp lực lên vùng này."
        }`
      : "";

  return `Bạn là một huấn luyện viên thể hình đang soạn BẢN NHÁP kế hoạch tập cho một khách hàng, để PT xem xét và chỉnh sửa trước khi giao — đây KHÔNG phải bản giao trực tiếp cho khách hàng.

${levelGuidance}
${injuryNote}

QUY TẮC BẮT BUỘC:
- CHỈ được dùng exerciseId có trong danh sách bên dưới. TUYỆT ĐỐI KHÔNG tự bịa exerciseId hay tên bài tập không có trong danh sách.
- KHÔNG được đặt tên hoặc sao chép theo bất kỳ chương trình tập thương mại/có bản quyền nào (vd: không dùng tên "5/3/1", "StrongLifts", "PPL của XYZ"...) — chỉ mô tả cấu trúc buổi tập chung chung.
- Nếu dữ liệu về khách hàng còn thiếu (chưa có chu kỳ tập, feedback quá ít...), PHẢI liệt kê rõ trong dataGaps, không được tự suy diễn.
- Nếu có ghi chú từ PT (ptNotes), hãy cân nhắc nhưng KHÔNG được vì ptNotes mà bỏ qua cảnh báo chấn thương ở trên.
- warnings: liệt kê các lưu ý an toàn quan trọng PT cần biết trước khi giao (không phải chẩn đoán y khoa).

Chỉ trả lời bằng JSON hợp lệ theo ĐÚNG shape sau, không markdown:
{"days": [{"dayNumber": 1, "title": string, "exercises": [{"exerciseId": string, "order": number, "sets": number, "reps": number, "note": string}]}], "dataGaps": string[], "warnings": string[], "summaryForPt": string}

Cần tạo ${req.daysPerWeek} buổi/tuần, chương trình kéo dài ${req.durationWeeks} tuần.
Mục tiêu: ${req.client.goal ?? "không rõ"}
cycleFeedbackSummary (nếu có): ${JSON.stringify(req.cycleFeedbackSummary ?? {})}
priorDecisions (nếu có): ${JSON.stringify(req.priorDecisions)}
Ghi chú của PT: ${req.ptNotes ?? "(không có)"}

Danh sách bài tập được phép dùng (id | tên | vùng cơ | dụng cụ):
${catalogLines}

Hãy tạo bản nháp kế hoạch dưới dạng JSON theo đúng schema.`;
}

function buildDeterministicFallback(req: GenerateClientPlanDraftRequest): GenerateClientPlanDraftOutput {
  return {
    days: [],
    dataGaps: ["AI không tạo được bản nháp — vui lòng tự chọn bài tập thủ công."],
    warnings: req.client.injuries.length > 0 ? [`Khách hàng có báo cáo chấn thương: ${req.client.injuries.join(", ")} — cân nhắc kỹ khi chọn bài tập.`] : [],
    summaryForPt: "Không thể tạo bản nháp tự động lúc này. Vui lòng tạo kế hoạch thủ công bên dưới.",
  };
}

export const clientPlanDraftService = {
  async generateDraft(req: GenerateClientPlanDraftRequest): Promise<GenerateClientPlanDraftOutput> {
    const { safe: safeExercises, excludedBodyParts } = filterExercisesForInjuries(req.allowedExercises, req.client.injuries);

    if (safeExercises.length === 0) {
      logger.warn({ userId: req.userId }, "[client-plan-draft] no exercises remain after injury filtering — cannot draft");
      return {
        days: [],
        dataGaps: [],
        warnings: [`Không còn bài tập an toàn nào sau khi loại trừ vùng chấn thương (${req.client.injuries.join(", ")}) — cần PT tự chọn bài tập phù hợp.`],
        summaryForPt: "Không thể tạo bản nháp tự động do giới hạn an toàn — vui lòng tạo kế hoạch thủ công.",
      };
    }

    const allowedIds = new Set(safeExercises.map((e) => e.id));
    const prompt = buildDraftPrompt(req, safeExercises, excludedBodyParts);

    const result = await callLlmJson(prompt, GenerateClientPlanDraftOutputSchema, {
      userId: req.userId,
      phase: "generate-client-plan-draft",
      numPredict: 1200,
      attempts: 3,
      logPrefix: "[client-plan-draft]",
    });

    const output = result ?? buildDeterministicFallback(req);

    // Belt-and-braces: drop any day/exercise referencing an id outside the
    // allowed (already injury-filtered) catalog — never trust the model's
    // own claim that an id is valid.
    const droppedIds: string[] = [];
    output.days = output.days.map((day) => ({
      ...day,
      exercises: day.exercises.filter((ex) => {
        const ok = allowedIds.has(ex.exerciseId);
        if (!ok) droppedIds.push(ex.exerciseId);
        return ok;
      }),
    }));
    if (droppedIds.length > 0) {
      logger.warn({ userId: req.userId, droppedIds }, "[client-plan-draft] LLM referenced exerciseId(s) outside the allowed catalog — dropped");
    }

    // Data-gap transparency is non-negotiable — force a note when the
    // caller-supplied context was thin, regardless of what the model said.
    if (!req.cycleFeedbackSummary && !output.dataGaps.some((g) => /feedback|dữ liệu/i.test(g))) {
      output.dataGaps = [...output.dataGaps, "Khách hàng chưa có dữ liệu phản hồi buổi tập (feedback) để cá nhân hóa."];
    }
    if (excludedBodyParts.size > 0 && !output.warnings.some((w) => /chấn thương|injur/i.test(w))) {
      output.warnings = [
        ...output.warnings,
        `Đã loại trừ các bài tập thuộc nhóm ${[...excludedBodyParts].join(", ")} do khách hàng báo cáo chấn thương — kiểm tra lại nếu cần điều chỉnh.`,
      ];
    }

    return output;
  },
};
