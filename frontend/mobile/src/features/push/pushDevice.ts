import * as Notifications from "expo-notifications";
import { notificationService } from "../../services/api";
import { Preferences } from "../../services/storage";

/**
 * Phase 14.2 — this phone's FCM token on the server (user-service `push_devices`).
 *
 * The token last registered is remembered so sign-out can take it back off the account it was
 * registered to — while the session is still valid, since unregistering is an authenticated call.
 * Both directions are best-effort: a failed register is retried on the next start or token
 * rotation, and a failed unregister is corrected the moment another account signs in on this
 * phone (the server re-points the row by token).
 */
const KEY = "push.registeredToken";

export async function registerPushToken(token: string): Promise<void> {
  await notificationService.registerDevice(token);
  await Preferences.set({ key: KEY, value: token });
}

export async function unregisterPushToken(): Promise<void> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return;
  try {
    await notificationService.unregisterDevice(value);
  } catch {
    // offline / session already gone — see the header for why this is safe to drop
  }
  await Preferences.remove({ key: KEY });
}

/**
 * E2 — once the call has been answered or declined in the app, its "đang gọi" notice in the shade
 * is stale. Best-effort: the shade entry is the system's, and a missing one is not an error.
 */
export async function dismissCallPush(callSessionId: string): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const n of shown) {
      const data = (n.request.content.data ?? {}) as Record<string, unknown>;
      if (data.callSessionId === callSessionId) await Notifications.dismissNotificationAsync(n.request.identifier);
    }
  } catch {
    // nothing to tidy
  }
}
