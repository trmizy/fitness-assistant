import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { router, usePathname, useRootNavigationState } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { useApp } from "../../context/AppContext";
import { notificationService } from "../../services/api";
import { notificationsKey, unreadCountKey } from "../notifications/useNotifications";
import { Preferences } from "../../services/storage";
import { registerPushToken } from "./pushDevice";
import { decidePushPermission, PUSH_ASKED_KEY } from "./pushPermission";
import { isForCurrentUser, pushTapRoute, readPushData, showsWhileOpen, type PushData } from "./pushRouting";

/** Must match ANDROID_CHANNEL_ID in user-service push.service.ts. */
const CHANNEL_ID = "default";

// Read by the foreground handler below, which lives outside React.
let signedInUserId: string | null = null;

// While the app is open a push would otherwise arrive silently. Show it — but only when it was
// written for whoever is signed in right now (see isForCurrentUser).
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = readPushData(notification.request.content.data);
    // This handler also runs while the app sits in the background with its JS alive (seen on the
    // emulator: a call push vanished after Home) — "open" means actually on screen.
    const onScreen = AppState.currentState === "active";
    const show = isForCurrentUser(data, signedInUserId) && (!onScreen || showsWhileOpen(data));
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

/**
 * Phase 14.2 — phone push for the signed-in account. Renders nothing.
 *
 * - Signed in → notification channel, permission (Android 13+ asks; older grants by default),
 *   FCM token registered to this account, re-registered whenever FCM rotates it.
 * - A tap — app open, in the background, or cold-started by the tap — opens the matching screen
 *   once navigation is ready and someone is signed in; a tap made while signed out waits for the
 *   sign-in, and is dropped if a different account signs in (the push was not theirs).
 * - Sign-out unregisters the token and clears the shade (AppContext.logout → pushDevice).
 */
export function PushManager() {
  const { user, role } = useApp();
  const queryClient = useQueryClient();
  // Ready = the navigator exists AND the app has left "/". On a cold start from a tap, app/index
  // (RootRedirect) redirects to the role's home once the session is restored — navigating before
  // that lands the tap's screen first and then the redirect replaces it (seen on the release
  // build: the notification was marked read but the app sat on the dashboard).
  const rootKey = useRootNavigationState()?.key;
  const pathname = usePathname();
  const navigationReady = !!rootKey && pathname !== "/" && pathname !== "";
  const pendingTap = useRef<PushData | null>(null);

  const userId = user?.id ?? null;
  useEffect(() => {
    signedInUserId = userId;
  }, [userId]);

  // Was the app cold-started by a deep link (e.g. the payment return)? null = not known yet.
  const [launchedByLink, setLaunchedByLink] = useState<boolean | null>(null);
  const landingPath = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    Linking.getInitialURL()
      .then((url) => alive && setLaunchedByLink(!!url))
      .catch(() => alive && setLaunchedByLink(false));
    return () => {
      alive = false;
    };
  }, []);
  // The first real screen after the splash redirect — where a deep link landed the user.
  if (landingPath.current === null && navigationReady) landingPath.current = pathname;
  const onDeepLinkLanding = launchedByLink === true && pathname === landingPath.current;

  // Permission still to be asked (never asked, askable) but not allowed on the current screen yet.
  const [promptPending, setPromptPending] = useState(false);
  const prompting = useRef(false);

  // Register this phone for the signed-in account.
  useEffect(() => {
    if (!userId || Platform.OS !== "android") return;
    let cancelled = false;
    void (async () => {
      try {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
          name: "Thông báo",
          importance: Notifications.AndroidImportance.HIGH,
        });
        const current = await Notifications.getPermissionsAsync();
        const asked = (await Preferences.get({ key: PUSH_ASKED_KEY })).value != null;
        if (cancelled) return;
        const decision = decidePushPermission({
          granted: current.granted,
          canAskAgain: current.canAskAgain,
          askedBefore: asked,
          pathname: "",
          onDeepLinkLanding: false,
        });
        if (decision === "register") {
          const { data } = await Notifications.getDevicePushTokenAsync();
          if (!cancelled && typeof data === "string") await registerPushToken(data);
        } else if (decision === "defer") {
          // askable and never asked — the dialog waits for a normal screen (effect below)
          setPromptPending(true);
        }
      } catch (err) {
        // No Google Play services, no network, FCM hiccup — push is a nudge, never a blocker.
        console.warn("[push] registration skipped", err);
      }
    })();
    const rotation = Notifications.addPushTokenListener(({ data }) => {
      if (typeof data === "string") void registerPushToken(data).catch(() => undefined);
    });
    return () => {
      cancelled = true;
      setPromptPending(false);
      rotation.remove();
    };
  }, [userId]);

  // Ask at most once per install, and only on a normal screen: never over the payment result or on
  // the screen a deep link cold-started us on (the dialog used to stack on top of the result on every
  // cold start). The flag is saved BEFORE the dialog so a crash/kill mid-dialog cannot make it loop.
  useEffect(() => {
    if (!userId || !promptPending || launchedByLink === null || prompting.current) return;
    const decision = decidePushPermission({
      granted: false,
      canAskAgain: true,
      askedBefore: false,
      pathname,
      onDeepLinkLanding,
    });
    if (decision !== "prompt") return;
    prompting.current = true;
    setPromptPending(false);
    void (async () => {
      try {
        await Preferences.set({ key: PUSH_ASKED_KEY, value: String(Date.now()) });
        const result = await Notifications.requestPermissionsAsync();
        if (!result.granted) return;
        const { data } = await Notifications.getDevicePushTokenAsync();
        if (typeof data === "string") await registerPushToken(data);
      } catch (err) {
        console.warn("[push] permission request skipped", err);
      } finally {
        prompting.current = false;
      }
    })();
  }, [userId, promptPending, launchedByLink, pathname, onDeepLinkLanding]);

  const openPendingTap = useCallback(() => {
    const data = pendingTap.current;
    if (!data || !navigationReady || !userId) return;
    pendingTap.current = null;
    Notifications.clearLastNotificationResponse();
    const route = pushTapRoute(data, userId, role);
    if (!route) return; // written for another account
    if (data.notificationId) {
      void notificationService
        .markRead(data.notificationId)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
          void queryClient.invalidateQueries({ queryKey: unreadCountKey(userId) });
        })
        .catch(() => undefined);
    }
    router.push(route as never);
  }, [navigationReady, queryClient, role, userId]);

  // Taps: the one that cold-started the app, then every later one.
  useEffect(() => {
    const take = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      pendingTap.current = readPushData(response.notification.request.content.data);
      openPendingTap();
    };
    take(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(take);
    return () => sub.remove();
  }, [openPendingTap]);

  // A tap that arrived before navigation or sign-in was ready.
  useEffect(() => {
    openPendingTap();
  }, [openPendingTap]);

  return null;
}
