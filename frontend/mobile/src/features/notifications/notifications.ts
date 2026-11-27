/**
 * CL-20 — pure parts of "Thông báo". Shape is user-service's real `GET /notifications` answer
 * (checked 22/9): `{ notifications: [{ id, text, eventType, entityType, entityId, link, unread,
 * createdAt }], unreadCount }`. `link` is a WEB route (or null) — mapped here to the mobile
 * screen that shows the same thing; an unknown link opens nothing rather than a dead route.
 */

import { anchorOptionsFor } from "../../config/returnPath";

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
    case "GYM_COMPLAINT_CASE_RESOLVED":
      return { title: "Khiếu nại đã xử lý", icon: "shield", tone: "primary" };
    // Gym complaint case (N09C-01): no mobile case screen exists yet, so these only get a title/icon and open nothing.
    case "GYM_COMPLAINT_CASE_OPENED":
      return { title: "Báo cáo đã được tiếp nhận", icon: "shield", tone: "primary" };
    case "GYM_COMPLAINT_CASE_MORE_INFO":
      return { title: "Cần bổ sung thông tin", icon: "alert", tone: "warning" };
    case "GYM_COMPLAINT_CASE_SLA_WARNING":
      return { title: "Hồ sơ sắp đến hạn xử lý", icon: "alert", tone: "warning" };
    case "GYM_COMPLAINT_CASE_SLA_OVERDUE":
      return { title: "Hồ sơ đã quá hạn xử lý", icon: "alert", tone: "danger" };
    case "GYM_COMPLAINT_CASE_APPEAL_FILED":
      return { title: "Kháng nghị đã được tiếp nhận", icon: "shield", tone: "primary" };
    // Withdrawal (Q9): the owner's approved / paid / rejected notices and the admins' "waiting for a second admin" notice.
    case "WITHDRAWAL_APPROVED":
      return { title: "Yêu cầu rút tiền đã được duyệt", icon: "money", tone: "primary" };
    case "WITHDRAWAL_PAID":
      return { title: "Rút tiền đã chuyển khoản", icon: "money", tone: "primary" };
    case "WITHDRAWAL_REJECTED":
      return { title: "Yêu cầu rút tiền bị từ chối", icon: "alert", tone: "danger" };
    case "WITHDRAWAL_AWAITING_SECOND_ADMIN":
      return { title: "Rút tiền chờ duyệt lần hai", icon: "money", tone: "warning" };
    case "CONTRACT_REQUESTED":
    case "CONTRACT_ACCEPTED":
      return { title: "Hợp đồng PT", icon: "file", tone: "primary" };
    case "CONTRACT_REJECTED":
    case "CONTRACT_CANCELLED":
    case "CONTRACT_CANCELLED_PT_DEACTIVATED":
      return { title: "Hợp đồng PT đã kết thúc", icon: "alert", tone: "danger" };
    case "CONTRACT_PAUSED_PT_SUSPENDED":
      return { title: "Hợp đồng tạm dừng", icon: "file", tone: "warning" };
    case "CONTRACT_RESUMED_PT_REINSTATED":
      return { title: "Hợp đồng hoạt động trở lại", icon: "file", tone: "primary" };
    case "REFUND_NEEDS_MANUAL_SETTLEMENT":
      return { title: "Hoàn tiền", icon: "money", tone: "warning" };
    case "PT_APPLICATION_SUBMITTED":
    case "PT_APPLICATION_REVIEWED":
      return { title: "Đơn ứng tuyển PT", icon: "shield", tone: "primary" };
    // Listing Management (M1): the PT's public listing. All four open the "Tin đăng" screen.
    case "PT_LISTING_APPROVED":
      return { title: "Tin đăng đã được duyệt", icon: "check", tone: "primary" };
    case "PT_LISTING_REJECTED":
      return { title: "Bản sửa tin đăng bị từ chối", icon: "alert", tone: "danger" };
    case "PT_LISTING_CHANGES_REQUESTED":
      return { title: "Tin đăng cần chỉnh sửa", icon: "alert", tone: "warning" };
    case "PT_LISTING_INVALIDATED":
      return { title: "Tin đăng vừa được cập nhật", icon: "file", tone: "warning" };
    // Listing Management (M2): the Gym Owner's branch listing and amenity proposals. All five open "Tin đăng & tiện ích".
    case "GYM_LISTING_APPROVED":
      return { title: "Tin đăng chi nhánh đã được duyệt", icon: "check", tone: "primary" };
    case "GYM_LISTING_REJECTED":
      return { title: "Bản sửa tin đăng chi nhánh bị từ chối", icon: "alert", tone: "danger" };
    case "GYM_LISTING_CHANGES_REQUESTED":
      return { title: "Tin đăng chi nhánh cần chỉnh sửa", icon: "alert", tone: "warning" };
    case "GYM_LISTING_INVALIDATED":
      return { title: "Tin đăng chi nhánh vừa được cập nhật", icon: "file", tone: "warning" };
    case "GYM_AMENITY_PROPOSAL_REVIEWED":
      return { title: "Đề xuất tiện ích đã được xử lý", icon: "sparkles", tone: "primary" };
    // Gym branch lifecycle (FIX3-NOTIFY): the admin suspended / lifted / temporarily closed / reopened the owner's (or manager's) branch. All four open that branch.
    case "GYM_BRANCH_SUSPENDED":
      return { title: "Chi nhánh bị tạm khoá", icon: "alert", tone: "danger" };
    case "GYM_BRANCH_SUSPENSION_LIFTED":
      return { title: "Chi nhánh được mở khoá", icon: "check", tone: "primary" };
    case "GYM_BRANCH_TEMPORARILY_CLOSED":
      return { title: "Chi nhánh tạm đóng cửa", icon: "alert", tone: "warning" };
    case "GYM_BRANCH_REOPENED":
      return { title: "Chi nhánh mở cửa lại", icon: "check", tone: "primary" };
    // Front desk (item 6): a check-in exception request waits for the owner / manager to approve it (opens "Quầy lễ tân").
    case "GYM_CHECKIN_EXCEPTION_REQUESTED":
      return { title: "Ngoại lệ check-in chờ duyệt", icon: "alert", tone: "warning" };
    // Plan review (PT <-> client): the client asked a PT to review a plan / the PT answered.
    case "PLAN_REVIEW_REQUESTED":
      return { title: "Yêu cầu duyệt kế hoạch", icon: "file", tone: "primary" };
    case "PLAN_REVIEW_DECIDED":
      return { title: "PT đã phản hồi kế hoạch", icon: "check", tone: "primary" };
    default:
      return { title: "Thông báo", icon: "bell", tone: "primary" };
  }
}

const LINK_MAP: Record<string, string> = {
  "/client/booking": "/client/services/booking",
  "/client/schedule": "/client/services/booking",
  "/client/contracts": "/client/services?tab=contracts",
  "/client/services": "/client/services",
  "/client/workout": "/client/workout",
  "/client/training": "/client/workout",
  "/client/nutrition": "/client/workout/nutrition",
  "/client/wallet": "/client/profile/wallet",
  // Withdrawal notices (Q9): the PT's wallet screen and the admin's withdrawals screen.
  "/pt/wallet": "/pt/wallet",
  // A PT's contract / schedule notices (user-service links them to the web's /pt/contracts and /pt/schedule).
  "/pt/contracts": "/pt/contracts",
  "/pt/schedule": "/pt/schedule",
  "/admin/finance/withdrawals": "/admin/withdrawals",
  "/client/dashboard": "/client/dashboard",
  "/client/pt-application": "/client/profile/pt-application",
  // Listing Management (M1): the server links PT listing notifications to "/pt/listing".
  "/pt/listing": "/pt/listing",
  // Front desk (item 6): gym-service links the exception notice to `/gym-owner/front-desk?gymId=<id>`; the mobile screen has its own branch switcher.
  "/gym-owner/front-desk": "/gym-owner/front-desk",
};

/**
 * Listing Management (M2): gym-service links its owner notifications to `/gym-owner/listings?gymId=<id>` (the web page); the
 * mobile screen is `/gym-owner/listing`. The branch id is kept so the screen opens straight on that branch.
 */
const GYM_LISTING_LINK = /^\/gym-owner\/listings?$/;
export function gymListingRoute(link: string): string | null {
  const [rawPath, query = ""] = link.split("#")[0].split("?");
  if (!GYM_LISTING_LINK.test(rawPath.replace(/\/+$/, ""))) return null;
  const id = /(?:^|&)gymId=([^&]+)/.exec(query)?.[1];
  return id ? `/gym-owner/listing?gymId=${id}` : "/gym-owner/listing";
}

/**
 * Gym branch lifecycle notices (FIX3-NOTIFY): gym-service links them to the web branch page `/gym-owner/gyms/<id>`; the mobile screen is
 * `/gym-owner/branch?gymId=<id>`.
 */
const GYM_BRANCH_LINK = /^\/gym-owner\/gyms\/([A-Za-z0-9_-]+)$/;
export function gymBranchRoute(link: string): string | null {
  const id = GYM_BRANCH_LINK.exec(link.split("#")[0].split("?")[0].replace(/\/+$/, ""))?.[1];
  return id ? `/gym-owner/branch?gymId=${id}` : null;
}

/**
 * Check-in exception notices (item 6): gym-service links them to `/gym-owner/front-desk?gymId=<id>`. The mobile route is the same
 * path ("Quầy lễ tân" tab); the branch id is kept so the desk opens on that branch (an unknown id falls back to the first branch).
 */
const GYM_FRONT_DESK_LINK = /^\/gym-owner\/front-desk$/;
export function gymFrontDeskRoute(link: string): string | null {
  const [rawPath, query = ""] = link.split("#")[0].split("?");
  if (!GYM_FRONT_DESK_LINK.test(rawPath.replace(/\/+$/, ""))) return null;
  const id = /(?:^|&)gymId=([A-Za-z0-9_-]{1,64})(?:&|$)/.exec(query)?.[1];
  return id ? `/gym-owner/front-desk?gymId=${id}` : "/gym-owner/front-desk";
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * N15M-11 — land on the exact thing. A contract notice opens Dịch vụ > Hợp đồng with that contract
 * highlighted; a session notice opens "Buổi tập" with that session's sheet open. The id is only added
 * when it really is that entity's id (a dispute-case notice carries the CASE id, which is not a session
 * id) and is well-formed; without it the route is the list.
 */
function refine(route: string, entityType: string | null, entityId: string | null): string {
  const id = entityId && SAFE_ID.test(entityId) ? entityId : null;
  // N16M-02 — a session notice is about the session, whatever tab the server's link names (the PT's session
  // requests carry /pt/contracts; a client's may carry /client/contracts): route to the schedule, never to a list
  // the session is not on ("Yêu cầu · 0").
  if (entityType === "SESSION") {
    if (route === "/pt/contracts" || route === "/pt/schedule") return id ? `/pt/schedule?sessionId=${id}` : "/pt/schedule";
    if (route === "/client/services?tab=contracts" || route === "/client/services") return refine("/client/services/booking", entityType, entityId);
  }
  if (route === "/client/services/booking") return entityType === "SESSION" && id ? `${route}?sessionId=${id}` : route;
  if (route === "/client/services?tab=contracts") return entityType === "CONTRACT" && id ? `${route}&contractId=${id}` : route;
  // A contract notice the server links to the bare Dịch vụ tab (PT feedback) belongs on Hợp đồng too.
  if (route === "/client/services" && entityType === "CONTRACT") return refine("/client/services?tab=contracts", entityType, entityId);
  // The PT's own screens take the same ids: the contract opens expanded, the session's day opens with that session outlined.
  if (route === "/pt/contracts") return entityType === "CONTRACT" && id ? `${route}?contractId=${id}` : route;
  if (route === "/pt/schedule") return entityType === "SESSION" && id ? `${route}?sessionId=${id}` : route;
  return route;
}

/** Where tapping a notification goes on mobile, or null when there is nothing to open. */
export function notificationRoute(n: Pick<AppNotification, "link" | "entityType"> & { entityId?: string | null }): string | null {
  const entityId = n.entityId ?? null;
  if (n.link) {
    const gymListing = gymListingRoute(n.link);
    if (gymListing) return gymListing;
    const gymBranch = gymBranchRoute(n.link);
    if (gymBranch) return gymBranch;
    const gymFrontDesk = gymFrontDeskRoute(n.link);
    if (gymFrontDesk) return gymFrontDesk;
    const path = n.link.split("?")[0].replace(/\/+$/, "");
    if (LINK_MAP[path]) return refine(LINK_MAP[path], n.entityType, entityId);
    for (const [prefix, target] of Object.entries(LINK_MAP)) if (path.startsWith(`${prefix}/`)) return refine(target, n.entityType, entityId);
    return null;
  }
  switch (n.entityType) {
    case "SESSION":
      return refine("/client/services/booking", n.entityType, entityId);
    case "CONTRACT":
      return refine("/client/services?tab=contracts", n.entityType, entityId);
    case "WORKOUT_SCHEDULE":
      return "/client/workout";
    case "PT_LISTING":
      return "/pt/listing";
    default:
      return null;
  }
}

/**
 * N17M-01 — how to push a notification route.
 *
 * A route that lands INSIDE a tab's own stack (`/client/services/booking`, `/client/profile/wallet`,
 * `/pt/service-orders/<id>` ...) pushed from another tab is applied to a navigator that is not mounted yet.
 * expo-router then starts that stack with ONLY the pushed screen: the layout's
 * `unstable_settings.initialRouteName` is skipped (it only applies to cold-start links), so the tab's hub
 * stays unreachable: its back arrow follows the global history and the tab keeps showing the sub-screen.
 * `withAnchor: true` makes expo-router load the stack's initial route (the hub) under the pushed screen.
 * Plain tab roots (`/client/services?tab=contracts`, `/pt/schedule`) have nothing to anchor, so they are
 * left alone (the flag would only add a stray `initial` param to their search params).
 */
export function notificationPushOptions(route: string): { withAnchor: true } | undefined {
  return anchorOptionsFor(route);
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
