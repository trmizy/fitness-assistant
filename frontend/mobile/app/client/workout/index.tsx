import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarClock,
  Check,
  ChevronRight,
  Compass,
  Dumbbell,
  LayoutTemplate,
  Play,
  Plus,
  Repeat,
  Upload,
  type LucideIcon,
} from "lucide-react-native";

import {
  Badge,
  Button,
  Card,
  CountUp,
  EmptyState,
  ProgressRing,
  Segmented,
  Skeleton,
  Stagger,
  StaggerItem,
  Tappable,
} from "../../../src/components/ui";
import { trainingCycleService, workoutService } from "../../../src/services/api";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { addDays, parseApiDateOnly, startOfWeek, toDateInputValue } from "../../../src/utils/date";
import { buildTrainingWeek } from "../../../src/features/workout/trainingWeek";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

const TABS = ["Lịch tuần", "Nhật ký", "Chu kỳ"] as const;
type Tab = (typeof TABS)[number];

/**
 * CL-02 — "Tập luyện".
 *
 * Visual authority: `New Frontend/src/screens/Workout.tsx` — three segments (Lịch tuần / Nhật ký
 * / Chu kỳ) plus a toolbar row. Behavioural authority: web's `TrainingPage.tsx` host and the
 * services it mounts.
 *
 * Web's `WorkoutLogPage.tsx` is ~9.000 dòng because it is a desktop screen that also owns a month
 * calendar, session feedback, rescheduling, exercise substitution and custom-exercise creation.
 * Porting it line for line would produce a phone screen nobody designed. What is ported is the
 * API contract it established — same endpoints, same date handling — rendered as the three
 * segments the mobile design actually specifies. The desktop-only surfaces are tracked per-screen
 * in MOBILE_MIGRATION_MANIFEST.md rather than smuggled in here.
 */
export default function WorkoutScreen() {
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("Lịch tuần");

  const weekStart = useMemo(() => startOfWeek(new Date()), []);

  const schedulesQuery = useQuery({
    queryKey: ["workout-schedules", "week"],
    queryFn: () =>
      workoutService.getSchedules(50, {
        startDate: toDateInputValue(weekStart),
        endDate: toDateInputValue(addDays(weekStart, 6)),
      }),
  });

  const historyQuery = useQuery({
    queryKey: ["workout-history", "recent"],
    queryFn: () => workoutService.getHistory(1, 10),
  });

  const cycleQuery = useQuery({
    queryKey: ["training-cycle", "active"],
    queryFn: () => trainingCycleService.getActive(),
    // An account with no active cycle answers 404 — that is a normal state, not an outage, so it
    // must not be retried three times before the empty state can render.
    retry: false,
  });

  const { refreshing, onRefresh } = usePullToRefresh([
    ["workout-schedules", "week"],
    ["workout-history", "recent"],
    ["training-cycle", "active"],
  ]);

  // Day-state rules (rest / past / in progress / done) live in buildTrainingWeek, where they are tested.
  const week = useMemo(
    () => buildTrainingWeek(schedulesQuery.data, weekStart),
    [schedulesQuery.data, weekStart],
  );

  const planned = week.filter((d) => !d.rest).length;
  const done = week.filter((d) => d.done).length;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} colors={[accent.primary]} />
      }
    >
      <View className="px-5">
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="font-display text-2xl text-foreground">Tập luyện</Text>
          <View className="flex-row items-center gap-2">
            <ToolButton icon={Compass} onPress={() => router.push("/client/library")} />
            <ToolButton icon={LayoutTemplate} onPress={() => router.push("/client/workout/templates")} />
            <ToolButton icon={Upload} onPress={() => router.push("/client/workout/import")} />
            <ToolButton icon={BarChart3} onPress={() => router.push("/client/stats/activity")} />
            <Tappable
              className="h-10 w-10 items-center justify-center rounded-full bg-primary"
              onPress={() => router.push("/client/workout/log")}
            >
              <Plus size={22} color={accent.onPrimary} strokeWidth={2.5} />
            </Tappable>
          </View>
        </View>
        <Segmented options={[...TABS]} value={tab} onChange={(next) => setTab(next as Tab)} />
      </View>

      <View className="px-5 pt-5">
        {tab === "Lịch tuần" ? (
          <View className="gap-5">
            <Card className="flex-row items-center gap-4 p-4">
              <ProgressRing progress={planned > 0 ? done / planned : 0} size={64} stroke={7}>
                <Text className="font-display text-sm text-foreground">
                  {done}/{planned}
                </Text>
              </ProgressRing>
              <View className="flex-1">
                <Text className="font-display text-base text-foreground">Tuần này</Text>
                <Text className="font-body text-sm text-muted-foreground">
                  {planned > 0
                    ? `Đã hoàn thành ${done} / ${planned} buổi theo kế hoạch`
                    : "Tuần này chưa có buổi nào được lên lịch"}
                </Text>
              </View>
            </Card>

            {schedulesQuery.isLoading ? (
              <View className="gap-2.5">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-[68px] rounded-2xl" />
                ))}
              </View>
            ) : (
              <Stagger className="gap-2.5">
                {week.map((day) => (
                  <StaggerItem key={day.key}>
                    <Card
                      className={`flex-row items-center gap-3 p-4 ${day.today ? "border-primary/40 bg-primary/5" : ""}`}
                      onPress={
                        // Only today's session can be started: the logging screen always opens
                        // TODAY's schedule, so letting a past or future day open it would log the
                        // wrong session under that day's card.
                        day.today && day.schedule && !day.done
                          ? () => router.push("/client/workout/log")
                          : undefined
                      }
                    >
                      <View className="w-14 shrink-0">
                        <Text
                          className={`font-display text-sm ${day.today ? "text-primary" : "text-muted-foreground"}`}
                        >
                          {day.label}
                        </Text>
                      </View>
                      <View className="flex-1">
                        <Text
                          className={`font-body text-sm ${day.rest ? "text-muted-foreground" : "font-body-semibold text-foreground"}`}
                          numberOfLines={1}
                        >
                          {day.rest
                            ? "Nghỉ ngơi"
                            : (day.schedule?.programDay?.name ?? day.schedule?.name ?? "Buổi tập")}
                        </Text>
                      </View>
                      {day.done ? (
                        <View className="h-7 w-7 items-center justify-center rounded-full bg-primary">
                          <Check size={15} color={accent.onPrimary} strokeWidth={3} />
                        </View>
                      ) : day.rest ? (
                        <Badge tone="neutral">Nghỉ</Badge>
                      ) : day.inProgress ? (
                        <Badge tone="warning">Đang tập</Badge>
                      ) : day.today ? (
                        <Badge tone="success">Hôm nay</Badge>
                      ) : day.past ? (
                        // Seen on device: a past, planned, untrained day rendered the same calendar
                        // icon as a future one, while the dashboard's heatmap already marked it missed.
                        <Badge tone="danger">Bỏ lỡ</Badge>
                      ) : (
                        <CalendarClock size={17} color="#8b9299" />
                      )}
                    </Card>
                  </StaggerItem>
                ))}
              </Stagger>
            )}
          </View>
        ) : tab === "Nhật ký" ? (
          <View className="gap-5">
            <Button full size="lg" icon={Play} onPress={() => router.push("/client/workout/log")}>
              Bắt đầu buổi tập
            </Button>

            {historyQuery.isLoading ? (
              <View className="gap-2.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[76px] rounded-2xl" />
                ))}
              </View>
            ) : (
              <RecentWorkouts data={historyQuery.data} />
            )}
          </View>
        ) : (
          <CycleTab query={cycleQuery} />
        )}
      </View>
    </ScrollView>
  );
}

function RecentWorkouts({ data }: { data: any }) {
  const accent = useWorkspaceAccent();
  const workouts: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.workouts)
      ? data.workouts
      : Array.isArray(data?.data)
        ? data.data
        : [];

  if (workouts.length === 0) {
    return (
      <EmptyState
        icon={Dumbbell}
        title="Chưa có buổi tập nào"
        description="Buổi tập bạn ghi lại sẽ xuất hiện ở đây."
      />
    );
  }

  return (
    <View>
      <Text className="mb-3 px-1 font-display text-lg text-foreground">Gần đây</Text>
      <Stagger className="gap-2.5">
        {workouts.map((w: any) => {
          const exerciseCount = Array.isArray(w?.exercises) ? w.exercises.length : 0;
          return (
            <StaggerItem key={String(w.id)}>
              <Card
                className="flex-row items-center gap-3 p-4"
                onPress={() =>
                  router.push({
                    pathname: "/client/workout/[id]",
                    params: { id: String(w.id) },
                  })
                }
              >
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                  <Dumbbell size={18} color={accent.primary} />
                </View>
                <View className="flex-1">
                  <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                    {w?.name ?? "Buổi tập"}
                  </Text>
                  <View className="mt-0.5 flex-row items-center gap-1">
                    <Repeat size={12} color="#8b9299" />
                    <Text className="font-body text-xs text-muted-foreground">
                      {exerciseCount > 0 ? `${exerciseCount} bài` : "—"}
                      {w?.date ? ` · ${new Date(w.date).toLocaleDateString("vi-VN")}` : ""}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={18} color="#8b9299" />
              </Card>
            </StaggerItem>
          );
        })}
      </Stagger>
    </View>
  );
}

function CycleTab({ query }: { query: { isLoading: boolean; data: any; isError: boolean } }) {
  const accent = useWorkspaceAccent();
  // Read the clock once per mount, not on every render: the cycle's week index is day-grained, and a
  // render-time Date.now() makes the output depend on when React happens to re-render.
  const [now] = useState(() => Date.now());

  if (query.isLoading) {
    return <Skeleton className="h-40 rounded-2xl" />;
  }

  const cycle = query.data?.cycle;
  if (query.isError || !cycle) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Chưa có chu kỳ nào đang chạy"
        description="Chu kỳ tập luyện được tạo cùng kế hoạch — bắt đầu một kế hoạch để mở chu kỳ đầu tiên."
      />
    );
  }

  const start = parseApiDateOnly(cycle.startDate);
  const end = parseApiDateOnly(cycle.endDate);
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const elapsed = Math.min(
    totalDays,
    Math.max(0, Math.round((now - start.getTime()) / 86_400_000)),
  );
  const weekIndex = Math.floor(elapsed / 7) + 1;
  const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));

  return (
    <View className="gap-5">
      <Card className="p-5">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Badge tone="info">
              Tuần {Math.min(weekIndex, totalWeeks)} / {totalWeeks}
            </Badge>
            <Text className="font-display mt-2 text-xl text-foreground" numberOfLines={2}>
              {cycle.name ?? cycle.goal ?? "Chu kỳ hiện tại"}
            </Text>
            <Text className="mt-1 font-body text-sm text-muted-foreground">
              {start.toLocaleDateString("vi-VN")} – {end.toLocaleDateString("vi-VN")}
            </Text>
          </View>
          <ProgressRing progress={elapsed / totalDays} size={72} stroke={7} color={accent.chart3}>
            <Text className="font-display text-base text-foreground">
              <CountUp to={Math.round((elapsed / totalDays) * 100)} suffix="%" />
            </Text>
          </ProgressRing>
        </View>
      </Card>

      {cycle.summary ? (
        <Card className="p-4">
          <Text className="mb-2 font-display text-base text-foreground">Tổng kết tới hiện tại</Text>
          <Text className="font-body text-sm leading-6 text-muted-foreground">
            {typeof cycle.summary === "string"
              ? cycle.summary
              : JSON.stringify(cycle.summary, null, 2)}
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

function ToolButton({ icon: Icon, onPress }: { icon: LucideIcon; onPress: () => void }) {
  return (
    <Tappable
      className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
      onPress={onPress}
    >
      <Icon size={19} color="#8b9299" />
    </Tappable>
  );
}
