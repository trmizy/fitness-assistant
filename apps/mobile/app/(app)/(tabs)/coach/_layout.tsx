import { Stack } from "expo-router";
import { colors } from "../../../../src/ui";

const headerOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: { color: colors.textPrimary },
  headerTintColor: colors.accent,
};

export default function CoachStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ ...headerOptions, title: "Coach" }} />
      <Stack.Screen name="[sessionId]" options={{ ...headerOptions, title: "Trò chuyện" }} />
    </Stack>
  );
}
