import { Stack } from "expo-router";

/**
 * Without this file every screen under `workout/` would register as its OWN `Tabs.Screen`
 * (`workout/index`, `workout/log`, …) instead of one `workout` tab — the tab's `name` in
 * `app/client/_layout.tsx` would stop matching, and each sub-screen would render with the tab bar
 * under it. A Stack here keeps "Tập luyện" a single tab and lets the logging screen, templates and
 * import push over it the way the design shows them.
 */
export default function WorkoutStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
