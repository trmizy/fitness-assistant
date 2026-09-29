import { Stack } from "expo-router";

/** AD-02 — đơn ứng tuyển huấn luyện viên: hàng chờ và màn chi tiết. Mỗi màn tự vẽ `ScreenHeader`. */
export default function AdminPtApplicationsLayout() {
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
