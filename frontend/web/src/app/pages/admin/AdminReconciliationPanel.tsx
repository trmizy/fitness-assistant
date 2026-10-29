import { InfoIcon } from "@phosphor-icons/react";
import { useSearchParams } from "react-router";
import { countAttention } from "./adminReconciliation.utils";
import { AdminReconciliationBlocks } from "./AdminReconciliationBlocks";
import { BalanceView } from "./reconciliation/BalanceView";
import { FOCUS } from "./reconciliation/ExceptionParts";
import { useExceptionReports } from "./reconciliation/useReconciliationData";
import {
  GATEWAY_CHIP_LABEL,
  GATEWAY_CHIP_REASON,
  RECON_VIEWS,
  RECON_VIEW_LABEL,
  RECON_VIEW_LEVEL,
  parseReconView,
  withReconView,
  type ReconView,
} from "./reconciliation/reconciliationView";

/**
 * "Tài chính › Đối soát" (B4). Two chips kept in the URL (`?view=balance|exceptions`, default balance):
 *   - Cân đối sổ (L1)  — the wallet invariant ESCROW = Σ claims (P3; HTTP 409 = drift with body, not a load error)
 *   - Ngoại lệ (L1)    — the 22 existing exception groups (P13 + U2, counted, never summed) + the L2 gateway-callback group (P2)
 * A third chip "Đối chiếu cổng ↔ Gymini" is shown DISABLED with its reason: L3 (independent PSP/bank report) has no source.
 * The page title / subtitle / "Làm mới" live in the Tài chính header (AdminFinancePage).
 */

const GATEWAY_NOTE_ID = "recon-gateway-chip-note";

export function AdminReconciliationPanel() {
  const [search, setSearch] = useSearchParams();
  const view = parseReconView(search.get("view"));
  // Same cached reports as the sidebar badge, the B3 queue and the Ngoại lệ chip — only used here for the chip count.
  const { payment, sessions } = useExceptionReports({ gateway: false });
  const attention = payment.data && sessions.data ? countAttention(payment.data, sessions.data) : null;

  const select = (next: ReconView) => {
    if (next === view && search.get("view") === next) return;
    setSearch((prev) => withReconView(prev, next), { replace: false });
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
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={GATEWAY_NOTE_ID}
          title={`${GATEWAY_CHIP_LABEL}: ${GATEWAY_CHIP_REASON}`}
          data-testid="recon-chip-gateway-disabled"
          onClick={(e) => e.preventDefault()}
          className={`inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-full border border-dashed border-adm-border bg-transparent px-4 text-sm text-adm-text-2 xl:min-h-10 ${FOCUS}`}
        >
          {GATEWAY_CHIP_LABEL}
          <span className="hidden text-[11px] sm:inline">{GATEWAY_CHIP_REASON}</span>
          <span className="text-[11px] sm:hidden">L3 — BLOCKED</span>
        </button>
      </div>
      <p id={GATEWAY_NOTE_ID} data-testid="recon-gateway-note" className="flex items-start gap-2 text-xs text-adm-text-2">
        <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          “{GATEWAY_CHIP_LABEL}” chưa dùng được: chưa có báo cáo quyết toán độc lập từ cổng thanh toán hay ngân hàng (L3, BLOCKED) nên chưa thể đối chiếu hai phía.
          Gymini không hiện số liệu giả ở đây.
        </span>
      </p>

      {view === "balance" ? <BalanceView /> : <AdminReconciliationBlocks />}
    </div>
  );
}
