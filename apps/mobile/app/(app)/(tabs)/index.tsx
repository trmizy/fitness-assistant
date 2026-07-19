import { Screen, Text, Card, spacing } from "../../../src/ui";
import { useAuthStore } from "../../../src/store/authStore";

// Real Dashboard content lands in P5 — this proves the tab shell + header
// profile button work end-to-end.
export default function DashboardTab() {
  const user = useAuthStore((s) => s.user);

  return (
    <Screen scroll>
      <Card>
        <Text variant="heading">Xin chào{user?.firstName ? `, ${user.firstName}` : ""}</Text>
        <Text variant="caption" style={{ marginTop: spacing.xs }}>
          Dashboard sẽ hiển thị ở đây (P5)
        </Text>
      </Card>
    </Screen>
  );
}
