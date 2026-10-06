import { Stack } from "expo-router";

// Keeps this stack's index under a screen opened directly (deep link, push tap) so Back returns
// to it instead of leaving the tab stranded on the sub-screen (real phone, 6/10).
export const unstable_settings = { initialRouteName: "index" };

/**
 * The "Học viên" tab (PT-02) with the per-client detail (PT-03) pushed over it — same reason as
 * the client's profile stack: "back" must return to the roster, not leave the tab.
 */
export default function PtStudentsStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
