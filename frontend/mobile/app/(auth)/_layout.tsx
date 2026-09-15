import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "react-native";

/**
 * The signed-out area. A plain stack with no header — each screen draws its own, matching the
 * design, which gives every auth screen its full-bleed layout.
 *
 * Route group `(auth)` rather than a real folder so these live at `/login`, `/register`, … exactly
 * as on web. The role workspaces do the opposite (real `client/`, `pt/`, … segments) because their
 * URLs carry meaning — see src/config/landing.ts.
 */
export default function AuthLayout() {
  const insets = useSafeAreaInsets();

  return (
    // The stack's own screens are full-bleed, so the top inset is applied once here rather than
    // repeated in every screen.
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "transparent" },
          animation: "slide_from_right",
        }}
      />
    </View>
  );
}
