import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { View } from "react-native";
import { Card, Text, Badge, Button, SkeletonCard, ErrorNotice, colors, spacing } from "../../ui";
import { useSchedulesQuery } from "../../api/queries";
import { todayDateOnly } from "../../lib/date";
import type { ScheduleStatus } from "../../api/workouts";

const STATUS_BADGE: Record<ScheduleStatus, { label: string; tone: "neutral" | "accent" | "success" | "warning" }> = {
  NOT_STARTED: { label: "Chưa bắt đầu", tone: "neutral" },
  IN_PROGRESS: { label: "Đang tập", tone: "accent" },
  COMPLETED: { label: "Đã hoàn thành", tone: "success" },
  SKIPPED: { label: "Đã bỏ qua", tone: "warning" },
};

export function TodayScheduleCard() {
  const router = useRouter();
  const today = todayDateOnly();
  const { data: schedules, isLoading, isError, refetch } = useSchedulesQuery({
    startDate: today,
    endDate: today,
  });

  if (isLoading) return <SkeletonCard lines={2} />;
  if (isError) return <ErrorNotice onRetry={refetch} />;

  const todaySchedule = schedules?.[0];

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="subheading">Hôm nay</Text>
        {todaySchedule ? (
          <Badge
            label={STATUS_BADGE[todaySchedule.status].label}
            tone={STATUS_BADGE[todaySchedule.status].tone}
          />
        ) : null}
      </View>

      {todaySchedule ? (
        <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
          <Text variant="bodyStrong">{todaySchedule.programDay?.title ?? "Buổi tập"}</Text>
          {todaySchedule.programDay?.exercises ? (
            <Text variant="caption">{todaySchedule.programDay.exercises.length} bài tập</Text>
          ) : null}
          <Button
            label={todaySchedule.status === "NOT_STARTED" ? "Bắt đầu buổi tập" : "Xem chi tiết"}
            onPress={() => router.push("/(app)/(tabs)/workouts")}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      ) : (
        <View style={{ marginTop: spacing.md, alignItems: "center", gap: spacing.xs }}>
          <Feather name="coffee" size={22} color={colors.textMuted} />
          <Text variant="caption">Không có buổi tập nào theo lịch hôm nay</Text>
        </View>
      )}
    </Card>
  );
}
