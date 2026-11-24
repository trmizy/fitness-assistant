import { useQuery } from "@tanstack/react-query";
import { SparkleIcon as Sparkle, WarningIcon as Warning } from "@phosphor-icons/react";
import { fitnessRoadmapService, type GoalRecommendationResult } from "../services/api";
import "../pages/client/GoalImagePicker.css"; // shared motion tokens (.t-goalimg, .t-goalimg-rise)

// "Gymini gợi ý theo chỉ số của bạn" — one suggestion, from one backend function (goal-recommendation.engine), shown wherever a goal is
// chosen (roadmap wizard, onboarding, profile). It only SUGGESTS: the user picks, nothing is saved here. Every figure says whether it is
// measured, typed by the user or estimated, and the confidence is a word, never a percentage.

export type SuggestedGoal = "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE";

const GOAL_LABEL: Record<string, string> = {
  WEIGHT_LOSS: "Giảm mỡ",
  MUSCLE_GAIN: "Tăng cơ",
  MAINTENANCE: "Duy trì vóc dáng",
  ATHLETIC_PERFORMANCE: "Hiệu suất thể thao",
};
const KIND_LABEL = { MEASURED: "Đo thật", USER_ENTERED: "Bạn nhập", ESTIMATED: "Ước tính" } as const;
const CONFIDENCE_LABEL = { HIGH: "Cao", MEDIUM: "Vừa", LOW: "Thấp" } as const;

export interface GoalSuggestionInputs {
  weightKg?: number;
  heightCm?: number;
  age?: number;
  gender?: "MALE" | "FEMALE" | "OTHER";
  bodyFatPct?: number;
  bodyFatMethod?: "manual" | "visual_reference" | "inbody";
}

export function GoalSuggestion({
  inputs,
  currentGoal,
  onChoose,
  allowedGoals,
  className = "",
}: {
  inputs?: GoalSuggestionInputs;
  currentGoal: string | null;
  onChoose: (goal: SuggestedGoal) => void;
  /** goals the host screen can actually set (the profile page has no "Hiệu suất thể thao") */
  allowedGoals?: SuggestedGoal[];
  className?: string;
}) {
  const query = useQuery<{ recommendation: GoalRecommendationResult; profileGoal: string | null }>({
    queryKey: ["goal-recommendation", JSON.stringify(inputs ?? {})],
    queryFn: () => fitnessRoadmapService.getGoalRecommendation(inputs ?? {}),
    retry: false,
    staleTime: 30_000,
  });

  const rec = query.data?.recommendation;
  if (query.isLoading) return <p className="text-xs text-zinc-500">Đang xem chỉ số của bạn...</p>;
  if (!rec) return null;

  if (rec.status === "INSUFFICIENT_DATA") {
    return <p className="text-xs text-zinc-500" data-testid="goal-suggestion-insufficient">{rec.reasons[0]} Gymini sẽ gợi ý mục tiêu khi có đủ thông tin.</p>;
  }

  const allow = (g: string) => !allowedGoals || allowedGoals.includes(g as SuggestedGoal);
  const choices = (rec.status === "RECOMMENDED" && rec.recommended ? [rec.recommended, ...rec.options.filter((o) => o !== rec.recommended)] : rec.options).filter(allow) as SuggestedGoal[];
  const review = rec.status === "REVIEW_FIRST";

  return (
    <section
      className={`t-goalimg space-y-3 rounded-2xl border p-4 ${review ? "border-amber-500/40 bg-amber-500/5" : "border-green-500/30 bg-green-500/5"} ${className}`}
      aria-label="Gợi ý mục tiêu theo chỉ số cơ thể"
      data-testid="goal-suggestion"
      data-status={rec.status}
    >
      <div className="t-goalimg-rise space-y-1" style={{ ["--i" as string]: 0 }}>
        <p className={`flex items-center gap-2 text-sm font-bold ${review ? "text-amber-300" : "text-green-300"}`}>
          {review ? <Warning className="h-4 w-4 flex-shrink-0" weight="fill" /> : <Sparkle className="h-4 w-4 flex-shrink-0" weight="fill" />}
          {rec.headline}
        </p>
        {rec.confidence && rec.status !== "REVIEW_FIRST" && <p className="text-xs text-zinc-500">Mức chắc chắn: {CONFIDENCE_LABEL[rec.confidence]}</p>}
      </div>

      <ul className="space-y-1.5">
        {rec.reasons.map((reason, i) => (
          <li key={i} className="t-goalimg-rise text-sm text-zinc-300" style={{ ["--i" as string]: i + 1 }}>{reason}</li>
        ))}
      </ul>

      {rec.evidence.length > 0 && (
        <dl className="space-y-1 text-xs">
          {rec.evidence.map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <dt className="text-zinc-500">{row.label}</dt>
              <dd className="text-zinc-200">
                <span className="font-semibold">{row.value}</span>
                <span className="ml-2 rounded-full border border-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-400">{KIND_LABEL[row.kind]}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {choices.map((goal, i) => {
            const active = currentGoal === goal;
            const primary = i === 0 && rec.status === "RECOMMENDED";
            return (
              <button
                key={goal}
                type="button"
                data-testid={`goal-suggestion-choose-${goal}`}
                disabled={active}
                onClick={() => onChoose(goal)}
                className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-default ${
                  active ? "border border-green-500/50 text-green-300" : primary ? "bg-green-500 text-black hover:bg-green-400" : "border border-zinc-600 text-zinc-300 hover:border-green-500/50"
                }`}
              >
                {active ? `Đang chọn: ${GOAL_LABEL[goal]}` : review ? `Chọn ${GOAL_LABEL[goal]}` : primary ? `Chọn ${GOAL_LABEL[goal]}` : GOAL_LABEL[goal]}
              </button>
            );
          })}
        </div>
      )}

      {rec.caveats.length > 0 && (
        <details className="text-xs text-zinc-500">
          <summary className="min-h-8 cursor-pointer text-zinc-400">Lưu ý</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {rec.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </details>
      )}
      <p className="text-xs text-zinc-600">Gợi ý tham khảo từ số đo của bạn, không phải chẩn đoán y tế. Bạn luôn là người quyết định.</p>
    </section>
  );
}
