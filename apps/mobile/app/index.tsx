import { Redirect } from "expo-router";
import { useAuthStore } from "../src/store/authStore";

// Root layout only renders this after bootstrap() resolves (see
// app/_layout.tsx), so isAuthenticated here already reflects the real
// SecureStore-restored session.
export default function IndexGate() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return <Redirect href={isAuthenticated ? "/(app)" : "/(auth)/login"} />;
}
