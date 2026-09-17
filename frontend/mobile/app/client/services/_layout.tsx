import { Stack } from "expo-router";

/** One "services" route segment instead of a tab per sub-screen — see workout/_layout.tsx. */
export default function ServicesStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
