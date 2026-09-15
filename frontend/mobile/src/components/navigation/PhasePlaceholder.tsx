import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Construction, LogOut } from "lucide-react-native";

import { Button, Card } from "../ui";
import { useApp } from "../../context/AppContext";
import { useWorkspaceAccent } from "../../theme/workspace";

/**
 * Stand-in for a screen whose real content belongs to a later phase.
 *
 * It exists so Phase 4 can prove the NAVIGATION — guards, tabs, role separation, session
 * persistence — without pretending any of these screens are built. Each one says which phase will
 * replace it, so a half-finished screen can never be mistaken for a finished one.
 *
 * Every placeholder carries a sign-out button: until the real profile screens exist, this is the
 * only way to end a session on the device, and testing the role guards requires switching accounts
 * constantly.
 */
export function PhasePlaceholder({
  title,
  phase,
  description,
}: {
  title: string;
  /** e.g. "Phase 5" — the phase that replaces this screen. */
  phase: string;
  description?: string;
}) {
  const { logout, user, role } = useApp();
  const accent = useWorkspaceAccent();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="p-6 gap-5"
      contentContainerStyle={{ paddingTop: insets.top + 16 }}
    >
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
        <Construction size={26} color={accent.primary} />
      </View>

      <View>
        <Text className="font-display text-2xl text-foreground">{title}</Text>
        <Text className="mt-1.5 font-body text-muted-foreground">
          {description ?? `Màn hình thật sẽ được dựng ở ${phase}.`}
        </Text>
      </View>

      <Card className="gap-1 p-4">
        <Text className="text-xs font-body-medium uppercase text-muted-foreground">
          Phiên hiện tại
        </Text>
        <Text className="font-body-semibold text-foreground">
          {user ? `${user.firstName} ${user.lastName}` : "—"}
        </Text>
        <Text className="font-body text-sm text-muted-foreground">
          {user?.email} · vai trò: {role}
        </Text>
      </Card>

      <Button variant="secondary" icon={LogOut} full onPress={logout}>
        Đăng xuất
      </Button>
    </ScrollView>
  );
}
