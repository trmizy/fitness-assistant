import { Stack } from "expo-router";

// Keeps this stack's index under a screen opened directly (deep link, push tap) so Back returns
// to it instead of leaving the tab stranded on the sub-screen (real phone, 6/10).
export const unstable_settings = { initialRouteName: "index" };

/**
 * One "plans" route segment (CL-18/CL-23/CL-12) instead of sibling tab screens — see
 * workout/_layout.tsx. The hub, an AI plan's detail, the wizard, a market listing, a 1-1 service
 * and a 1-1 order all push over each other here, reachable from Tập luyện's header and the home
 * screen's "Kế hoạch" shortcut the way the design opens `Plans`.
 */
export default function PlansStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
