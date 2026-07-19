import { Redirect, Stack } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";
import { colors } from "../../src/ui";

// (tabs) holds the 5-tab shell; profile is pushed on top from the
// Trang chủ header button (see (tabs)/index.tsx).
export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="profile"
        options={{
          headerShown: true,
          title: "Hồ sơ",
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { color: colors.textPrimary },
          headerTintColor: colors.accent,
        }}
      />
    </Stack>
  );
}
