import { Stack } from "expo-router";

/** WB-17 — hàng chờ duyệt hồ sơ đối tác và màn chi tiết. Mỗi màn tự vẽ `ScreenHeader`. */
export default function AdminApplicationsLayout() {
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
