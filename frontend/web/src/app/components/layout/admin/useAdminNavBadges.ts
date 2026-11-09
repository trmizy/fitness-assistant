import { useQuery } from "@tanstack/react-query";
import { useApp } from "../../../context/AppContext";
import { QUEUE_QUERIES } from "../../../pages/admin/today/queueQueries";
import { exceptionAttention } from "../../../pages/admin/reconciliation/reconciliationView";
import { RECON_KEYS, fetchGatewayDiscrepancies, fetchObligations, fetchSessionsReport } from "../../../pages/admin/reconciliation/useReconciliationData";
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
 *
 * Đối soát counts "cần xem ngay" across ALL THREE of its sources (P13 + U2 + P2); if any of the three has not loaded or
 * failed there is no badge rather than an undercount (`exceptionAttention` → null).
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
  const q = { enabled, ...BADGE_QUERY_OPTIONS } as const;

  // Rút tiền / Hoàn tiền dịch vụ / Hồ sơ PT / Hồ sơ đối tác / Chi nhánh / Đề xuất tiện ích: the queue pages' own queries
  // (key + function live in today/queueQueries.ts — one definition shared with "Hôm nay").
  const withdrawals = useQuery({ ...QUEUE_QUERIES.withdrawals, ...q });
  const serviceRefunds = useQuery({ ...QUEUE_QUERIES.serviceRefunds, ...q });
  const ptApplications = useQuery({ ...QUEUE_QUERIES.ptApplications, ...q });
  const partnerApplications = useQuery({ ...QUEUE_QUERIES.partnerApplications, ...q });
  const gyms = useQuery({ ...QUEUE_QUERIES.gyms, ...q });
  const proposals = useQuery({ ...QUEUE_QUERIES.proposals, ...q });

  // Đối soát — the page's own three reads: P13 + U2 (the 22 groups) AND P2 "Cổng báo số tiền khác số Gymini" (B3b).
  // Same keys + same functions as the reconciliation screen (RECON_KEYS / fetch*), so the badge and the screen agree.
  const payment = useQuery({ queryKey: RECON_KEYS.obligations, queryFn: fetchObligations, ...q });
  const sessions = useQuery({ queryKey: RECON_KEYS.sessions, queryFn: fetchSessionsReport, ...q });
  const gateway = useQuery({ queryKey: RECON_KEYS.gateway, queryFn: fetchGatewayDiscrepancies, ...q });

  const attention = exceptionAttention(
    payment.isError ? null : payment.data,
    sessions.isError ? null : sessions.data,
    gateway.isError ? null : gateway.data,
  );

  return {
    withdrawals: withdrawals.isError ? null : badgeFromLength(withdrawals.data),
    serviceRefunds: serviceRefunds.isError ? null : badgeFromLength(serviceRefunds.data),
    reconciliation: badgeFromAttention(attention?.critical, attention !== null),
    ptApplications: ptApplications.isError ? null : badgeFromLength(ptApplications.data),
    partnerApplications: partnerApplications.isError ? null : badgeFromApplicationCounts(partnerApplications.data),
    gymsPending: gyms.isError ? null : badgeFromPendingGyms(gyms.data),
    listingsPending: proposals.isError ? null : badgeFromLength(proposals.data),
  };
}
