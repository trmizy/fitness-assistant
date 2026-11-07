import { useEffect, useState } from "react";
import { useIsFetching, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { staleness, type Staleness } from "../adminFinanceOverview.utils";
import { exceptionAttention, type ExceptionAttention } from "../reconciliation/reconciliationView";
import { RECON_KEYS, errorView, fetchGatewayDiscrepancies, fetchObligations, fetchReconciliation, fetchSessionsReport, type ReconData } from "../reconciliation/useReconciliationData";
import { QUEUE_QUERIES, TODAY_REFRESH_KEYS } from "./queueQueries";
import {
  summarizeDisputes,
  summarizeGyms,
  summarizeMonitor,
  summarizePartnerApplications,
  summarizeProposals,
  summarizePtApplications,
  summarizeServiceRefundQueue,
  summarizeUsers,
  summarizeWithdrawalList,
  type MonitorFacts,
  type Src,
  type QueueFacts,
  type UsersFacts,
  type WithdrawalFacts,
} from "./todayModel";

/**
 * Data of "Hôm nay". Every source is its OWN query: one failing never blanks another (each is `loading`, `error` with a
 * reason, or `ready` with data — there is no state in which a number is "0 because we don't know"). The queue queries
 * share their keys/functions with the sidebar badges and with the queue pages themselves (`queueQueries.ts`), the
 * reconciliation ones with the Đối soát screen (`RECON_KEYS`), so one request serves them all.
 */
export type { Src };

const OPTIONS = { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } as const;
const POLL_MS = 60_000;
const USERS_POLL_MS = 5 * 60_000;
const MAX_AGE_MS = 3 * 60_000;

const MALFORMED = () => Object.assign(new Error("MALFORMED_RESPONSE"), { malformed: true });

function toSrc<T>(q: UseQueryResult<unknown>, read: (raw: unknown) => T | null, what: string): Src<T> {
  if (q.data !== undefined) {
    const v = read(q.data);
    return v === null ? { status: "error", ...errorView(MALFORMED(), what) } : { status: "ready", data: v };
  }
  if (q.isError) return { status: "error", ...errorView(q.error, what) };
  return { status: "loading" };
}

/** Combine several sources into one: any error wins (named), else any loading, else ready with `make`. */
function combine<T>(parts: Array<{ name: string; src: Src<unknown> }>, make: () => T | null): Src<T> {
  const failed = parts.filter((p) => p.src.status === "error");
  if (failed.length) {
    return {
      status: "error",
      message: `Chưa đọc được: ${failed.map((p) => p.name).join(", ")}. Chưa biết số liệu; đây không phải số bằng không.`,
      forbidden: failed.every((p) => p.src.status === "error" && p.src.forbidden),
    };
  }
  if (parts.some((p) => p.src.status === "loading")) return { status: "loading" };
  const v = make();
  return v === null ? { status: "error", message: "Dữ liệu không đọc được. Chưa biết số liệu; đây không phải số bằng không.", forbidden: false } : { status: "ready", data: v };
}

export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface TodayData {
  nowMs: number;
  withdrawals: Src<WithdrawalFacts>;
  serviceRefunds: Src<QueueFacts>;
  disputes: Src<QueueFacts>;
  ptApplications: Src<QueueFacts>;
  partnerApplications: Src<QueueFacts>;
  gyms: Src<QueueFacts>;
  proposals: Src<QueueFacts>;
  /** P13 + U2 + P2 together (the same three sources the sidebar badge needs). */
  exceptions: Src<ExceptionAttention>;
  balance: Src<ReconData>;
  users: Src<UsersFacts>;
  monitor: Src<MonitorFacts>;
  /** Latest `dataUpdatedAt` among sources that have data (0 = nothing loaded yet). */
  updatedAt: number;
  /** When the balance (P3) was last read — the tile says "Tính đến" with it. */
  balanceUpdatedAt: number;
  stale: Staleness;
  fetching: boolean;
  /** Every source answered 401/403 → show no numbers at all. */
  allForbidden: boolean;
  refresh: () => void;
}

export function useTodayData(): TodayData {
  const nowMs = useNow(30_000);
  const queryClient = useQueryClient();

  const wd = useQuery({ ...QUEUE_QUERIES.withdrawals, ...OPTIONS, refetchInterval: POLL_MS });
  const rf = useQuery({ ...QUEUE_QUERIES.serviceRefunds, ...OPTIONS, refetchInterval: POLL_MS });
  const dp = useQuery({ ...QUEUE_QUERIES.disputes, ...OPTIONS, refetchInterval: POLL_MS });
  const pt = useQuery({ ...QUEUE_QUERIES.ptApplications, ...OPTIONS, refetchInterval: POLL_MS });
  const pa = useQuery({ ...QUEUE_QUERIES.partnerApplications, ...OPTIONS, refetchInterval: POLL_MS });
  const gy = useQuery({ ...QUEUE_QUERIES.gyms, ...OPTIONS, refetchInterval: POLL_MS });
  const pr = useQuery({ ...QUEUE_QUERIES.proposals, ...OPTIONS, refetchInterval: POLL_MS });
  const bal = useQuery({ queryKey: RECON_KEYS.balance, queryFn: fetchReconciliation, ...OPTIONS, refetchInterval: POLL_MS });
  const ob = useQuery({ queryKey: RECON_KEYS.obligations, queryFn: fetchObligations, ...OPTIONS, refetchInterval: POLL_MS });
  const se = useQuery({ queryKey: RECON_KEYS.sessions, queryFn: fetchSessionsReport, ...OPTIONS, refetchInterval: POLL_MS });
  const gw = useQuery({ queryKey: RECON_KEYS.gateway, queryFn: fetchGatewayDiscrepancies, ...OPTIONS, refetchInterval: POLL_MS });
  const us = useQuery({ ...QUEUE_QUERIES.users, ...OPTIONS, staleTime: 60_000, refetchInterval: USERS_POLL_MS });
  const mo = useQuery({ ...QUEUE_QUERIES.monitor, ...OPTIONS, refetchInterval: POLL_MS });

  const withdrawals = toSrc(wd, (raw) => summarizeWithdrawalList(raw, nowMs), "hàng đợi rút tiền");
  const serviceRefunds = toSrc(rf, summarizeServiceRefundQueue, "yêu cầu hoàn tiền dịch vụ");
  const disputes = toSrc(dp, summarizeDisputes, "danh sách tranh chấp buổi tập");
  const ptApplications = toSrc(pt, summarizePtApplications, "hồ sơ PT chờ duyệt");
  const partnerApplications = toSrc(pa, summarizePartnerApplications, "hồ sơ đối tác chờ duyệt");
  const gyms = toSrc(gy, summarizeGyms, "chi nhánh chờ duyệt");
  const proposals = toSrc(pr, summarizeProposals, "đề xuất tiện ích chờ duyệt");
  const balance = toSrc(bal, (raw) => (raw && typeof raw === "object" && "report" in raw ? (raw as ReconData) : null), "số dư các ví");
  const obSrc = toSrc(ob, (raw) => raw, "nghĩa vụ và tiền giữ lại");
  const seSrc = toSrc(se, (raw) => raw, "tất toán hợp đồng và buổi tập");
  const gwSrc = toSrc(gw, (raw) => raw, "sai lệch số tiền cổng");
  const exceptions = combine(
    [
      { name: "sổ cái và nghĩa vụ", src: obSrc },
      { name: "tất toán hợp đồng", src: seSrc },
      { name: "sai lệch số tiền cổng", src: gwSrc },
    ],
    () => exceptionAttention(ob.data, se.data, gw.data),
  );
  const users = toSrc(us, (raw) => summarizeUsers(raw, nowMs), "danh sách người dùng");
  const monitor = toSrc(mo, summarizeMonitor, "tình trạng dịch vụ");

  // Freshness: only the queue / money sources (they poll every minute); users + monitor poll on their own clock.
  const polled = [wd, rf, dp, pt, pa, gy, pr, bal, ob, se, gw];
  const loaded = polled.filter((q) => q.data !== undefined);
  const oldest = loaded.length ? Math.min(...loaded.map((q) => q.dataUpdatedAt)) : 0;
  const stale = staleness({
    hasData: loaded.length > 0,
    updatedAt: oldest,
    refetchFailed: loaded.some((q) => q.isError),
    nowMs,
    maxAgeMs: MAX_AGE_MS,
  });
  const all = [...polled, us, mo];
  const updatedAt = Math.max(0, ...all.filter((q) => q.data !== undefined).map((q) => q.dataUpdatedAt));

  const refreshKeys = TODAY_REFRESH_KEYS;
  const fetching = useIsFetching({ predicate: (q) => refreshKeys.some((k) => k.every((p, i) => q.queryKey[i] === p)) }) > 0;

  const sources: Array<Src<unknown>> = [withdrawals, serviceRefunds, disputes, ptApplications, partnerApplications, gyms, proposals, balance, obSrc, seSrc, gwSrc, users, monitor];

  return {
    nowMs,
    withdrawals,
    serviceRefunds,
    disputes,
    ptApplications,
    partnerApplications,
    gyms,
    proposals,
    exceptions,
    balance,
    users,
    monitor,
    updatedAt,
    balanceUpdatedAt: bal.data !== undefined ? bal.dataUpdatedAt : 0,
    stale,
    fetching,
    allForbidden: sources.every((s) => s.status === "error" && s.forbidden),
    refresh: () => {
      for (const queryKey of refreshKeys) void queryClient.invalidateQueries({ queryKey });
    },
  };
}
