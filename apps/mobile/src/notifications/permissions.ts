import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

export type PermissionOutcome = "granted" | "denied" | "unsupported";

// Simulator/emulator (không phải thiết bị thật) không nhận được push
// token, nhưng LOCAL notification (dùng ở P11) vẫn hoạt động bình
// thường trên simulator iOS/Android — chỉ push từ server mới cần thiết
// bị thật. Vẫn xin quyền OS như bình thường.
export async function requestNotificationPermission(): Promise<PermissionOutcome> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") return "granted";

  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === "granted" ? "granted" : "denied";
}

export async function getNotificationPermissionStatus(): Promise<PermissionOutcome> {
  const result = await Notifications.getPermissionsAsync();
  return result.status === "granted" ? "granted" : "denied";
}

export function isPhysicalDevice(): boolean {
  return Device.isDevice;
}
