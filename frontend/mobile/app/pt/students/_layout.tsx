import { Stack } from "expo-router";

/**
 * The "Học viên" tab (PT-02) with the per-client detail (PT-03) pushed over it — same reason as
 * the client's profile stack: "back" must return to the roster, not leave the tab.
 */
export default function PtStudentsStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
