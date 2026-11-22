/**
 * GymOwnerBell - notification bell for the Gym Owner shell.
 * Topbar.tsx keeps its bell inline (and is being edited in another session), so it cannot be reused without touching it.
 * This component reuses everything that CAN be shared - notificationService, the existing query keys
 * (["notifications"], ["notifications-unread"]), notificationEventLabel and useRealtimeNotifications - and only re-draws the
 * panel in workspace tokens. The count shown on the badge is the real unread count from the API.
 */
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { BellIcon, ChecksIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationService } from "../../../services/api";
import { notificationEventLabel } from "../../../utils/notificationEventLabels";
import { useRealtimeNotifications } from "../../../hooks/useRealtimeNotifications";
import type { AppNotification } from "../../../types";
import { CountBadge, useDismissable, useDropdownPhase } from "./motion";

export function GymOwnerBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useRealtimeNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const phase = useDropdownPhase(open);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, rootRef, triggerRef);

  const { data: notifData } = useQuery({ queryKey: ["notifications"], queryFn: () => notificationService.list(1, 10), refetchInterval: 60000 });
  const { data: unreadData } = useQuery({ queryKey: ["notifications-unread"], queryFn: () => notificationService.getUnreadCount(), refetchInterval: 60000 });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
  };
  const markAll = useMutation({ mutationFn: () => notificationService.markAllRead(), onSuccess: refresh });
  const markRead = useMutation({ mutationFn: (id: string) => notificationService.markRead(id), onSuccess: refresh });

  const notifications: AppNotification[] = notifData?.notifications || [];
  const unread: number = unreadData?.count || 0;

  const openItem = (n: AppNotification) => {
    if (n.unread) markRead.mutate(n.id);
    const link =
      n.entityType === "GYM_COMPLAINT_CASE" && n.entityId ? `/gym-owner/complaint-cases/${encodeURIComponent(n.entityId)}` : n.link;
    if (link) {
      navigate(link);
      setOpen(false);
    }
  };

  return (
    <div className="go-menu-anchor go-bell-anchor" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="go-icon-btn"
        data-testid="notification-bell"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Thông báo, ${unread} chưa đọc` : "Thông báo"}
        onClick={() => setOpen((v) => !v)}
      >
        <BellIcon aria-hidden="true" />
        <CountBadge count={unread} />
      </button>
      <div className={`go-bell-panel ${phase.className}`} data-origin="top-right" role="dialog" aria-label="Thông báo">
        <div className="go-bell-head">
          <span>Thông báo</span>
          {unread > 0 && (
            <button type="button" className="go-icon-btn" onClick={() => markAll.mutate()} aria-label="Đánh dấu tất cả đã đọc">
              <ChecksIcon aria-hidden="true" />
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="go-bell-empty">Chưa có thông báo nào.</div>
        ) : (
          <ul className="go-bell-list">
            {notifications.map((n) => (
              <li key={n.id}>
                <button type="button" className="go-bell-item" data-unread={n.unread ? "true" : "false"} onClick={() => openItem(n)}>
                  <span style={{ display: "block" }}>{n.text}</span>
                  <span className="go-bell-meta">
                    {new Date(n.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                    {" "}
                    {notificationEventLabel(n.eventType)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
