import { Redirect, Slot } from "expo-router";

/**
 * Dev-only screens (kitchen sink). The route still exists in a release bundle — expo-router
 * registers every file — so without this a release build opened `fitnessassistant://kitchen-sink`
 * (found on a real phone, 6/10; Phase 15 deliverable 8).
 */
export default function DevLayout() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Slot />;
}
