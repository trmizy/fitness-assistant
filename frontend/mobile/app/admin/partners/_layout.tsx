import { Stack } from "expo-router";

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
