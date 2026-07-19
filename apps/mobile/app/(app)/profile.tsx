import { Screen, Text, Button, Card, spacing } from "../../src/ui";
import { useAuthStore } from "../../src/store/authStore";
import { strings } from "../../src/i18n/strings";

// Minimal placeholder — P12 (Polish) builds out goal editing etc.
export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <Screen>
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
      <Button label={strings.common.logout} variant="secondary" onPress={logout} />
    </Screen>
  );
}
