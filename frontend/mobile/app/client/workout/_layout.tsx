import { Stack } from "expo-router";

// Keeps this stack's index under a screen opened directly (deep link, push tap) so Back returns
// to it instead of leaving the tab stranded on the sub-screen (real phone, 6/10).
export const unstable_settings = { initialRouteName: "index" };

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
