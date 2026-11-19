import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminService, api } from "../../../services/api";
import { normalizeObligationsReport, normalizeSessionsReport } from "../adminReconciliation.utils";
import { normalizeReconciliation, reconciliationFromHttpError, type ReconciliationReport } from "../adminFinanceOverview.utils";
import { describeAdminError } from "../shared/useAdminError";
import { normalizeGatewayDiscrepancies, normalizeReconciliationRuns } from "./reconciliationView";

/**
 * Data of "Tài chính › Đối soát". The three reads that already existed keep their query keys AND the exact data shape
 * the other screens cache under them (B3 overview tab `["admin","finance","reconciliation"]` = `{report, conflict}`,
 * the sidebar badges / B3 queue `obligations-report` + `sessions-reconciliation` = the normalised reports), so one
 * request serves all of them and the header "Làm mới" invalidates them together.
 */
export const RECON_KEYS = {
  balance: ["admin", "finance", "reconciliation"] as const,
  /** G-06 run history. Starts with the balance key, so "Làm mới" (prefix invalidation) refreshes it together with the balance. */
  runs: ["admin", "finance", "reconciliation", "runs"] as const,
  obligations: ["admin", "finance", "obligations-report"] as const,
  sessions: ["admin", "finance", "sessions-reconciliation"] as const,
  gateway: ["admin", "finance", "gateway-discrepancies"] as const,
};

const POLL_MS = 60_000;

export interface ReconData {
  report: ReconciliationReport;
  /** The server answered 409 (= "có lệch") with the full report — a drift, NOT a load error. */
  conflict: boolean;
}

export const malformed = () => Object.assign(new Error("MALFORMED_RESPONSE"), { malformed: true });

/** P3. HTTP 409 carries the full report: that is exactly when the admin must see the numbers. */
export async function fetchReconciliation(): Promise<ReconData> {
  try {
    const res = await adminService.getReconciliation();
    const report = normalizeReconciliation(res);
    if (!report) throw malformed();
    return { report, conflict: false };
  } catch (error) {
    const report = reconciliationFromHttpError(error);
    if (report) return { report, conflict: true };
    throw error;
  }
}

export interface ErrorView {
  message: string;
  forbidden: boolean;
}

/** One sentence that always says "the figure is unknown" — never lets an error read as zero. */
export function errorView(error: unknown, what: string): ErrorView {
  if ((error as { malformed?: boolean } | null)?.malformed) {
    return { message: `Máy chủ trả về ${what} không đọc được. Chưa biết số liệu — không phải số bằng không.`, forbidden: false };
  }
  const v = describeAdminError(error, { action: "read" });
  const forbidden = v.kind === "forbidden" || v.kind === "unauthorized";
  if (v.kind === "server") return { message: `Không tải được ${what} — lỗi máy chủ. Chưa biết số liệu; đây không phải số bằng không.`, forbidden };
  if (v.kind === "network") return { message: `Không kết nối được máy chủ để tải ${what}. Chưa biết số liệu; đây không phải số bằng không.`, forbidden };
  return { message: `${v.message} Chưa biết số liệu; đây không phải số bằng không.`, forbidden };
}

const OPTIONS = { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } as const;

export function useBalanceReport() {
  return useQuery({ queryKey: RECON_KEYS.balance, queryFn: fetchReconciliation, refetchInterval: POLL_MS, ...OPTIONS });
}

/** P13 — the obligations report; a body that cannot be read is a failure, never an empty report. */
export async function fetchObligations() {
  const report = normalizeObligationsReport(await adminService.getObligationsReport());
  if (!report) throw malformed();
  return report;
}

/** U2 — the sessions/settlement report (same rule as P13). */
export async function fetchSessionsReport() {
  const report = normalizeSessionsReport(await adminService.getSessionsReconciliation());
  if (!report) throw malformed();
  return report;
}

/**
 * P2. Shared by the reconciliation page AND the sidebar badge / "Hôm nay" (B3b): same query key, same function, so
 * every surface reads one cache entry and they always agree.
 */
export async function fetchGatewayDiscrepancies() {
  // P2 has no adminService wrapper yet; same axios instance (auth header, base URL, refresh) as every admin call.
  const { data } = await api.get("/admin/payments/gateway-discrepancies");
  const report = normalizeGatewayDiscrepancies(data);
  if (!report) throw malformed();
  return report;
}

/** P13 + U2 (+ P2 when `gateway`). Independent: if one source fails the others still render. */
export function useExceptionReports(opts: { gateway: boolean }) {
  const payment = useQuery({ queryKey: RECON_KEYS.obligations, queryFn: fetchObligations, refetchInterval: POLL_MS, ...OPTIONS });
  const sessions = useQuery({ queryKey: RECON_KEYS.sessions, queryFn: fetchSessionsReport, refetchInterval: POLL_MS, ...OPTIONS });
  const gateway = useQuery({ queryKey: RECON_KEYS.gateway, enabled: opts.gateway, queryFn: fetchGatewayDiscrepancies, refetchInterval: POLL_MS, ...OPTIONS });
  return { payment, sessions, gateway };
}

/** G-06 — the history of balance checks, newest first. Same axios instance (auth header, base URL, refresh) as every admin call. */
export const RUNS_PAGE_SIZE = 20;

export async function fetchReconciliationRuns(offset: number) {
  const { data } = await api.get("/admin/payments/reconciliation/runs", { params: { limit: RUNS_PAGE_SIZE, offset } });
  const page = normalizeReconciliationRuns(data);
  if (!page) throw malformed();
  return page;
}

export function useReconciliationRuns(offset: number) {
  return useQuery({ queryKey: [...RECON_KEYS.runs, offset], queryFn: () => fetchReconciliationRuns(offset), placeholderData: keepPreviousData, ...OPTIONS });
}

/**
 * G-06 - "Chạy đối soát và lưu": POST asks the server to run the balance check and record ONE run. It is the only write of this
 * screen and never touches money. On success the run history and the balance are re-read.
 */
export async function postReconciliationRun() {
  const { data } = await api.post("/admin/payments/reconciliation/runs");
  return data as { run?: unknown };
}

export function useRunReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postReconciliationRun,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: RECON_KEYS.runs }),
        qc.invalidateQueries({ queryKey: RECON_KEYS.balance }),
      ]);
    },
  });
}
