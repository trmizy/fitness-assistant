import { Stack } from "expo-router";
import { colors } from "../../../../src/ui";

const headerOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: { color: colors.textPrimary },
  headerTintColor: colors.accent,
};

export default function InBodyStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ ...headerOptions, title: "InBody" }} />
      <Stack.Screen name="add" options={{ ...headerOptions, title: "Thêm bản ghi" }} />
    </Stack>
  );
}
