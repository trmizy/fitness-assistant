import { Stack } from "expo-router";

/**
 * Phase 14.1 — holds the gateway return screen. Without this file `payments/result` would register
 * as its own `Tabs.Screen` under app/client/ and grow a sixth tab; with it, the single
 * `hiddenRoutes` entry "payments" in app/client/_layout.tsx keeps it off the tab bar.
 */
export default function PaymentsStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
