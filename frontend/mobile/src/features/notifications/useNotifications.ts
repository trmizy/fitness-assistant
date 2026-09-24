import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { notificationService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { useSocketContext } from "../../context/SocketContext";
import { REALTIME_EVENTS } from "../../realtime/events";

export const notificationsKey = (userId: string) => ["notifications", userId] as const;
export const unreadCountKey = (userId: string) => ["notifications-unread", userId] as const;

/**
 * Unread count for the bell (`GET /notifications/unread-count` → `{ count }`), refreshed when the
 * gateway pushes `notification:new` and every minute as a fallback. Keys carry the user id so a
 * different account never sees the previous one's count.
 */
export function useUnreadNotifications() {
  const { user } = useApp();
  const userId = user?.id ?? "guest";
  const queryClient = useQueryClient();
  const { socket } = useSocketContext();

  const query = useQuery({
    queryKey: unreadCountKey(userId),
    queryFn: async () => {
      const r: any = await notificationService.getUnreadCount();
      const n = r?.count ?? r?.data?.count ?? r?.unreadCount;
      return typeof n === "number" ? n : 0;
    },
    enabled: !!user?.id,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!socket) return;
    const onNew = () => {
      void queryClient.invalidateQueries({ queryKey: unreadCountKey(userId) });
      void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
    };
    socket.on(REALTIME_EVENTS.notificationNew, onNew);
    return () => {
      socket.off(REALTIME_EVENTS.notificationNew, onNew);
    };
  }, [socket, queryClient, userId]);

  return query.data ?? 0;
}
