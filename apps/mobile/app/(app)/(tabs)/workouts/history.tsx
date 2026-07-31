import { FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen, Text, Card, EmptyState, SkeletonCard, ErrorNotice, spacing } from "../../../../src/ui";
import { useWorkoutHistoryQuery } from "../../../../src/api/queries";
import { formatShortDate } from "../../../../src/lib/date";

export default function WorkoutHistoryScreen() {
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useWorkoutHistoryQuery({ limit: 50 });

  if (isLoading) {
    return (
      <Screen>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen>
        <ErrorNotice onRetry={refetch} />
      </Screen>
    );
  }

  return (
    <Screen padded={false} style={{ flex: 1 }}>
      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        refreshing={isRefetching}
        onRefresh={refetch}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/(app)/(tabs)/workouts/${item.id}`)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text variant="bodyStrong">{item.name}</Text>
              <Text variant="caption">{formatShortDate(item.date)}</Text>
            </View>
            <Text variant="caption">{item.exercises.length} bài tập</Text>
          </Card>
        )}
        ListEmptyComponent={
          <EmptyState
            icon={(p) => <Feather name="calendar" {...p} />}
            title="Chưa có lịch sử"
            description="Các buổi tập bạn ghi lại sẽ hiện ở đây."
          />
        }
      />
    </Screen>
  );
}
