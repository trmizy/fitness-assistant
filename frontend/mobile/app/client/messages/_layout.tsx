import { Stack } from "expo-router";

/**
 * One "messages" tab (SH-04/CL-21): the conversation list, with a conversation pushed over it —
 * see workout/_layout.tsx for why sub-screens need their own Stack.
 */
export default function MessagesStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
