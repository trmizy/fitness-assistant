import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useQueryClient } from "@tanstack/react-query";

import { useApp } from "../../context/AppContext";
import { useSocketContext } from "../../context/SocketContext";
import { REALTIME_EVENTS } from "../../realtime/events";
import { isForCurrentUser, readPushData } from "../push/pushRouting";
import { getSocket as getChatSocket } from "../../services/socket";
import { queryKeysForEvent } from "./eventRefresh";

/**
 * Keeps the lists behind a server event fresh while the app is open. Renders nothing.
 *
 * Three doors for the same event, because any can be shut. `notification:new` is emitted by
 * CHAT-service's socket (user-service posts it there), not by the gateway's — the app only ever
 * listened on the gateway's, so the event never arrived and the bell lived on its 60 s poll
 * (found 7/10). Both sockets are heard now, plus the phone push that lands while the app is on
 * screen (FCM still delivers when a socket is down). Each marks the affected lists stale — see
 * eventRefresh.ts; invalidating twice for one event is harmless.
 */
export function RealtimeRefresh() {
  const { user } = useApp();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const { socket } = useSocketContext();

  useEffect(() => {
    if (!userId) return;
    const refresh = (eventType?: string | null, entityType?: string | null) => {
      for (const queryKey of queryKeysForEvent(eventType, entityType)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    const onSocket = (n: any) => refresh(n?.eventType, n?.entityType);
    socket?.on(REALTIME_EVENTS.notificationNew, onSocket);
    // The same module-level instance CallProvider connects; listening does not open it.
    const chatSocket = getChatSocket();
    chatSocket.on(REALTIME_EVENTS.notificationNew, onSocket);

    const push = Notifications.addNotificationReceivedListener((notification) => {
      const data = readPushData(notification.request.content.data);
      if (isForCurrentUser(data, userId)) refresh(data.eventType, data.entityType);
    });

    return () => {
      socket?.off(REALTIME_EVENTS.notificationNew, onSocket);
      chatSocket.off(REALTIME_EVENTS.notificationNew, onSocket);
      push.remove();
    };
  }, [socket, queryClient, userId]);

  return null;
}
