import type { QueryKey } from "@tanstack/react-query";
import { adminService, personalizedServiceApi } from "../../../services/api";
import { ptApplicationService } from "../../../services/ptApplicationService";
import { adminPartnerApplications } from "../../../services/partnerApplication";
import { adminAmenityService } from "../../../services/ptListingApi";
import { proposalsKey } from "../listings/adminListingShared";
import { RECON_KEYS } from "../reconciliation/useReconciliationData";

/**
 * The work-queue reads that BOTH the sidebar badges (`useAdminNavBadges`) and "Hôm nay" run. One definition = one
 * query key + one query function per queue, so React Query keeps a single cache entry and a single request serves
 * every surface (Master Plan B2 rule: "the keys are the contract"). If a queue page changes its query, change it here.
 *
 * These are plain option objects — pure data, no React — so the key list below can be unit-tested.
 */
export const QUEUE_QUERIES = {
  /** Rút tiền — AdminWithdrawals QUEUE_KEY (P7: PENDING + APPROVED, ≤100 rows). */
  withdrawals: { queryKey: ["admin", "pending-withdrawals"] as QueryKey, queryFn: () => adminService.listPendingWithdrawals() },
  /** Hoàn tiền dịch vụ — PTServiceRefunds LIST_KEY (A1: REFUND_REQUESTED only, no cap). */
  serviceRefunds: { queryKey: ["refund-requests"] as QueryKey, queryFn: () => personalizedServiceApi.listRefundRequests() },
  /** Hồ sơ PT — PTManagement `["admin-pt-applications", filter]` with filter = SUBMITTED (ADM-08). */
  ptApplications: {
    queryKey: ["admin-pt-applications", "SUBMITTED"] as QueryKey,
    queryFn: () => ptApplicationService.listApplications({ status: "SUBMITTED" }),
  },
  /** Hồ sơ đối tác — AdminApplicationsPanel counts (ADM-50). */
  partnerApplications: { queryKey: ["admin-applications", "counts"] as QueryKey, queryFn: () => adminPartnerApplications.list() },
  /** Chi nhánh — AdminGymModeration `["admin-gyms"]` (ADM-51). */
  gyms: { queryKey: ["admin-gyms"] as QueryKey, queryFn: () => adminService.listGymsForAdmin() },
  /** Đề xuất tiện ích — AdminListingsPage badge (ADM-71). */
  proposals: { queryKey: proposalsKey("PENDING") as QueryKey, queryFn: () => adminAmenityService.listProposals("PENDING") },
  /** Tranh chấp buổi tập — AdminDisputes (U1, ADM-32): every DISPUTED session, oldest first, no cap. */
  disputes: { queryKey: ["admin", "disputed-sessions"] as QueryKey, queryFn: () => adminService.listDisputedSessions() },
  /** Người dùng — `GET /auth/users` (auth-service: every non-ADMIN account with `createdAt`). Only "Hôm nay" reads it. */
  users: { queryKey: ["admin", "today", "users"] as QueryKey, queryFn: () => adminService.listUsers() },
  /** Dịch vụ đang chạy — `GET /admin/system-monitor` (gateway probe). Only "Hôm nay" reads it. */
  monitor: { queryKey: ["admin", "today", "system-monitor"] as QueryKey, queryFn: () => adminService.getSystemMonitoring() },
} as const;

/** Key prefixes the "Hôm nay" header "Làm mới" re-reads — exactly the sources the page shows (nothing more). */
export const TODAY_REFRESH_KEYS: readonly QueryKey[] = [
  QUEUE_QUERIES.withdrawals.queryKey,
  QUEUE_QUERIES.serviceRefunds.queryKey,
  QUEUE_QUERIES.ptApplications.queryKey,
  QUEUE_QUERIES.partnerApplications.queryKey,
  QUEUE_QUERIES.gyms.queryKey,
  QUEUE_QUERIES.proposals.queryKey,
  QUEUE_QUERIES.disputes.queryKey,
  QUEUE_QUERIES.users.queryKey,
  QUEUE_QUERIES.monitor.queryKey,
  RECON_KEYS.balance,
  RECON_KEYS.obligations,
  RECON_KEYS.sessions,
  RECON_KEYS.gateway,
];
