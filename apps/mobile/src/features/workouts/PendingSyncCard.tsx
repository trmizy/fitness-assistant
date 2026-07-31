import { useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Card, Text, Badge, Button, colors, spacing } from "../../ui";
import { usePendingWorkoutLogsQuery, queryKeys } from "../../api/queries";
import { syncQueuedWorkoutLogs } from "../../offline/syncEngine";
import { removeQueuedWorkoutLog } from "../../offline/workoutQueue";

// Chỉ hiện khi có ít nhất 1 buổi tập đang chờ đồng bộ (native only —
// web luôn trả về mảng rỗng, xem src/offline/db.ts).
export function PendingSyncCard() {
  const { data: items } = usePendingWorkoutLogsQuery();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  if (!items || items.length === 0) return null;

  const failedCount = items.filter((i) => i.status === "failed").length;

  const onSyncNow = async () => {
    setSyncing(true);
    try {
      await syncQueuedWorkoutLogs();
    } finally {
      setSyncing(false);
    }
  };

  const onDiscard = async (clientId: string) => {
    await removeQueuedWorkoutLog(clientId);
    await queryClient.invalidateQueries({ queryKey: queryKeys.pendingWorkoutLogs });
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Feather name="cloud-off" size={18} color={colors.warning} />
          <Text variant="bodyStrong">{items.length} buổi tập chưa sync</Text>
        </View>
        <Badge label={failedCount > 0 ? `${failedCount} lỗi` : "Chờ mạng"} tone={failedCount > 0 ? "danger" : "warning"} />
      </View>

      <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
        {items.map((item) => (
          <View key={item.clientId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text variant="caption" style={{ flex: 1 }}>
              {item.payload.name}
              {item.status === "failed" ? ` — ${item.errorMessage}` : ""}
            </Text>
            {item.status === "failed" ? (
              <Button label="Xoá" variant="ghost" size="sm" onPress={() => onDiscard(item.clientId)} />
            ) : null}
          </View>
        ))}
      </View>

      <Button
        label="Đồng bộ ngay"
        variant="secondary"
        loading={syncing}
        onPress={onSyncNow}
        style={{ marginTop: spacing.md }}
      />
    </Card>
  );
}
