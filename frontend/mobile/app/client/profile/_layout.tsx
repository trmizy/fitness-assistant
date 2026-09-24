import { Stack } from "expo-router";

/**
 * The "Cá nhân" tab (CL-05 hub) with its drill-downs pushed over it — edit profile, wallet,
 * settings, export, report issue, PT application. Same reason as workout/_layout.tsx: sub-screens
 * need their own Stack so "back" returns to the hub instead of leaving the tab.
 */
export default function ProfileStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
