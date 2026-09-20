import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Dumbbell, Flame, Search } from "lucide-react-native";

import {
  Card,
  CountUp,
  EmptyState,
  Input,
  Segmented,
  Tappable,
  inputPlaceholderColor,
} from "../../../src/components/ui";
import { statsService, workoutService } from "../../../src/services/api";
import { toDateInputValue } from "../../../src/utils/date";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import {
  ACTIVITY_STATES,
  activityColor,
  activityCounts,
  buildActivityWeeks,
  muscleColor,
  sortMuscles,
  type ActivityDay,
} from "../../../src/features/stats/statsMath";

const TABS = ["Hoạt động", "Nhóm cơ", "Tiến bộ"] as const;
type Tab = (typeof TABS)[number];

/** The design's grid is 17 weeks wide; that is 119 days back including today. */
const HEATMAP_DAYS = 17 * 7;

const MUSCLE_RANGES = [
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
  { value: "cycle", label: "Chu kỳ" },
] as const;

/**
 * CL-15 — statistics.
 *
 * Visual authority: `New Frontend/src/screens/Stats.tsx`, which puts all three views behind one
 * segmented control. Web splits them across three pages; on a phone the design's single screen with
 * segments is the better shape, and it is what the dashboard's "Thống kê" action already points at.
 *
 * Every number is the server's: the grid is `/stats/activity-heatmap`, the streak and totals are
 * `/stats/workouts`, and the muscle heat is `/stats/muscle-heatmap`. The design's sample figures
 * (a 24-day streak, 186 sessions) are not carried over as defaults — an empty history reads as empty.
 */
export default function StatsScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("Hoạt động");

  const today = new Date();
  const to = toDateInputValue(today);
  const from = toDateInputValue(new Date(today.getTime() - (HEATMAP_DAYS - 1) * 86400_000));

  const heatmapQuery = useQuery({
    queryKey: ["activity-heatmap", from, to],
    queryFn: () => statsService.getActivityHeatmap(from, to),
  });
  const workoutStatsQuery = useQuery({
    queryKey: ["workout-stats"],
    queryFn: () => workoutService.getStats(),
  });

  const { refreshing, onRefresh } = usePullToRefresh([
    ["activity-heatmap", from, to],
    ["workout-stats"],
  ]);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 12 }}>
      <View className="flex-row items-center gap-2 px-5">
        <Tappable
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          onPress={() => router.back()}
        >
          <ChevronLeft size={20} color="#8b9299" />
        </Tappable>
        <Text className="flex-1 font-display text-xl text-foreground">Thống kê</Text>
      </View>

      <View className="px-5 pt-4">
        <Segmented options={[...TABS]} value={tab} onChange={(next) => setTab(next as Tab)} />
      </View>

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
        {tab === "Hoạt động" ? (
          <ActivityTab
            days={(heatmapQuery.data?.days ?? []) as ActivityDay[]}
            loading={heatmapQuery.isLoading}
            stats={workoutStatsQuery.data}
          />
        ) : tab === "Nhóm cơ" ? (
          <MuscleTab />
        ) : (
          <ProgressTab />
        )}
      </ScrollView>
    </View>
  );
}

function ActivityTab({
  days,
  loading,
  stats,
}: {
  days: ActivityDay[];
  loading: boolean;
  stats: any;
}) {
  const accent = useWorkspaceAccent();
  const [selected, setSelected] = useState<string | null>(null);

  const weeks = useMemo(() => buildActivityWeeks(days), [days]);
  const counts = useMemo(() => activityCounts(days), [days]);

  const detailQuery = useQuery({
    queryKey: ["activity-day", selected],
    queryFn: () => statsService.getActivityDayDetail(selected!),
    enabled: !!selected,
  });

  if (loading) {
    return (
      <View className="items-center py-16">
        <ActivityIndicator color={accent.primary} />
      </View>
    );
  }

  return (
    <View className="gap-5">
      <Card className="p-5">
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="font-display text-base text-foreground">17 tuần gần nhất</Text>
          <Text className="font-body text-xs text-muted-foreground">
            {counts.completed + counts.partial} buổi có tập
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row gap-1">
            {weeks.map((week, col) => (
              <View key={`w-${col}`} className="gap-1">
                {week.map((day, row) => (
                  <Tappable
                    key={day?.date ?? `empty-${col}-${row}`}
                    haptic={false}
                    disabled={!day}
                    onPress={() => setSelected(day?.date ?? null)}
                  >
                    <View
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        backgroundColor: day ? activityColor(day.state) : "transparent",
                        borderWidth: day?.date === selected ? 1.5 : 0,
                        borderColor: "#e6eae8",
                      }}
                    />
                  </Tappable>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>

        <View className="mt-4 flex-row flex-wrap items-center gap-3">
          {ACTIVITY_STATES.map((state) => (
            <View key={state.key} className="flex-row items-center gap-1.5">
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: state.color }} />
              <Text className="font-body text-[11px] text-muted-foreground">
                {state.label} {counts[state.key] > 0 ? `(${counts[state.key]})` : ""}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {selected ? (
        <Card className="p-4">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="font-body-semibold text-sm text-foreground">
              {selected.split("-").reverse().join("/")}
            </Text>
            <Tappable haptic={false} onPress={() => setSelected(null)}>
              <Text className="font-body text-xs text-primary">Đóng</Text>
            </Tappable>
          </View>
          {detailQuery.isLoading ? (
            <ActivityIndicator color={accent.primary} />
          ) : !detailQuery.data ? (
            <Text className="font-body text-sm text-muted-foreground">Không đọc được chi tiết ngày này.</Text>
          ) : (
            <View className="gap-1.5">
              <Text className="font-body text-sm text-muted-foreground">
                {detailQuery.data.workout?.name ?? "Không có buổi tập nào"}
              </Text>
              {detailQuery.data.volumeKg != null ? (
                <Text className="font-body text-sm text-foreground">
                  Khối lượng: {Math.round(detailQuery.data.volumeKg).toLocaleString("vi-VN")} kg
                </Text>
              ) : null}
              {detailQuery.data.durationMinutes != null ? (
                <Text className="font-body text-sm text-foreground">
                  Thời lượng: {detailQuery.data.durationMinutes} phút
                </Text>
              ) : null}
              {detailQuery.data.prs?.length > 0 ? (
                <View className="mt-1 gap-1">
                  <Text className="font-body-semibold text-xs text-primary">
                    {detailQuery.data.prs.length} kỷ lục cá nhân
                  </Text>
                  {detailQuery.data.prs.slice(0, 3).map((pr: any) => (
                    <Text key={pr.exerciseId} className="font-body text-xs text-muted-foreground">
                      {pr.exerciseName}
                      {pr.weightKg != null ? ` · ${pr.weightKg} kg` : ""}
                      {pr.reps != null ? ` × ${pr.reps}` : ""}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          )}
        </Card>
      ) : null}

      <View className="flex-row gap-3">
        <Card className="flex-1 p-4">
          <Text className="font-body text-xs text-muted-foreground">Chuỗi hiện tại</Text>
          <Text className="font-display text-3xl text-foreground">
            <CountUp to={Number(stats?.currentStreakDays ?? 0)} />
          </Text>
          <Text className="font-body text-xs text-muted-foreground">ngày liên tục</Text>
        </Card>
        <Card className="flex-1 p-4">
          <Text className="font-body text-xs text-muted-foreground">Tổng buổi tập</Text>
          <Text className="font-display text-3xl text-foreground">
            <CountUp to={Number(stats?.totalWorkouts ?? 0)} />
          </Text>
          <Text className="font-body text-xs text-muted-foreground">
            {stats?.workoutsPerWeek ?? 0} buổi/tuần
          </Text>
        </Card>
      </View>
    </View>
  );
}

function MuscleTab() {
  const accent = useWorkspaceAccent();
  const [range, setRange] = useState<(typeof MUSCLE_RANGES)[number]["value"]>("30d");

  const query = useQuery({
    queryKey: ["muscle-heatmap", range],
    queryFn: () => statsService.getMuscleHeatmap({ range }),
  });

  const muscles = useMemo(() => sortMuscles(query.data), [query.data]);
  const maxScore = muscles.reduce((max, m) => Math.max(max, m.score), 0);

  return (
    <View className="gap-4">
      <View className="flex-row gap-2">
        {MUSCLE_RANGES.map((option) => (
          <Tappable
            key={option.value}
            className={`rounded-full border px-3.5 py-1.5 ${
              range === option.value ? "border-primary bg-primary/15" : "border-border bg-card"
            }`}
            onPress={() => setRange(option.value)}
          >
            <Text
              className={`font-body-medium text-xs ${range === option.value ? "text-primary" : "text-muted-foreground"}`}
            >
              {option.label}
            </Text>
          </Tappable>
        ))}
      </View>

      {query.isLoading ? (
        <View className="items-center py-16">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : muscles.length === 0 ? (
        <EmptyState
          icon={Flame}
          title="Chưa có dữ liệu nhóm cơ"
          description={
            range === "cycle" && query.data?.noActiveCycle
              ? "Bạn chưa có chu kỳ tập nào đang chạy — chọn 7 hoặc 30 ngày để xem theo khoảng thời gian."
              : "Ghi vài buổi tập trong khoảng này là bản đồ nhóm cơ sẽ có số liệu."
          }
        />
      ) : (
        <Card className="p-4">
          <Text className="font-display mb-3 text-base text-foreground">Khối lượng theo nhóm cơ</Text>
          <View className="gap-3">
            {muscles.map((muscle) => (
              <View key={muscle.muscleId || muscle.code}>
                <View className="mb-1 flex-row items-center justify-between">
                  <Text className="font-body-medium text-xs text-muted-foreground">{muscle.nameVi}</Text>
                  <Text className="font-body-semibold text-xs text-foreground">
                    {Math.round(muscle.score).toLocaleString("vi-VN")}
                  </Text>
                </View>
                <View className="h-2 overflow-hidden rounded-full bg-panel">
                  <View
                    className="h-full rounded-full"
                    style={{
                      width: `${maxScore > 0 ? (muscle.score / maxScore) * 100 : 0}%`,
                      backgroundColor: muscleColor(muscle.intensity),
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
          <Text className="mt-3 font-body text-[11px] leading-4 text-muted-foreground">
            Thanh dài theo khối lượng tuyệt đối; màu theo mức độ tập trung mà máy chủ tính.
          </Text>
        </Card>
      )}
    </View>
  );
}

function ProgressTab() {
  const accent = useWorkspaceAccent();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const exercisesQuery = useQuery({
    queryKey: ["exercise-library", { search: query, page: 1 }],
    queryFn: () => workoutService.getExercises({ search: query || undefined, page: 1, limit: 12 }),
    staleTime: 60_000,
  });

  const exercises: any[] = Array.isArray(exercisesQuery.data) ? exercisesQuery.data : [];

  return (
    <View className="gap-4">
      <Text className="font-body text-sm leading-5 text-muted-foreground">
        Chọn một bài tập để xem tiến bộ qua từng buổi. Chỉ số hiển thị phụ thuộc kiểu ghi của bài —
        bài có tạ xem khối lượng và 1RM ước tính, bài tính giờ xem thời gian giữ.
      </Text>

      <Input
        value={input}
        onChangeText={setInput}
        placeholder="Tìm bài tập…"
        placeholderTextColor={inputPlaceholderColor}
        icon={Search}
        autoCorrect={false}
      />

      {exercisesQuery.isLoading ? (
        <View className="items-center py-10">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : exercises.length === 0 ? (
        <EmptyState icon={Search} title="Không tìm thấy bài tập nào" description="Thử một từ khoá khác." />
      ) : (
        <View className="gap-2">
          {exercises.map((exercise) => (
            <Card
              key={String(exercise.id)}
              className="flex-row items-center gap-3 p-3.5"
              onPress={() =>
                router.push({
                  pathname: "/client/stats/exercise-progress/[id]",
                  params: { id: String(exercise.id) },
                })
              }
            >
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                <Dumbbell size={18} color={accent.primary} />
              </View>
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                  {exercise.exerciseName}
                </Text>
                <Text className="font-body text-xs text-muted-foreground">
                  {exercise.loggingMode === "BODYWEIGHT_REPS"
                    ? "Trọng lượng cơ thể"
                    : exercise.loggingMode === "TIME"
                      ? "Tính giờ"
                      : "Có tạ + số lần"}
                </Text>
              </View>
              <ChevronRight size={18} color="#8b9299" />
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}
