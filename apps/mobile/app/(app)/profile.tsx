import { Screen, Text, Button, Card, spacing } from "../../src/ui";
import { useAuthStore } from "../../src/store/authStore";
import { strings } from "../../src/i18n/strings";
import { NotificationSettingsCard } from "../../src/features/notifications/NotificationSettingsCard";
import { GoalEditor } from "../../src/features/profile/GoalEditor";

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <Screen scroll>
      <Card>
        <Text variant="heading">
          {user?.firstName ?? ""} {user?.lastName ?? ""}
        </Text>
        <Text variant="caption" style={{ marginTop: spacing.xs }}>
          {user?.email}
        </Text>
        <Text variant="small" style={{ marginTop: spacing.sm }}>
          {user?.role}
        </Text>
      </Card>
      <GoalEditor />
      <NotificationSettingsCard />
      <Button label={strings.common.logout} variant="secondary" onPress={logout} />
    </Screen>
  );
}
