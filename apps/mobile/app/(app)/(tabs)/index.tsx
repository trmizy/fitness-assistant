import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Screen, Text, spacing } from "../../../src/ui";
import { useAuthStore } from "../../../src/store/authStore";
import { TodayScheduleCard } from "../../../src/features/dashboard/TodayScheduleCard";
import { CycleOrInBodyCard } from "../../../src/features/dashboard/CycleOrInBodyCard";
import { QuickActions } from "../../../src/features/dashboard/QuickActions";

export default function DashboardTab() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }, [queryClient]);

  return (
    <Screen scroll onRefresh={onRefresh} refreshing={refreshing}>
      <Text variant="heading">Xin chào{user?.firstName ? `, ${user.firstName}` : ""}</Text>
      <TodayScheduleCard />
      <CycleOrInBodyCard />
      <QuickActions />
      <Text variant="small" style={{ textAlign: "center", marginTop: spacing.sm }}>
        Kéo xuống để làm mới
      </Text>
    </Screen>
  );
}
