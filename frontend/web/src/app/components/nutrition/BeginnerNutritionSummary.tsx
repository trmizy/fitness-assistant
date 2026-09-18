import { useState } from "react";
import {
  SparkleIcon as Sparkles,
  CircleNotchIcon as Loader2,
  CaretDownIcon as ChevronDown,
  CaretUpIcon as ChevronUp,
  PlusIcon as Plus,
  CheckIcon as Check,
  ArrowsClockwiseIcon as Repeat,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  nutritionService,
  type NutritionDailySummary,
  type FoodSuggestionItem,
  type SubstituteMode,
} from "../../services/api";

/**
 * AI Nutrition Cycle Engine (Gymini) — spec §XI/§XII: a beginner should
 * never need to understand "calories" or "macros" to know what to do next.
 * This card translates the deterministic dailySummary (already computed by
 * fitness-service — see nutrition.service.ts's buildDailySummary) into
 * plain language, and lets the user pull up concrete food combos for
 * whatever's left today (on demand — never an automatic LLM/DB call on
 * mount, spec §L).
 */

const SUBSTITUTE_MODE_LABEL: Record<SubstituteMode, string> = {
  REPLACE: "Món khác",
  CHEAPER: "Rẻ hơn",
  HIGHER_PROTEIN: "Nhiều đạm hơn",
  VEGETARIAN: "Món chay",
};

function itemKey(optionLabel: string, index: number): string {
  return `${optionLabel}::${index}`;
}

export function BeginnerNutritionSummary({
  dailySummary,
  dateStr,
}: {
  dailySummary: NutritionDailySummary | null | undefined;
  dateStr: string;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addedLabel, setAddedLabel] = useState<string | null>(null);
  const [openPickerKey, setOpenPickerKey] = useState<string | null>(null);
  // Per-item substitute picks, keyed by "optionLabel::itemIndex" — applies
  // on top of whatever the server suggested, before the user commits
  // "Thêm bữa này". Reset whenever the suggestion list itself refetches
  // (dateStr/budget/region change) since the indices it keys on no longer
  // necessarily mean the same thing.
  const [itemOverrides, setItemOverrides] = useState<Record<string, FoodSuggestionItem>>({});
  const queryClient = useQueryClient();

  const { data: suggestions, isFetching: loadingSuggestions } = useQuery({
    queryKey: ["food-suggestions", dateStr],
    queryFn: () => nutritionService.getFoodSuggestions(dateStr),
    enabled: showSuggestions,
    staleTime: 60_000,
  });

  const substituteMutation = useMutation({
    mutationFn: (params: { optionLabel: string; index: number; item: FoodSuggestionItem; mode: SubstituteMode }) =>
      nutritionService.getFoodSubstitute(params.item, params.mode),
    onError: () => toast.error("Không tìm được món thay thế — thử lại sau"),
  });

  const applyMutation = useMutation({
    mutationFn: (params: { label: string; items: FoodSuggestionItem[] }) =>
      nutritionService.applyFoodSuggestion(dateStr, params.items),
    onSuccess: (_res, params) => {
      toast.success("Đã thêm vào nhật ký hôm nay");
      setAddedLabel(params.label);
      // Real data changed — the daily-task query (dailySummary/meals) and
      // this card's own remaining-calories numbers must refetch, not just
      // show a toast over stale numbers.
      queryClient.invalidateQueries({ queryKey: ["nutrition-daily-task"] });
      queryClient.invalidateQueries({ queryKey: ["food-suggestions", dateStr] });
      setItemOverrides({});
    },
    onError: () => toast.error("Không thể thêm — thử lại sau"),
  });

  if (!dailySummary) return null;

  const caloriesPct = dailySummary.targetCalories > 0
    ? Math.min(100, Math.max(0, (dailySummary.consumedCalories / dailySummary.targetCalories) * 100))
    : 0;
  const proteinPct = dailySummary.targetProtein > 0
    ? Math.min(100, Math.max(0, (dailySummary.consumedProtein / dailySummary.targetProtein) * 100))
    : 0;

  const overCalories = dailySummary.remainingCalories < 0;
  const overProtein = dailySummary.remainingProtein < 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4 space-y-4">
      <div>
        <h3 className="text-zinc-100 font-bold text-sm">Hôm nay bạn nên ăn khoảng</h3>
        <p className="text-2xl font-extrabold text-orange-400 mt-1">
          {dailySummary.targetCalories.toLocaleString("vi-VN")} kcal
        </p>
        <p className="text-xs text-zinc-500 mt-0.5">
          Ưu tiên đủ {dailySummary.targetProtein}g protein trong ngày.
        </p>
      </div>

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-400">Calories</span>
            <span className={overCalories ? "text-amber-400" : "text-zinc-300"}>
              {dailySummary.consumedCalories.toLocaleString("vi-VN")} / {dailySummary.targetCalories.toLocaleString("vi-VN")} kcal
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all"
              style={{ width: `${caloriesPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-400">Protein</span>
            <span className={overProtein ? "text-amber-400" : "text-zinc-300"}>
              {Math.round(dailySummary.consumedProtein)} / {Math.round(dailySummary.targetProtein)}g
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-lime-400 rounded-full transition-all"
              style={{ width: `${proteinPct}%` }}
            />
          </div>
        </div>
      </div>

      <p className="text-sm text-zinc-300">
        {overCalories
          ? "Bạn đã đạt mục tiêu calories hôm nay 🎉"
          : `Bạn còn khoảng ${Math.round(dailySummary.remainingCalories).toLocaleString("vi-VN")} kcal`}
        {!overProtein && dailySummary.remainingProtein > 5
          ? ` và thiếu khoảng ${Math.round(dailySummary.remainingProtein)}g protein.`
          : "."}
      </p>

      {!overCalories && (
        <button
          type="button"
          onClick={() => setShowSuggestions((v) => !v)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-semibold transition-colors"
        >
          <Sparkles className="w-4 h-4 text-orange-400" />
          Gợi ý món ăn tiếp theo
          {showSuggestions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      )}

      {showSuggestions && (
        <div className="space-y-2 pt-1">
          {loadingSuggestions && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang tìm món phù hợp...
            </div>
          )}
          {!loadingSuggestions && suggestions?.options.length === 0 && (
            <p className="text-xs text-zinc-500 py-2">
              Chưa tìm được gợi ý phù hợp — bạn có thể tự thêm món trong danh sách bên dưới.
            </p>
          )}
          {!loadingSuggestions &&
            suggestions?.options.map((option) => {
              const justAdded = addedLabel === option.label;
              // Whatever was picked via a substitute action overrides the
              // server's original item at that slot — this is what
              // actually gets rendered AND what "Thêm bữa này" submits.
              const effectiveItems = option.items.map(
                (item, i) => itemOverrides[itemKey(option.label, i)] ?? item,
              );
              return (
                <div key={option.label} className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg p-3">
                  <p className="text-xs font-bold text-zinc-300 mb-1.5">{option.label}</p>
                  <ul className="space-y-1.5">
                    {effectiveItems.map((item, i) => {
                      const key = itemKey(option.label, i);
                      const pickerOpen = openPickerKey === key;
                      const picking = substituteMutation.isPending && substituteMutation.variables?.optionLabel === option.label && substituteMutation.variables?.index === i;
                      const result =
                        substituteMutation.data && substituteMutation.variables?.optionLabel === option.label && substituteMutation.variables?.index === i
                          ? substituteMutation.data
                          : null;
                      return (
                        <li key={i}>
                          <div className="text-sm text-zinc-200 flex justify-between gap-2 items-start">
                            <span>
                              {Math.round(item.quantityG)}g {item.foodName}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-zinc-500 text-xs">
                                {item.calories} kcal · {Math.round(item.protein)}g đạm
                              </span>
                              <button
                                type="button"
                                title="Đổi món"
                                onClick={() => setOpenPickerKey(pickerOpen ? null : key)}
                                className="p-1 rounded-md text-zinc-500 hover:text-orange-400 hover:bg-zinc-700/60 transition-colors"
                              >
                                <Repeat className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {pickerOpen && (
                            <div className="mt-1.5 mb-1 p-2 rounded-lg bg-zinc-900/60 border border-zinc-700/40 space-y-1.5">
                              <div className="flex flex-wrap gap-1.5">
                                {(Object.keys(SUBSTITUTE_MODE_LABEL) as SubstituteMode[]).map((mode) => (
                                  <button
                                    key={mode}
                                    type="button"
                                    disabled={substituteMutation.isPending}
                                    onClick={() =>
                                      substituteMutation.mutate({ optionLabel: option.label, index: i, item, mode })
                                    }
                                    className="px-2 py-1 rounded-md text-[11px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 transition-colors"
                                  >
                                    {SUBSTITUTE_MODE_LABEL[mode]}
                                  </button>
                                ))}
                              </div>
                              {picking && (
                                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 py-1">
                                  <Loader2 className="w-3 h-3 animate-spin" /> Đang tìm...
                                </div>
                              )}
                              {result && !picking && result.candidates.length === 0 && (
                                <p className="text-[11px] text-zinc-500 py-1">{result.note}</p>
                              )}
                              {result && !picking && result.candidates.length > 0 && (
                                <div className="space-y-1">
                                  {result.candidates.map((cand) => (
                                    <button
                                      key={cand.foodId}
                                      type="button"
                                      onClick={() => {
                                        setItemOverrides((prev) => ({ ...prev, [key]: cand }));
                                        setOpenPickerKey(null);
                                      }}
                                      className="w-full flex justify-between gap-2 text-left text-[11px] px-2 py-1.5 rounded-md bg-zinc-800/80 hover:bg-emerald-500/10 hover:border-emerald-500/30 border border-transparent text-zinc-300 transition-colors"
                                    >
                                      <span>
                                        {Math.round(cand.quantityG)}g {cand.foodName}
                                      </span>
                                      <span className="text-zinc-500 shrink-0">
                                        {cand.calories} kcal · {Math.round(cand.protein)}g đạm
                                      </span>
                                    </button>
                                  ))}
                                  <p className="text-[10px] text-zinc-600 pt-0.5">{result.note}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                    <li className="text-xs text-zinc-500">+ {option.sideNote}</li>
                  </ul>
                  <button
                    type="button"
                    disabled={applyMutation.isPending}
                    onClick={() => applyMutation.mutate({ label: option.label, items: effectiveItems })}
                    className={`w-full mt-2.5 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                      justAdded
                        ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                        : "bg-orange-500 hover:bg-orange-400 text-black"
                    }`}
                  >
                    {applyMutation.isPending && applyMutation.variables?.label === option.label ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : justAdded ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Đã thêm
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" /> Thêm bữa này
                      </>
                    )}
                  </button>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
