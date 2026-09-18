import { logger } from "@gym-coach/shared";
import { callLlmJson } from "../llm/json_llm_call.util";
import {
  GenerateRoadmapDraftOutputSchema,
  type GenerateRoadmapDraftRequest,
  type GenerateRoadmapDraftOutput,
} from "../schemas/roadmap-draft.schemas";

/** FitnessRoadmap AI Draft generation (Phase B). See
 * docs/FITNESS_ROADMAP_AI_DRAFT_DESIGN.md. This service NEVER decides a
 * roadmap's real fate — it only proposes a phase SEQUENCE (types +
 * durations + reasons), never calories/macros/workout content (those stay
 * owned by NutritionGoal/WorkoutProgram, unchanged). fitness-service
 * independently re-validates and clamps everything below before ever
 * showing it to a user/PT, and nothing is persisted until the user/PT
 * explicitly accepts. */

/** Goal-aware deterministic fallback mapping — a user whose goal is
 * MUSCLE_GAIN/MAINTENANCE/ATHLETIC_PERFORMANCE must never silently receive
 * a FAT_LOSS strategy just because the model failed. These are the real
 * goal values the product already uses (see frontend/web's
 * OnboardingWizardPage.tsx `goalOptions` and ProfilePage.tsx), not invented
 * here. Unrecognized/future goal values map to MAINTENANCE — the one
 * phase type that implies no aggressive deficit or surplus either way,
 * i.e. the safe neutral choice, never FAT_LOSS by default.
 * fitness-service's own independent fallback (generateAiRoadmapDraft's
 * unreachable-service and zero-valid-phases paths) mirrors this exact
 * mapping — kept in sync deliberately, not shared code (the two services
 * stay decoupled, same reasoning as RoadmapDraftPhaseTypeSchema being
 * redeclared independently on each side). */
function mapGoalTypeToFallbackPhaseType(goalType: string): GenerateRoadmapDraftOutput["phases"][number]["phaseType"] {
  switch (goalType) {
    case "WEIGHT_LOSS":
      return "FAT_LOSS";
    case "MUSCLE_GAIN":
      return "LEAN_GAIN";
    case "MAINTENANCE":
      return "MAINTENANCE";
    case "ATHLETIC_PERFORMANCE":
      return "PERFORMANCE";
    default:
      return "MAINTENANCE";
  }
}

function buildDraftPrompt(req: GenerateRoadmapDraftRequest): string {
  const p = req.profile;
  const experienceNote = p.experienceLevel ?? "UNKNOWN";
  const screeningNote =
    p.safetyScreeningStatus === "FOLLOW_UP_SUGGESTED"
      ? "CẢNH BÁO: hồ sơ sức khỏe khách hàng có safetyScreeningStatus=FOLLOW_UP_SUGGESTED — TUYỆT ĐỐI không đề xuất chuỗi giảm cân liên tiếp (nhiều FAT_LOSS/MINI_CUT nối tiếp không có MAINTENANCE/DIET_BREAK ở giữa); PHẢI ghi rõ điều này trong warnings."
      : p.safetyScreeningStatus === "UNKNOWN"
        ? "Hồ sơ sàng lọc an toàn của khách hàng là UNKNOWN (chưa có dữ liệu) — không được coi đây là bằng chứng an toàn, hãy thận trọng."
        : "";
  const injuryNote = p.injuries.length > 0 ? `Chấn thương/đau đã báo cáo: ${p.injuries.join(", ")}.` : "";
  const bodyCompNote = req.bodyComposition?.bodyFatPercent != null
    ? `InBody thật gần nhất: body fat ${req.bodyComposition.bodyFatPercent}%${req.bodyComposition.muscleMassKg != null ? `, lean mass ${req.bodyComposition.muscleMassKg}kg` : ""} (đo lúc ${req.bodyComposition.measuredAt ?? "?"}) — LUÔN ưu tiên số liệu này hơn mọi ước lượng khác.`
    : "Chưa có số liệu InBody thật — không được tự suy diễn body-fat % cụ thể.";
  const visualNote = req.goalVisualAttributes
    ? `Gợi ý phong cách hình ảnh mục tiêu do người dùng chọn (CHỈ mang tính tham khảo phong cách, KHÔNG phải số đo cơ thể, KHÔNG được diễn giải như một mục tiêu số đo chính xác): muscularity=${req.goalVisualAttributes.muscularity ?? "?"}, relativeLeanness=${req.goalVisualAttributes.relativeLeanness ?? "?"}, focusMuscles=${req.goalVisualAttributes.focusMuscles.join(",") || "none"}.`
    : "";
  const historyNote = req.history
    ? `Đã hoàn thành ${req.history.completedCycleCount} chu kỳ tập trước đó. Quyết định chu kỳ gần nhất: ${req.history.lastCycleDecision ?? "chưa có"}. Số lần đổi mục tiêu dinh dưỡng: ${req.history.nutritionGoalVersionCount}.`
    : "Chưa có lịch sử chu kỳ tập nào — đây là roadmap đầu tiên của khách hàng.";
  const constraintsNote = req.constraints.length > 0 ? `Ràng buộc khác: ${req.constraints.join("; ")}.` : "";
  const targetNote =
    p.targetWeightKg != null || p.targetBodyFatPercent != null
      ? `Mục tiêu số cụ thể do khách hàng đặt (chỉ mang tính tham khảo cho reasoningSummary, KHÔNG phải một cam kết kết quả)${
          p.targetWeightKg != null ? `: cân nặng mục tiêu ${p.targetWeightKg}kg` : ""
        }${p.targetBodyFatPercent != null ? `${p.targetWeightKg != null ? "," : ":"} tỷ lệ mỡ mục tiêu ${p.targetBodyFatPercent}%` : ""}.`
      : "";

  return `Bạn là chuyên gia lập kế hoạch thể hình dài hạn, đang soạn BẢN NHÁP một "Fitness Roadmap" (chuỗi các PHASE chiến lược) cho khách hàng — đây KHÔNG phải một buổi tập hay một thực đơn cụ thể, CHỈ là chuỗi giai đoạn chiến lược (ví dụ: giảm mỡ -> nghỉ giữa kỳ -> giảm mỡ tiếp -> duy trì).

QUY TẮC BẮT BUỘC:
- Chỉ dùng phaseType trong danh sách: FAT_LOSS, DIET_BREAK, MAINTENANCE, LEAN_GAIN, MINI_CUT, RECOMPOSITION, PERFORMANCE, RECOVERY.
- KHÔNG bao giờ đề xuất calories, protein, số bài tập, hay bất kỳ chi tiết dinh dưỡng/tập luyện cụ thể nào — đó thuộc hệ thống khác, không phải nhiệm vụ của bạn.
- KHÔNG bao giờ hứa hẹn kết quả cụ thể ("bạn sẽ giảm X kg") hay so sánh với hình ảnh người khác.
- Nếu dữ liệu thiếu (chưa có InBody, chưa có lịch sử), PHẢI ghi rõ trong assumptions, không tự suy diễn số liệu.
- Nếu có bất kỳ lý do phải cẩn trọng (sàng lọc an toàn, chấn thương, dữ liệu thiếu), PHẢI ghi trong warnings.
- Mỗi phase cần: phaseType, name (tiếng Việt ngắn), plannedDurationWeeks (1-26), reason (lý do ngắn), objectiveMaxCycles (tùy chọn).
- Tổng số phase tối đa 12.

${screeningNote}
${injuryNote}
${bodyCompNote}
${visualNote}
${historyNote}
${constraintsNote}
${targetNote}

Mục tiêu tổng quát: ${req.goalType}
Khung thời gian mong muốn: ${req.timeframeWeeks ? `${req.timeframeWeeks} tuần` : "không rõ, hãy tự đề xuất hợp lý"}
Trình độ: ${experienceNote}
Số ngày tập/tuần: ${p.trainingDaysPerWeek ?? "không rõ"}

Chỉ trả lời bằng JSON hợp lệ theo ĐÚNG schema sau, không markdown, không giải thích thêm ngoài JSON:
{"summary": string, "reasoningSummary": string, "confidence": number (0-1), "phases": [{"phaseType": string, "name": string, "plannedDurationWeeks": number, "objectiveMaxCycles": number, "reason": string}], "warnings": string[], "assumptions": string[]}`;
}

function buildDeterministicFallback(req: GenerateRoadmapDraftRequest): GenerateRoadmapDraftOutput {
  // Never fabricate a specific plan when the model is unavailable/invalid —
  // return a single, safe, minimal-assumption starting phase and be
  // explicit that this is not a personalized proposal.
  return {
    summary: "Không thể tạo bản nháp roadmap tự động lúc này.",
    reasoningSummary:
      "AI không phản hồi hợp lệ — trả về một phase khởi đầu mặc định, an toàn, chưa cá nhân hóa. Vui lòng tự chỉnh sửa hoặc thử lại.",
    confidence: 0,
    phases: [
      {
        // Safety (screening follow-up) always outranks the goal-aware
        // mapping below — never propose an aggressive phase for a
        // flagged-for-review profile regardless of stated goal.
        phaseType:
          req.profile.safetyScreeningStatus === "FOLLOW_UP_SUGGESTED"
            ? "RECOVERY"
            : mapGoalTypeToFallbackPhaseType(req.goalType),
        name: "Giai đoạn khởi đầu",
        plannedDurationWeeks: Math.min(req.timeframeWeeks ?? 6, 6),
        reason: "Bản nháp dự phòng khi AI không khả dụng — cần khách hàng/PT tự chỉnh sửa.",
      },
    ],
    warnings: ["AI không tạo được bản nháp cá nhân hóa — đây là bản nháp dự phòng, cần chỉnh sửa thủ công."],
    assumptions: ["Không có dữ liệu cá nhân hóa nào được sử dụng cho bản nháp dự phòng này."],
  };
}

export const roadmapDraftService = {
  async generateDraft(req: GenerateRoadmapDraftRequest): Promise<GenerateRoadmapDraftOutput> {
    const prompt = buildDraftPrompt(req);

    const result = await callLlmJson(prompt, GenerateRoadmapDraftOutputSchema, {
      userId: req.userId,
      phase: "generate-roadmap-draft",
      numPredict: 900,
      attempts: 3,
      logPrefix: "[roadmap-draft]",
    });

    const output = result ?? buildDeterministicFallback(req);

    // Data-gap transparency, non-negotiable — same discipline as
    // client-plan-draft.service.ts.
    if (!req.bodyComposition?.bodyFatPercent && !output.assumptions.some((a) => /InBody|body.?fat/i.test(a))) {
      output.assumptions = [...output.assumptions, "Chưa có số liệu InBody thật — roadmap dựa trên hồ sơ tự khai."];
    }
    if (
      req.profile.safetyScreeningStatus === "FOLLOW_UP_SUGGESTED" &&
      !output.warnings.some((w) => /sàng lọc|an toàn|safety/i.test(w))
    ) {
      output.warnings = [
        ...output.warnings,
        "Hồ sơ sức khỏe khách hàng có gợi ý cần theo dõi thêm (FOLLOW_UP_SUGGESTED) — cân nhắc kỹ trước khi chấp nhận roadmap này.",
      ];
      logger.warn(
        { userId: req.userId },
        "[roadmap-draft] safetyScreeningStatus=FOLLOW_UP_SUGGESTED — forced warning onto AI draft output",
      );
    }

    return output;
  },
};
