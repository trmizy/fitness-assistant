import { Stack } from "expo-router";

/** One "stats" route segment — see workout/_layout.tsx. */
export default function StatsStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
