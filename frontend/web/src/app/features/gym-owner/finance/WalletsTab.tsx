/**
 * Tab "Ví" of Tài chính.
 *  - "All branches": ONE dense table, one row per branch (G5 redline R1), so 6 to 90 branches stay scannable. Numbers are right-aligned,
 *    there is NO total row or footer (each wallet is its own ledger, read at its own time). A row (click or Enter on its name) opens that
 *    branch at `?gymId=<id>&tab=wallets`. A wallet that failed is one row with "Không tải được" + Thử lại, never 0 ₫. Column meanings live
 *    in header tooltips and ONE compact legend, not per row. At 768px and below the rows become a list: name + "Có thể rút" and a
 *    disclosure for the other values. If the table needs horizontal room at mid widths it scrolls inside a labelled, focusable region
 *    with a sticky first column.
 *  - One branch (R2): ONE surface (no card in a card, no coloured stripes): "Có thể rút" as the hero value with "Rút tiền" beside it, then
 *    a hairline-divided grid for Khả dụng / Đang chờ / Đang khoá / Giữ cho lệnh chờ, a plain debt row, and the open requests.
 * Every number is a field of `GET /owner/gyms/:id/wallet`. Motion: 14 skeleton, 04 text swap (refresh), 01 card-resize (open requests).
 */
import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ArrowsClockwiseIcon, MoneyIcon, WarningIcon } from "@phosphor-icons/react";
import { gymService } from "../../../services/api";
import type { Wallet } from "../../../types";
import { formatVND } from "../../../utils/currency";
import { GoTag } from "../../../components/layout/gym-owner/GoTag";
import { GoReveal } from "../../../components/layout/gym-owner/GoAccordion";
import { SuccessCheck, TextStates } from "../../../components/layout/gym-owner/motion";
import { branchCodes, classifyApiError, type ScopeGym } from "../scope/scopeModel";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ScopeStateFrame } from "../scope/PermissionGate";
import { finKey, useWallet, useWithdrawals } from "./useFinanceData";
import {
  NO_TOTAL_NOTE,
  WALLET_COLUMNS,
  WALLET_FROZEN_TEXT,
  WALLET_HELP,
  clockText,
  isOpenWithdrawal,
  walletRowState,
  walletView,
  wdStatusTag,
  type WalletView,
} from "./financeModel";
import { WithdrawDialog } from "./WithdrawDialog";

export function WalletsTab({ gyms, onOpenWithdrawal, onPickBranch, sentFlag, onWithdrawn }: { gyms: ScopeGym[]; onOpenWithdrawal: (id: string) => void; onPickBranch: (id: string) => void; sentFlag: boolean; onWithdrawn: () => void }) {
  const scope = useGymOwnerScope();
  const single = scope.gymId !== "ALL";
  const codes = branchCodes(scope.gyms);
  if (gyms.length === 0) {
    return (
      <section className="go-panel" data-testid="go-fin-empty">
        <div className="go-task-empty">
          <strong>Chưa có ví nào trong phạm vi</strong>
          <span>Ví chi nhánh xuất hiện sau khi chi nhánh được duyệt và có giao dịch.</span>
        </div>
      </section>
    );
  }
  return (
    <div className="go-stack" data-testid="go-fin-wallets" data-mode={single ? "single" : "all"}>
      {sentFlag && (
        <div className="go-sent go-sent-bar" data-show="true" role="status" data-testid="go-fin-sent">
          <SuccessCheck show size={16} /> Đã gửi yêu cầu rút tiền. Lệnh đang chờ Gymini duyệt.
        </div>
      )}
      {single ? (
        <WalletSingle gym={gyms[0]} code={codes[gyms[0].id] ?? "--"} onOpenWithdrawal={onOpenWithdrawal} onWithdrawn={onWithdrawn} />
      ) : (
        <WalletsTable gyms={gyms} codes={codes} onPickBranch={onPickBranch} canWithdraw={scope.can("finance.withdraw")} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// All branches: one table
// ---------------------------------------------------------------------------------------------------------------------

function WalletsTable({ gyms, codes, onPickBranch, canWithdraw }: { gyms: ScopeGym[]; codes: Record<string, string>; onPickBranch: (id: string) => void; canWithdraw: boolean }) {
  const scope = useGymOwnerScope();
  const qs = useQueries({
    queries: gyms.map((g) => ({
      queryKey: finKey(scope.userId, "wallet", g.id),
      queryFn: () => gymService.getOwnedWallet(g.id) as Promise<Wallet>,
      retry: false,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    })),
  });
  const rows = gyms.map((g, i) => {
    const q = qs[i];
    const state = walletRowState({ loading: q.isLoading, failed: q.isError && !q.data, approved: g.status === "APPROVED" || g.status === undefined });
    return { gym: g, code: codes[g.id] ?? "--", q, state, w: q.data ? walletView(q.data) : null };
  });

  return (
    <section className="go-panel go-wt-panel" aria-labelledby="go-h-wt" data-testid="go-wallet-table-panel">
      <div className="go-panel-head">
        <h2 id="go-h-wt">Ví của {gyms.length} chi nhánh</h2>
        <p>Chọn một chi nhánh để xem chi tiết{canWithdraw ? " và rút tiền" : ""}.</p>
      </div>

      <div className="go-wt-scroll" role="region" aria-label="Bảng ví các chi nhánh, có thể cuộn ngang" tabIndex={0} data-testid="go-wallet-scroll">
        <table className="go-wt" data-testid="go-wallet-table">
          <caption className="sr-only">Ví của từng chi nhánh. Mỗi dòng là một chi nhánh, không có dòng tổng.</caption>
          <thead>
            <tr>
              <th scope="col" className="go-wt-first">Chi nhánh</th>
              {WALLET_COLUMNS.map((c) => (
                <th key={c.id} scope="col" className="go-num" title={c.help} data-col={c.id}>{c.label}</th>
              ))}
              <th scope="col" className="go-num">Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ gym, code, q, state, w }) => (
              <tr key={gym.id} data-testid="go-wallet-row" data-gym-id={gym.id} data-state={state} onClick={() => onPickBranch(gym.id)}>
                <th scope="row" className="go-wt-first">
                  <span className="go-wt-name">
                    <span className="go-code-chip" aria-hidden="true">{code}</span>
                    <button type="button" className="go-wt-link" onClick={(e) => { e.stopPropagation(); onPickBranch(gym.id); }} aria-label={`Mở ví chi nhánh ${gym.name}`} data-testid="go-wallet-open">{gym.name}</button>
                    {w && !w.active && <GoTag tone="risk" text={w.status === "FROZEN" ? "Tạm khoá" : "Không hoạt động"} />}
                  </span>
                </th>
                {state === "loading" && <td colSpan={7}><span className="go-skel-bar" style={{ width: "60%" }} aria-hidden="true" /></td>}
                {state === "failed" && (
                  <td colSpan={7} data-testid="go-wallet-error">
                    <span className="go-wt-fail" role="alert"><WarningIcon aria-hidden="true" width={16} height={16} /> Không tải được ví này.</span>
                    <button type="button" className="go-btn go-btn-sm" onClick={(e) => { e.stopPropagation(); void q.refetch(); }}>Thử lại</button>
                  </td>
                )}
                {state === "no-wallet" && <td colSpan={7} data-testid="go-wallet-none" className="go-wt-muted">Chi nhánh chưa có ví: hồ sơ chưa được Gymini duyệt.</td>}
                {state === "ready" && w && (
                  <>
                    <td className="go-num" data-col="withdrawable"><span className="go-wt-hero" data-value={String(w.withdrawable)}>{formatVND(w.withdrawable)}</span>{!w.withdrawableFromServer && <span className="go-wt-note" title={WALLET_HELP.withdrawableOldServer}>số khả dụng</span>}</td>
                    <td className="go-num" data-col="available">{formatVND(w.available)}</td>
                    <td className="go-num" data-col="pending">{formatVND(w.pending)}</td>
                    <td className="go-num" data-col="locked">{formatVND(w.locked)}</td>
                    <td className="go-num" data-col="reserved">{formatVND(w.reservedPending)}</td>
                    <td className="go-num" data-col="debt">{w.debtOpen > 0 ? <span className="go-wt-debt"><WarningIcon aria-hidden="true" width={14} height={14} />{formatVND(w.debtOpen)}</span> : <span className="go-wt-muted">Không có</span>}</td>
                    <td className="go-num go-wt-muted" data-col="stamp">{clockText(q.dataUpdatedAt)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="go-wt-list" aria-label="Ví các chi nhánh" data-testid="go-wallet-list">
        {rows.map(({ gym, code, q, state, w }) => (
          <li key={gym.id} data-testid="go-wallet-li" data-gym-id={gym.id} data-state={state}>
            <div className="go-wt-li-top">
              <span className="go-wt-name">
                <span className="go-code-chip" aria-hidden="true">{code}</span>
                <button type="button" className="go-wt-link" onClick={() => onPickBranch(gym.id)} aria-label={`Mở ví chi nhánh ${gym.name}`}>{gym.name}</button>
              </span>
              {state === "ready" && w && <span className="go-wt-hero" data-value={String(w.withdrawable)}>{formatVND(w.withdrawable)}</span>}
            </div>
            {state === "loading" && <span className="go-skel-bar" style={{ width: "50%" }} aria-hidden="true" />}
            {state === "failed" && (
              <div className="go-wt-li-fail">
                <span className="go-wt-fail" role="alert"><WarningIcon aria-hidden="true" width={16} height={16} /> Không tải được ví này.</span>
                <button type="button" className="go-btn go-btn-sm" onClick={() => void q.refetch()}>Thử lại</button>
              </div>
            )}
            {state === "no-wallet" && <p className="go-wt-muted">Chi nhánh chưa có ví: hồ sơ chưa được Gymini duyệt.</p>}
            {state === "ready" && w && (
              <details className="go-wt-more">
                <summary>Xem các ngăn khác của ví</summary>
                <dl>
                  <div><dt>Khả dụng</dt><dd>{formatVND(w.available)}</dd></div>
                  <div><dt>Đang chờ</dt><dd>{formatVND(w.pending)}</dd></div>
                  <div><dt>Đang khoá</dt><dd>{formatVND(w.locked)}</dd></div>
                  <div><dt>Giữ cho lệnh chờ</dt><dd>{formatVND(w.reservedPending)}</dd></div>
                  <div><dt>Nợ nền tảng</dt><dd>{w.debtOpen > 0 ? formatVND(w.debtOpen) : "Không có"}</dd></div>
                  <div><dt>Cập nhật</dt><dd>{clockText(q.dataUpdatedAt)}</dd></div>
                </dl>
              </details>
            )}
          </li>
        ))}
      </ul>

      <dl className="go-wt-legend" data-testid="go-wallet-legend" aria-label="Ý nghĩa các cột">
        {WALLET_COLUMNS.map((c) => (
          <div key={c.id}><dt>{c.label}</dt><dd>{c.help}</dd></div>
        ))}
      </dl>
      <p className="go-list-note" data-testid="go-fin-nototal">{NO_TOTAL_NOTE}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// One branch: one surface
// ---------------------------------------------------------------------------------------------------------------------

function Cell({ kind, label, value, help, testId }: { kind: "available" | "pending" | "locked" | "reserved"; label: string; value: number; help: string; testId: string }) {
  return (
    <div className="go-wgrid-cell" data-kind={kind} data-testid={testId}>
      <dt>{label}</dt>
      <dd className="go-wgrid-num" data-value={String(value)}>{formatVND(value)}</dd>
      <dd className="go-money-hint">{help}</dd>
    </div>
  );
}

function WalletSingle({ gym, code, onOpenWithdrawal, onWithdrawn }: { gym: ScopeGym; code: string; onOpenWithdrawal: (id: string) => void; onWithdrawn: () => void }) {
  const scope = useGymOwnerScope();
  const walletQ = useWallet(gym.id);
  const withdrawalsQ = useWithdrawals(gym, scope.can("finance.withdrawals.view"));
  const [dialog, setDialog] = useState(false);
  const w: WalletView | null = walletQ.data ? walletView(walletQ.data) : null;
  const failed = walletQ.isError && !walletQ.data;
  const open = (withdrawalsQ.data ?? []).filter((r) => isOpenWithdrawal(r.status));
  const canWithdraw = scope.can("finance.withdraw");

  if (failed && classifyApiError(walletQ.error) === "forbidden") return <ScopeStateFrame kind="forbidden" />;

  return (
    <article className="go-wsingle" aria-label={`Ví ${gym.name}`} data-big="true" data-testid="go-wallet-card" data-gym-id={gym.id} data-state={walletQ.isLoading ? "loading" : failed ? "error" : "ready"}>
      <header className="go-wsingle-head">
        <span className="go-code-chip go-code-chip-lg" aria-hidden="true">{code}</span>
        <h2>{gym.name}</h2>
        {w && !w.active && <GoTag tone="risk" text={w.status === "FROZEN" ? "Ví tạm khoá" : w.status === "CLOSED" ? "Ví đã đóng" : "Ví không hoạt động"} />}
      </header>

      {walletQ.isLoading && (
        <div className="go-wsingle-skel" aria-hidden="true" data-testid="go-wallet-skeleton">
          <span className="go-skel-bar" data-size="lg" />
          <span className="go-skel-bar" data-size="block" />
        </div>
      )}

      {failed && (
        <div className="go-notice" data-tone="risk" role="alert" data-testid="go-wallet-error">
          <span>Không tải được ví {gym.name}. Chưa kết luận ví có bao nhiêu tiền.</span>
          <button type="button" className="go-btn go-btn-sm" onClick={() => void walletQ.refetch()}>Thử lại</button>
        </div>
      )}

      {w && (
        <>
          <div className="go-wsingle-hero" data-testid="go-wallet-main">
            <div className="go-wsingle-hero-text">
              <span className="go-money-label">Có thể rút</span>
              <span className="go-money-num go-money-hero" data-testid="gym-wallet-available-balance" data-value={String(w.withdrawable)}>{formatVND(w.withdrawable)}</span>
              <span className="go-money-hint">{w.withdrawableFromServer ? WALLET_HELP.withdrawable : WALLET_HELP.withdrawableOldServer}</span>
            </div>
            <div className="go-wsingle-actions">
              {canWithdraw && (
                <button type="button" className="go-btn" data-variant="primary" onClick={() => setDialog(true)} data-testid="go-withdraw-open">
                  <MoneyIcon aria-hidden="true" width={16} height={16} /> Rút tiền
                </button>
              )}
              <button type="button" className="go-btn go-btn-sm" onClick={() => void walletQ.refetch()} disabled={walletQ.isFetching} data-testid="go-wallet-refresh">
                <ArrowsClockwiseIcon aria-hidden="true" width={14} height={14} />
                <TextStates value={walletQ.isFetching ? "Đang tải" : "Tải lại"} />
              </button>
            </div>
          </div>

          {!w.active && WALLET_FROZEN_TEXT[w.status] && <p className="go-note go-wsingle-note" data-tone="warn" role="note">{WALLET_FROZEN_TEXT[w.status]}</p>}

          <dl className="go-wgrid" data-testid="go-wallet-grid">
            <Cell kind="available" label="Khả dụng" value={w.available} help={WALLET_HELP.available} testId="go-slot-available" />
            <Cell kind="pending" label="Đang chờ" value={w.pending} help={WALLET_HELP.pending} testId="go-slot-pending" />
            <Cell kind="locked" label="Đang khoá" value={w.locked} help={WALLET_HELP.locked} testId="go-slot-locked" />
            <Cell kind="reserved" label="Giữ cho lệnh chờ" value={w.reservedPending} help={WALLET_HELP.reservedPending} testId="go-slot-reserved" />
          </dl>

          {(w.debtOpen > 0 || w.debtRecovered > 0) && (
            <div className={w.debtOpen > 0 ? "go-wdebt-row2 go-note" : "go-wdebt-row2"} data-tone={w.debtOpen > 0 ? "warn" : undefined} data-testid="go-wallet-debt">
              <WarningIcon aria-hidden="true" width={18} height={18} className="go-wdebt-ico" />
              <div>
                <p className="go-wdebt-line"><strong>Nợ nền tảng</strong> <span className="go-wgrid-num" data-testid="go-wallet-debt-open">{formatVND(w.debtOpen)}</span></p>
                <p className="go-money-hint">
                  {WALLET_HELP.debt}
                  {w.debtRecovered > 0 && <> Đã trừ tổng cộng {formatVND(w.debtRecovered)}.</>}
                </p>
                {w.debtRecent.length > 0 && (
                  <ul className="go-wdebt-list" data-testid="go-wallet-debt-recent">
                    {w.debtRecent.slice(0, 5).map((r, i) => (
                      <li key={`${r.at}-${i}`}>
                        Đã trừ {formatVND(r.amount)} ngày {new Date(r.at).toLocaleDateString("vi-VN")}, {r.unpaidAfter > 0 ? `còn nợ ${formatVND(r.unpaidAfter)}` : "đã trả đủ"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <p className="go-muted-text go-wsingle-stamp" data-testid="go-wallet-stamp">Cập nhật lúc {clockText(walletQ.dataUpdatedAt)}{walletQ.isError ? ". Lần tải lại gần nhất bị lỗi, số liệu có thể đã cũ." : ""}</p>

          <GoReveal open={open.length > 0}>
            <div className="go-wd-open" data-testid="gym-open-withdrawal-requests">
              <h3>Lệnh rút đang mở</h3>
              <ul>
                {open.map((r) => {
                  const st = wdStatusTag(r.status);
                  return (
                    <li key={r.id} data-testid="gym-withdrawal-request-row" data-status={r.status} data-amount={String(r.amount)}>
                      <button type="button" className="go-linkbtn" onClick={() => onOpenWithdrawal(r.id)} aria-label={`Xem lệnh rút ${formatVND(r.amount)}, ${st.text}`}>{formatVND(r.amount)}</button>
                      <GoTag tone={st.tone} text={st.text} />
                    </li>
                  );
                })}
              </ul>
            </div>
          </GoReveal>
          {withdrawalsQ.isError && <p className="go-muted-text" data-testid="go-wallet-wd-error">Chưa tải được danh sách lệnh rút, nên chưa liệt kê được các lệnh đang mở.</p>}
        </>
      )}

      {canWithdraw && <WithdrawDialog open={dialog} onClose={() => setDialog(false)} gym={gym} code={code} wallet={w} onDone={onWithdrawn} />}
    </article>
  );
}
