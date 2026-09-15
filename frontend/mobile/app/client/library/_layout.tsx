import { Stack } from "expo-router";

/** One "library" route segment instead of six sibling tab screens — see workout/_layout.tsx. */
export default function LibraryStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
