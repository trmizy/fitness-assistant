import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  ArrowClockwiseIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  LockKeyIcon,
  PulseIcon,
  ScalesIcon,
  UsersIcon,
  WalletIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { adminService, personalizedServiceApi } from "../../services/api";
import { AdminLink } from "../../components/layout/admin/AdminLink";
import { ADMIN_FINANCE_TABS } from "../../components/layout/admin/adminNav";
import { StatTile, type StatStatus } from "./shared/StatTile";
import { AttentionList, type AttentionItem } from "./shared/AttentionList";
import { describeAdminError } from "./shared/useAdminError";
import { FlowChart, MoneyMapCard } from "./AdminFinanceOverviewParts";
import { normalizeObligationsReport, normalizeSessionsReport } from "./adminReconciliation.utils";
import { exceptionAttention } from "./reconciliation/reconciliationView";
import { RECON_KEYS, fetchGatewayDiscrepancies } from "./reconciliation/useReconciliationData";
import {
  GROUP_LABEL,
  GROUP_NOUN,
  PERIOD_LABEL,
  RANGE_PROBLEM_TEXT,
  ageText,
  balanceVerdict,
  buildChartPoints,
  buildMoneyMap,
  checkRange,
  formatDong,
  formatDriftCents,
  formatMoneyString,
  formatVnDateTime,
  formatVnTime,
  normalizeFinanceOverview,
  normalizeReconciliation,
  periodFromSearch,
  periodToSearch,
  presetRange,
  reconciliationFromHttpError,
  staleness,
  summarizeWithdrawals,
  toApiRange,
  bucketLabel,
  type GroupBy,
  type PeriodPreset,
  type PeriodState,
  type ReconciliationReport,
  type FinanceOverviewReport,
  type Staleness,
} from "./adminFinanceOverview.utils";

/**
 * "Tài chính › Tổng quan" (B3). Every number maps to a row of Master Plan §3:
 *  - "Hiện tại"  ← P3 GET /admin/payments/reconciliation   (HTTP 409 carries the body = "có lệch", NOT a load error)
 *  - "Trong kỳ"  ← P4 GET /admin/payments/finance-overview (totals, buckets; UTC buckets)
 *  - "Luỹ kế"    ← P4 platformRevenue (not period-bound)
 *  - Hàng đợi    ← P7 withdrawals · A1 refund requests · P13 + U2 exceptions (counts only) — same queries (same keys)
 *                  as the sidebar badges, so the cache is shared.
 * Loading / error / 403 / stale are states, never "0 ₫".
 */

const POLL_MS = 60_000;
const RECON_MAX_AGE_MS = 3 * 60_000;
const OVERVIEW_MAX_AGE_MS = 10 * 60_000;

const SECTION_H = "text-base font-bold text-adm-text";
const SECTION_HINT = "text-xs text-adm-text-2";
const CARD = "rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card sm:p-5";
const BTN =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text transition-colors hover:bg-adm-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)] disabled:opacity-60 motion-reduce:transition-none lg:min-h-9";

const financeTab = (key: string) => ADMIN_FINANCE_TABS.find((t) => t.key === key)?.to ?? "/admin/finance";

// ───────────────────────────────────────────────────────────────── lỗi ──
const malformed = () => Object.assign(new Error("MALFORMED_RESPONSE"), { malformed: true });

interface ErrorView {
  message: string;
  forbidden: boolean;
}

function errorView(error: unknown): ErrorView {
  if ((error as { malformed?: boolean } | null)?.malformed) {
    return { message: "Máy chủ trả về dữ liệu không đọc được. Chưa biết số liệu — không phải số bằng không.", forbidden: false };
  }
  const v = describeAdminError(error, { action: "read" });
  const forbidden = v.kind === "forbidden" || v.kind === "unauthorized";
  if (v.kind === "server") return { message: "Không tải được — lỗi máy chủ. Chưa biết số liệu; đây không phải số bằng không.", forbidden };
  if (v.kind === "network") return { message: "Không kết nối được máy chủ. Chưa biết số liệu; đây không phải số bằng không.", forbidden };
  if (v.status === 400) return { message: "Khoảng thời gian không hợp lệ — hãy chọn lại kỳ.", forbidden };
  return { message: `${v.message} Chưa biết số liệu; đây không phải số bằng không.`, forbidden };
}

// ──────────────────────────────────────────────────────────── dữ liệu ──
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

interface ReconData {
  report: ReconciliationReport;
  /** The server answered 409 (= "có lệch") with the full report. */
  conflict: boolean;
}

async function fetchReconciliation(): Promise<ReconData> {
  try {
    const res = await adminService.getReconciliation();
    const report = normalizeReconciliation(res);
    if (!report) throw malformed();
    return { report, conflict: false };
  } catch (error) {
    // Khi sổ lệch server trả 409 KÈM báo cáo đầy đủ — đó là lúc admin cần thấy số, không phải "lỗi tải".
    const report = reconciliationFromHttpError(error);
    if (report) return { report, conflict: true };
    throw error;
  }
}

interface OverviewData {
  report: FinanceOverviewReport;
  /** The request this data answers (placeholder data from the previous period keeps its own range). */
  req: { groupBy: GroupBy; from: string; to: string };
}

const QUEUE_OPTIONS = { retry: false, staleTime: 60_000, refetchOnWindowFocus: false } as const;

// ───────────────────────────────────────────────────────── chip "cũ" ──
function StaleChip({ info, nowMs, onRefresh, busy, testId }: { info: Staleness; nowMs: number; onRefresh: () => void; busy: boolean; testId: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-st-pending-border bg-st-pending-bg px-2.5 py-1.5 text-xs font-medium text-st-pending"
    >
      <ClockIcon className="size-4 shrink-0" aria-hidden />
      <span>
        Dữ liệu lúc {formatVnTime(info.updatedAt)} — đã cũ {ageText(Math.floor((nowMs - info.updatedAt) / 60_000))}
        {info.reason === "REFETCH_FAILED" ? " (lần cập nhật gần nhất không thành công)" : ""}
      </span>
      <button type="button" onClick={onRefresh} disabled={busy} className="font-bold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]">
        Làm mới
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────── bộ chọn kỳ ──
function PeriodControls({
  period,
  nowMs,
  onChange,
}: {
  period: PeriodState;
  nowMs: number;
  onChange: (next: PeriodState, replace?: boolean) => void;
}) {
  const [draft, setDraft] = useState({ from: period.from, to: period.to });
  useEffect(() => setDraft({ from: period.from, to: period.to }), [period.from, period.to]);
  const problem = period.preset === "custom" ? checkRange(draft.from, draft.to, nowMs) : null;
  const today = new Date(nowMs).toISOString().slice(0, 10);

  const pick = (preset: PeriodPreset) => {
    if (preset === period.preset) return;
    if (preset === "custom") onChange({ ...period, preset: "custom" });
    else onChange({ ...period, preset, ...presetRange(preset, nowMs) });
  };
  const edit = (key: "from" | "to", value: string) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (checkRange(next.from, next.to, nowMs) === null) onChange({ ...period, preset: "custom", from: next.from, to: next.to }, true);
  };

  const seg = (on: boolean) =>
    `min-h-11 px-3 text-xs font-semibold transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--adm-focus)] motion-reduce:transition-none lg:min-h-9 ${
      on ? "bg-adm-text text-adm-surface" : "bg-adm-surface text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text"
    }`;
  const field =
    "min-h-11 rounded-lg border border-adm-border bg-adm-surface px-2 text-xs text-adm-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)] lg:min-h-9";

  return (
    <div className="space-y-2" data-testid="finance-period-controls">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Kỳ" className="flex overflow-hidden rounded-lg border border-adm-border">
          {(Object.keys(PERIOD_LABEL) as PeriodPreset[]).map((p) => (
            <button key={p} type="button" aria-pressed={period.preset === p} data-testid={`period-${p}`} onClick={() => pick(p)} className={seg(period.preset === p)}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Nhóm theo" className="flex overflow-hidden rounded-lg border border-adm-border">
          {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
            <button key={g} type="button" aria-pressed={period.group === g} data-testid={`group-${g}`} onClick={() => onChange({ ...period, group: g })} className={seg(period.group === g)}>
              {GROUP_LABEL[g]}
            </button>
          ))}
        </div>
      </div>
      {period.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-adm-text-2">
          <label className="flex items-center gap-1.5">
            Từ
            <input type="date" data-testid="period-from" value={draft.from} max={draft.to || today} onChange={(e) => edit("from", e.target.value)} className={field} />
          </label>
          <label className="flex items-center gap-1.5">
            Đến
            <input type="date" data-testid="period-to" value={draft.to} min={draft.from} max={today} onChange={(e) => edit("to", e.target.value)} className={field} />
          </label>
          {problem && (
            <span role="alert" data-testid="period-problem" className="text-st-danger">
              {RANGE_PROBLEM_TEXT[problem]}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── trang ──
export function AdminFinanceOverviewTab() {
  const nowMs = useNow(30_000);
  const [search, setSearch] = useSearchParams();
  const period = useMemo(() => periodFromSearch(search, nowMs), [search, nowMs]);
  const setPeriod = (next: PeriodState, replace = false) => setSearch(periodToSearch(next), { replace });
  const rangeProblem = period.preset === "custom" ? checkRange(period.from, period.to, nowMs) : null;
  const [tableOpen, setTableOpen] = useState(false);

  // P3 — hiện tại (không theo kỳ), cập nhật mỗi phút.
  const recon = useQuery({
    queryKey: ["admin", "finance", "reconciliation"],
    queryFn: fetchReconciliation,
    refetchInterval: POLL_MS,
    staleTime: 30_000,
  });

  // P4 — theo kỳ. Cùng khoá truy vấn như trước; giữ dữ liệu kỳ cũ (mờ) trong lúc tải kỳ mới.
  const overview = useQuery<OverviewData>({
    queryKey: ["admin", "finance-overview", period.group, period.from, period.to],
    enabled: !rangeProblem,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await adminService.getFinanceOverview({ groupBy: period.group, ...toApiRange(period.from, period.to) });
      const report = normalizeFinanceOverview(res);
      if (!report) throw malformed();
      return { report, req: { groupBy: period.group, from: period.from, to: period.to } };
    },
  });

  // Hàng đợi tài chính — cùng khoá + cùng hàm gọi với huy hiệu thanh bên.
  const withdrawals = useQuery({ queryKey: ["admin", "pending-withdrawals"], queryFn: () => adminService.listPendingWithdrawals(), ...QUEUE_OPTIONS });
  const serviceRefunds = useQuery({ queryKey: ["refund-requests"], queryFn: () => personalizedServiceApi.listRefundRequests(), ...QUEUE_OPTIONS });
  const obligations = useQuery({
    queryKey: ["admin", "finance", "obligations-report"],
    queryFn: async () => normalizeObligationsReport(await adminService.getObligationsReport()),
    ...QUEUE_OPTIONS,
  });
  const sessions = useQuery({
    queryKey: ["admin", "finance", "sessions-reconciliation"],
    queryFn: async () => normalizeSessionsReport(await adminService.getSessionsReconciliation()),
    ...QUEUE_OPTIONS,
  });
  // P2 — cùng khoá + hàm với huy hiệu thanh bên và Hôm nay, để số "cần xem ngay" luôn khớp.
  const gateway = useQuery({ queryKey: RECON_KEYS.gateway, queryFn: fetchGatewayDiscrepancies, ...QUEUE_OPTIONS });

  const refreshAll = () => {
    void recon.refetch();
    if (!rangeProblem) void overview.refetch();
    void withdrawals.refetch();
    void serviceRefunds.refetch();
    void obligations.refetch();
    void sessions.refetch();
    void gateway.refetch();
  };
  const refreshing = recon.isFetching || overview.isFetching;

  // ── 403: không hiện số nào ──
  const reconErr = recon.isError ? errorView(recon.error) : null;
  const overviewErr = overview.isError ? errorView(overview.error) : null;
  if (reconErr?.forbidden || overviewErr?.forbidden) {
    return (
      <div data-testid="finance-forbidden" role="alert" className={`${CARD} flex flex-col items-center gap-2 py-12 text-center`}>
        <LockKeyIcon className="size-8 text-adm-text-2" aria-hidden />
        <h2 className="text-lg font-bold text-adm-text">Không có quyền xem dữ liệu tài chính</h2>
        <p className="max-w-md text-sm text-adm-text-2">
          Tài khoản này không có quyền xem dữ liệu tài chính, hoặc phiên đăng nhập đã hết hạn. Hãy đăng nhập lại bằng tài khoản quản trị.
        </p>
      </div>
    );
  }

  // ── Hiện tại (P3) ──
  const reconStatus: StatStatus = recon.data ? "ready" : recon.isError ? "error" : "loading";
  const r = recon.data?.report;
  const verdict = r ? balanceVerdict(r) : null;
  const reconStale = staleness({ hasData: !!recon.data, updatedAt: recon.dataUpdatedAt, refetchFailed: recon.isError && !!recon.data, nowMs, maxAgeMs: RECON_MAX_AGE_MS });
  const moneyMap = r ? buildMoneyMap(r) : null;
  const negatives = r?.negativeWallets.length ?? 0;

  // ── Trong kỳ (P4) ──
  const o = rangeProblem ? undefined : overview.data;
  const overviewStatus: StatStatus = o ? "ready" : overview.isError ? "error" : rangeProblem ? "error" : "loading";
  const overviewStale = staleness({ hasData: !!o, updatedAt: overview.dataUpdatedAt, refetchFailed: overview.isError && !!o, nowMs, maxAgeMs: OVERVIEW_MAX_AGE_MS });
  const switching = !!o && overview.isPlaceholderData;
  const tot = o?.report.totals;
  const points = o ? buildChartPoints(o.report.buckets, o.req.groupBy) : null;
  const pr = o?.report.platformRevenue ?? null;
  const retryOverview = () => void overview.refetch();
  const retryRecon = () => void recon.refetch();

  // ── hàng đợi ──
  const wq = withdrawals.data !== undefined ? summarizeWithdrawals(withdrawals.data, nowMs) : null;
  const wStatus: StatStatus = withdrawals.isError || (withdrawals.data !== undefined && !wq) ? "error" : wq ? "ready" : "loading";
  const attention = exceptionAttention(obligations.data, sessions.data, gateway.data);
  const exStatus: StatStatus = obligations.isError || sessions.isError || gateway.isError ? "error" : attention ? "ready" : "loading";
  const refundList = Array.isArray(serviceRefunds.data) ? serviceRefunds.data : null;
  const rfStatus: StatStatus = serviceRefunds.isError || (serviceRefunds.data !== undefined && !refundList) ? "error" : refundList ? "ready" : "loading";
  const capNote = wq?.capped ? " · trong 100 yêu cầu cũ nhất, có thể còn nữa" : "";
  const withdrawalDetail = (q: { count: number; totalDong: bigint | null; oldestMinutes: number | null }, none: string) =>
    q.count === 0 ? none : `${q.oldestMinutes === null ? "" : `Cũ nhất ${ageText(q.oldestMinutes)} · `}Tổng ${formatDong(q.totalDong)}${capNote}`;
  const cap = (n: number) => (wq?.capped ? `≥${n}` : String(n));

  const queueItems: AttentionItem[] = [
    {
      key: "withdrawals-approved",
      title: "Đã duyệt, chờ chuyển khoản",
      to: financeTab("withdrawals"),
      status: wStatus,
      count: wq?.approved.count ?? null,
      countText: wq ? cap(wq.approved.count) : undefined,
      detail: wq ? withdrawalDetail(wq.approved, "Không có yêu cầu nào đang chờ chuyển khoản") : undefined,
      tone: "danger",
      errorText: "Không tải được hàng đợi rút tiền — chưa biết có yêu cầu nào hay không.",
    },
    {
      key: "exceptions",
      title: "Ngoại lệ đối soát cần xem",
      to: financeTab("reconciliation"),
      status: exStatus,
      count: attention?.critical ?? null,
      detail: attention
        ? attention.critical === 0
          ? `Không có mục nào cần xem ngay${attention.watch ? ` · ${attention.watch} mục theo dõi` : ""}`
          : `${attention.watch ? `${attention.watch} mục theo dõi thêm · ` : ""}chỉ đếm, không cộng tiền`
        : undefined,
      tone: "danger",
      errorText: "Không tải được báo cáo ngoại lệ — chưa biết có mục nào cần xem hay không.",
    },
    {
      key: "service-refunds",
      title: "Yêu cầu hoàn tiền dịch vụ",
      to: financeTab("refunds"),
      status: rfStatus,
      count: refundList?.length ?? null,
      detail: refundList ? (refundList.length === 0 ? "Không có yêu cầu hoàn tiền nào đang chờ" : "Số tiền hoàn xem trong từng yêu cầu") : undefined,
      tone: "warning",
      errorText: "Không tải được yêu cầu hoàn tiền — chưa biết có yêu cầu nào hay không.",
    },
    {
      key: "withdrawals-pending",
      title: "Rút tiền chờ duyệt",
      to: financeTab("withdrawals"),
      status: wStatus,
      count: wq?.pending.count ?? null,
      countText: wq ? cap(wq.pending.count) : undefined,
      detail: wq ? withdrawalDetail(wq.pending, "Không có yêu cầu rút tiền nào chờ duyệt") : undefined,
      tone: "warning",
      errorText: "Không tải được hàng đợi rút tiền — chưa biết có yêu cầu nào hay không.",
    },
  ];

  return (
    <div data-testid="admin-finance-overview" className="space-y-6">
      {/* ───────── Hiện tại ───────── */}
      <section aria-labelledby="fin-now" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="fin-now" className={SECTION_H}>
            Hiện tại
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {reconStale.stale ? (
              <StaleChip info={reconStale} nowMs={nowMs} onRefresh={refreshAll} busy={refreshing} testId="finance-stale-recon" />
            ) : (
              <span data-testid="finance-asof" className={SECTION_HINT}>
                {recon.data ? `Tính đến ${formatVnTime(recon.dataUpdatedAt)} · không phụ thuộc kỳ` : "Không phụ thuộc kỳ"}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatTile
            testId="tile-escrow"
            loadingClassName="lg:min-h-[226px]"
            label="Tiền đang giữ hộ"
            icon={WalletIcon}
            tone="info"
            status={reconStatus}
            value={r ? formatMoneyString(r.escrow) : null}
            note="Số dư ví giữ hộ (ESCROW) của nền tảng"
            errorText={reconErr?.message}
            onRetry={retryRecon}
            dimmed={reconStale.stale}
          />
          <StatTile
            testId="tile-claims"
            loadingClassName="lg:min-h-[226px]"
            label="Tổng quyền đòi của các bên"
            icon={UsersIcon}
            tone="neutral"
            status={reconStatus}
            value={r ? formatMoneyString(r.claims) : null}
            note="Khách + PT + phòng gym + nền tảng, mọi ngăn (chờ, khả dụng, đã khoá, tạm giữ)"
            errorText={reconErr?.message}
            onRetry={retryRecon}
            dimmed={reconStale.stale}
          />
          <StatTile
            testId="tile-balance"
            loadingClassName="lg:min-h-[226px]"
            label="Cân đối sổ ví (ESCROW = Σ quyền đòi)"
            icon={verdict?.balanced === false ? WarningIcon : verdict ? CheckCircleIcon : ScalesIcon}
            tone={verdict ? (verdict.balanced ? "success" : "danger") : "neutral"}
            danger={verdict?.balanced === false}
            status={reconStatus}
            value={verdict ? formatDriftCents(verdict.driftCents) : null}
            note={
              verdict ? (
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      data-testid="balance-chip"
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                        verdict.balanced ? "border-st-success-border bg-st-success-bg text-st-success" : "border-st-danger-border bg-st-danger-bg text-st-danger"
                      }`}
                    >
                      {verdict.balanced ? <CheckCircleIcon className="size-3.5" aria-hidden /> : <WarningIcon className="size-3.5" aria-hidden />}
                      {verdict.balanced ? "Cân bằng" : "Lệch sổ"}
                    </span>
                    <span>Chênh lệch = tiền giữ hộ − tổng quyền đòi</span>
                  </span>
                  <span>Chỉ so số dư các ví với ví giữ hộ — không kiểm cổng thanh toán, quyết toán hay nghĩa vụ treo.</span>
                </span>
              ) : undefined
            }
            errorText={reconErr?.message}
            onRetry={retryRecon}
            dimmed={reconStale.stale}
          />
        </div>

        {verdict && !verdict.balanced && (
          <div role="status" data-testid="drift-callout" className="rounded-xl border border-st-danger-border bg-st-danger-bg px-4 py-3 text-sm text-st-danger">
            <p className="flex items-start gap-2 font-semibold">
              <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Sổ ví đang lệch {formatDriftCents(verdict.driftCents)}
                {verdict.driftCents > 0n ? " (ví giữ hộ nhiều hơn tổng quyền đòi)" : " (ví giữ hộ ít hơn tổng quyền đòi)"}.
              </span>
            </p>
            <p className="mt-1 pl-6 text-[13px] text-adm-text">
              {recon.data?.conflict ? "Máy chủ báo lệch bằng mã 409 kèm số liệu — đây là cảnh báo về sổ, không phải lỗi tải; các số ở trên vẫn là số thật. " : ""}
              {negatives > 0 ? `Có ${negatives} ví âm. ` : ""}
              Nguyên nhân thường gặp: ví âm, ví lệch so với sổ cái, bút toán thiếu.{" "}
              <AdminLink to={financeTab("reconciliation")} className="font-semibold text-adm-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]">
                Xem tab Đối soát
              </AdminLink>
            </p>
          </div>
        )}
        {verdict?.balanced && negatives > 0 && (
          <p role="status" className="rounded-xl border border-st-warning-border bg-st-warning-bg px-4 py-2 text-[13px] text-st-warning">
            Sổ cân bằng nhưng có {negatives} ví âm — cần kiểm tra ở tab Đối soát.
          </p>
        )}
      </section>

      {/* ───────── Bản đồ tiền ───────── */}
      <section aria-label="Bản đồ tiền đang giữ hộ">
        {reconStatus === "loading" && (
          <div data-testid="finance-money-map" data-state="loading" role="status" aria-busy="true" className={`${CARD} min-h-[300px] md:min-h-[640px]`}>
            <span className="sr-only">Đang tải bản đồ tiền đang giữ hộ</span>
            <div aria-hidden className="space-y-4">
              <div className="h-5 w-48 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
              <div className="h-9 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
              <div className="h-40 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
            </div>
          </div>
        )}
        {reconStatus === "error" && (
          <div data-testid="finance-money-map" data-state="error" role="group" aria-label="Bản đồ tiền — không tải được" className={`${CARD} min-h-[120px]`}>
            <h2 className={SECTION_H}>Bản đồ tiền đang giữ hộ</h2>
            <p className="mt-2 text-sm text-adm-text-2">{reconErr?.message}</p>
            <button type="button" onClick={retryRecon} className={`${BTN} mt-3`}>
              <ArrowClockwiseIcon className="size-3.5" aria-hidden /> Thử lại
            </button>
          </div>
        )}
        {moneyMap && <MoneyMapCard map={moneyMap} dimmed={reconStale.stale} />}
      </section>

      {/* ───────── Trong kỳ ───────── */}
      <section aria-labelledby="fin-period" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="fin-period" className={SECTION_H}>
            Trong kỳ
          </h2>
          {overviewStale.stale ? (
            <StaleChip info={overviewStale} nowMs={nowMs} onRefresh={refreshAll} busy={refreshing} testId="finance-stale-period" />
          ) : (
            <span className={SECTION_HINT}>Dòng tiền thật qua nền tảng · ngày tính theo UTC (lệch 7 giờ so với giờ Việt Nam)</span>
          )}
        </div>

        <PeriodControls period={period} nowMs={nowMs} onChange={setPeriod} />

        <div aria-busy={switching} className="space-y-3">
          <div className={`grid grid-cols-1 gap-3 transition-opacity motion-reduce:transition-none sm:grid-cols-2 lg:grid-cols-3 ${switching ? "opacity-50" : ""}`}>
            <StatTile
              testId="tile-income"
              loadingClassName="lg:min-h-[146px]"
              label="Tiền vào nền tảng"
              icon={ArrowDownLeftIcon}
              tone="info"
              status={overviewStatus}
              value={tot ? formatMoneyString(tot.income) : null}
              note="Thanh toán thành công qua cổng, gồm cả nạp ví khách cũ (backend hiện tính vậy)"
              errorText={rangeProblem ? RANGE_PROBLEM_TEXT[rangeProblem] : overviewErr?.message}
              onRetry={rangeProblem ? undefined : retryOverview}
              dimmed={overviewStale.stale}
            />
            <StatTile
              testId="tile-expense"
              loadingClassName="lg:min-h-[146px]"
              label="Tiền ra khỏi nền tảng"
              icon={ArrowUpRightIcon}
              tone="neutral"
              status={overviewStatus}
              value={tot ? formatMoneyString(tot.expense) : null}
              note="Tiền đã hoàn trả và đã chi trả rút tiền. Hoàn về ví khách chưa tính cho tới khi khách rút."
              errorText={rangeProblem ? RANGE_PROBLEM_TEXT[rangeProblem] : overviewErr?.message}
              onRetry={rangeProblem ? undefined : retryOverview}
              dimmed={overviewStale.stale}
            />
            <StatTile
              testId="tile-net-revenue"
              loadingClassName="lg:min-h-[146px]"
              label="Doanh thu nền tảng đã thực hiện"
              icon={PulseIcon}
              tone="info"
              status={overviewStatus}
              value={tot ? formatMoneyString(tot.netRevenue) : null}
              note="Phần phí đã giải phóng vào ví doanh thu trong kỳ; khoản đang chờ chưa tính"
              errorText={rangeProblem ? RANGE_PROBLEM_TEXT[rangeProblem] : overviewErr?.message}
              onRetry={rangeProblem ? undefined : retryOverview}
              dimmed={overviewStale.stale}
            />
          </div>

          <div data-testid="finance-period-card" className={`${CARD} min-h-[300px] transition-opacity motion-reduce:transition-none ${switching ? "opacity-50" : ""}`}>
            {overviewStatus === "loading" ? (
              <div role="status" aria-busy="true" data-state="loading">
                <span className="sr-only">Đang tải biểu đồ tiền vào và ra</span>
                <div aria-hidden className="space-y-3">
                  <div className="h-5 w-56 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
                  <div className="h-56 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
                </div>
              </div>
            ) : overviewStatus === "error" || !o ? (
              <div data-state="error" role="group" aria-label="Biểu đồ — không tải được">
                <h3 className="text-sm font-bold text-adm-text">Tiền vào và ra theo {GROUP_NOUN[period.group]}</h3>
                <p className="mt-2 text-sm text-adm-text-2">{rangeProblem ? RANGE_PROBLEM_TEXT[rangeProblem] : (overviewErr?.message ?? "Không tải được dữ liệu trong kỳ.")}</p>
                {!rangeProblem && (
                  <button type="button" onClick={retryOverview} className={`${BTN} mt-3`}>
                    <ArrowClockwiseIcon className="size-3.5" aria-hidden /> Thử lại
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-sm font-bold text-adm-text">Tiền vào và ra theo {GROUP_NOUN[o.req.groupBy]}</h3>
                  <p data-testid="period-range-label" className={SECTION_HINT}>
                    {o.req.from.split("-").reverse().join("/")} – {o.req.to.split("-").reverse().join("/")} · kỳ tính theo UTC (backend hiện tại)
                  </p>
                </div>

                {o.report.buckets.length === 0 ? (
                  <p data-testid="period-empty" className="py-16 text-center text-sm text-adm-text-2">
                    Không có giao dịch trong kỳ này.
                  </p>
                ) : !points ? (
                  <p role="alert" className="py-10 text-center text-sm text-st-danger">
                    Một số cột trả về số tiền không đọc được nên chưa vẽ biểu đồ.
                  </p>
                ) : (
                  <div className="mt-3">
                    <FlowChart points={points} noun={GROUP_NOUN[o.req.groupBy]} />
                  </div>
                )}

                {o.report.buckets.length > 0 && (
                  <div className="mt-3">
                    <button
                      type="button"
                      aria-expanded={tableOpen}
                      aria-controls="fin-period-table"
                      onClick={() => setTableOpen((v) => !v)}
                      data-testid="period-table-toggle"
                      className={BTN}
                    >
                      {tableOpen ? <CaretDownIcon className="size-3.5" aria-hidden /> : <CaretRightIcon className="size-3.5" aria-hidden />}
                      {tableOpen ? "Thu gọn bảng theo kỳ" : "Xem bảng theo kỳ"}
                    </button>
                    <div id="fin-period-table" hidden={!tableOpen} className="mt-3 overflow-x-auto rounded-lg border border-adm-border">
                      <table data-testid="period-table" className="w-full min-w-[340px] text-[13px]">
                        <caption className="sr-only">Tiền vào, tiền ra và doanh thu nền tảng theo {GROUP_NOUN[o.req.groupBy]}</caption>
                        <thead className="bg-adm-surface-2 text-xs text-adm-text-2">
                          <tr>
                            <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                              {GROUP_LABEL[o.req.groupBy]}
                            </th>
                            <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                              Tiền vào
                            </th>
                            <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                              Tiền ra
                            </th>
                            <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                              Doanh thu
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-adm-border-soft">
                          {o.report.buckets.map((b) => (
                            <tr key={b.period}>
                              <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left font-normal text-adm-text">
                                {bucketLabel(b.period, o.req.groupBy)}
                              </th>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text">{formatMoneyString(b.income)}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text">{formatMoneyString(b.expense)}</td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text">{formatMoneyString(b.netRevenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-adm-border bg-adm-surface-2 font-bold">
                            <th scope="row" className="px-3 py-2.5 text-left text-adm-text">
                              Cả kỳ
                            </th>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text">{formatMoneyString(o.report.totals.income)}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text">{formatMoneyString(o.report.totals.expense)}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-adm-text">{formatMoneyString(o.report.totals.netRevenue)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ───────── Doanh thu luỹ kế ───────── */}
      <section aria-labelledby="fin-cumulative" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="fin-cumulative" className={SECTION_H}>
            Doanh thu nền tảng luỹ kế
          </h2>
          <span className={SECTION_HINT}>Số dư ví doanh thu hiện tại — không phụ thuộc kỳ ở trên</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(() => {
            const st: StatStatus = o ? (pr ? "ready" : "error") : overview.isError || rangeProblem ? "error" : "loading";
            const err = o && !pr ? "Máy chủ chưa trả số doanh thu luỹ kế. Chưa biết số liệu; đây không phải số bằng không." : overviewErr?.message;
            return (
              <>
                <StatTile
                  testId="tile-rev-available"
                  label="Đã hưởng"
                  icon={CheckCircleIcon}
                  tone="info"
                  status={st}
                  value={pr ? formatMoneyString(pr.available) : null}
                  note="Phần phí đã giải phóng vào ví doanh thu"
                  errorText={err}
                  onRetry={retryOverview}
                />
                <StatTile
                  testId="tile-rev-pending"
                  label="Còn chờ giải phóng"
                  icon={ClockIcon}
                  tone="pending"
                  status={st}
                  value={pr ? formatMoneyString(pr.pending) : null}
                  note="Chưa tính vào doanh thu đã hưởng"
                  errorText={err}
                  onRetry={retryOverview}
                />
                <StatTile
                  testId="tile-rev-asof"
                  label="Tính đến"
                  icon={ClockIcon}
                  tone="neutral"
                  status={st}
                  valueSize="sm"
                  value={pr ? formatVnDateTime(pr.asOf) : null}
                  note="Luỹ kế từ khi bắt đầu, giờ Việt Nam"
                  errorText={err}
                  onRetry={retryOverview}
                />
              </>
            );
          })()}
        </div>
      </section>

      {/* ───────── Hàng đợi tài chính ───────── */}
      <AttentionList
        headingId="fin-queues"
        testId="finance-queues"
        title="Hàng đợi tài chính"
        description="Việc liên quan đến tiền, sắp theo độ khẩn"
        items={queueItems}
      />
    </div>
  );
}
