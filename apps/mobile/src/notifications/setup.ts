import * as Notifications from "expo-notifications";

// Gọi 1 lần ở app/_layout.tsx — quyết định app hiển thị thông báo ra
// sao khi đến lúc app đang mở (foreground).
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
