import { logger } from "@gym-coach/shared";
import { llmService } from "./llm.service";
import { retriever } from "../llm/retriever";
import {
  AnalyzeCycleOutputSchema,
  DecisionPhaseSchema,
  KeepPhaseSchema,
  AdjustPhaseSchema,
  NewPlanPhaseSchema,
  type AnalyzeCycleOutput,
  type AnalyzeCycleRequest,
  type DecisionPhaseOutput,
  type CycleReview,
} from "../schemas/cycle-analysis.schemas";
import { z } from "zod";

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

function buildCycleDataBlock(req: AnalyzeCycleRequest): string {
  const { cycle, progressSignals, inbody, priorCycles, currentPlan } = req;
  const goalLabel = GOAL_LABEL[cycle.goal ?? ""] ?? cycle.goal ?? "không rõ";

  return `Dữ liệu chu kỳ:
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
Các chu kỳ trước (gần nhất trước): ${JSON.stringify(priorCycles ?? [])}`;
}

/** Phase 1: decision + review only. Kept deliberately small (4 fields) so a
 * 1.5B local model can track the whole shape reliably — see DECISIONS.md
 * "Fine-tuning — analyze-cycle 2-phase split" for why the single 20-field
 * combined schema was unreliable on this model. */
function buildDecisionPrompt(req: AnalyzeCycleRequest, evidence: string): string {
  return `Bạn là một huấn luyện viên thể hình giàu kinh nghiệm. Dựa trên các tín hiệu tiến triển đã được HỆ THỐNG TÍNH SẴN (progressSignals) — không tự bịa số liệu, không tính lại delta — hãy chọn 1 trong 3 quyết định:

- KEEP khi xu hướng "đang tiến triển tốt".
- ADJUST khi "chững lại".
- NEW_PLAN khi "đang sụt giảm", cần đổi mục tiêu, hoặc mệt tích lũy kéo dài.

Nếu lowConfidence=true, đặt cycleReview.confidence="low" và giải thích hạn chế trong trainingNote.

Chỉ trả lời bằng JSON hợp lệ theo ĐÚNG shape sau, không markdown, không giải thích ngoài JSON:
{"decision": "KEEP"|"ADJUST"|"NEW_PLAN", "cycleReview": {"bodyCompositionTrend": string, "trainingNote": string, "laggingMuscleGroups": string[], "confidence": "high"|"low"}}

${buildCycleDataBlock(req)}

Kiến thức huấn luyện liên quan (tham khảo, không trích dẫn nguồn):
${evidence || "(không có tài liệu liên quan)"}

Câu hỏi của user: Hãy đưa ra quyết định cho chu kỳ tiếp theo dưới dạng JSON theo đúng schema.`;
}

/** Phase 2: only the ONE branch's fields (picked from phase 1's decision), no
 * nullable sibling branches — removes the cross-branch field-name confusion
 * (e.g. filling adjustDetails with keepDetails' field names) seen when the
 * model had to track all 3 branches + null-ing the other 2 in one shot. */
function buildDetailsPrompt(
  req: AnalyzeCycleRequest,
  evidence: string,
  decisionPhase: DecisionPhaseOutput,
): string {
  const { decision } = decisionPhase;
  const branchInstruction =
    decision === "KEEP"
      ? `Quyết định đã chọn là KEEP: giữ split hiện tại, đề xuất % tăng tải hợp lý cho chu kỳ tới, giữ hoặc tinh chỉnh nhẹ lượng calo.
Trả lời theo ĐÚNG shape: {"keepDetails": {"overloadIncreasePct": number, "calorieDelta": number, "notes": string}, "mealPlanDraft": {"estimatedTDEE": number, "calorieTarget": number, "macros": {"proteinG": number, "carbG": number, "fatG": number}, "notes": string}}`
      : decision === "ADJUST"
        ? `Quyết định đã chọn là ADJUST: giữ khung plan hiện tại; thêm kỹ thuật pump-set/isolation cuối buổi cho tối đa 1-2 nhóm cơ ì (tối đa 2 buổi/tuần); có thể chỉnh calo ±5-10%; có thể đổi 1-2 bài tập.
Trả lời theo ĐÚNG shape: {"adjustDetails": {"pumpSetTargets": string[], "maxPumpSessionsPerWeek": number, "exerciseSwaps": [], "calorieDeltaPct": number, "notes": string}, "mealPlanDraft": {"estimatedTDEE": number, "calorieTarget": number, "macros": {"proteinG": number, "carbG": number, "fatG": number}, "notes": string}}`
        : `Quyết định đã chọn là NEW_PLAN: cần chèn 1 tuần deload trước khi bắt đầu plan mới.
Trả lời theo ĐÚNG shape: {"newPlanDraft": {"goal": string, "durationDays": number, "daysPerWeek": number, "splitSuggestion": string, "deloadWeekFirst": boolean, "notes": string}, "mealPlanDraft": {"estimatedTDEE": number, "calorieTarget": number, "macros": {"proteinG": number, "carbG": number, "fatG": number}, "notes": string}}`;

  return `Bạn là một huấn luyện viên thể hình giàu kinh nghiệm. Chu kỳ vừa được đánh giá:
- decision: ${decision}
- bodyCompositionTrend: ${decisionPhase.cycleReview.bodyCompositionTrend}
- trainingNote: ${decisionPhase.cycleReview.trainingNote}

${branchInstruction}

Luôn tính lại TDEE ước lượng dựa trên BMR mới nhất trong dữ liệu InBody nếu có; nếu không có BMR, ước lượng TDEE từ cân nặng/khối lượng cơ hiện có. mealPlanDraft luôn phải có giá trị đầy đủ, không để trống field nào.

Chỉ trả lời bằng JSON hợp lệ đúng shape trên, không markdown, không giải thích ngoài JSON.

${buildCycleDataBlock(req)}

Kiến thức huấn luyện liên quan (tham khảo, không trích dẫn nguồn):
${evidence || "(không có tài liệu liên quan)"}

Câu hỏi của user: Hãy đưa ra chi tiết cho quyết định ${decision} dưới dạng JSON theo đúng schema.`;
}

function defaultCycleReview(req: AnalyzeCycleRequest): CycleReview {
  return {
    bodyCompositionTrend: TREND_LABEL[req.progressSignals.overallTrend],
    trainingNote: "AI không tạo được phân tích chi tiết — áp dụng quy tắc mặc định theo xu hướng tổng thể.",
    laggingMuscleGroups: req.progressSignals.laggingMuscleGroups ?? [],
    confidence: "low",
  };
}

function defaultDetailsFor(
  req: AnalyzeCycleRequest,
  decision: "KEEP" | "ADJUST" | "NEW_PLAN",
): Pick<AnalyzeCycleOutput, "keepDetails" | "adjustDetails" | "newPlanDraft" | "mealPlanDraft"> {
  return {
    keepDetails:
      decision === "KEEP"
        ? { overloadIncreasePct: 2.5, calorieDelta: 0, notes: "Mặc định khi AI không phản hồi." }
        : null,
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
  };
}

async function callLlmJson<T>(
  prompt: string,
  schema: z.ZodType<T, z.ZodTypeDef, any>,
  opts: { userId: string; phase: string; numPredict: number },
): Promise<T | null> {
  const attempts = 2;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await llmService.callLLM(prompt, {
        responseFormat: "json",
        temperature: 0.2,
        numPredict: opts.numPredict,
        timeoutMs: Number(process.env.CYCLE_ANALYSIS_LLM_TIMEOUT_MS ?? 80_000),
      });
      const jsonMatch = result.answer.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object found in LLM response");
      const parsed = JSON.parse(jsonMatch[0]);
      return schema.parse(parsed);
    } catch (err) {
      lastError = err;
      logger.warn(
        { err: (err as Error).message, attempt, userId: opts.userId, phase: opts.phase },
        "[cycle-analysis] LLM output validation failed, retrying",
      );
    }
  }
  logger.error(
    { err: (lastError as Error)?.message, userId: opts.userId, phase: opts.phase },
    "[cycle-analysis] phase failed after retries, using fallback for this phase",
  );
  return null;
}

export const cycleAnalysisService = {
  async analyzeCycle(req: AnalyzeCycleRequest): Promise<AnalyzeCycleOutput> {
    const queries = buildRagQueries(req);
    const evidenceDocs = await retriever.retrieveEvidence(queries);
    const evidence = evidenceDocs
      .map((d) => `- ${d.pageContent.slice(0, 500)}`)
      .join("\n");

    const decisionResult = await callLlmJson<DecisionPhaseOutput>(
      buildDecisionPrompt(req, evidence),
      DecisionPhaseSchema,
      { userId: req.userId, phase: "decision", numPredict: 400 },
    );

    const fallbackDecisionPhase = {
      decision: fallbackDecision(req.progressSignals.overallTrend),
      cycleReview: defaultCycleReview(req),
    };
    const decisionPhase: DecisionPhaseOutput = decisionResult ?? fallbackDecisionPhase;

    const { decision } = decisionPhase;
    type DetailsPhaseOutput =
      | z.infer<typeof KeepPhaseSchema>
      | z.infer<typeof AdjustPhaseSchema>
      | z.infer<typeof NewPlanPhaseSchema>;
    const detailsSchema = (
      decision === "KEEP" ? KeepPhaseSchema : decision === "ADJUST" ? AdjustPhaseSchema : NewPlanPhaseSchema
    ) as z.ZodType<DetailsPhaseOutput>;

    const detailsResult = await callLlmJson<DetailsPhaseOutput>(
      buildDetailsPrompt(req, evidence, decisionPhase),
      detailsSchema,
      { userId: req.userId, phase: "details", numPredict: 700 },
    );

    const details = detailsResult
      ? {
          keepDetails: "keepDetails" in detailsResult ? detailsResult.keepDetails : null,
          adjustDetails: "adjustDetails" in detailsResult ? detailsResult.adjustDetails : null,
          newPlanDraft: "newPlanDraft" in detailsResult ? detailsResult.newPlanDraft : null,
          mealPlanDraft: detailsResult.mealPlanDraft,
        }
      : defaultDetailsFor(req, decision);

    return AnalyzeCycleOutputSchema.parse({
      decision,
      cycleReview: decisionPhase.cycleReview,
      ...details,
    });
  },
};
