import { Stack } from "expo-router";
import { colors } from "../../../../src/ui";

const headerOptions = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.surface },
  headerTitleStyle: { color: colors.textPrimary },
  headerTintColor: colors.accent,
};

export default function WorkoutsStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ ...headerOptions, title: "Tập luyện" }} />
      <Stack.Screen name="exercises" options={{ ...headerOptions, title: "Chọn bài tập" }} />
      <Stack.Screen name="log" options={{ ...headerOptions, title: "Ghi buổi tập" }} />
      <Stack.Screen name="history" options={{ ...headerOptions, title: "Lịch sử" }} />
      <Stack.Screen name="[id]" options={{ ...headerOptions, title: "Chi tiết buổi tập" }} />
    </Stack>
  );
}
