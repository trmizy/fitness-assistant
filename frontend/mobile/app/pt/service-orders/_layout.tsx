import { Stack } from "expo-router";

// Keeps this stack's index under a screen opened directly (deep link, push tap) so Back returns
// to it instead of leaving the tab stranded on the sub-screen (real phone, 6/10).
export const unstable_settings = { initialRouteName: "index" };

/** PT-09's detail lives under its own Stack so "back" returns to the order list. */
export default function PtServiceOrdersLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
