import { Stack } from "expo-router";
import { colors } from "../../../../src/ui";

const headerOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: { color: colors.textPrimary },
  headerTintColor: colors.accent,
};

export default function PlansStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ ...headerOptions, title: "Kế hoạch" }} />
      <Stack.Screen name="decision" options={{ ...headerOptions, title: "Đề xuất AI" }} />
    </Stack>
  );
}
