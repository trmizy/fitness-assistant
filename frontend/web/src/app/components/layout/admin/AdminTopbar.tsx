import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router";
import { BellIcon, CaretRightIcon, ChecksIcon, ListIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationService } from "../../../services/api";
import type { AppNotification } from "../../../types";
import { useRealtimeNotifications } from "../../../hooks/useRealtimeNotifications";
import { useBackDismissible } from "../../../hooks/useBackDismissible";
import { AutoText } from "../../i18n/AutoText";
import { LanguageSwitcher } from "../../settings/LanguageSwitcher";
import { AdminLink } from "./AdminLink";
import { getAdminBreadcrumb } from "./adminNav";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

/**
 * Notification bell — same service, same query keys and same realtime hook as the shared
 * Topbar's bell, so unread counts / mark-read behave identically. Presentation only differs
 * (admin tokens, buttons instead of clickable divs, Esc closes).
 */
function AdminNotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useRealtimeNotifications();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  useBackDismissible(open, () => setOpen(false));

  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationService.list(1, 10),
    refetchInterval: 60000,
  });
  const { data: unreadData } = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => notificationService.getUnreadCount(),
    refetchInterval: 60000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
  };
  const markAllRead = useMutation({ mutationFn: () => notificationService.markAllRead(), onSuccess: invalidate });
  const markRead = useMutation({ mutationFn: (id: string) => notificationService.markRead(id), onSuccess: invalidate });

  const notifications: AppNotification[] = notifData?.notifications || [];
  const unreadCount: number = unreadData?.count || 0;

  // Esc closes and returns focus to the bell; click outside closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={bellRef}
        type="button"
        data-testid="notification-bell"
        aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`relative grid size-11 place-items-center rounded-[10px] text-adm-text-2 transition-colors hover:bg-adm-surface-2 hover:text-adm-text motion-reduce:transition-none lg:size-9 ${FOCUS_RING}`}
      >
        <BellIcon size={20} aria-hidden />
        {unreadCount > 0 && (
          <span className="absolute right-2 top-2 size-2 rounded-full bg-primary lg:right-1.5 lg:top-1.5" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div
          role="region"
          aria-label="Thông báo"
          className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-adm-border bg-adm-surface text-adm-text shadow-adm-pop"
        >
          <div className="flex items-center justify-between border-b border-adm-border px-4 py-3">
            <h3 className="text-sm font-semibold">
              <AutoText>Thông báo</AutoText>
            </h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <span className="rounded-full bg-st-success-bg px-2 py-0.5 text-xs font-semibold text-st-success">
                  {unreadCount} <AutoText>mới</AutoText>
                </span>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  aria-label="Đánh dấu tất cả đã đọc"
                  title="Đánh dấu tất cả đã đọc"
                  className={`grid size-8 place-items-center rounded-lg text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text ${FOCUS_RING}`}
                >
                  <ChecksIcon size={16} aria-hidden />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.map((n) => (
              <button
                key={n.id}
                type="button"
                data-testid={`notification-item-${n.eventType}`}
                onClick={() => {
                  if (n.unread) markRead.mutate(n.id);
                  const caseLink =
                    n.entityType === "DISPUTE_CASE" && n.entityId
                      ? `/admin/disputes/${encodeURIComponent(n.entityId)}`
                      : n.entityType === "GYM_COMPLAINT_CASE" && n.entityId
                        ? `/admin/complaints/cases/${encodeURIComponent(n.entityId)}`
                        : null;
                  if (caseLink || n.link) {
                    navigate(caseLink ?? n.link!);
                    setOpen(false);
                  }
                }}
                className={`block w-full border-b border-adm-border-soft px-4 py-3 text-left transition-colors last:border-0 hover:bg-adm-surface-2 motion-reduce:transition-none ${FOCUS_RING} ${
                  n.unread ? "bg-st-info-bg/40" : ""
                }`}
              >
                <p className="text-sm">{n.text}</p>
                {n.eventType === "DISPUTE_CASE_UPDATED" && <p className="text-xs text-adm-text-2">Cập nhật hồ sơ khiếu nại</p>}
                <p className="mt-0.5 text-xs text-adm-text-2">
                  {new Date(n.createdAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </button>
            ))}
          </div>
          {notifications.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-adm-text-2">
              <AutoText>Chưa có thông báo nào.</AutoText>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Thin topbar (Master Plan §2.4): breadcrumb/context on the left, notification bell (and the
 * language switcher) on the right. The page's own H1 + subtitle stay inside each page. The
 * theme switch and the user menu live at the bottom of the sidebar instead.
 */
export function AdminTopbar({
  menuButtonRef,
  menuOpen,
  onOpenMenu,
}: {
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  menuOpen: boolean;
  onOpenMenu: () => void;
}) {
  const { pathname } = useLocation();
  const crumbs = getAdminBreadcrumb(pathname);

  return (
    <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-adm-border bg-adm-surface px-3 md:px-7">
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenMenu}
          aria-label="Mở menu điều hướng"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          data-testid="admin-menu-button"
          className={`grid size-11 shrink-0 place-items-center rounded-[10px] text-adm-text-2 transition-colors hover:bg-adm-surface-2 hover:text-adm-text motion-reduce:transition-none lg:hidden ${FOCUS_RING}`}
        >
          <ListIcon size={20} aria-hidden />
        </button>
        <nav aria-label="Đường dẫn" data-testid="admin-breadcrumb" className="min-w-0">
          <ol className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0 text-sm text-adm-text-2">
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li
                  key={`${crumb.label}-${i}`}
                  className={`min-w-0 items-center gap-1.5 ${last ? "flex" : "hidden sm:flex"}`}
                >
                  {i > 0 && <CaretRightIcon size={11} className="hidden shrink-0 sm:block" aria-hidden />}
                  {crumb.to && !last ? (
                    <AdminLink to={crumb.to} className={`truncate rounded-md hover:text-adm-text ${FOCUS_RING}`}>
                      <AutoText>{crumb.label}</AutoText>
                    </AdminLink>
                  ) : (
                    <span className={`truncate ${last ? "font-semibold text-adm-text" : ""}`} aria-current={last ? "page" : undefined}>
                      <AutoText>{crumb.label}</AutoText>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <div className="hidden md:block [&_label]:has-[:focus-visible]:outline-2 [&_label]:has-[:focus-visible]:outline-offset-2 [&_label]:has-[:focus-visible]:outline-[var(--adm-focus)] [&_select]:min-h-6">
          <LanguageSwitcher />
        </div>
        <AdminNotificationBell />
      </div>
    </header>
  );
}
