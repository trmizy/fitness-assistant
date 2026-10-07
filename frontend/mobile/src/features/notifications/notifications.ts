/**
 * CL-20 — pure parts of "Thông báo". Shape is user-service's real `GET /notifications` answer
 * (checked 22/9): `{ notifications: [{ id, text, eventType, entityType, entityId, link, unread,
 * createdAt }], unreadCount }`. `link` is a WEB route (or null) — mapped here to the mobile
 * screen that shows the same thing; an unknown link opens nothing rather than a dead route.
 */

export type AppNotification = {
  id: string;
  text: string;
  eventType: string | null;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  unread: boolean;
  createdAt: string;
};

export type NotificationTone = "primary" | "warning" | "danger";
export type NotificationIcon = "calendar" | "check" | "money" | "sparkles" | "dumbbell" | "shield" | "alert" | "bell" | "file" | "salad";

export function normalizeNotifications(raw: unknown): { items: AppNotification[]; unreadCount: number } {
  const r = raw as any;
  const list: any[] = Array.isArray(r) ? r : Array.isArray(r?.notifications) ? r.notifications : Array.isArray(r?.data?.notifications) ? r.data.notifications : [];
  const items = list
    .filter((n) => n && typeof n.id === "string")
    .map((n) => ({
      id: n.id,
      text: String(n.text ?? n.message ?? ""),
      eventType: n.eventType ?? n.type ?? null,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
      link: typeof n.link === "string" ? n.link : null,
      unread: n.unread === true || n.read === false,
      createdAt: String(n.createdAt ?? ""),
    }));
  const count = typeof r?.unreadCount === "number" ? r.unreadCount : items.filter((i) => i.unread).length;
  return { items, unreadCount: count };
}

/** Title + icon + tone per event type. Titles are ours (the server only sends the body text). */
export function notificationMeta(eventType: string | null): { title: string; icon: NotificationIcon; tone: NotificationTone } {
  switch (eventType) {
    case "WORKOUT_UPCOMING":
      return { title: "Nhắc lịch tập", icon: "dumbbell", tone: "primary" };
    case "WORKOUT_RESCHEDULED":
      return { title: "Đã dời lịch tập", icon: "calendar", tone: "primary" };
    case "WORKOUT_UNFINISHED":
      return { title: "Buổi tập dang dở", icon: "dumbbell", tone: "warning" };
    case "TRAINING_PLAN_UPDATED":
      return { title: "Kế hoạch tập đã cập nhật", icon: "file", tone: "primary" };
    case "PT_FEEDBACK_RECEIVED":
      return { title: "Phản hồi từ PT", icon: "sparkles", tone: "primary" };
    case "NUTRITION_PLAN_READY":
      return { title: "Kế hoạch dinh dưỡng sẵn sàng", icon: "salad", tone: "primary" };
    case "CYCLE_ASSESSMENT_READY":
    case "CYCLE_REASSESSMENT_READY":
      return { title: "Đánh giá chu kỳ mới", icon: "sparkles", tone: "primary" };
    case "SESSION_BOOKED":
    case "SESSION_CONFIRMED":
    case "SESSION_AUTO_CONFIRMED":
    case "SESSION_COMPLETED":
      return { title: "Buổi tập với PT", icon: "check", tone: "primary" };
    case "SESSION_PENDING_CONFIRMATION":
      return { title: "Buổi tập chờ bạn xác nhận", icon: "check", tone: "warning" };
    case "SESSION_RESCHEDULE_REQUESTED":
      return { title: "Đề xuất dời lịch", icon: "calendar", tone: "warning" };
    case "SESSION_CANCELLED":
      return { title: "Buổi tập đã huỷ", icon: "alert", tone: "danger" };
    case "SESSION_NO_SHOW_PT":
    case "SESSION_PT_NO_SHOW_REPORTED":
      return { title: "PT vắng mặt", icon: "alert", tone: "warning" };
    case "SESSION_DISPUTED":
      return { title: "Khiếu nại buổi tập", icon: "alert", tone: "warning" };
    case "SESSION_DISPUTE_RESOLVED":
    case "GYM_COMPLAINT_RESOLVED":
      return { title: "Khiếu nại đã xử lý", icon: "shield", tone: "primary" };
    case "CONTRACT_REQUESTED":
    case "CONTRACT_ACCEPTED":
      return { title: "Hợp đồng PT", icon: "file", tone: "primary" };
    case "CONTRACT_REJECTED":
    case "CONTRACT_CANCELLED":
    case "CONTRACT_CANCELLED_PT_DEACTIVATED":
      return { title: "Hợp đồng PT đã kết thúc", icon: "alert", tone: "danger" };
    case "REFUND_NEEDS_MANUAL_SETTLEMENT":
      return { title: "Hoàn tiền", icon: "money", tone: "warning" };
    case "PT_APPLICATION_SUBMITTED":
    case "PT_APPLICATION_REVIEWED":
      return { title: "Đơn ứng tuyển PT", icon: "shield", tone: "primary" };
    default:
      return { title: "Thông báo", icon: "bell", tone: "primary" };
  }
}

const LINK_MAP: Record<string, string> = {
  "/client/booking": "/client/services/booking",
  "/client/schedule": "/client/services/booking",
  "/client/contracts": "/client/services",
  "/client/services": "/client/services",
  "/client/workout": "/client/workout",
  "/client/training": "/client/workout",
  "/client/nutrition": "/client/workout/nutrition",
  "/client/wallet": "/client/profile/wallet",
  "/client/dashboard": "/client/dashboard",
  "/client/pt-application": "/client/profile/pt-application",
};

/** Where tapping a notification goes on mobile, or null when there is nothing to open. */
export function notificationRoute(n: Pick<AppNotification, "link" | "entityType">): string | null {
  if (n.link) {
    const path = n.link.split("?")[0].replace(/\/+$/, "");
    if (LINK_MAP[path]) return LINK_MAP[path];
    for (const [prefix, target] of Object.entries(LINK_MAP)) if (path.startsWith(`${prefix}/`)) return target;
    return null;
  }
  switch (n.entityType) {
    case "SESSION":
      return "/client/services/booking";
    case "CONTRACT":
      return "/client/services";
    case "WORKOUT_SCHEDULE":
      return "/client/workout";
    default:
      return null;
  }
}

/** "Hôm nay" / "Tuần này" / "Trước đó" groups, newest first, empty groups dropped. */
export function groupNotifications(items: AppNotification[], now = new Date()) {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startWeek = startToday - 6 * 86_400_000;
  const groups: { label: string; items: AppNotification[] }[] = [
    { label: "Hôm nay", items: [] },
    { label: "Tuần này", items: [] },
    { label: "Trước đó", items: [] },
  ];
  const sorted = [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const n of sorted) {
    const t = Date.parse(n.createdAt);
    groups[t >= startToday ? 0 : t >= startWeek ? 1 : 2].items.push(n);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return "Vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  const date = new Date(t);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}
