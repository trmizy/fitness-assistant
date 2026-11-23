/**
 * Tab "Doanh số": the membership cards sold by the branches in scope (`GET /owner/gyms/:id/memberships`, the whole list like the old
 * Finance page; the accountant receives the sales view without any member identity). It is a SALES report: the amounts are the list
 * price each card was sold for (`priceAtPurchase`), a gross selling price, NOT the gym's income (the wallet is). The only sum kept is
 * the old page's "thẻ đã thanh toán" total (active + expired), labelled as that; it is not shown at all when a branch failed to load.
 * CSV (`finance.export`) carries every row, the table shows the newest 100.
 */
import { useQueries } from "@tanstack/react-query";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import { formatVND } from "../../../utils/currency";
import { recognizedSales, salesCsv } from "../../../utils/financeExport";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { useBrandPlans } from "../members/useBrandPlans";
import { memberStatusTag, planNameOf } from "../members/membersModel";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { branchCodes, type ScopeGym } from "../scope/scopeModel";
import { downloadCsv } from "./downloadCsv";
import { finKey } from "./useFinanceData";
import { SALES_MEANING_NOTE, SALES_ROWS_SHOWN, SALES_STATUS_LABEL, SALES_TOTAL_LABEL, coverageLine, dayText, normalizeSales, sortSales } from "./financeModel";

const COLS_ALL = "minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.4fr) minmax(0, 1.1fr) minmax(0, 1fr)";
const COLS_ONE = "minmax(0, 1fr) minmax(0, 1.6fr) minmax(0, 1.1fr) minmax(0, 1fr)";

export function SalesTab({ gyms }: { gyms: ScopeGym[] }) {
  const scope = useGymOwnerScope();
  const codes = branchCodes(scope.gyms);
  const all = scope.gymId === "ALL" && gyms.length > 1;
  const plans = useBrandPlans(true);
  const planRows = plans.query.data ?? [];
  const qs = useQueries({
    queries: gyms.map((g) => ({
      queryKey: finKey(scope.userId, "sales", g.id),
      queryFn: async () => normalizeSales(await gymService.listOwnedMemberships(g.id)),
      retry: false,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    })),
  });
  const loading = qs.some((q) => q.isLoading);
  const failedIdx = qs.map((q, i) => (q.isError && !q.data ? i : -1)).filter((i) => i >= 0);
  const failedNames = failedIdx.map((i) => gyms[i].name);
  const rows = sortSales(qs.flatMap((q) => q.data ?? []));
  const recognized = recognizedSales(rows);
  const canExport = scope.can("finance.export");
  const gymName = (id: string) => gyms.find((g) => g.id === id)?.name ?? "";
  const coverage = coverageLine(gyms.length, failedNames);
  const stamp = new Date().toISOString().slice(0, 10);
  const shown = rows.slice(0, SALES_ROWS_SHOWN);

  return (
    <div className="go-stack" data-testid="go-fin-sales">
      {coverage && (
        <div className="go-notice" data-tone="risk" role="alert" data-testid="go-fin-sales-partial">
          <span>{coverage} Doanh số bên dưới chưa đủ nên không có số tổng.</span>
          <button type="button" className="go-btn go-btn-sm" onClick={() => failedIdx.forEach((i) => void qs[i].refetch())}>Thử lại</button>
        </div>
      )}
      <section className="go-panel" aria-labelledby="go-h-sales">
        <div className="go-panel-head go-panel-head-row">
          <div>
            <h2 id="go-h-sales">Doanh số bán thẻ</h2>
            <p data-testid="go-fin-sales-meaning">{SALES_MEANING_NOTE}</p>
          </div>
          {canExport && (
            <button type="button" className="go-btn go-btn-sm" disabled={rows.length === 0} onClick={() => downloadCsv(`gymini-doanh-so-${stamp}.csv`, salesCsv(rows, { gym: gymName, plan: (id) => planNameOf(id, planRows) }))} data-testid="go-fin-sales-csv">
              <DownloadSimpleIcon aria-hidden="true" width={14} height={14} /> Xuất CSV
            </button>
          )}
        </div>

        {!loading && failedNames.length === 0 && (
          <div className="go-cm-totals go-sales-totals" data-testid="go-fin-sales-total">
            <div className="go-cm-total">
              <span className="go-label">{SALES_TOTAL_LABEL}</span>
              <span className="go-money-num" data-testid="go-fin-sales-sum" data-value={String(recognized.total)}>{formatVND(recognized.total)}</span>
              <span className="go-hint-text">{recognized.count} thẻ (đang dùng và đã hết hạn). Chờ thanh toán và đã huỷ không tính.</span>
            </div>
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="go-task-skel" aria-hidden="true" data-testid="go-fin-sales-skeleton">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "55%" }} /><span className="go-skel-bar" style={{ width: "25%" }} /></div>
            ))}
          </div>
        )}

        {!loading && rows.length === 0 && failedNames.length === 0 && (
          <div className="go-task-empty" data-testid="go-fin-sales-empty">
            <strong>Chưa có thẻ nào được bán</strong>
            <span>Khi có người mua gói, giao dịch sẽ xuất hiện ở đây.</span>
          </div>
        )}

        {shown.length > 0 && (
          <div role="table" className="go-dt" aria-label="Thẻ đã bán" data-testid="go-fin-sales-table" style={{ "--go-cols": all ? COLS_ALL : COLS_ONE } as React.CSSProperties}>
            <div role="row" className="go-dt-row go-dt-head">
              <div role="columnheader">Ngày bán</div>
              <div role="columnheader">Gói</div>
              {all && <div role="columnheader">Chi nhánh</div>}
              <div role="columnheader">Trạng thái</div>
              <div role="columnheader" className="go-num">Giá bán</div>
            </div>
            {shown.map((s) => {
              const st = memberStatusTag(s.status);
              return (
                <div key={s.id} role="row" className="go-dt-row" data-testid="go-fin-sales-row" data-row-id={s.id}>
                  <div role="cell" className="go-dt-cell go-dt-first"><span className="go-dt-main">{dayText(s.createdAt)}</span></div>
                  <div role="cell" className="go-dt-cell" data-label="Gói">{planNameOf(s.planId, planRows)}</div>
                  {all && <div role="cell" className="go-dt-cell" data-label="Chi nhánh"><span className="go-code-chip" aria-hidden="true">{codes[s.gymId] ?? "--"}</span> <span className="go-dt-sub-inline">{gymName(s.gymId)}</span></div>}
                  <div role="cell" className="go-dt-cell" data-label="Trạng thái"><GoTag tone={st.tone} text={SALES_STATUS_LABEL[s.status] ?? st.text} /></div>
                  <div role="cell" className="go-dt-cell go-money-cell" data-label="Giá bán">{formatVND(s.priceAtPurchase)}</div>
                </div>
              );
            })}
          </div>
        )}

        {rows.length > 0 && (
          <p className="go-list-note" data-testid="go-fin-sales-note">
            {rows.length > SALES_ROWS_SHOWN ? `Hiển thị ${SALES_ROWS_SHOWN} thẻ mới nhất trên ${rows.length}. ` : `Hiển thị ${rows.length} thẻ. `}
            {canExport ? "File CSV có đủ mọi thẻ." : ""}
          </p>
        )}
      </section>
    </div>
  );
}
