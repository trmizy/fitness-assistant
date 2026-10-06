import { Stack } from "expo-router";

// Keeps this stack's index under a screen opened directly (deep link, push tap) so Back returns
// to it instead of leaving the tab stranded on the sub-screen (real phone, 6/10).
export const unstable_settings = { initialRouteName: "index" };

/**
 * The "Cá nhân" tab (CL-05 hub) with its drill-downs pushed over it — edit profile, wallet,
 * settings, export, report issue, PT application. Same reason as workout/_layout.tsx: sub-screens
 * need their own Stack so "back" returns to the hub instead of leaving the tab.
 */
export default function ProfileStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
