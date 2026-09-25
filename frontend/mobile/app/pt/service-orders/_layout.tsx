import { Stack } from "expo-router";

/** PT-09's detail lives under its own Stack so "back" returns to the order list. */
export default function PtServiceOrdersLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
