import { Stack } from "expo-router";

/**
 * Vùng công khai của luồng đăng ký đối tác (WB-15). Cố ý **không** nằm trong `(auth)` và không có
 * guard nào: người mở nó chưa có tài khoản, và liên kết xác minh trong thư phải mở được ngay cả khi
 * ứng dụng đang đăng xuất.
 *
 * Mỗi màn tự vẽ `ScreenHeader` của nó, nên stack này không có header.
 */
export default function PartnerLayout() {
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
