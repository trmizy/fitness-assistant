import { useState } from "react";
import { View } from "react-native";
import { Card, Text, Button, Badge, colors, spacing } from "../../ui";
import { useSchedulesQuery, useActiveCycleQuery } from "../../api/queries";
import { requestNotificationPermission, type PermissionOutcome } from "../../notifications/permissions";
import { syncReminders } from "../../notifications/scheduler";
import { todayDateOnly, daysFromNow } from "../../lib/date";
import { env } from "../../config/env";

export function NotificationSettingsCard() {
  const [permission, setPermission] = useState<PermissionOutcome | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const { data: upcomingSchedules } = useSchedulesQuery({
    startDate: todayDateOnly(),
    endDate: daysFromNow(7),
  });
  const { data: activeCycleData } = useActiveCycleQuery();

  const onSync = async () => {
    setSyncing(true);
    setLastResult(null);
    try {
      const outcome = await requestNotificationPermission();
      setPermission(outcome);
      if (outcome !== "granted") {
        setLastResult("Chưa được cấp quyền thông báo.");
        return;
      }
      const count = await syncReminders({
        upcomingSchedules: upcomingSchedules ?? [],
        activeCycle: env.featureCycles ? (activeCycleData?.cycle ?? null) : null,
      });
      setLastResult(count > 0 ? `Đã đặt ${count} nhắc lịch.` : "Không có lịch nào cần nhắc trong 7 ngày tới.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="bodyStrong">Thông báo</Text>
        {permission ? (
          <Badge
            label={permission === "granted" ? "Đã cấp quyền" : "Chưa cấp quyền"}
            tone={permission === "granted" ? "success" : "neutral"}
          />
        ) : null}
      </View>
      <Text variant="caption" style={{ marginTop: spacing.xs }}>
        Nhắc buổi tập theo lịch và nhắc đo InBody khi gần kết thúc chu kỳ.
      </Text>
      {lastResult ? (
        <Text variant="caption" color={colors.textSecondary} style={{ marginTop: spacing.xs }}>
          {lastResult}
        </Text>
      ) : null}
      <Button
        label="Đồng bộ nhắc lịch"
        variant="secondary"
        loading={syncing}
        onPress={onSync}
        style={{ marginTop: spacing.md }}
      />
    </Card>
  );
}
