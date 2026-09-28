import { Stack } from "expo-router";

/** AD-02 — duyệt chi nhánh phòng gym: hàng việc và màn chi tiết. Mỗi màn tự vẽ `ScreenHeader`. */
export default function AdminGymsLayout() {
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
