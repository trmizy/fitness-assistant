import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, LineChart, TrendingDown, TrendingUp } from "lucide-react-native";

import { Badge, Card, EmptyState, Tappable } from "../../../../src/components/ui";
import { statsService } from "../../../../src/services/api";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import {
  MODE_LABELS,
  barHeights,
  metricsFor,
  seriesFor,
  summarize,
  type ExerciseLoggingMode,
} from "../../../../src/features/stats/statsMath";

/**
 * CL-15 (progress) — one exercise over time.
 *
 * Which series even exists depends on how the exercise is logged, and the table comes from web: a
 * bodyweight exercise has no 1RM to estimate, a timed hold has no weight, and for pace a smaller
 * number is a better one. Sessions where a metric was not recorded are left out of the chart rather
 * than drawn as zero — the API returns null for those, and `Number(null)` is 0, which is exactly the
 * trap the unit tests catch.
 *
 * Bars rather than a line: at four to ten sessions a bar per session reads more honestly on a phone
 * than a line implying continuity between two months apart.
 */
export default function ExerciseProgressScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [metricId, setMetricId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["exercise-progress", id],
    queryFn: () => statsService.getExerciseProgress(String(id)),
    enabled: !!id,
  });

  const result = query.data;
  const metrics = useMemo(() => metricsFor(result?.loggingMode), [result?.loggingMode]);
  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
  const points = useMemo(
    () => (result ? seriesFor(result.sessions ?? [], metric.dataKey) : []),
    [result, metric.dataKey],
  );
  const summary = summarize(points, metric.lowerIsBetter);
  const heights = barHeights(points);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40 }}
    >
      <View className="flex-row items-center gap-2 px-5">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground" numberOfLines={2}>
          {result?.exerciseName ?? "Tiến bộ"}
        </Text>
      </View>

      {query.isLoading ? (
        <View className="items-center py-16">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : !result ? (
        <EmptyState
          icon={LineChart}
          title="Không đọc được dữ liệu tiến bộ"
          description="Thử lại khi có kết nối, hoặc chọn bài tập khác."
        />
      ) : (
        <View className="gap-4 px-5 pt-4">
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{MODE_LABELS[result.loggingMode as ExerciseLoggingMode] ?? "Có tạ + số lần"}</Badge>
            <Badge tone="info">{(result.sessions ?? []).length} buổi có ghi</Badge>
          </View>

          {metrics.length > 1 ? (
            <View className="flex-row flex-wrap gap-2">
              {metrics.map((option) => (
                <Tappable
                  key={option.id}
                  className={`rounded-full border px-3.5 py-1.5 ${
                    option.id === metric.id ? "border-primary bg-primary/15" : "border-border bg-card"
                  }`}
                  onPress={() => setMetricId(option.id)}
                >
                  <Text
                    className={`font-body-medium text-xs ${
                      option.id === metric.id ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {option.title}
                  </Text>
                </Tappable>
              ))}
            </View>
          ) : null}

          {points.length === 0 ? (
            <EmptyState
              icon={LineChart}
              title="Chưa có số liệu cho chỉ số này"
              description={`Ghi vài buổi có ${metric.title.toLowerCase()} là biểu đồ sẽ có dữ liệu.`}
            />
          ) : (
            <>
              <Card className="p-4">
                <Text className="font-display text-base text-foreground">{metric.title}</Text>
                {metric.note ? (
                  <Text className="mt-0.5 font-body text-[11px] text-muted-foreground">{metric.note}</Text>
                ) : null}

                <View className="mt-4 h-40 flex-row items-end justify-between gap-2">
                  {points.map((point, index) => (
                    <View key={`${point.date}-${index}`} className="flex-1 items-center gap-1.5">
                      <Text className="font-body text-[10px] text-muted-foreground">{point.value}</Text>
                      <View className="h-24 w-full justify-end">
                        <View
                          className="w-full rounded-md"
                          style={{
                            height: `${heights[index]}%`,
                            backgroundColor: `${accent.primary}b3`,
                          }}
                        />
                      </View>
                      <Text className="font-body text-[10px] text-muted-foreground">
                        {point.date.slice(8, 10)}/{point.date.slice(5, 7)}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>

              {summary ? (
                <View className="flex-row gap-3">
                  <Card className="flex-1 p-4">
                    <Text className="font-body text-xs text-muted-foreground">Tốt nhất</Text>
                    <Text className="font-display text-2xl text-foreground">
                      {summary.best}
                      <Text className="font-display text-sm text-muted-foreground"> {metric.unit}</Text>
                    </Text>
                  </Card>
                  <Card className="flex-1 p-4">
                    <Text className="font-body text-xs text-muted-foreground">Thay đổi</Text>
                    <View className="flex-row items-center gap-1.5">
                      {summary.improved == null ? null : summary.delta > 0 ? (
                        <TrendingUp size={16} color={summary.improved ? accent.primary : "#ef4444"} />
                      ) : (
                        <TrendingDown size={16} color={summary.improved ? accent.primary : "#ef4444"} />
                      )}
                      <Text
                        className="font-display text-2xl"
                        style={{
                          color:
                            summary.improved == null
                              ? "#e6eae8"
                              : summary.improved
                                ? accent.primary
                                : "#ef4444",
                        }}
                      >
                        {summary.delta > 0 ? "+" : ""}
                        {summary.delta}
                      </Text>
                    </View>
                    <Text className="font-body text-xs text-muted-foreground">
                      {summary.improved == null ? "chưa đủ để kết luận" : `${metric.unit} so với buổi đầu`}
                    </Text>
                  </Card>
                </View>
              ) : null}
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}
