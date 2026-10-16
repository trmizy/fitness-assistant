import { Stack } from "expo-router";

// Keeps this stack's index under a screen opened directly (deep link, push tap) so Back returns
// to it instead of leaving the tab stranded on the sub-screen (real phone, 6/10).
export const unstable_settings = { initialRouteName: "index" };

/** One "roadmap" segment (WB-11): the journey, the guided wizard and the advanced form push here. */
export default function RoadmapStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
