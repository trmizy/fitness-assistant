import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  Check,
  ChevronRight,
  Dumbbell,
  Play,
  Plus,
  Repeat,
} from "lucide-react-native";

import { CyclePanel } from "../../../src/features/cycle/CyclePanel";
import { DaySheet, scheduleTitle } from "../../../src/features/workout/DaySheet";
import { WorkoutToolsMenu } from "../../../src/features/workout/WorkoutToolsMenu";
import { BodyJourneyCard, TrainingDistributionCard } from "../../../src/features/workout/TrainingInsights";
import type { TrainingDay } from "../../../src/features/workout/trainingWeek";
import { RoadmapJourney } from "../../../src/features/roadmap/RoadmapJourney";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ProgressRing,
  Segmented,
  Skeleton,
  Stagger,
  StaggerItem,
  Tappable,
} from "../../../src/components/ui";
import { workoutService } from "../../../src/services/api";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { addDays, parseApiDateOnly, startOfWeek, toDateInputValue } from "../../../src/utils/date";
import { buildTrainingWeek } from "../../../src/features/workout/trainingWeek";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

// "Lộ trình" (WB-11, Phase 8) is web's Training-page "Lộ trình" tab: the long-term journey, with the
// current cycle shown inline and "Chu kỳ" kept for the full cycle drill-down.
const TABS = ["Lịch tuần", "Nhật ký", "Chu kỳ", "Lộ trình"] as const;
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
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(() => (TABS as readonly string[]).includes(String(params.tab)) ? (params.tab as Tab) : "Lịch tuần");

  // Re-read the calendar day on focus / foreground: left open past midnight, the week and its
  // "Hôm nay" row (and so the day sheet's actions) would otherwise stay on yesterday.
  const [dayKey, setDayKey] = useState(() => toDateInputValue(new Date()));
  const syncDay = useCallback(() => setDayKey(toDateInputValue(new Date())), []);
  useFocusEffect(syncDay);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && syncDay());
    return () => sub.remove();
  }, [syncDay]);
  const weekStart = useMemo(() => startOfWeek(parseApiDateOnly(dayKey)), [dayKey]);
  // 14B.4 — tapping a day opens its sheet (start today's session, reschedule, hide, add a session).
  const [openDay, setOpenDay] = useState<TrainingDay | null>(null);

  const schedulesQuery = useQuery({
    queryKey: ["workout-schedules", "week", toDateInputValue(weekStart)],
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
  // 14B.4 — a longer window for the "Phân bổ" charts (30 days / all), loaded with the Nhật ký tab.
  const analyticsQuery = useQuery({
    queryKey: ["workout-history", "analytics"],
    queryFn: () => workoutService.getHistory(1, 100),
    enabled: tab === "Nhật ký",
  });
  const analyticsWorkouts: any[] = Array.isArray(analyticsQuery.data)
    ? analyticsQuery.data
    : Array.isArray((analyticsQuery.data as any)?.workouts)
      ? (analyticsQuery.data as any).workouts
      : [];

  const { refreshing, onRefresh } = usePullToRefresh([
    ["workout-schedules", "week"],
    ["workout-history", "recent"],
    // Prefix: every query of the Chu kỳ segment (active, history, progress, assessment...).
    ["training-cycle"],
  ]);

  // Day-state rules (rest / past / in progress / done) live in buildTrainingWeek, where they are tested.
  const week = useMemo(
    () => buildTrainingWeek(schedulesQuery.data, weekStart, parseApiDateOnly(dayKey)),
    [schedulesQuery.data, weekStart, dayKey],
  );

  const planned = week.filter((d) => !d.rest).length;
  const done = week.filter((d) => d.done).length;

  return (
    <View className="flex-1 bg-background">
    <ScrollView
      className="flex-1"
      // Bottom room so the last card clears the floating tool button.
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 96 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} colors={[accent.primary]} />
      }
    >
      <View className="px-5">
        <View className="mb-4 flex-row items-center justify-between">
          <Text className="mr-3 font-display text-2xl text-foreground">Tập luyện</Text>
          {/* The tool doors (nutrition, plans, programs, templates, import, stats) moved to
              WorkoutToolsMenu at the bottom-left, where each has its name; "+" — start/log a
              session — stays here as the primary action. */}
          <View className="ml-2">
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
                      // Every day opens its sheet; only today's session can be started from it — the
                      // logging screen always opens TODAY's schedule.
                      onPress={() => setOpenDay(day)}
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
                          {/* programDay carries `title` (the old `.name` read always fell back to "Buổi tập"). */}
                          {day.rest ? "Nghỉ ngơi" : scheduleTitle(day.schedule)}
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
            <BodyJourneyCard />
            <TrainingDistributionCard workouts={analyticsWorkouts} />
          </View>
        ) : tab === "Chu kỳ" ? (
          <CyclePanel />
        ) : (
          <RoadmapJourney onOpenCycle={() => setTab("Chu kỳ")} />
        )}
      </View>
      <DaySheet day={openDay} onClose={() => setOpenDay(null)} />
    </ScrollView>
    <WorkoutToolsMenu />
    </View>
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
