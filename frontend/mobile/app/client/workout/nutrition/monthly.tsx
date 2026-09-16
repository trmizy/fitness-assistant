import { useMemo } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Animated, { FadeIn } from "react-native-reanimated";
import { Award, Check, Flame, TrendingUp, type LucideIcon } from "lucide-react-native";

import { Badge, Card, CountUp, EmptyState, ScreenHeader } from "../../../../src/components/ui";
import { nutritionService } from "../../../../src/services/api";
import { toDateInputValue } from "../../../../src/utils/date";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import { normalizeLogs, sumTotals } from "../../../../src/features/nutrition/nutritionMath";

/**
 * CL-19 (summary half) — the month behind the day.
 *
 * Visual authority: `New Frontend/NutritionExtras.tsx#MonthlySummary` — an adherence headline, a
 * tile grid, and a dot-per-day calendar.
 *
 * What the data actually supports differs from the mock in two places, and the mock loses:
 * - Its "Nước TB / ngày" tile is dropped. Nothing in the product logs water intake — `waterMl` on a
 *   goal is a target, never a measurement — so that tile could only ever show a made-up number.
 * - Average protein is not in `/nutrition/monthly-summary` (it returns calories and a per-day
 *   status), so it is computed from the month's own logs, which is a real figure rather than a
 *   guess. The day dots keep the endpoint's own status.
 */
const STATUS_LABEL: Record<string, string> = {
  completed: "Đạt",
  partial: "Một phần",
  in_progress: "Đang ghi",
  skipped: "Bỏ qua",
  pending: "Chưa ghi",
};

export default function NutritionMonthlyScreen() {
  const accent = useWorkspaceAccent();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const startStr = toDateInputValue(monthStart);
  const endStr = toDateInputValue(monthEnd);

  const summaryQuery = useQuery({
    queryKey: ["nutrition-monthly-summary", startStr],
    queryFn: () => nutritionService.getMonthlySummary(startStr, endStr),
  });
  const logsQuery = useQuery({
    queryKey: ["nutrition-logs-month", startStr],
    queryFn: () => nutritionService.getLogs(startStr, endStr),
  });

  const days = summaryQuery.data ?? [];
  const logs = useMemo(() => normalizeLogs(logsQuery.data), [logsQuery.data]);

  const stats = useMemo(() => {
    const daysWithFood = days.filter((d) => d.calories > 0);
    const hitDays = days.filter((d) => d.status === "completed");
    const totalCalories = daysWithFood.reduce((sum, d) => sum + d.calories, 0);

    // Protein per day is averaged over the days that actually have logs, not over the whole month —
    // dividing by 30 when someone logged three days reads as a collapse in adherence that never
    // happened.
    const loggedDates = new Set(logs.map((log) => log.date.slice(0, 10)));
    const totals = sumTotals(logs);

    return {
      adherence: days.length > 0 ? Math.round((hitDays.length / days.length) * 100) : 0,
      hitDays: hitDays.length,
      totalDays: days.length,
      avgCalories: daysWithFood.length > 0 ? Math.round(totalCalories / daysWithFood.length) : 0,
      avgProtein: loggedDates.size > 0 ? Math.round(totals.protein / loggedDates.size) : 0,
      loggedDays: loggedDates.size,
    };
  }, [days, logs]);

  const loading = summaryQuery.isLoading || logsQuery.isLoading;
  const monthLabel = `tháng ${now.getMonth() + 1}`;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={`Tổng kết ${monthLabel}`} onBack={() => router.back()} />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : days.length === 0 ? (
        <EmptyState
          icon={Flame}
          title={`Chưa có dữ liệu ${monthLabel}`}
          description="Ghi nhật ký ăn uống vài ngày là phần tổng kết này sẽ có số liệu thật."
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}
        >
          <Card className="overflow-hidden p-5">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Badge tone={stats.adherence >= 70 ? "success" : stats.adherence >= 40 ? "warning" : "neutral"}>
                  {stats.adherence >= 70 ? "Tuân thủ tốt" : stats.adherence >= 40 ? "Cần cố gắng" : "Chưa đều"}
                </Badge>
                <Text className="font-display mt-2 text-4xl text-foreground">
                  <CountUp to={stats.adherence} suffix="%" />
                </Text>
                <Text className="font-body text-sm text-muted-foreground">Tỉ lệ ngày đạt mục tiêu calo</Text>
              </View>
              <Award size={56} color={`${accent.primary}4d`} />
            </View>
          </Card>

          <View className="mt-4 flex-row flex-wrap gap-3">
            <Tile
              icon={Flame}
              label="Calo TB / ngày"
              value={stats.avgCalories.toLocaleString("vi-VN")}
              sub={`trên ${stats.loggedDays} ngày có ghi`}
            />
            <Tile
              icon={TrendingUp}
              label="Đạm TB / ngày"
              value={`${stats.avgProtein}g`}
              sub="tính từ nhật ký thật"
            />
            <Tile
              icon={Check}
              label="Ngày đạt mục tiêu"
              value={String(stats.hitDays)}
              sub={`/ ${stats.totalDays} ngày`}
            />
            <Tile
              icon={Flame}
              label="Ngày có ghi nhật ký"
              value={String(stats.loggedDays)}
              sub={`/ ${stats.totalDays} ngày`}
            />
          </View>

          <Card className="mt-4 p-4">
            <Text className="font-display mb-3 text-base text-foreground">Lịch tuân thủ</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {days.map((day, index) => {
                const done = day.status === "completed";
                const partial = day.status === "partial" || day.status === "in_progress";
                return (
                  <Animated.View
                    key={day.date}
                    entering={FadeIn.delay(index * 12).duration(220)}
                    className="h-7 w-7 items-center justify-center rounded-[6px]"
                    style={{
                      backgroundColor: done
                        ? accent.primary
                        : partial
                          ? `${accent.primary}59`
                          : "#1b1f1d",
                    }}
                  >
                    <Text
                      className="font-body text-[10px]"
                      style={{ color: done ? accent.onPrimary : "#8b9299" }}
                    >
                      {Number(day.date.slice(8, 10))}
                    </Text>
                  </Animated.View>
                );
              })}
            </View>
            <View className="mt-3 flex-row flex-wrap gap-3">
              {(["completed", "partial", "pending"] as const).map((status) => (
                <View key={status} className="flex-row items-center gap-1.5">
                  <View
                    className="h-3 w-3 rounded-[3px]"
                    style={{
                      backgroundColor:
                        status === "completed"
                          ? accent.primary
                          : status === "partial"
                            ? `${accent.primary}59`
                            : "#1b1f1d",
                    }}
                  />
                  <Text className="font-body text-[11px] text-muted-foreground">
                    {STATUS_LABEL[status]}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Card className="min-w-[45%] flex-1 p-4">
      <Icon size={18} color={accent.primary} />
      <Text className="font-display mt-2 text-xl text-foreground">{value}</Text>
      <Text className="font-body text-xs text-muted-foreground">{label}</Text>
      <Text className="mt-0.5 font-body text-[11px] text-muted-foreground">{sub}</Text>
    </Card>
  );
}
