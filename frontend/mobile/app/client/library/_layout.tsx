import { Stack } from "expo-router";

// Keeps this stack's index under a screen opened directly (deep link, push tap) so Back returns
// to it instead of leaving the tab stranded on the sub-screen (real phone, 6/10).
export const unstable_settings = { initialRouteName: "index" };

/** One "library" route segment instead of six sibling tab screens — see workout/_layout.tsx. */
export default function LibraryStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
