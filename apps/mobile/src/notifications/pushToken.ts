// TODO(server-push): CHƯA implement. Đây chỉ là chỗ đặt sẵn cấu trúc.
//
// Để bật push từ server (FCM Android / APNs iOS qua Expo Push Service)
// cần các phần sau, hiện chưa có cái nào:
//
// 1. Backend: xác nhận `backend/services/user-service/src/routes/notification.routes.ts`
//    hiện chỉ có GET / , GET /unread-count, PATCH /:id/read, PATCH
//    /read-all — đây là inbox thông báo TRONG APP, không phải push
//    token registry. Cần thêm 1 route mới kiểu
//    `POST /notifications/push-token` lưu `{userId, expoPushToken,
//    platform}` vào bảng mới (chưa có model Prisma tương ứng).
// 2. Backend: khi có sự kiện cần push (VD: PT nhắn tin, buổi tập được
//    PT duyệt...) gọi Expo Push API (`https://exp.host/--/api/v2/push/send`)
//    với token đã lưu.
// 3. Mobile (hàm dưới đây, hiện chỉ trả về token, KHÔNG gửi lên server):
//    - `getExpoPushTokenAsync()` cần `projectId` thật từ EAS (xem P13
//      `app.config.ts`/`eas.json`) — hiện app chưa có EAS project nên
//      gọi hàm này sẽ throw ở runtime nếu chưa cấu hình.
//    - Sau khi có token, POST lên endpoint #1 (chưa tồn tại).
//
// Cho tới khi có #1 + #2, notification server-side sẽ KHÔNG hoạt động.
// P11 chỉ implement local notification (đặt lịch ngay trên máy, xem
// scheduler.ts) — không phụ thuộc phần này.

import * as Notifications from "expo-notifications";

export async function getExpoPushTokenForDebugOnly(): Promise<string | null> {
  try {
    const result = await Notifications.getExpoPushTokenAsync();
    return result.data;
  } catch {
    // Mong đợi throw nếu chưa có EAS projectId cấu hình (xem TODO ở trên).
    return null;
  }
}
