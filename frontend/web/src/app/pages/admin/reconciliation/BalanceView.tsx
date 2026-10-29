import { ArrowClockwiseIcon, CaretDownIcon, CaretRightIcon, CheckCircleIcon, WalletIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AdminLink } from "../../../components/layout/admin/AdminLink";
import { ADMIN_FINANCE_TABS } from "../../../components/layout/admin/adminNav";
import { formatDong, formatDriftCents, formatMoneyString, balanceVerdict, buildMoneyMap, staleness, formatVnTime, type MoneyToken } from "../adminFinanceOverview.utils";
import { partyLabel } from "../adminReconciliation.utils";
import { FOCUS } from "./ExceptionParts";
import { BALANCE_MAX_AGE_MS, ForbiddenPanel, LevelNote, StaleChip, useNow } from "./ReconStates";
import { NO_PROCEDURE_TEXT, driftCauseCounts, negativeWalletViews } from "./reconciliationView";
import { errorView, useBalanceReport, useExceptionReports } from "./useReconciliationData";

/**
 * Chip "Cân đối sổ (L1)" — the whole-platform wallet invariant ESCROW = Σ claims (docs/money-flow.md §1.3), P3.
 * Scope, always said on screen: it compares wallet balances only. It does NOT check gateways, settlements or open
 * obligations. HTTP 409 = a drift WITH the full body → the numbers are shown (E-01), never a load error.
 * Loading / error / 403 / stale are states, never "0 ₫".
 */

const TOKEN_VAR: Record<MoneyToken, string> = {
  held: "var(--money-held)",
  pending: "var(--money-pending)",
  available: "var(--money-available)",
  locked: "var(--money-locked)",
  out: "var(--money-out)",
  revenue: "var(--money-revenue)",
};

const CARD = "rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card sm:p-5";
const BTN = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text transition-colors hover:bg-adm-surface-2 disabled:opacity-60 motion-reduce:transition-none lg:min-h-9 ${FOCUS}`;
const exceptionsTab = ADMIN_FINANCE_TABS.find((t) => t.key === "reconciliation")?.to ?? "/admin/finance/reconciliation";

function Skeleton() {
  return (
    <div role="status" aria-busy="true" data-testid="recon-balance-loading" className="space-y-3">
      <span className="sr-only">Đang tải số liệu cân đối sổ</span>
      <div aria-hidden className="grid gap-3 lg:grid-cols-2">
        <div className="h-40 animate-pulse rounded-xl bg-adm-pill motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-xl bg-adm-pill motion-reduce:animate-none" />
      </div>
      <div aria-hidden className="h-14 animate-pulse rounded-xl bg-adm-pill motion-reduce:animate-none" />
    </div>
  );
}

export function BalanceView() {
  const nowMs = useNow(30_000);
  const recon = useBalanceReport();
  // Counts of the usual causes come from the same cached report the Ngoại lệ chip uses; they never gate the numbers above.
  const { payment } = useExceptionReports({ gateway: false });
  const [rulesOpen, setRulesOpen] = useState(false);

  const errInfo = recon.isError ? errorView(recon.error, "số liệu cân đối sổ") : null;
  if (errInfo?.forbidden) return <ForbiddenPanel />;
  const err = recon.data ? null : errInfo;

  const data = recon.data;
  const report = data?.report ?? null;
  const verdict = report ? balanceVerdict(report) : null;
  const map = report ? buildMoneyMap(report) : null;
  const wallets = report ? negativeWalletViews(report) : [];
  const stale = staleness({
    hasData: !!data,
    updatedAt: recon.dataUpdatedAt,
    refetchFailed: recon.isError && !!data,
    nowMs,
    maxAgeMs: BALANCE_MAX_AGE_MS,
  });
  const causes = driftCauseCounts(payment.data ?? null);
  const refreshing = recon.isFetching;

  return (
    <div data-testid="recon-balance" className="space-y-4">
      <h2 className="text-base font-bold text-adm-text">Cân đối sổ ví</h2>

      <LevelNote
        level="L1"
        testId="recon-balance-level"
        text="Kiểm bất biến ESCROW = Σ quyền đòi từ số dư các ví trong sổ cái của Gymini (P3). Chỉ so số dư ví với nhau — không đối chiếu cổng thanh toán, quyết toán hay nghĩa vụ treo."
      />

      <div className="flex flex-wrap items-center gap-2">
        {stale.stale ? (
          <StaleChip info={stale} nowMs={nowMs} onRefresh={() => void recon.refetch()} busy={refreshing} testId="recon-balance-stale" />
        ) : (
          <span data-testid="recon-balance-asof" className="text-xs text-adm-text-2">
            {data ? `Tính đến ${formatVnTime(recon.dataUpdatedAt)}` : ""}
          </span>
        )}
        <button type="button" onClick={() => void recon.refetch()} aria-busy={refreshing} data-testid="recon-balance-refresh" className={BTN}>
          <ArrowClockwiseIcon className={`size-3.5 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Làm mới
        </button>
      </div>

      {!data && !err && <Skeleton />}

      {err && (
        <div data-testid="recon-balance-error" role="alert" className={`${CARD} space-y-2`}>
          <p className="flex items-start gap-2 text-sm font-semibold text-st-danger">
            <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden /> {err.message}
          </p>
          <button type="button" onClick={() => void recon.refetch()} className={BTN}>
            <ArrowClockwiseIcon className="size-3.5" aria-hidden /> Thử lại
          </button>
        </div>
      )}

      {report && verdict && map && (
        <div className={`space-y-4 transition-opacity motion-reduce:transition-none ${stale.stale ? "opacity-80" : ""}`}>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {/* trái: một con số */}
            <section data-testid="recon-escrow-card" aria-labelledby="recon-escrow-h" className={CARD}>
              <h3 id="recon-escrow-h" className="flex items-center gap-2 text-sm font-bold text-adm-text">
                <WalletIcon className="size-4 text-adm-text-2" aria-hidden /> Tiền đang giữ hộ
              </h3>
              <p data-testid="recon-escrow" className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-adm-text">
                {formatMoneyString(report.escrow)}
              </p>
              <p className="mt-2 text-xs text-adm-text-2">Số dư thực của ví giữ hộ (ESCROW) trong sổ cái.</p>
            </section>

            {/* phải: quyền đòi cộng dồn */}
            <section data-testid="recon-claims-card" aria-labelledby="recon-claims-h" className={CARD}>
              <h3 id="recon-claims-h" className="text-sm font-bold text-adm-text">
                Quyền đòi của các bên
              </h3>
              <ul className="mt-2 divide-y divide-adm-border-soft">
                {map.segments.map((s) => (
                  <li key={s.key} data-testid={`recon-claim-${s.key}`} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2 text-adm-text">
                      <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: TOKEN_VAR[s.token] }} />
                      <span className="min-w-0">{s.label}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-adm-text">{s.dong === null ? "—" : formatDong(s.dong)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex items-center justify-between gap-3 border-t-2 border-adm-text pt-3 text-sm font-bold text-adm-text">
                <span>Tổng quyền đòi</span>
                <span data-testid="recon-claims" className="whitespace-nowrap tabular-nums">
                  {formatMoneyString(report.claims)}
                </span>
              </div>
              {map.missingKeys.length > 0 && (
                <p data-testid="recon-claims-missing" className="mt-2 text-xs text-st-warning">
                  Máy chủ chưa trả {map.missingKeys.length} ngăn; các dòng trên có thể không cộng đủ tổng quyền đòi.
                </p>
              )}
              {map.missingKeys.length === 0 && map.unexplainedCents !== 0n && (
                <p data-testid="recon-claims-unexplained" className="mt-2 text-xs text-st-warning">
                  Các dòng trên không cộng đúng bằng tổng quyền đòi (lệch {formatDriftCents(map.unexplainedCents)}).
                </p>
              )}
            </section>
          </div>

          {/* chênh lệch */}
          <section
            data-testid="recon-drift-card"
            data-balanced={verdict.balanced ? "true" : "false"}
            aria-label="Chênh lệch sổ"
            className={`rounded-xl border px-4 py-3 ${verdict.balanced ? "border-st-success-border bg-st-success-bg text-st-success" : "border-st-danger-border bg-st-danger-bg text-st-danger"}`}
          >
            <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-bold">
              {verdict.balanced ? <CheckCircleIcon className="size-5 shrink-0" aria-hidden /> : <WarningIcon className="size-5 shrink-0" aria-hidden />}
              <span data-testid="recon-verdict">{verdict.balanced ? "Cân bằng" : "Lệch sổ"}</span>
              <span>
                Chênh lệch = <span data-testid="recon-drift">{formatDriftCents(verdict.driftCents)}</span>
              </span>
              <span className="text-xs font-medium text-adm-text-2">(tiền giữ hộ − tổng quyền đòi)</span>
            </p>
            {!verdict.balanced && (
              <div data-testid="recon-drift-detail" className="mt-2 space-y-2 text-[13px] text-adm-text">
                <p>
                  {verdict.driftCents > 0n ? "Ví giữ hộ đang nhiều hơn tổng quyền đòi." : "Ví giữ hộ đang ít hơn tổng quyền đòi."}{" "}
                  {data?.conflict
                    ? "Máy chủ báo lệch bằng mã 409 kèm đầy đủ số liệu — đây là cảnh báo về sổ, không phải lỗi tải; các số ở trên vẫn là số thật."
                    : ""}
                </p>
                <div>
                  <p className="font-semibold">Nguyên nhân có thể cần kiểm tra</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    <li>
                      Ví có số dư âm{causes.negativeWallets === null ? "" : `: ${causes.negativeWallets} ví`}
                      {wallets.length > 0 ? ` (${wallets.length} ví âm trong báo cáo này)` : ""}
                    </li>
                    <li>Ví lệch so với sổ cái{causes.walletMismatches === null ? "" : `: ${causes.walletMismatches} ví`}</li>
                    <li>Tiền chờ của hợp đồng bị rút quá mức{causes.negativeSubledgers === null ? "" : `: ${causes.negativeSubledgers} hợp đồng`}</li>
                  </ul>
                  <p className="mt-1 text-xs text-adm-text-2">Số kèm theo lấy từ báo cáo Ngoại lệ; hệ thống {NO_PROCEDURE_TEXT} để sửa sổ.</p>
                </div>
                <AdminLink
                  to={`${exceptionsTab}?view=exceptions`}
                  data-testid="recon-to-exceptions"
                  className={`inline-flex min-h-11 items-center font-semibold text-adm-text underline underline-offset-2 lg:min-h-9 ${FOCUS}`}
                >
                  Xem các nhóm ngoại lệ
                </AdminLink>
              </div>
            )}
          </section>

          {/* ví âm */}
          <section data-testid="recon-negative-wallets-card" aria-labelledby="recon-neg-h" className={CARD}>
            <h3 id="recon-neg-h" className="text-sm font-bold text-adm-text">
              Ví âm
            </h3>
            {wallets.length === 0 ? (
              <p data-testid="recon-no-negative" className="mt-2 flex items-center gap-1.5 text-sm text-st-success">
                <CheckCircleIcon className="size-4" aria-hidden /> Không có ví âm
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm font-semibold text-st-danger">{wallets.length} ví có số dư âm — luôn là lỗi</p>
                <ul className="mt-2 space-y-1 text-[13px] text-adm-text">
                  {wallets.map((w) => (
                    <li key={w.key} data-testid="recon-negative-wallet-row">
                      {partyLabel(w.ownerType)} <span className="font-mono">{w.ownerId.slice(0, 8) || "—"}</span> — chờ {w.pendingText}, khả dụng {w.availableText}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {verdict.balanced && wallets.length > 0 && (
              <p className="mt-2 text-xs text-st-warning">Sổ cân bằng nhưng vẫn có ví âm — cần kiểm tra ở chip Ngoại lệ.</p>
            )}
          </section>

          {/* quy tắc */}
          <div>
            <button
              type="button"
              aria-expanded={rulesOpen}
              aria-controls="recon-rules"
              onClick={() => setRulesOpen((v) => !v)}
              data-testid="recon-rules-toggle"
              className={BTN}
            >
              {rulesOpen ? <CaretDownIcon className="size-3.5" aria-hidden /> : <CaretRightIcon className="size-3.5" aria-hidden />}
              Quy tắc cân đối là gì?
            </button>
            <div id="recon-rules" hidden={!rulesOpen} className="mt-2 max-w-3xl space-y-1.5 text-[13px] leading-relaxed text-adm-text-2">
              <p>Mọi đồng khách trả qua cổng được ghi vào ví giữ hộ (ESCROW) và đồng thời thành quyền đòi của khách, PT, phòng gym hoặc nền tảng ở một ngăn (chờ, khả dụng, đã khoá, tạm giữ).</p>
              <p>Khi sổ đúng: tiền giữ hộ = tổng quyền đòi của mọi ví khác. Chỉ khi tiền thật rời nền tảng (rút tiền đã chuyển khoản) thì cả hai vế cùng giảm.</p>
              <p>Hoàn tiền hiện ghi có vào ví khách (vẫn trong ESCROW), nên không làm lệch sổ. Lệch ≠ 0 nghĩa là có bút toán sai hoặc thiếu và cần điều tra.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
