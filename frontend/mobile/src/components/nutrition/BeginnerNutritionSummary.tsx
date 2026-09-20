import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Check, ChevronDown, ChevronUp, Plus, Repeat, SlidersHorizontal, Sparkles } from "lucide-react-native";

import { BottomSheet, Card, Tappable, useToast } from "../ui";
import {
  nutritionService,
  profileService,
  type FoodSuggestionItem,
  type NutritionBudgetLevel,
  type NutritionDailySummary,
  type NutritionRegion,
  type SubstituteMode,
} from "../../services/api";
import { useApp } from "../../context/AppContext";
import { useWorkspaceAccent } from "../../theme/workspace";
import { timingProgress } from "../../theme/motion";
import { haptics } from "../../lib/haptics";
import {
  BUDGET_OPTIONS,
  REGION_OPTIONS,
  SUBSTITUTE_MODES,
  SUBSTITUTE_MODE_LABEL,
  canSuggest,
  effectiveItems,
  itemKey,
  itemLine,
  normalizeBudgetLevel,
  normalizeRegion,
  regionToSend,
  remainingSentence,
  summaryProgress,
} from "../../features/nutrition/foodSuggestions";

const PROTEIN_TINT = "#22c55e";
const WARN = "#f59e0b";

/**
 * WB-14 — web's `BeginnerNutritionSummary.tsx`: the day in plain words, and on demand (never on
 * mount — the suggestion engine runs catalog queries) a few concrete combos for what is left,
 * each item swappable, each combo loggable in one tap.
 *
 * The budget/region preference lives in web's Settings › Dinh dưỡng. Mobile has no settings
 * screen until Phase 9, so it is reachable from here for now; both write the same profile fields.
 */
export function BeginnerNutritionSummary({
  dailySummary,
  dateStr,
}: {
  dailySummary: NutritionDailySummary | null | undefined;
  dateStr: string;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addedLabel, setAddedLabel] = useState<string | null>(null);
  // Picks and the open picker are keyed by slot, and a refetch can reorder the combos — so both are
  // stamped with the data version they were made against and simply stop applying to newer data.
  const [picker, setPicker] = useState<{ version: number; key: string } | null>(null);
  const [overrides, setOverrides] = useState<{ version: number; map: Record<string, FoodSuggestionItem> }>({
    version: 0,
    map: {},
  });
  const [prefsOpen, setPrefsOpen] = useState(false);

  const suggestionsQuery = useQuery({
    queryKey: ["food-suggestions", dateStr],
    queryFn: () => nutritionService.getFoodSuggestions(dateStr),
    enabled: showSuggestions,
    staleTime: 60_000,
  });
  const suggestions = suggestionsQuery.data;
  const loadingSuggestions = suggestionsQuery.isFetching;
  const version = suggestionsQuery.dataUpdatedAt;
  const itemOverrides = overrides.version === version ? overrides.map : {};
  const openPickerKey = picker?.version === version ? picker.key : null;
  const setOpenPickerKey = (key: string | null) => setPicker(key ? { version, key } : null);
  const pick = (key: string, item: FoodSuggestionItem) =>
    setOverrides({ version, map: { ...itemOverrides, [key]: item } });

  const substituteMutation = useMutation({
    mutationFn: (params: { optionLabel: string; index: number; item: FoodSuggestionItem; mode: SubstituteMode }) =>
      nutritionService.getFoodSubstitute(params.item, params.mode),
    onError: () => toast.show("Không tìm được món thay thế — thử lại sau", "danger"),
  });

  const applyMutation = useMutation({
    mutationFn: (params: { label: string; items: FoodSuggestionItem[] }) =>
      nutritionService.applyFoodSuggestion(dateStr, params.items),
    onSuccess: (_res, params) => {
      haptics.success();
      toast.show("Đã thêm vào nhật ký hôm nay", "success");
      setAddedLabel(params.label);
      // Real rows were written: the day's totals, its log list and what is left to suggest all moved.
      void queryClient.invalidateQueries({ queryKey: ["nutrition-daily-task"] });
      void queryClient.invalidateQueries({ queryKey: ["nutrition-logs", dateStr] });
      void queryClient.invalidateQueries({ queryKey: ["food-suggestions", dateStr] });
      setOverrides({ version: 0, map: {} });
    },
    onError: () => toast.show("Không thể thêm — thử lại sau", "danger"),
  });

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => (await profileService.getProfile()).profile,
    enabled: !!user?.id,
  });
  const budgetLevel = normalizeBudgetLevel(profileQuery.data?.nutritionBudgetLevel);
  const region = normalizeRegion(profileQuery.data?.region);

  const prefMutation = useMutation({
    mutationFn: (patch: { nutritionBudgetLevel?: NutritionBudgetLevel; region?: NutritionRegion }) =>
      profileService.updateProfile(patch),
    onSuccess: (res, patch) => {
      if (res?.profile) queryClient.setQueryData(["profile", user?.id], res.profile);
      else void queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
      void queryClient.invalidateQueries({ queryKey: ["food-suggestions", dateStr] });
      toast.show(patch.region ? "Đã cập nhật vùng miền" : "Đã cập nhật ngân sách thực phẩm", "success");
    },
    onError: () => toast.show("Không thể cập nhật — thử lại sau", "danger"),
  });

  if (!dailySummary) return null;

  const progress = summaryProgress(dailySummary);
  const budgetLabel = BUDGET_OPTIONS.find((o) => o.value === budgetLevel)?.label ?? "Bình thường";
  const regionLabel = REGION_OPTIONS.find((o) => o.value === region)?.label;

  return (
    <Card className="mt-4 gap-4 p-4">
      <View>
        <Text className="font-body-semibold text-sm text-foreground">Hôm nay bạn nên ăn khoảng</Text>
        <Text className="mt-1 font-display text-2xl" style={{ color: accent.primary }}>
          {`${dailySummary.targetCalories.toLocaleString("vi-VN")} kcal`}
        </Text>
        <Text className="mt-0.5 font-body text-xs text-muted-foreground">
          {`Ưu tiên đủ ${dailySummary.targetProtein}g protein trong ngày.`}
        </Text>
      </View>

      <View className="gap-2">
        <SummaryBar
          label="Calories"
          value={`${dailySummary.consumedCalories.toLocaleString("vi-VN")} / ${dailySummary.targetCalories.toLocaleString("vi-VN")} kcal`}
          over={progress.overCalories}
          pct={progress.calories}
          color={accent.primary}
        />
        <SummaryBar
          label="Protein"
          value={`${Math.round(dailySummary.consumedProtein)} / ${Math.round(dailySummary.targetProtein)}g`}
          over={progress.overProtein}
          pct={progress.protein}
          color={PROTEIN_TINT}
        />
      </View>

      <Text className="font-body text-sm leading-5 text-foreground">{remainingSentence(dailySummary)}</Text>

      {canSuggest(dailySummary) ? (
        <Tappable
          className="flex-row items-center justify-center gap-2 rounded-xl bg-panel px-4 py-2.5"
          onPress={() => setShowSuggestions((v) => !v)}
        >
          <Sparkles size={16} color={accent.primary} />
          <Text className="font-body-semibold text-sm text-foreground">Gợi ý món ăn tiếp theo</Text>
          {showSuggestions ? <ChevronUp size={16} color="#8b9299" /> : <ChevronDown size={16} color="#8b9299" />}
        </Tappable>
      ) : null}

      {showSuggestions ? (
        <View className="gap-2">
          <Tappable
            className="flex-row items-center gap-2 rounded-lg px-1 py-1"
            haptic={false}
            onPress={() => setPrefsOpen(true)}
          >
            <SlidersHorizontal size={14} color="#8b9299" />
            <Text className="flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
              {`Ngân sách: ${budgetLabel}${regionLabel ? ` · ${regionLabel}` : ""}`}
            </Text>
            <Text className="font-body-semibold text-xs text-primary">Tuỳ chỉnh</Text>
          </Tappable>

          {loadingSuggestions ? (
            <View className="flex-row items-center gap-2 py-2">
              <ActivityIndicator size="small" color="#8b9299" />
              <Text className="font-body text-xs text-muted-foreground">Đang tìm món phù hợp...</Text>
            </View>
          ) : null}

          {!loadingSuggestions && suggestions?.options.length === 0 ? (
            <Text className="py-2 font-body text-xs text-muted-foreground">
              Chưa tìm được gợi ý phù hợp — bạn có thể tự thêm món trong danh sách bên dưới.
            </Text>
          ) : null}

          {!loadingSuggestions
            ? suggestions?.options.map((option) => {
                const justAdded = addedLabel === option.label;
                const items = effectiveItems(option, itemOverrides);
                const applying = applyMutation.isPending && applyMutation.variables?.label === option.label;
                return (
                  <View key={option.label} className="rounded-xl border border-border bg-panel p-3">
                    <Text className="mb-1.5 font-body-semibold text-xs text-foreground">{option.label}</Text>
                    <View className="gap-1.5">
                      {items.map((item, i) => {
                        const key = itemKey(option.label, i);
                        const pickerOpen = openPickerKey === key;
                        const mine =
                          substituteMutation.variables?.optionLabel === option.label &&
                          substituteMutation.variables?.index === i;
                        const picking = substituteMutation.isPending && mine;
                        const result = substituteMutation.data && mine ? substituteMutation.data : null;
                        const line = itemLine(item);
                        return (
                          <View key={`${key}:${item.foodId}`}>
                            <View className="flex-row items-start gap-2">
                              <Text className="flex-1 font-body text-sm text-foreground">{line.name}</Text>
                              <Text className="pt-0.5 font-body text-xs text-muted-foreground">{line.meta}</Text>
                              <Tappable
                                accessibilityLabel="Đổi món"
                                className="h-7 w-7 items-center justify-center rounded-md"
                                onPress={() => setOpenPickerKey(pickerOpen ? null : key)}
                              >
                                <Repeat size={14} color={pickerOpen ? accent.primary : "#8b9299"} />
                              </Tappable>
                            </View>

                            {pickerOpen ? (
                              <View className="mb-1 mt-1.5 gap-1.5 rounded-lg border border-border bg-background/60 p-2">
                                <View className="flex-row flex-wrap gap-1.5">
                                  {SUBSTITUTE_MODES.map((mode) => (
                                    <Tappable
                                      key={mode}
                                      disabled={substituteMutation.isPending}
                                      className={`rounded-md bg-card px-2 py-1 ${substituteMutation.isPending ? "opacity-50" : ""}`}
                                      onPress={() =>
                                        substituteMutation.mutate({ optionLabel: option.label, index: i, item, mode })
                                      }
                                    >
                                      <Text className="font-body-semibold text-[11px] text-foreground">
                                        {SUBSTITUTE_MODE_LABEL[mode]}
                                      </Text>
                                    </Tappable>
                                  ))}
                                </View>
                                {picking ? (
                                  <View className="flex-row items-center gap-1.5 py-1">
                                    <ActivityIndicator size="small" color="#8b9299" />
                                    <Text className="font-body text-[11px] text-muted-foreground">Đang tìm...</Text>
                                  </View>
                                ) : null}
                                {result && !picking && result.candidates.length === 0 ? (
                                  <Text className="py-1 font-body text-[11px] text-muted-foreground">{result.note}</Text>
                                ) : null}
                                {result && !picking && result.candidates.length > 0 ? (
                                  <View className="gap-1">
                                    {result.candidates.map((cand) => {
                                      const c = itemLine(cand);
                                      return (
                                        <Tappable
                                          key={cand.foodId}
                                          className="flex-row gap-2 rounded-md bg-card px-2 py-1.5"
                                          onPress={() => {
                                            pick(key, cand);
                                            setOpenPickerKey(null);
                                          }}
                                        >
                                          <Text className="flex-1 font-body text-[11px] text-foreground">{c.name}</Text>
                                          <Text className="font-body text-[11px] text-muted-foreground">{c.meta}</Text>
                                        </Tappable>
                                      );
                                    })}
                                    <Text className="pt-0.5 font-body text-[10px] text-muted-foreground">{result.note}</Text>
                                  </View>
                                ) : null}
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                      <Text className="font-body text-xs text-muted-foreground">{`+ ${option.sideNote}`}</Text>
                    </View>

                    <Tappable
                      disabled={applyMutation.isPending}
                      className={`mt-2.5 flex-row items-center justify-center gap-1.5 rounded-lg py-2 ${
                        justAdded ? "border" : "bg-primary"
                      } ${applyMutation.isPending ? "opacity-50" : ""}`}
                      style={justAdded ? { borderColor: "rgba(34,197,94,0.3)", backgroundColor: "rgba(34,197,94,0.1)" } : undefined}
                      onPress={() => applyMutation.mutate({ label: option.label, items })}
                    >
                      {applying ? (
                        <ActivityIndicator size="small" color={accent.onPrimary} />
                      ) : justAdded ? (
                        <>
                          <Check size={14} color={PROTEIN_TINT} />
                          <Text className="font-body-semibold text-xs" style={{ color: PROTEIN_TINT }}>Đã thêm</Text>
                        </>
                      ) : (
                        <>
                          <Plus size={14} color={accent.onPrimary} />
                          <Text className="font-body-semibold text-xs text-on-primary">Thêm bữa này</Text>
                        </>
                      )}
                    </Tappable>
                  </View>
                );
              })
            : null}
        </View>
      ) : null}

      <BottomSheet open={prefsOpen} onClose={() => setPrefsOpen(false)} title="Gợi ý món ăn theo">
        <View className="gap-4 pb-1">
          <View>
            <Text className="mb-2 font-body text-[11px] text-muted-foreground">Ngân sách thực phẩm</Text>
            <View className="gap-2">
              {BUDGET_OPTIONS.map((opt) => (
                <PrefOption
                  key={opt.value}
                  label={opt.label}
                  hint={opt.hint}
                  selected={budgetLevel === opt.value}
                  disabled={prefMutation.isPending}
                  onPress={() => {
                    if (budgetLevel !== opt.value) prefMutation.mutate({ nutritionBudgetLevel: opt.value });
                  }}
                />
              ))}
            </View>
            <Text className="mt-2 font-body text-xs text-muted-foreground">
              Gymini ưu tiên gợi ý món ăn và tạo kế hoạch dinh dưỡng phù hợp với ngân sách này.
            </Text>
          </View>

          <View>
            <Text className="mb-2 font-body text-[11px] text-muted-foreground">Vùng miền (tuỳ chọn)</Text>
            <View className="gap-2">
              {REGION_OPTIONS.map((opt) => (
                <PrefOption
                  key={opt.value}
                  label={opt.label}
                  hint={opt.hint}
                  selected={region === opt.value}
                  disabled={prefMutation.isPending}
                  onPress={() => {
                    const next = regionToSend(region, opt.value);
                    if (next) prefMutation.mutate({ region: next });
                  }}
                />
              ))}
            </View>
            <Text className="mt-2 font-body text-xs text-muted-foreground">
              Gymini sẽ ưu tiên gợi ý và đề xuất đổi món theo phong cách nấu ăn vùng miền này — không bắt
              buộc, để trống thì dùng gợi ý chung toàn quốc.
            </Text>
          </View>
        </View>
      </BottomSheet>
    </Card>
  );
}

function SummaryBar({
  label,
  value,
  over,
  pct,
  color,
}: {
  label: string;
  value: string;
  over: boolean;
  pct: number;
  color: string;
}) {
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(pct, timingProgress);
  }, [pct, fill]);
  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="font-body text-xs text-muted-foreground">{label}</Text>
        <Text className={`font-body text-xs ${over ? "" : "text-foreground"}`} style={over ? { color: WARN } : undefined}>
          {value}
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-panel">
        <Animated.View className="h-full rounded-full" style={[{ backgroundColor: color }, style]} />
      </View>
    </View>
  );
}

function PrefOption({
  label,
  hint,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Tappable
      disabled={disabled}
      onPress={onPress}
      className={`rounded-xl border px-3 py-2.5 ${
        selected ? "border-primary/50 bg-primary/10" : "border-border bg-panel"
      } ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`font-body-semibold text-xs ${selected ? "text-primary" : "text-foreground"}`}>{label}</Text>
      <Text className="mt-0.5 font-body text-[10px] text-muted-foreground">{hint}</Text>
    </Tappable>
  );
}
