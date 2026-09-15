import { useMemo } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Apple,
  BarChart3,
  Bell,
  ClipboardList,
  Dumbbell,
  Flame,
  MessageCircle,
  ScanLine,
  Search,
  TrendingUp,
  type LucideIcon,
} from "lucide-react-native";

import {
  Avatar,
  Badge,
  Card,
  CountUp,
  EmptyState,
  ProgressRing,
  SectionHeader,
  Skeleton,
  Stagger,
  StaggerItem,
  Tappable,
} from "../../src/components/ui";
import { useApp } from "../../src/context/AppContext";
import {
  inbodyService,
  profileService,
  statsService,
  workoutService,
} from "../../src/services/api";
import { usePullToRefresh } from "../../src/hooks/usePullToRefresh";
import {
  addDays,
  formatScheduleDate,
  greetingForHour,
  sortInBodyNewestFirst,
  startOfWeek,
  toDateInputValue,
} from "../../src/utils/date";
import {
  buildActivityWeek,
  changeLabel,
  currentStreak,
  isSameLocalDay as isToday,
  selectUpcomingSchedules,
} from "../../src/features/dashboard/dashboardWeek";
import { useWorkspaceAccent } from "../../src/theme/workspace";

/**
 * CL-01 — client dashboard.
 *
 * Visual authority: `New Frontend/src/screens/Home.tsx`. Behavioural authority: web's
 * `pages/client/ClientDashboard.tsx` — same five queries, same date conventions, same
 * newest-first InBody ordering (the web file carries a comment about a real bug where a bare
 * `["profile"]` key stopped matching the InBody upload's invalidation; the key here is the same
 * `["profile", userId]` for the same reason).
 *
 * Two cards from the reference are deliberately NOT rendered yet, rather than filled with
 * invented content: the "AI Coach có gợi ý mới" nudge (there is no suggestion endpoint until the
 * chat/AI work in Phase 9) and the "buổi tập chờ xác nhận" nudge (session confirmation is Phase
 * 7's contract/session flow). Both are recorded as PARTIAL in MOBILE_MIGRATION_MANIFEST.md.
 * Rendering either one now would mean hardcoding a claim the backend never made.
 *
 * The reference's two stat tiles show calories and water, which come from the nutrition domain
 * (Phase 6). The tile pair is kept exactly as designed but filled with the body metrics web
 * already shows on this screen (weight, muscle mass); nutrition replaces/joins them in Phase 6.
 */
export default function ClientDashboardScreen() {
  const { user } = useApp();
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();

  const today = useMemo(() => new Date(), []);
  const range = useMemo(() => {
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return {
      todayStart,
      startDate: toDateInputValue(todayStart),
      endDate: toDateInputValue(addDays(todayStart, 30)),
      weekStart: startOfWeek(todayStart),
    };
  }, [today]);

  const profileQuery = useQuery({
    // Must match the key the InBody upload flow invalidates — see the web file's comment.
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const res = await profileService.getProfile();
      return res.profile;
    },
    enabled: !!user?.id,
  });

  const inbodyQuery = useQuery({
    queryKey: ["inbody-history"],
    queryFn: inbodyService.getHistory,
  });

  const programQuery = useQuery({
    queryKey: ["current-workout-program"],
    queryFn: () => workoutService.getCurrentProgram(),
  });

  const schedulesQuery = useQuery({
    queryKey: ["workout-schedules", "dashboard-upcoming"],
    queryFn: () =>
      workoutService.getSchedules(10, {
        startDate: range.startDate,
        endDate: range.endDate,
      }),
  });

  // The reference's "Hoạt động tuần" bars. Web's dashboard has no equivalent (its own weekly
  // panel is an explicit "no data" placeholder), so this reads the real activity heatmap the
  // stats screens use instead of inventing a series.
  const activityQuery = useQuery({
    queryKey: ["activity-heatmap", "dashboard-week"],
    queryFn: () =>
      statsService.getActivityHeatmap(
        toDateInputValue(range.weekStart),
        toDateInputValue(addDays(range.weekStart, 6)),
      ),
  });

  const { refreshing, onRefresh } = usePullToRefresh([
    ["profile", user?.id],
    ["inbody-history"],
    ["current-workout-program"],
    ["workout-schedules", "dashboard-upcoming"],
    ["activity-heatmap", "dashboard-week"],
  ]);

  const sortedInBody = useMemo(
    () => sortInBodyNewestFirst(Array.isArray(inbodyQuery.data) ? inbodyQuery.data : []),
    [inbodyQuery.data],
  );
  const latest: any = sortedInBody[0];
  const prev: any = sortedInBody[1];

  const week = useMemo(() => buildActivityWeek(range.weekStart, activityQuery.data?.days), [
    range.weekStart,
    activityQuery.data,
  ]);
  const doneThisWeek = week.filter((d) => d.value >= 1).length;
  const plannedThisWeek = week.filter((d) => d.state && d.state !== "rest").length;
  const weekProgress = plannedThisWeek > 0 ? doneThisWeek / plannedThisWeek : 0;
  const streak = useMemo(() => currentStreak(activityQuery.data?.days), [activityQuery.data]);

  const program = programQuery.data as any;
  // A started session stays "next" (it is the one to resume) and "Sắp tới" starts after it — both
  // rules live in selectUpcomingSchedules, where they are tested.
  const {
    upcoming,
    next: nextSchedule,
    later: laterSchedules,
  } = useMemo(() => selectUpcomingSchedules(schedulesQuery.data), [schedulesQuery.data]);
  const nextDay = nextSchedule?.programDay;
  const nextExerciseCount = nextDay?.exercises?.length ?? 0;

  const loading =
    profileQuery.isLoading ||
    inbodyQuery.isLoading ||
    programQuery.isLoading ||
    schedulesQuery.isLoading;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={accent.primary}
          colors={[accent.primary]}
        />
      }
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-5">
        <View className="flex-1">
          <Text className="font-body text-sm text-muted-foreground">
            {greetingForHour(today.getHours())}
          </Text>
          <Text className="font-display text-2xl text-foreground" numberOfLines={1}>
            {user?.firstName || "Bạn"}
          </Text>
        </View>
        <View className="flex-row items-center gap-3">
          <RoundButton icon={Search} onPress={() => router.push("/client/library/search")} />
          <RoundButton icon={Bell} dot onPress={() => router.push("/client/notifications")} />
          <Avatar name={user?.firstName || "Bạn"} size={44} />
        </View>
      </View>

      <Stagger className="gap-5 px-5 pt-6">
        {/* Streak hero */}
        <StaggerItem>
          <Card className="overflow-hidden p-5">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <View className="flex-row items-center gap-2">
                  <Flame size={18} color={accent.primary} strokeWidth={2.5} />
                  <Text className="font-body-semibold text-sm text-primary">Chuỗi ngày tập</Text>
                </View>
                {activityQuery.isLoading ? (
                  <Skeleton className="mt-2 h-10 w-32 rounded-xl" />
                ) : (
                  <Text className="font-display mt-1 text-4xl text-foreground">
                    <CountUp to={streak} /> ngày
                  </Text>
                )}
                <Text className="mt-1 font-body text-sm text-muted-foreground">
                  {plannedThisWeek > 0
                    ? `Tuần này ${doneThisWeek}/${plannedThisWeek} buổi đã hoàn thành`
                    : "Chưa có buổi nào lên lịch cho tuần này"}
                </Text>
              </View>
              <ProgressRing progress={weekProgress} size={92}>
                <Text className="font-display text-xl text-foreground">
                  <CountUp to={Math.round(weekProgress * 100)} suffix="%" />
                </Text>
                <Text className="font-body text-[11px] text-muted-foreground">tuần này</Text>
              </ProgressRing>
            </View>
          </Card>
        </StaggerItem>

        {/* Quick access */}
        <StaggerItem>
          <View className="flex-row gap-2.5">
            <QuickAction icon={ClipboardList} label="Kế hoạch" onPress={() => router.push("/client/workout")} />
            <QuickAction icon={BarChart3} label="Thống kê" onPress={() => router.push("/client/stats/activity")} />
            <QuickAction icon={ScanLine} label="InBody" onPress={() => router.push("/client/inbody")} />
            <QuickAction icon={MessageCircle} label="Tin nhắn" onPress={() => router.push("/client/messages")} />
          </View>
        </StaggerItem>

        {/* Today's / next planned session */}
        <StaggerItem>
          <Card className="p-4">
            {loading ? (
              <Skeleton className="h-28 rounded-xl" />
            ) : nextSchedule ? (
              <>
                <View className="mb-3 flex-row items-center justify-between">
                  <View className="flex-1 flex-row items-center gap-2 pr-2">
                    <Badge tone={isToday(nextSchedule.date) ? "success" : "info"}>
                      {isToday(nextSchedule.date) ? "Hôm nay" : formatScheduleDate(nextSchedule.date)}
                    </Badge>
                    <Text className="flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                      {nextDay?.name ?? nextSchedule?.name ?? "Buổi tập"}
                    </Text>
                  </View>
                  {nextExerciseCount > 0 ? (
                    <Text className="font-body text-xs text-muted-foreground">
                      {nextExerciseCount} bài
                    </Text>
                  ) : null}
                </View>
                {nextExerciseCount > 0 ? (
                  <View className="mb-4 flex-row gap-1.5">
                    {Array.from({ length: Math.min(nextExerciseCount, 10) }).map((_, i) => (
                      <View key={i} className="h-1.5 flex-1 rounded-full bg-panel" />
                    ))}
                  </View>
                ) : null}
                <Tappable
                  className="flex-row items-center justify-center gap-2 rounded-xl bg-primary py-3"
                  onPress={() => router.push("/client/workout")}
                >
                  <Dumbbell size={18} color={accent.onPrimary} strokeWidth={2.5} />
                  <Text className="font-body-semibold text-on-primary">
                    {nextSchedule?.workoutId || nextSchedule?.workout?.id
                      ? "Tiếp tục buổi tập"
                      : "Bắt đầu buổi tập"}
                  </Text>
                </Tappable>
              </>
            ) : (
              <EmptyState
                icon={Dumbbell}
                title="Chưa có buổi nào được lên lịch"
                description={
                  program
                    ? "Kế hoạch của bạn chưa xếp buổi nào trong 30 ngày tới."
                    : "Tạo kế hoạch tập để bắt đầu."
                }
                actionLabel="Mở Tập luyện"
                onAction={() => router.push("/client/workout")}
              />
            )}
          </Card>
        </StaggerItem>

        {/* Body metrics — the reference's tile pair; nutrition tiles join these in Phase 6. */}
        <StaggerItem>
          <View className="flex-row gap-3">
            <StatTile
              icon={TrendingUp}
              tint={accent.chart2}
              label="Cân nặng"
              value={latest?.weight != null ? `${latest.weight} kg` : "---"}
              sub={changeLabel(latest?.weight, prev?.weight, "kg")}
              loading={inbodyQuery.isLoading}
            />
            <StatTile
              icon={Apple}
              tint={accent.chart3}
              label="Cơ bắp"
              value={latest?.muscleMass != null ? `${latest.muscleMass} kg` : "---"}
              sub={changeLabel(latest?.muscleMass, prev?.muscleMass, "kg")}
              loading={inbodyQuery.isLoading}
            />
          </View>
        </StaggerItem>

        {/* Weekly activity */}
        <StaggerItem>
          <Card className="p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Activity size={18} color={accent.primary} />
                <Text className="font-display text-base text-foreground">Hoạt động tuần</Text>
              </View>
              <Text className="font-body-semibold text-xs text-primary">
                {doneThisWeek}/{week.length} ngày
              </Text>
            </View>
            <View className="h-28 flex-row items-end justify-between gap-2">
              {week.map((day) => (
                <View key={day.label} className="flex-1 items-center gap-2">
                  {/* flex-1, not h-full: h-full made the bar track 100% of the row on top of the
                      label and gap below it, so a fully-trained day overflowed upward over the
                      card title. */}
                  <View className="w-full flex-1 justify-end">
                    <View
                      className={`w-full rounded-md ${day.value >= 1 ? "bg-primary" : "bg-primary/35"}`}
                      style={{ height: `${Math.max(day.value * 100, 4)}%` }}
                    />
                  </View>
                  <Text className="font-body text-[11px] text-muted-foreground">{day.label}</Text>
                </View>
              ))}
            </View>
          </Card>
        </StaggerItem>

        {/* Upcoming */}
        <StaggerItem>
          <View>
            <SectionHeader
              title="Sắp tới"
              action="Xem lịch"
              onAction={() => router.push("/client/workout")}
            />
            <Card>
              {schedulesQuery.isLoading ? (
                <View className="p-4">
                  <Skeleton className="h-12 rounded-xl" />
                </View>
              ) : laterSchedules.length === 0 ? (
                <View className="p-4">
                  <Text className="font-body text-sm text-muted-foreground">
                    {upcoming.length === 0
                      ? "Không có buổi nào trong 30 ngày tới."
                      : "Không có buổi nào khác trong 30 ngày tới."}
                  </Text>
                </View>
              ) : (
                laterSchedules.map((s: any, i: number) => (
                  <View
                    key={s.id ?? `${s.date}-${i}`}
                    className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}
                  >
                    <View className="w-20 shrink-0">
                      <Text className="font-display text-sm text-primary">
                        {formatScheduleDate(s.date)}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="font-body text-sm text-foreground" numberOfLines={1}>
                        {s?.programDay?.name ?? s?.name ?? "Buổi tập"}
                      </Text>
                    </View>
                    <Badge tone="neutral">
                      {(s?.programDay?.exercises?.length ?? 0) > 0
                        ? `${s.programDay.exercises.length} bài`
                        : "Cá nhân"}
                    </Badge>
                  </View>
                ))
              )}
            </Card>
          </View>
        </StaggerItem>
      </Stagger>
    </ScrollView>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────

// Week bars, streak, next/later schedules and change labels: src/features/dashboard/dashboardWeek.ts.

function RoundButton({
  icon: Icon,
  dot,
  onPress,
}: {
  icon: LucideIcon;
  dot?: boolean;
  onPress: () => void;
}) {
  return (
    <Tappable
      className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card"
      onPress={onPress}
    >
      <Icon size={20} color="#8b9299" />
      {dot ? (
        <View className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-primary" />
      ) : null}
    </Tappable>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Tappable
      className="flex-1 items-center gap-2 rounded-2xl border border-border bg-card py-3.5"
      onPress={onPress}
    >
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
        <Icon size={19} color={accent.primary} />
      </View>
      <Text className="font-body-medium text-[11px] text-muted-foreground">{label}</Text>
    </Tappable>
  );
}

function StatTile({
  icon: Icon,
  tint,
  label,
  value,
  sub,
  loading,
}: {
  icon: LucideIcon;
  tint: string;
  label: string;
  value: string;
  sub: string;
  loading?: boolean;
}) {
  return (
    <Card className="flex-1 p-4">
      <View
        className="mb-3 h-9 w-9 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${tint}26` }}
      >
        <Icon size={18} color={tint} />
      </View>
      <Text className="font-body text-xs text-muted-foreground">{label}</Text>
      {loading ? (
        <Skeleton className="my-1 h-7 w-20 rounded-lg" />
      ) : (
        <Text className="font-display text-2xl leading-tight text-foreground">{value}</Text>
      )}
      <Text className="font-body text-xs text-muted-foreground" numberOfLines={2}>
        {sub}
      </Text>
    </Card>
  );
}
