import { Screen, Text, Button, Card, spacing } from "../../src/ui";
import { useAuthStore } from "../../src/store/authStore";
import { strings } from "../../src/i18n/strings";

// Placeholder home — P4 replaces this with the real tab-bar shell and P5
// builds the actual Dashboard content here.
export default function AppHomePlaceholder() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <Screen>
      <Card>
        <Text variant="heading">Xin chào{user?.firstName ? `, ${user.firstName}` : ""}</Text>
        <Text variant="caption" style={{ marginTop: spacing.xs }}>
          {user?.email}
        </Text>
      </Card>
      <Button label={strings.common.logout} variant="secondary" onPress={logout} />
    </Screen>
  );
}
