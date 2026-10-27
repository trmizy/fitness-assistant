import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../../context/AppContext";
import { adminService, personalizedServiceApi } from "../../../services/api";
import { ptApplicationService } from "../../../services/ptApplicationService";
import { adminPartnerApplications } from "../../../services/partnerApplication";
import { adminAmenityService } from "../../../services/ptListingApi";
import { proposalsKey } from "../../../pages/admin/listings/adminListingShared";
import {
  countAttention,
  normalizeObligationsReport,
  normalizeSessionsReport,
} from "../../../pages/admin/adminReconciliation.utils";
import {
  badgeFromApplicationCounts,
  badgeFromAttention,
  badgeFromLength,
  badgeFromPendingGyms,
  type AdminBadgeKey,
  type BadgeCount,
} from "./adminNav";

/**
 * Sidebar count badges. Every query below is the SAME query the corresponding admin page
 * already runs — same query key AND same queryFn / data shape — so React Query shares the
 * cache and no new endpoint is hit (Master Plan B2). If a page changes its query, change it
 * here too (the keys are the contract).
 *
 * A failed / not-yet-loaded query yields `null` → NO badge (never "0"), and nothing here
 * can block navigation: these are plain background queries with `retry: false`.
 */
const BADGE_QUERY_OPTIONS = {
  retry: false,
  staleTime: 60_000,
  refetchOnWindowFocus: false,
} as const;

export type AdminNavBadges = Record<AdminBadgeKey, BadgeCount>;

export function useAdminNavBadges(): AdminNavBadges {
  const { isAdmin } = useApp();
  const enabled = isAdmin;

  // Rút tiền — AdminWithdrawals: QUEUE_KEY
  const withdrawals = useQuery({
    queryKey: ["admin", "pending-withdrawals"],
    queryFn: () => adminService.listPendingWithdrawals(),
    enabled,
    ...BADGE_QUERY_OPTIONS,
  });

  // Hoàn tiền dịch vụ cá nhân hoá — PTServiceRefunds: LIST_KEY
  const serviceRefunds = useQuery({
    queryKey: ["refund-requests"],
    queryFn: () => personalizedServiceApi.listRefundRequests(),
    enabled,
    ...BADGE_QUERY_OPTIONS,
  });

  // Đối soát — AdminReconciliationBlocks (needs BOTH reports, as the page's own summary does)
  const payment = useQuery({
    queryKey: ["admin", "finance", "obligations-report"],
    queryFn: async () => normalizeObligationsReport(await adminService.getObligationsReport()),
    enabled,
    ...BADGE_QUERY_OPTIONS,
  });
  const sessions = useQuery({
    queryKey: ["admin", "finance", "sessions-reconciliation"],
    queryFn: async () => normalizeSessionsReport(await adminService.getSessionsReconciliation()),
    enabled,
    ...BADGE_QUERY_OPTIONS,
  });

  // Hồ sơ PT chờ duyệt — PTManagement: ["admin-pt-applications", filter] with filter = SUBMITTED
  const ptApplications = useQuery({
    queryKey: ["admin-pt-applications", "SUBMITTED"],
    queryFn: () => ptApplicationService.listApplications({ status: "SUBMITTED" }),
    enabled,
    ...BADGE_QUERY_OPTIONS,
  });

  // Hồ sơ đăng ký đối tác — AdminApplicationsPanel: counts
  const partnerApplications = useQuery({
    queryKey: ["admin-applications", "counts"],
    queryFn: () => adminPartnerApplications.list(),
    enabled,
    ...BADGE_QUERY_OPTIONS,
  });

  // Chi nhánh chờ duyệt lần đầu — AdminGymModeration: ["admin-gyms"]
  const gyms = useQuery({
    queryKey: ["admin-gyms"],
    queryFn: () => adminService.listGymsForAdmin(),
    enabled,
    ...BADGE_QUERY_OPTIONS,
  });

  // Đề xuất tiện ích chờ duyệt — AdminListingsPage badge
  const proposals = useQuery({
    queryKey: proposalsKey("PENDING"),
    queryFn: () => adminAmenityService.listProposals("PENDING"),
    enabled,
    ...BADGE_QUERY_OPTIONS,
  });

  const reconBothLoaded = Boolean(payment.data) && Boolean(sessions.data) && !payment.isError && !sessions.isError;
  const attention = reconBothLoaded ? countAttention(payment.data ?? null, sessions.data ?? null) : null;

  return {
    withdrawals: withdrawals.isError ? null : badgeFromLength(withdrawals.data),
    serviceRefunds: serviceRefunds.isError ? null : badgeFromLength(serviceRefunds.data),
    reconciliation: badgeFromAttention(attention?.critical, reconBothLoaded),
    ptApplications: ptApplications.isError ? null : badgeFromLength(ptApplications.data),
    partnerApplications: partnerApplications.isError ? null : badgeFromApplicationCounts(partnerApplications.data),
    gymsPending: gyms.isError ? null : badgeFromPendingGyms(gyms.data),
    listingsPending: proposals.isError ? null : badgeFromLength(proposals.data),
  };
}
