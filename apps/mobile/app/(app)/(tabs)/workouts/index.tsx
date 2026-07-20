import { View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen, Text, Card, Badge, SkeletonCard, colors, spacing } from "../../../../src/ui";
import { useWorkoutHistoryQuery, usePRsQuery } from "../../../../src/api/queries";
import { useWorkoutDraftStore } from "../../../../src/features/workouts/workoutDraftStore";
import { PendingSyncCard } from "../../../../src/features/workouts/PendingSyncCard";
import { formatShortDate } from "../../../../src/lib/date";

function HubAction({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Card onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: colors.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={20} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption">{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.textMuted} />
    </Card>
  );
}

export default function WorkoutsHubScreen() {
  const router = useRouter();
  const { data: history, isLoading } = useWorkoutHistoryQuery({ limit: 3 });
  const { data: prs } = usePRsQuery();
  const draftCount = useWorkoutDraftStore((s) => s.exercises.length);

  return (
    <Screen scroll>
      <PendingSyncCard />
      <HubAction
        icon="plus-circle"
        title="Ghi buổi tập mới"
        subtitle={draftCount > 0 ? `Đang soạn — ${draftCount} bài tập` : "Chọn bài tập và nhập set"}
        onPress={() => router.push(draftCount > 0 ? "/(app)/(tabs)/workouts/log" : "/(app)/(tabs)/workouts/exercises")}
      />
      <HubAction
        icon="list"
        title="Danh mục bài tập"
        subtitle="Tìm kiếm và lọc theo nhóm cơ"
        onPress={() => router.push("/(app)/(tabs)/workouts/exercises")}
      />
      <HubAction
        icon="clock"
        title="Lịch sử buổi tập"
        subtitle="Xem lại các buổi tập đã ghi"
        onPress={() => router.push("/(app)/(tabs)/workouts/history")}
      />

      {prs && prs.length > 0 ? (
        <View>
          <Text variant="small" style={{ color: colors.textMuted, marginBottom: spacing.sm }}>
            KỶ LỤC CÁ NHÂN GẦN ĐÂY
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {prs.slice(0, 4).map((pr) => (
              <Badge key={pr.exerciseId} label={`${pr.exerciseName}: ${pr.weight}kg`} tone="accent" />
            ))}
          </View>
        </View>
      ) : null}

      <View>
        <Text variant="small" style={{ color: colors.textMuted, marginBottom: spacing.sm }}>
          GẦN ĐÂY
        </Text>
        {isLoading ? (
          <SkeletonCard lines={2} />
        ) : history && history.length > 0 ? (
          history.map((w) => (
            <Card
              key={w.id}
              onPress={() => router.push(`/(app)/(tabs)/workouts/${w.id}`)}
              style={{ marginBottom: spacing.sm }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text variant="bodyStrong">{w.name}</Text>
                <Text variant="caption">{formatShortDate(w.date)}</Text>
              </View>
              <Text variant="caption">{w.exercises.length} bài tập</Text>
            </Card>
          ))
        ) : (
          <Text variant="caption">Chưa có buổi tập nào.</Text>
        )}
      </View>
    </Screen>
  );
}
