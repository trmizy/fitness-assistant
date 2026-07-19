import { Redirect, Stack } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";

// Placeholder shell for P3 — replaced by a real tab navigator in P4.
export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
