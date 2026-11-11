import { useSearchParams } from "react-router";
import { AdminReconciliationBlocks } from "./AdminReconciliationBlocks";
import { BalanceView } from "./reconciliation/BalanceView";
import { GatewayReconciliationView } from "./reconciliation/gateway/GatewayReconciliationView";
import { MoneyExceptionView } from "./reconciliation/moneyExceptions/MoneyExceptionView";
import { FOCUS } from "./reconciliation/ExceptionParts";
import { useExceptionReports } from "./reconciliation/useReconciliationData";
import { exceptionAttention } from "./reconciliation/reconciliationView";
import {
  RECON_VIEWS,
  RECON_VIEW_LABEL,
  RECON_VIEW_LEVEL,
  parseReconView,
  switchReconView,
  type ReconView,
} from "./reconciliation/reconciliationView";

/**
 * "Tài chính › Đối soát" (B4, D7). Chips kept in the URL (`?view=balance|exceptions|gateway|held-no-show|late-open`, default balance):
 *   - Cân đối sổ (L1)  — the wallet invariant ESCROW = Σ claims (P3; HTTP 409 = drift with body, not a load error)
 *   - Ngoại lệ (L1)    — the 22 existing exception groups (P13 + U2, counted, never summed) + the L2 gateway-callback group (P2)
 *   - Khoản giữ buổi PT vắng / Bồi thường đến muộn (D7, L1) — the two money-exception views of Dispute V2.1 (four-eyes; writes only behind the server flags)
 *   - Đối chiếu cổng ↔ Gymini (L2, B8) — Gymini's transactions vs the gateway events Gymini stored (day range in `?from&to`); NOT an independent L3 report (no source yet)
 * The page title / subtitle / "Làm mới" live in the Tài chính header (AdminFinancePage).
 */

export function AdminReconciliationPanel() {
  const [search, setSearch] = useSearchParams();
  const view = parseReconView(search.get("view"));
  // Same cached reports as the sidebar badge, the B3 queue and the Ngoại lệ chip — only used here for the chip count.
  const { payment, sessions, gateway } = useExceptionReports({ gateway: true });
  const attention = exceptionAttention(payment.data, sessions.data, gateway.data);

  const select = (next: ReconView) => {
    if (next === view && search.get("view") === next) return;
    setSearch((prev) => switchReconView(prev, next), { replace: false });
  };

  return (
    <div data-testid="admin-reconciliation" className="space-y-4">
      <div role="group" aria-label="Chế độ xem đối soát" data-testid="admin-reconciliation-chips" className="flex flex-wrap gap-2">
        {RECON_VIEWS.map((v) => {
          const selected = v === view;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={selected}
              data-testid={`recon-chip-${v}`}
              onClick={() => select(v)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors motion-reduce:transition-none xl:min-h-10 ${FOCUS} ${
                selected ? "border-adm-text bg-adm-text text-adm-bg" : "border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2"
              }`}
            >
              {RECON_VIEW_LABEL[v]} ({RECON_VIEW_LEVEL[v]})
              {v === "exceptions" && attention && (
                <span
                  data-testid="recon-chip-count-exceptions"
                  aria-label={`${attention.critical} mục cần xem ngay`}
                  className={`rounded-full px-2 py-px text-xs font-semibold tabular-nums ${selected ? "bg-adm-bg/20 text-adm-bg" : "bg-adm-badge-bg text-adm-badge-fg"}`}
                >
                  {attention.critical}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {view === "balance" ? (
        <BalanceView />
      ) : view === "exceptions" ? (
        <AdminReconciliationBlocks />
      ) : view === "gateway" ? (
        <GatewayReconciliationView />
      ) : (
        <MoneyExceptionView view={view} />
      )}
    </div>
  );
}
