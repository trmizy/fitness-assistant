import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import {
  ChevronLeft,
  Coffee,
  Compass,
  Flame,
  Moon,
  Plus,
  PowerOff,
  Search,
  Target,
  Trash2,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  CountUp,
  EmptyState,
  ProgressRing,
  SwipeRow,
  Tappable,
  useToast,
} from "../../../../src/components/ui";
import { nutritionService } from "../../../../src/services/api";
import { toDateInputValue } from "../../../../src/utils/date";
import { haptics } from "../../../../src/lib/haptics";
import { usePullToRefresh } from "../../../../src/hooks/usePullToRefresh";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import { timingProgress } from "../../../../src/theme/motion";
import {
  MEAL_LABELS,
  MEAL_TYPES,
  goalProgress,
  groupByMeal,
  normalizeLogs,
  sumTotals,
  type MealType,
} from "../../../../src/features/nutrition/nutritionMath";
import { BeginnerNutritionSummary } from "../../../../src/components/nutrition/BeginnerNutritionSummary";

/**
 * CL-03 — the nutrition day.
 *
 * Visual authority: `New Frontend/src/screens/Nutrition.tsx`. Behavioural authority: web's
 * `NutritionPage.tsx` and, above it, the endpoints themselves.
 *
 * Where the design is a mock, this follows the data instead:
 * - The reference's "Nhiệm vụ AI hôm nay" card is filled from `GET /nutrition/daily-task`, and is
 *   rendered ONLY when a nutrition program actually exists (`hasProgram`). With no program there is
 *   no daily task to state, and inventing one would be claiming something the backend never said.
 * - Its meal rows are fixed sample meals; here the four meals are the real `mealType` groups of
 *   today's logs, each row swipeable to delete the log it stands for.
 * - Totals come from `dailyTask.actualProgress` when a program is running (the server's own figure)
 *   and from summing today's logs otherwise — the same precedence web uses.
 *
 * Route: under the Tập luyện tab, per doc 08 §4.2 and Ngài's 2026-09-13 decision that nutrition is
 * sub-navigation of a larger tab rather than a tab of its own.
 */
const MEAL_ICONS: Record<MealType, LucideIcon> = {
  breakfast: Coffee,
  lunch: UtensilsCrossed,
  snack: Flame,
  dinner: Moon,
};

const MACRO_TINTS = { protein: "#22c55e", carbs: "#f59e0b", fat: "#a78bfa" };

export default function NutritionScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();

  const today = toDateInputValue(new Date());

  const goalQuery = useQuery({
    queryKey: ["nutrition-goal"],
    queryFn: () => nutritionService.getGoal(),
  });
  const logsQuery = useQuery({
    queryKey: ["nutrition-logs", today],
    queryFn: () => nutritionService.getLogs(today, today),
    staleTime: 0,
  });
  const dailyTaskQuery = useQuery({
    queryKey: ["nutrition-daily-task", today],
    queryFn: () => nutritionService.getDailyTask(today),
    staleTime: 0,
  });

  const { refreshing, onRefresh } = usePullToRefresh([
    ["nutrition-goal"],
    ["nutrition-logs", today],
    ["nutrition-daily-task", today],
  ]);

  // This screen stays mounted in the Tập luyện tab's Stack, so returning to it — from the add
  // screen, from another tab, or after a change made anywhere else — must re-read the day. The
  // logging screen needed the same fix (ADAPTERS §20.10); without it a deleted meal stayed on
  // screen and the day's totals were a lie.
  useFocusEffect(
    useCallback(() => {
      void queryClient.refetchQueries({ queryKey: ["nutrition-logs", today], type: "active" }, { cancelRefetch: false });
      void queryClient.refetchQueries({ queryKey: ["nutrition-daily-task", today], type: "active" }, { cancelRefetch: false });
      void queryClient.refetchQueries({ queryKey: ["nutrition-goal"], type: "active" }, { cancelRefetch: false });
    }, [queryClient, today]),
  );

  const logs = useMemo(() => normalizeLogs(logsQuery.data), [logsQuery.data]);
  const groups = useMemo(() => groupByMeal(logs), [logs]);
  const loggedTotals = useMemo(() => sumTotals(logs), [logs]);

  const dailyTask = dailyTaskQuery.data;
  const hasProgram = !!dailyTask?.hasProgram;
  // The server's own progress wins when it exists; logs are the fallback, exactly as on web.
  const totals = {
    calories: dailyTask?.actualProgress?.calories ?? loggedTotals.calories,
    protein: dailyTask?.actualProgress?.protein ?? loggedTotals.protein,
    carbs: dailyTask?.actualProgress?.carbs ?? loggedTotals.carbs,
    fat: dailyTask?.actualProgress?.fat ?? loggedTotals.fat,
  };

  const goal = goalQuery.data;
  const goalCalories = goal?.calories ?? 0;
  const remaining = Math.max(0, Math.round(goalCalories - totals.calories));
  const progress = goalProgress(totals.calories, goalCalories);

  const openAdd = (meal?: MealType) => {
    haptics.tap();
    router.push(
      meal
        ? { pathname: "/client/workout/nutrition/add", params: { meal } }
        : "/client/workout/nutrition/add",
    );
  };

  const removeLog = async (id: string) => {
    try {
      await nutritionService.deleteLog(id);
      await queryClient.refetchQueries({ queryKey: ["nutrition-logs", today] }).catch(() => {});
      haptics.tap();
    } catch {
      toast.show("Không xoá được món này.", "danger");
    }
  };

  const [confirmOff, setConfirmOff] = useState(false);
  const deactivate = async () => {
    const programId = dailyTask?.program?.id;
    if (!programId) return;
    try {
      await nutritionService.deactivateNutritionProgram(String(programId));
      setConfirmOff(false);
      await queryClient.refetchQueries({ queryKey: ["nutrition-daily-task", today] }).catch(() => {});
      toast.show("Đã huỷ chương trình dinh dưỡng", "success");
    } catch {
      toast.show("Không huỷ được chương trình.", "danger");
    }
  };

  const loading = goalQuery.isLoading || logsQuery.isLoading;

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-2 px-5" style={{ paddingTop: insets.top + 12 }}>
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-2xl text-foreground">Dinh dưỡng</Text>
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.push("/client/library")}
        >
          <Compass size={19} color="#8b9299" />
        </Tappable>
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.push("/client/workout/nutrition/goals")}
        >
          <Target size={19} color="#8b9299" />
        </Tappable>
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full bg-primary"
          onPress={() => openAdd()}
        >
          <Plus size={22} strokeWidth={2.5} color={accent.onPrimary} />
        </Tappable>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={accent.primary}
              colors={[accent.primary]}
            />
          }
        >
          <Tappable
            className="mb-5 flex-row items-center gap-2 rounded-xl border border-border bg-panel px-3.5 py-3"
            haptic={false}
            onPress={() => router.push("/client/library/search")}
          >
            <Search size={18} color="#8b9299" />
            <Text className="font-body text-sm text-muted-foreground">
              Tìm thực phẩm, bài tập, kiến thức…
            </Text>
          </Tappable>

          {/* Calories + macros */}
          <Card className="p-5">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="font-body text-sm text-muted-foreground">Còn lại hôm nay</Text>
                <Text className="font-display text-4xl text-foreground">
                  <CountUp to={remaining} /> kcal
                </Text>
                <Text className="mt-1 font-body text-sm text-muted-foreground">
                  {Math.round(totals.calories).toLocaleString("vi-VN")} /{" "}
                  {goalCalories.toLocaleString("vi-VN")} kcal
                </Text>
              </View>
              <ProgressRing progress={progress} size={92} stroke={9}>
                <Text className="font-display text-xl text-foreground">
                  <CountUp to={Math.round(progress * 100)} suffix="%" />
                </Text>
              </ProgressRing>
            </View>

            <View className="mt-5 gap-3">
              <MacroBar label="Đạm" value={totals.protein} goal={goal?.protein ?? 0} color={MACRO_TINTS.protein} />
              <MacroBar label="Tinh bột" value={totals.carbs} goal={goal?.carbs ?? 0} color={MACRO_TINTS.carbs} />
              <MacroBar label="Chất béo" value={totals.fat} goal={goal?.fat ?? 0} color={MACRO_TINTS.fat} />
            </View>
          </Card>

          {/* WB-14 — web places it between the day's totals and the program card. */}
          <BeginnerNutritionSummary dailySummary={dailyTask?.dailySummary} dateStr={today} />

          {/* Only with a real program behind it. */}
          {hasProgram ? (
            <Card className="mt-4 flex-row items-center gap-3 border-primary/30 bg-primary/5 p-4">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                <Flame size={18} color={accent.primary} />
              </View>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">
                  {dailyTask?.program?.name ?? "Chương trình dinh dưỡng"}
                </Text>
                <Text className="mt-0.5 font-body text-xs text-muted-foreground">
                  {dailyTask?.day?.name ? `${dailyTask.day.name} · ` : ""}
                  {Array.isArray(dailyTask?.meals) ? `${dailyTask.meals.length} bữa theo kế hoạch` : "Theo kế hoạch"}
                </Text>
              </View>
              <Badge tone="success">Đang chạy</Badge>
            </Card>
          ) : null}

          {/* Meals */}
          <View className="mb-3 mt-6 flex-row items-center justify-between px-1">
            <Text className="font-display text-lg text-foreground">Bữa ăn</Text>
            <Tappable haptic={false} onPress={() => router.push("/client/workout/nutrition/monthly")}>
              <Text className="font-body-semibold text-sm text-primary">Tổng kết tháng</Text>
            </Tappable>
          </View>

          {logs.length === 0 ? (
            <EmptyState
              icon={UtensilsCrossed}
              title="Hôm nay chưa ghi món nào"
              description="Bấm dấu + để tìm món trong thư viện thực phẩm và ghi vào nhật ký."
              actionLabel="Thêm món"
              onAction={() => openAdd()}
            />
          ) : (
            <View className="gap-4">
              {MEAL_TYPES.map((meal) => {
                const rows = groups[meal];
                const Icon = MEAL_ICONS[meal];
                const kcal = rows.reduce((sum, row) => sum + row.calories, 0);
                if (rows.length === 0) return null;
                return (
                  <View key={meal}>
                    <View className="mb-2 flex-row items-center gap-2.5 px-1">
                      <View className="h-9 w-9 items-center justify-center rounded-xl bg-panel">
                        <Icon size={17} color={accent.primary} />
                      </View>
                      <Text className="flex-1 font-body-semibold text-sm text-foreground">
                        {MEAL_LABELS[meal]}
                      </Text>
                      <Text className="font-display text-sm text-foreground">
                        {kcal.toLocaleString("vi-VN")} kcal
                      </Text>
                      <Tappable
                        className="h-8 w-8 items-center justify-center rounded-lg bg-panel"
                        onPress={() => openAdd(meal)}
                      >
                        <Plus size={15} color={accent.primary} />
                      </Tappable>
                    </View>
                    <View className="gap-2">
                      {rows.map((row) => (
                        <SwipeRow
                          key={row.id}
                          actionLabel="Xoá"
                          actionIcon={Trash2}
                          onAction={() => void removeLog(row.id)}
                        >
                          <Card className="flex-row items-center gap-3 p-3.5">
                            <View className="flex-1">
                              <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                                {row.foodName}
                              </Text>
                              <Text className="mt-0.5 font-body text-[11px] text-muted-foreground">
                                {row.protein}g đạm · {row.carbs}g tinh bột · {row.fat}g béo
                                {row.notes ? ` · ${row.notes}` : ""}
                              </Text>
                            </View>
                            <Text className="font-display text-sm text-foreground">
                              {row.calories.toLocaleString("vi-VN")}
                            </Text>
                          </Card>
                        </SwipeRow>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {hasProgram ? (
            <Tappable
              className="mt-6 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5"
              onPress={() => setConfirmOff(true)}
            >
              <PowerOff size={16} color="#ef4444" />
              <Text className="font-body-semibold text-sm text-destructive">
                Huỷ chương trình dinh dưỡng
              </Text>
            </Tappable>
          ) : null}
        </ScrollView>
      )}

      {/* No text input in here, so a sheet is still the right shape for it. */}
      <BottomSheet open={confirmOff} onClose={() => setConfirmOff(false)} title="Huỷ chương trình?">
        <View className="gap-4 pb-1">
          <Text className="font-body text-sm leading-6 text-muted-foreground">
            Khi huỷ, ứng dụng ngừng theo dõi calo và macro theo kế hoạch. Nhật ký ăn uống của bạn vẫn
            được giữ và có thể kích hoạt lại bất cứ lúc nào.
          </Text>
          <Button full size="lg" variant="destructive" onPress={deactivate}>
            Xác nhận huỷ
          </Button>
          <Button full variant="ghost" onPress={() => setConfirmOff(false)}>
            Giữ lại
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}

/** The reference's macro row: label, eaten/target, and a bar that grows on the design's curve. */
function MacroBar({
  label,
  value,
  goal,
  color,
}: {
  label: string;
  value: number;
  goal: number;
  color: string;
}) {
  const fill = useSharedValue(0);
  const pct = goal > 0 ? Math.min(1, Math.max(0, value / goal)) : 0;

  useEffect(() => {
    fill.value = withTiming(pct, timingProgress);
  }, [pct, fill]);

  const style = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View>
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="font-body-medium text-xs text-muted-foreground">{label}</Text>
        <Text className="font-body-semibold text-xs text-foreground">
          {Math.round(value)}
          <Text className="font-body text-muted-foreground"> / {Math.round(goal)}g</Text>
        </Text>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-panel">
        <Animated.View className="h-full rounded-full" style={[{ backgroundColor: color }, style]} />
      </View>
    </View>
  );
}
