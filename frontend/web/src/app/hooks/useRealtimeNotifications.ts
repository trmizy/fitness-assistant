import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { REALTIME_EVENTS } from "../realtime/events";
import type { AppNotification } from "../types";
import { useSocket } from "./useSocket";

export function useRealtimeNotifications() {
  const queryClient = useQueryClient();
  const { socket, status } = useSocket();

  useEffect(() => {
    if (!socket) return;

    const handleNewNotification = (notification: AppNotification) => {
      const current = queryClient.getQueryData<{ notifications?: AppNotification[] }>([
        "notifications",
      ]);
      const list = current?.notifications || [];
      if (list.some((item) => item.id === notification.id)) return;

      const isUnread = notification.unread !== false;

      queryClient.setQueryData(["notifications"], (old: any) => {
        const oldList: AppNotification[] = old?.notifications || [];
        return {
          ...(old ?? {}),
          notifications: [notification, ...oldList].slice(0, 10),
          unreadCount: (old?.unreadCount || 0) + (isUnread ? 1 : 0),
        };
      });

      queryClient.setQueryData(["notifications-unread"], (old: any) => {
        if (!isUnread) return old ?? { count: 0 };
        return { ...(old ?? {}), count: (old?.count || 0) + 1 };
      });
    };

    socket.on(REALTIME_EVENTS.notificationNew, handleNewNotification);
    return () => {
      socket.off(REALTIME_EVENTS.notificationNew, handleNewNotification);
    };
  }, [queryClient, socket]);

  return { status };
}
