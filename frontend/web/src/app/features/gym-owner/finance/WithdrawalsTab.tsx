/**
 * Tab "Lệnh rút": the withdrawal requests of every branch in scope (`GET /owner/gyms/:id/withdrawals`, one request per branch), newest
 * first, with a drawer (`?withdrawal=<id>`, 07 panel-reveal) that draws the timeline Chờ duyệt -> Đã duyệt, chưa chuyển -> Đã chi /
 * Bị từ chối. "Đã duyệt" is not "Đã chi": the page says so. The account number is drawn exactly as the server returned it for the
 * role (the accountant's copy is masked by the server); we never mask or unmask it here.
 * A branch whose list failed is named and the rest still shows; the count of requests is only given for branches that loaded.
 */
import { useEffect, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { CaretRightIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { formatVND } from "../../../utils/currency";
import { withdrawalsCsv } from "../../../utils/financeExport";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { DrawerSection, GoDrawer } from "../../../components/layout/gym-owner/GoDrawer";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { branchCodes, type ScopeGym } from "../scope/scopeModel";
import { gymService } from "../../../services/api";
import { downloadCsv } from "./downloadCsv";
import { finKey } from "./useFinanceData";
import {
  APPROVED_NOT_PAID_NOTE,
  coverageLine,
  normalizeWithdrawals,
  payoutSourceNote,
  sortWithdrawals,
  stamp,
  withdrawalTimeline,
  wdStatusTag,
  type WithdrawalRow,
} from "./financeModel";

const COLS_ALL = "minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.8fr) minmax(0, 1.3fr)";
const COLS_ONE = "minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.8fr) minmax(0, 1.3fr)";

export function WithdrawalsTab({ gyms, openId, onOpen, onClose }: { gyms: ScopeGym[]; openId: string | null; onOpen: (id: string) => void; onClose: () => void }) {
  const scope = useGymOwnerScope();
  const codes = branchCodes(scope.gyms);
  const all = scope.gymId === "ALL" && gyms.length > 1;
  const qs = useQueries({
    queries: gyms.map((g) => ({
      queryKey: finKey(scope.userId, "withdrawals", g.id),
      queryFn: async () => normalizeWithdrawals(await gymService.listGymWithdrawals(g.id), g),
      retry: false,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    })),
  });
  const loading = qs.some((q) => q.isLoading);
  const failedIdx = qs.map((q, i) => (q.isError && !q.data ? i : -1)).filter((i) => i >= 0);
  const failedNames = failedIdx.map((i) => gyms[i].name);
  const rows = sortWithdrawals(qs.flatMap((q) => q.data ?? []));
  const open = openId ? (rows.find((r) => r.id === openId) ?? null) : null;
  const maskedForRole = !scope.can("finance.withdraw");
  const canExport = scope.can("finance.export");
  const coverage = coverageLine(gyms.length, failedNames);
  const stamp0 = new Date().toISOString().slice(0, 10);
  const settled = !loading;

  return (
    <div className="go-stack" data-testid="go-fin-withdrawals">
      {coverage && (
        <div className="go-notice" data-tone="risk" role="alert" data-testid="go-fin-wd-partial">
          <span>{coverage} Chưa kết luận các chi nhánh này có hay không có lệnh rút.</span>
          <button type="button" className="go-btn go-btn-sm" onClick={() => failedIdx.forEach((i) => void qs[i].refetch())}>Thử lại</button>
        </div>
      )}
      <section className="go-panel" aria-labelledby="go-h-wd">
        <div className="go-panel-head go-panel-head-row">
          <div>
            <h2 id="go-h-wd">Lệnh rút tiền</h2>
            <p>{maskedForRole ? "Số tài khoản nhận được che, chỉ còn 4 số cuối." : "Gymini duyệt rồi mới chuyển tiền ra ngoài hệ thống."}</p>
          </div>
          {canExport && (
            <button type="button" className="go-btn go-btn-sm" disabled={rows.length === 0} onClick={() => downloadCsv(`gymini-rut-tien-${stamp0}.csv`, withdrawalsCsv(rows, { masked: maskedForRole }))} data-testid="go-fin-wd-csv">
              <DownloadSimpleIcon aria-hidden="true" width={14} height={14} /> Xuất CSV
            </button>
          )}
        </div>

        {loading && rows.length === 0 && (
          <div className="go-task-skel" aria-hidden="true" data-testid="go-fin-wd-skeleton">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="go-task-skel-row"><span className="go-skel-bar" style={{ width: "50%" }} /><span className="go-skel-bar" style={{ width: "30%" }} /></div>
            ))}
          </div>
        )}

        {settled && rows.length === 0 && failedNames.length === 0 && (
          <div className="go-task-empty" data-testid="go-fin-wd-empty">
            <strong>Chưa có lệnh rút nào</strong>
            <span>Lệnh rút của chi nhánh sẽ hiện ở đây.</span>
          </div>
        )}

        {rows.length > 0 && (
          <div role="table" className="go-dt" aria-label="Lệnh rút tiền" data-testid="go-fin-wd-table" style={{ "--go-cols": all ? COLS_ALL : COLS_ONE } as React.CSSProperties}>
            <div role="row" className="go-dt-row go-dt-head">
              <div role="columnheader">Ngày tạo</div>
              {all && <div role="columnheader">Chi nhánh</div>}
              <div role="columnheader" className="go-num">Số tiền</div>
              <div role="columnheader">Tài khoản nhận</div>
              <div role="columnheader">Trạng thái</div>
            </div>
            {rows.map((r) => {
              const st = wdStatusTag(r.status);
              const selected = openId === r.id;
              return (
                <div key={r.id} role="row" className="go-dt-row" data-selected={selected ? "true" : undefined} aria-current={selected ? "true" : undefined} data-testid="go-fin-wd-row" data-row-id={r.id} data-status={r.status}>
                  <div role="cell" className="go-dt-cell go-dt-first">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <button type="button" className="go-rowlink" onClick={() => onOpen(r.id)} aria-label={`Mở lệnh rút ${formatVND(r.amount)} ngày ${stamp(r.createdAt)}`} data-testid="go-fin-wd-open">
                        {stamp(r.createdAt) || "Không rõ ngày"}
                      </button>
                    </div>
                    <span className="go-dt-chev" aria-hidden="true"><CaretRightIcon /></span>
                  </div>
                  {all && <div role="cell" className="go-dt-cell" data-label="Chi nhánh"><span className="go-code-chip" aria-hidden="true">{codes[r.gymId] ?? "--"}</span> <span className="go-dt-sub-inline">{r.gymName}</span></div>}
                  <div role="cell" className="go-dt-cell go-money-cell" data-label="Số tiền">{formatVND(r.amount)}</div>
                  <div role="cell" className="go-dt-cell" data-label="Tài khoản nhận" data-testid="go-fin-wd-payout">{r.payoutInfo ?? "Không có"}</div>
                  <div role="cell" className="go-dt-cell" data-label="Trạng thái"><GoTag tone={st.tone} text={st.text} /></div>
                </div>
              );
            })}
          </div>
        )}

        {rows.length > 0 && (
          <p className="go-list-note" data-testid="go-fin-wd-note">
            {APPROVED_NOT_PAID_NOTE}
            {failedNames.length === 0 ? ` Hiển thị toàn bộ ${rows.length} lệnh rút của ${gyms.length === 1 ? "chi nhánh" : `${gyms.length} chi nhánh`}.` : ` Hiển thị ${rows.length} lệnh của các chi nhánh đã tải.`}
          </p>
        )}
      </section>

      <WithdrawalDrawer open={!!openId} row={open} loaded={settled} onClose={onClose} maskedForRole={maskedForRole} code={open ? (codes[open.gymId] ?? null) : null} />
    </div>
  );
}

function WithdrawalDrawer({ open, row, loaded, onClose, maskedForRole, code }: { open: boolean; row: WithdrawalRow | null; loaded: boolean; onClose: () => void; maskedForRole: boolean; code: string | null }) {
  // The drawer keeps its last content while it animates out (the URL param is already gone then).
  const last = useRef<WithdrawalRow | null>(null);
  useEffect(() => {
    if (row) last.current = row;
  }, [row]);
  const shown = row ?? last.current;
  const st = shown ? wdStatusTag(shown.status) : null;
  const steps = shown ? withdrawalTimeline(shown) : [];

  return (
    <GoDrawer
      open={open}
      onClose={onClose}
      testId="go-wd-drawer"
      title={shown ? formatVND(shown.amount) : "Lệnh rút"}
      description="Diễn biến và tài khoản nhận của một lệnh rút tiền."
      meta={shown && st ? (<><GoTag tone={st.tone} text={st.text} />{code && <span className="go-code-chip" title={shown.gymName}>{code}</span>}<span className="go-muted-text">{shown.gymName}</span></>) : undefined}
    >
      {!shown && (
        <p className="go-muted" data-testid="go-wd-drawer-missing">{loaded ? "Không tìm thấy lệnh rút này trong phạm vi hiện tại. Có thể nó thuộc chi nhánh khác hoặc đã ngoài danh sách." : "Đang tải lệnh rút."}</p>
      )}
      {shown && (
        <>
          <DrawerSection title="Diễn biến">
            <ol className="go-timeline" data-testid="go-wd-timeline">
              {steps.map((s) => (
                <li key={s.key} data-done={s.done ? "true" : "false"} data-tone={s.tone}>
                  <span className="go-tl-dot" aria-hidden="true" />
                  <div>
                    <p className="go-tl-title">{s.title}</p>
                    <p className="go-tl-text">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="go-hint-text" data-testid="go-wd-drawer-note">{APPROVED_NOT_PAID_NOTE}</p>
          </DrawerSection>
          <DrawerSection title="Tài khoản nhận">
            <p style={{ overflowWrap: "anywhere" }} data-testid="go-wd-drawer-payout">{shown.payoutInfo ?? "Máy chủ không trả thông tin tài khoản nhận."}</p>
            <p className="go-hint-text">{payoutSourceNote(shown, maskedForRole)}</p>
          </DrawerSection>
        </>
      )}
    </GoDrawer>
  );
}
