import { logger } from "@gym-coach/shared";
import { llmService } from "./llm.service";
import { retriever } from "../llm/retriever";
import {
  AnalyzeCycleOutputSchema,
  type AnalyzeCycleOutput,
  type AnalyzeCycleRequest,
} from "../schemas/cycle-analysis.schemas";

const GOAL_LABEL: Record<string, string> = {
  WEIGHT_LOSS: "giảm mỡ (cut)",
  MUSCLE_GAIN: "tăng cơ (bulk)",
  MAINTENANCE: "duy trì vóc dáng",
  ATHLETIC_PERFORMANCE: "nâng cao hiệu suất vận động",
};

const TREND_LABEL: Record<string, string> = {
  PROGRESSING: "đang tiến triển tốt",
  PLATEAU: "chững lại",
  DECLINING: "đang sụt giảm",
};

/** Deterministic mapping used both as ai-service's own last-resort fallback
 * and mirrored in fitness-service (in case ai-service is unreachable at all). */
export function fallbackDecision(
  overallTrend: "PROGRESSING" | "PLATEAU" | "DECLINING",
): "KEEP" | "ADJUST" | "NEW_PLAN" {
  if (overallTrend === "PROGRESSING") return "KEEP";
  if (overallTrend === "PLATEAU") return "ADJUST";
  return "NEW_PLAN";
}

function buildRagQueries(req: AnalyzeCycleRequest): string[] {
  const { progressSignals, cycle } = req;
  const goalLabel = GOAL_LABEL[cycle.goal ?? ""] ?? "tập luyện thể hình";
  const trendLabel = TREND_LABEL[progressSignals.overallTrend];
  const queries = [`nguyên tắc periodization mesocycle deload khi ${trendLabel}, mục tiêu ${goalLabel}`];

  if (progressSignals.overallTrend === "PROGRESSING") {
    queries.push("nguyên tắc progressive overload tăng tải khi cơ thể đang tiến triển tốt");
  } else if (progressSignals.overallTrend === "PLATEAU") {
    queries.push("kỹ thuật pump set isolation cho nhóm cơ ì khi chững lại");
  } else {
    queries.push("tuần deload giảm tải khi mệt tích lũy hoặc sụt giảm hiệu suất");
  }

  for (const group of progressSignals.laggingMuscleGroups ?? []) {
    queries.push(`kỹ thuật tăng kích thích cho nhóm cơ ${group} khi tăng trưởng kém`);
  }

  queries.push(`hướng dẫn macro dinh dưỡng cho mục tiêu ${goalLabel}`);
  return queries;
}

function buildSystemPrompt(req: AnalyzeCycleRequest, evidence: string): string {
  const { cycle, progressSignals, inbody, priorCycles, currentPlan } = req;
  const goalLabel = GOAL_LABEL[cycle.goal ?? ""] ?? cycle.goal ?? "không rõ";

  return `Bạn là một huấn luyện viên thể hình giàu kinh nghiệm. Dựa trên các tín hiệu tiến triển đã được HỆ THỐNG TÍNH SẴN (progressSignals) — không tự bịa số liệu, không tính lại delta — hãy chọn 1 trong 3 quyết định và giải thích ngắn gọn:

- KEEP khi xu hướng "đang tiến triển tốt": giữ split hiện tại, đề xuất % tăng tải hợp lý cho chu kỳ tới, giữ hoặc tinh chỉnh nhẹ lượng calo.
- ADJUST khi "chững lại": giữ khung plan hiện tại; thêm kỹ thuật pump-set/isolation cuối buổi cho tối đa 1-2 nhóm cơ ì (tối đa 2 buổi/tuần); có thể chỉnh calo ±5-10%; có thể đổi 1-2 bài tập.
- NEW_PLAN khi "đang sụt giảm", cần đổi mục tiêu (vd tỉ lệ mỡ vượt ngưỡng khi đang tăng cơ), hoặc mệt tích lũy kéo dài: chèn 1 tuần deload trước khi bắt đầu plan mới.

Luôn tính lại TDEE ước lượng dựa trên BMR mới nhất trong dữ liệu InBody nếu có; nếu không có BMR, ước lượng TDEE từ cân nặng/khối lượng cơ hiện có. Nếu lowConfidence=true, nêu rõ trong cycleReview.confidence="low" và giải thích hạn chế.

Chỉ trả lời bằng JSON hợp lệ, không thêm markdown, không thêm giải thích ngoài JSON. Field tương ứng với "decision" đã chọn phải đầy đủ; các field nhánh khác để null. mealPlanDraft luôn có giá trị.

Dữ liệu chu kỳ:
- Chu kỳ số: ${cycle.cycleIndex}, mục tiêu: ${goalLabel}, độ dài: ${cycle.durationDays} ngày
- Xu hướng tổng thể (đã tính sẵn): ${TREND_LABEL[progressSignals.overallTrend]}
- Delta khối lượng cơ (SMM): ${progressSignals.deltaSMM ?? "không có dữ liệu"} kg
- Delta % mỡ cơ thể (PBF): ${progressSignals.deltaPBF ?? "không có dữ liệu"}%
- Thay đổi volume tập luyện: ${progressSignals.volumeChangePct ?? "không có dữ liệu"}%
- PR mới trong chu kỳ: ${(progressSignals.newPRs ?? []).join(", ") || "không có"}
- Tỉ lệ tuân thủ lịch tập: ${progressSignals.adherencePct ?? "?"}%
- Xu hướng RPE: ${progressSignals.rpeTrend ?? "?"}
- Nhóm cơ tăng trưởng kém: ${(progressSignals.laggingMuscleGroups ?? []).join(", ") || "không có"}
- lowConfidence: ${cycle.lowConfidence ?? false}

InBody đầu/cuối chu kỳ: ${JSON.stringify({ start: inbody.start, end: inbody.end })}
Plan hiện tại: ${JSON.stringify(currentPlan ?? {})}
Các chu kỳ trước (gần nhất trước): ${JSON.stringify(priorCycles ?? [])}

Kiến thức huấn luyện liên quan (tham khảo, không trích dẫn nguồn):
${evidence || "(không có tài liệu liên quan)"}

Câu hỏi của user: Hãy đưa ra quyết định cho chu kỳ tiếp theo dưới dạng JSON theo đúng schema.`;
}

export const cycleAnalysisService = {
  async analyzeCycle(req: AnalyzeCycleRequest): Promise<AnalyzeCycleOutput> {
    const queries = buildRagQueries(req);
    const evidenceDocs = await retriever.retrieveEvidence(queries);
    const evidence = evidenceDocs
      .map((d) => `- ${d.pageContent.slice(0, 500)}`)
      .join("\n");

    const prompt = buildSystemPrompt(req, evidence);

    const attempts = 2;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await llmService.callLLM(prompt, {
          responseFormat: "json",
          temperature: 0.2,
          numPredict: 900,
          timeoutMs: Number(process.env.CYCLE_ANALYSIS_LLM_TIMEOUT_MS ?? 80_000),
        });
        const jsonMatch = result.answer.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON object found in LLM response");
        const parsed = JSON.parse(jsonMatch[0]);
        const validated = AnalyzeCycleOutputSchema.parse(parsed);
        return validated;
      } catch (err) {
        lastError = err;
        logger.warn(
          { err: (err as Error).message, attempt, userId: req.userId },
          "[cycle-analysis] LLM output validation failed, retrying",
        );
      }
    }

    logger.error(
      { err: (lastError as Error)?.message, userId: req.userId },
      "[cycle-analysis] all attempts failed, using deterministic fallback",
    );
    const decision = fallbackDecision(req.progressSignals.overallTrend);
    return AnalyzeCycleOutputSchema.parse({
      decision,
      cycleReview: {
        bodyCompositionTrend: TREND_LABEL[req.progressSignals.overallTrend],
        trainingNote: "AI không tạo được phân tích chi tiết — áp dụng quy tắc mặc định theo xu hướng tổng thể.",
        laggingMuscleGroups: req.progressSignals.laggingMuscleGroups ?? [],
        confidence: "low",
      },
      keepDetails: decision === "KEEP" ? { overloadIncreasePct: 2.5, calorieDelta: 0, notes: "Mặc định khi AI không phản hồi." } : null,
      adjustDetails:
        decision === "ADJUST"
          ? {
              pumpSetTargets: req.progressSignals.laggingMuscleGroups ?? [],
              maxPumpSessionsPerWeek: 2,
              exerciseSwaps: [],
              calorieDeltaPct: 0,
              notes: "Mặc định khi AI không phản hồi.",
            }
          : null,
      newPlanDraft:
        decision === "NEW_PLAN"
          ? {
              goal: req.cycle.goal ?? "MAINTENANCE",
              durationDays: req.cycle.durationDays,
              daysPerWeek: 4,
              splitSuggestion: "Full body hoặc upper/lower, tuỳ mục tiêu",
              deloadWeekFirst: true,
              notes: "Mặc định khi AI không phản hồi.",
            }
          : null,
      mealPlanDraft: null,
    });
  },
};
