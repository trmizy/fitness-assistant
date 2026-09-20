import { Stack } from "expo-router";

/**
 * Without this file `inbody/index` and `inbody/entry` would each register as their own
 * `Tabs.Screen` under app/client/, so the client tab bar would grow two more tabs and the
 * `hiddenRoutes={["inbody", …]}` entry in app/client/_layout.tsx would stop matching anything.
 * Same reasoning as the workout stack.
 */
export default function InBodyStackLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
