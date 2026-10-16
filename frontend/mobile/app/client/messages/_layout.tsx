import { Stack } from "expo-router";

// Keeps this stack's index under a screen opened directly (deep link, push tap) so Back returns
// to it instead of leaving the tab stranded on the sub-screen (real phone, 6/10).
export const unstable_settings = { initialRouteName: "index" };

/**
 * One "messages" tab (SH-04/CL-21): the conversation list, with a conversation pushed over it —
 * see workout/_layout.tsx for why sub-screens need their own Stack.
 */
export default function MessagesStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
