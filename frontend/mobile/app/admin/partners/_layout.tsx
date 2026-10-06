import { Stack } from "expo-router";

// Keeps this stack's index under a screen opened directly (deep link, push tap) so Back returns
// to it instead of leaving the tab stranded on the sub-screen (real phone, 6/10).
export const unstable_settings = { initialRouteName: "index" };

/** 14B.8 (PG-D1) — danh sách đối tác và màn chi tiết. Mỗi màn tự vẽ `ScreenHeader`. */
export default function AdminPartnersLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "transparent" },
        animation: "slide_from_right",
      }}
    />
  );
}
