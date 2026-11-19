import { useId, useRef } from "react";
import { AdminLink } from "../../../../components/layout/admin/AdminLink";
import { XIcon } from "@phosphor-icons/react";
import { useModalA11y } from "../../shared/useModalA11y";
import { formatMoneyExact } from "../../adminFinanceOverview.utils";
import { formatDateTimeVi } from "../../adminReconciliation.utils";
import { Section, SkeletonBlock } from "../transactions/TransactionParts";
import { shortId } from "../transactions/moneyJourney";
import { bucketLabel, entryTypeLabel } from "../transactions/transactionsLabels";
import { FOCUS, PagerBar, WalletLoadError, WalletOwner, WalletStatusPill } from "./WalletParts";
import { entryKindLabel, walletOwnerTitle } from "./walletLabels";
import { ENTRIES_PAGE_SIZE, pageCount, transactionLink } from "./walletsUrlState";
import { useWalletDetail } from "./useWalletsData";
import type { WalletDto, WalletEntryDto } from "./walletsTypes";

function Balances({ wallet }: { wallet: WalletDto }) {
  const cell = (label: string, value: string, testId: string) => (
    <div className="rounded-lg border border-adm-border bg-adm-surface-2 px-3 py-2">
      <p className="text-xs text-adm-text-2">{label}</p>
      <p data-testid={testId} className="mt-0.5 text-base font-semibold tabular-nums text-adm-text">{formatMoneyExact(value)}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="admin-wallet-balances">
      {cell("Khả dụng", wallet.availableBalance, "admin-wallet-balance-available")}
      {cell("Đang chờ", wallet.pendingBalance, "admin-wallet-balance-pending")}
      {cell("Đang khóa", wallet.lockedBalance, "admin-wallet-balance-locked")}
      {cell("Tạm giữ của PT", wallet.holdbackBalance, "admin-wallet-balance-holdback")}
    </div>
  );
}

function EntriesTable({ entries, dimmed }: { entries: WalletEntryDto[]; dimmed: boolean }) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-adm-border transition-opacity motion-reduce:transition-none ${dimmed ? "opacity-60" : ""}`} aria-busy={dimmed}>
      <table data-testid="admin-wallet-entries" className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">Bút toán của ví</caption>
        <thead className="bg-adm-surface-2 text-xs text-adm-text-2">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Thời gian</th>
            <th scope="col" className="px-3 py-2 font-semibold">Phát sinh từ</th>
            <th scope="col" className="px-3 py-2 font-semibold">Loại</th>
            <th scope="col" className="px-3 py-2 font-semibold">Ngăn</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Số tiền</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Số dư trước → sau</th>
            <th scope="col" className="px-3 py-2 font-semibold">Giao dịch</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} data-testid="admin-wallet-entry" className="border-t border-adm-border-soft align-top">
              <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums text-adm-text-2">{formatDateTimeVi(e.createdAt)}</td>
              <td className="px-3 py-2 text-adm-text" data-testid="admin-wallet-entry-kind">{entryKindLabel(e.kind)}</td>
              <td className="px-3 py-2 whitespace-nowrap text-adm-text">{entryTypeLabel(e.entryType)}</td>
              <td className="px-3 py-2 whitespace-nowrap text-adm-text">{bucketLabel(e.bucket)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-adm-text">{formatMoneyExact(e.amount)}</td>
              <td className="px-3 py-2 text-right text-xs tabular-nums text-adm-text-2">
                {formatMoneyExact(e.balanceBefore)} → {formatMoneyExact(e.balanceAfter)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <AdminLink
                  to={transactionLink(e.transactionId)}
                  aria-label={`Mở giao dịch ${shortId(e.transactionId)}`}
                  data-testid="admin-wallet-entry-transaction-link"
                  className={`inline-flex min-h-11 items-center rounded-md font-mono text-xs text-primary underline underline-offset-4 xl:min-h-7 ${FOCUS}`}
                >
                  {shortId(e.transactionId)}
                </AdminLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Right-hand drawer (full screen on a phone) opened by `?id=`: the 4 balances of one wallet and a page of its ledger entries.
 * Read only. `useModalA11y` moves focus in, traps Tab, closes on Esc and gives focus back to what opened it.
 */
export function WalletDrawer({ id, entriesPage, onEntriesPage, onClose }: { id: string; entriesPage: number; onEntriesPage: (p: number) => void; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalA11y(panelRef, onClose, true);
  const query = useWalletDetail(id, entriesPage);
  const detail = query.data;
  const wallet = detail?.wallet;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose} data-testid="admin-wallet-drawer-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="admin-wallet-drawer"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-adm-surface text-adm-text shadow-xl outline-none sm:max-w-[760px] sm:border-l sm:border-adm-border"
      >
        <div className="flex items-start justify-between gap-3 border-b border-adm-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-xs text-adm-text-2">Ví</p>
            <h2 id={titleId} className="truncate text-base font-semibold">
              {wallet ? walletOwnerTitle(wallet.ownerType, wallet.ownerId) : <span className="font-mono">{shortId(id)}</span>}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng chi tiết ví"
            data-testid="admin-wallet-drawer-close"
            className={`inline-flex size-11 shrink-0 items-center justify-center rounded-md text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text xl:size-9 ${FOCUS}`}
          >
            <XIcon className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" key={id}>
          {query.isLoading ? (
            <div className="p-4"><SkeletonBlock rows={5} testId="admin-wallet-drawer-loading" /></div>
          ) : (query.isError && !detail) || !detail || !wallet ? (
            <div className="p-4"><WalletLoadError error={query.error} what="chi tiết ví" onRetry={() => query.refetch()} testId="admin-wallet-drawer-error" /></div>
          ) : (
            <>
              <section className="space-y-3 px-4 py-4 sm:px-5" aria-label="Tóm tắt ví">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <WalletOwner ownerType={wallet.ownerType} ownerId={wallet.ownerId} />
                  <WalletStatusPill status={wallet.status} />
                </div>
                <Balances wallet={wallet} />
                <p className="text-xs text-adm-text-2">
                  Tạo lúc {formatDateTimeVi(wallet.createdAt)} · cập nhật lúc {formatDateTimeVi(wallet.updatedAt)}
                </p>
              </section>

              <Section title={`Bút toán (${detail.entries.total.toLocaleString("vi-VN")})`} testId="admin-wallet-entries-section">
                {query.isError && (
                  <p role="status" data-testid="admin-wallet-entries-stale" className="rounded-lg border border-st-pending-border bg-st-pending-bg px-3 py-2 text-sm text-st-pending">
                    Không tải được trang này — đang hiện dữ liệu cũ. Bấm “Làm mới” ở đầu trang để thử lại.
                  </p>
                )}
                {detail.ignoredEntries > 0 && (
                  <p className="text-xs text-adm-text-2">Có {detail.ignoredEntries} bút toán không đọc được trong phản hồi nên không hiển thị.</p>
                )}
                {detail.entries.items.length === 0 ? (
                  <p data-testid="admin-wallet-entries-empty" className="rounded-lg border border-adm-border bg-adm-surface-2 px-3 py-2 text-sm text-adm-text-2">
                    Ví này chưa có bút toán nào.
                  </p>
                ) : (
                  <EntriesTable entries={detail.entries.items} dimmed={query.isPlaceholderData || (query.isFetching && !query.isLoading)} />
                )}
                {detail.entries.total > ENTRIES_PAGE_SIZE && (
                  <PagerBar
                    label="Phân trang bút toán"
                    testIdPrefix="admin-wallet-entries"
                    page={entriesPage}
                    pages={pageCount(detail.entries.total, ENTRIES_PAGE_SIZE)}
                    total={detail.entries.total}
                    noun="bút toán"
                    hasMore={detail.entries.hasMore}
                    shown={detail.entries.items.length}
                    onPage={onEntriesPage}
                  />
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
