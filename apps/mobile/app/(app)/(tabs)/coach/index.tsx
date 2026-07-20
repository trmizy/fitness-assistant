import { FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen, Text, Card, Button, EmptyState, SkeletonCard, spacing } from "../../../../src/ui";
import { useCoachSessionsQuery } from "../../../../src/api/queries";

export default function CoachSessionListScreen() {
  const router = useRouter();
  const { data: sessions, isLoading, refetch, isRefetching } = useCoachSessionsQuery();

  return (
    <Screen padded={false} style={{ flex: 1 }}>
      <View style={{ padding: spacing.lg }}>
        <Button label="+ Trò chuyện mới" onPress={() => router.push("/(app)/(tabs)/coach/new")} fullWidth />
      </View>

      {isLoading ? (
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <SkeletonCard lines={1} />
          <SkeletonCard lines={1} />
        </View>
      ) : (
        <FlatList
          data={sessions ?? []}
          keyExtractor={(item) => item.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          renderItem={({ item }) => (
            <Card onPress={() => router.push(`/(app)/(tabs)/coach/${item.id}`)}>
              <Text variant="bodyStrong">{item.title}</Text>
              <Text variant="caption">{new Date(item.lastMessageAt).toLocaleString("vi-VN")}</Text>
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState
              icon={(p) => <Feather name="message-circle" {...p} />}
              title="Chưa có cuộc trò chuyện nào"
              description="Bắt đầu hỏi AI coach về tập luyện, dinh dưỡng..."
            />
          }
        />
      )}
    </Screen>
  );
}
