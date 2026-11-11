import { useId, useRef } from "react";
import { XIcon } from "@phosphor-icons/react";
import { useModalA11y } from "../../shared/useModalA11y";
import { formatMoneyExact } from "../../adminFinanceOverview.utils";
import { formatDateTimeVi } from "../../adminReconciliation.utils";
import { FOCUS, Field, LoadError, Section, ShortIdCopy, SkeletonBlock, TxnStatusPill } from "./TransactionParts";
import { buildMoneyJourney, shortId, type JourneyEvent } from "./moneyJourney";
import { useTransactionDetail } from "./useTransactionsData";
import { activationLabel, bucketLabel, entryTypeLabel, ownerLabel, providerLabel, purposeLabel } from "./transactionsLabels";
import type { LedgerEntryDto, TxnDetailResponse, TxnSummary } from "./transactionsTypes";

const DOT: Record<JourneyEvent["tone"], string> = {
  success: "bg-st-success",
  pending: "bg-st-pending",
  danger: "bg-st-danger",
  warning: "bg-st-warning",
  info: "bg-st-info",
  neutral: "bg-st-neutral",
};

function Journey({ events, onOpenTransaction }: { events: JourneyEvent[]; onOpenTransaction: (id: string) => void }) {
  if (events.length === 0) {
    return <p className="text-sm text-adm-text-2">Chưa có sự kiện nào để dựng hành trình.</p>;
  }
  return (
    <ol data-testid="admin-transaction-journey" className="relative space-y-4 border-l border-adm-border pl-5">
      {events.map((e) => (
        <li key={e.key} data-testid="admin-transaction-journey-step" className="relative">
          <span aria-hidden className={`absolute -left-[26px] top-1.5 size-2.5 rounded-full ring-2 ring-adm-surface ${DOT[e.tone]}`} />
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
            <p className="min-w-0 text-sm font-medium text-adm-text">{e.title}</p>
            {e.amount !== null && <span className="shrink-0 text-sm font-semibold tabular-nums text-adm-text">{formatMoneyExact(e.amount)}</span>}
          </div>
          {e.detail && <p className="mt-0.5 text-xs text-adm-text-2">{e.detail}</p>}
          <p className="mt-0.5 text-xs tabular-nums text-adm-text-2">{formatDateTimeVi(e.at)}</p>
          {e.linkTransactionId && (
            <button
              type="button"
              onClick={() => onOpenTransaction(e.linkTransactionId as string)}
              className={`mt-1 min-h-11 rounded-md text-xs font-medium text-primary underline underline-offset-4 xl:min-h-7 ${FOCUS}`}
            >
              Mở giao dịch {shortId(e.linkTransactionId)}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function LedgerTable({ entries, paid }: { entries: LedgerEntryDto[]; paid: boolean }) {
  if (entries.length === 0) {
    return (
      <p data-testid="admin-transaction-ledger-empty" className={`rounded-lg border px-3 py-2 text-sm ${paid ? "border-st-warning-border bg-st-warning-bg text-st-warning" : "border-adm-border bg-adm-surface-2 text-adm-text-2"}`}>
        {paid ? "Giao dịch đã thanh toán nhưng chưa có bút toán nào được ghi — cần kiểm tra ở mục Đối soát." : "Chưa có bút toán — giao dịch này chưa phát sinh việc ghi sổ."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-adm-border">
      <table data-testid="admin-transaction-ledger" className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">Bút toán của giao dịch</caption>
        <thead className="bg-adm-surface-2 text-xs text-adm-text-2">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Ví</th>
            <th scope="col" className="px-3 py-2 font-semibold">Loại</th>
            <th scope="col" className="px-3 py-2 font-semibold">Ngăn</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Số tiền</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Số dư trước → sau</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-adm-border-soft align-top">
              <td className="px-3 py-2">
                <div className="text-adm-text">{ownerLabel(e.walletOwnerType)}</div>
                {/* platform wallets use fixed internal ids (payment-service wallet.service: ESCROW / REVENUE), never show them as a user id */}
                {e.walletOwnerType === "PLATFORM" ? (
                  <div className="text-xs text-adm-text-2">{PLATFORM_WALLET_LABEL[e.walletOwnerId] ?? "Ví nội bộ"}</div>
                ) : (
                  <ShortIdCopy id={e.walletOwnerId} label="mã chủ ví" />
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-adm-text">{entryTypeLabel(e.entryType)}</td>
              <td className="px-3 py-2 whitespace-nowrap text-adm-text">{bucketLabel(e.bucket)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-adm-text">{formatMoneyExact(e.amount)}</td>
              <td className="px-3 py-2 text-right text-xs tabular-nums text-adm-text-2">
                {formatMoneyExact(e.balanceBefore)} → {formatMoneyExact(e.balanceAfter)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RelatedRefunds({ detail, onOpenTransaction }: { detail: TxnDetailResponse; onOpenTransaction: (id: string) => void }) {
  const link = (t: TxnSummary, lead: string) => (
    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-adm-border px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-adm-text">{lead} · <span className="font-mono text-xs">{shortId(t.id)}</span></p>
        <p className="text-xs text-adm-text-2">
          <span className="tabular-nums">{formatMoneyExact(t.amount)}</span> · {formatDateTimeVi(t.createdAt)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <TxnStatusPill status={t.status} />
        <button
          type="button"
          onClick={() => onOpenTransaction(t.id)}
          className={`min-h-11 rounded-md px-2 text-sm font-medium text-primary underline underline-offset-4 xl:min-h-8 ${FOCUS}`}
        >
          Mở
        </button>
      </div>
    </li>
  );
  if (!detail.refundOf && detail.refunds.length === 0) {
    return <p className="text-sm text-adm-text-2">Không có hoàn tiền nào liên quan đến giao dịch này.</p>;
  }
  return (
    <ul data-testid="admin-transaction-refunds" className="space-y-2">
      {detail.refundOf && link(detail.refundOf, "Giao dịch gốc")}
      {detail.refunds.map((r) => link(r, "Khoản hoàn"))}
    </ul>
  );
}

function Summary({ t }: { t: TxnSummary }) {
  return (
    <dl className="space-y-2" data-testid="admin-transaction-summary">
      <Field label="Tạo lúc">{formatDateTimeVi(t.createdAt)}</Field>
      <Field label="Thanh toán lúc">{formatDateTimeVi(t.paidAt)}</Field>
      {t.failedAt && <Field label="Thất bại lúc">{formatDateTimeVi(t.failedAt)}</Field>}
      {t.refundedAt && <Field label="Hoàn tiền lúc">{formatDateTimeVi(t.refundedAt)}</Field>}
      <Field label="Người trả"><ShortIdCopy id={t.payerId} label="mã người trả" /></Field>
      {t.gymId && <Field label="Phòng gym"><ShortIdCopy id={t.gymId} label="mã phòng gym" /></Field>}
      {t.ptId && <Field label="PT"><ShortIdCopy id={t.ptId} label="mã PT" /></Field>}
      {t.ptContractId && <Field label="Hợp đồng PT"><ShortIdCopy id={t.ptContractId} label="mã hợp đồng" /></Field>}
      {t.membershipId && <Field label="Gói hội viên"><ShortIdCopy id={t.membershipId} label="mã gói hội viên" /></Field>}
      {t.providerTransactionId && <Field label="Mã giao dịch của cổng"><ShortIdCopy id={t.providerTransactionId} label="mã giao dịch của cổng" /></Field>}
      <Field label="Kích hoạt dịch vụ">{activationLabel(t.activationStatus)}</Field>
    </dl>
  );
}

/**
 * Right-hand drawer (full screen on a phone) opened by `?id=`. Read only: it shows what the server returned and has no
 * write control. `useModalA11y` moves focus in, traps Tab, closes on Esc and gives focus back to what opened it.
 */
const PLATFORM_WALLET_LABEL: Record<string, string> = { ESCROW: "Ví giữ hộ (tiền chưa chi cho đối tác)", REVENUE: "Ví doanh thu nền tảng" };

export function TransactionDrawer({ id, onClose, onOpenTransaction }: { id: string; onClose: () => void; onOpenTransaction: (id: string) => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalA11y(panelRef, onClose, true);
  const query = useTransactionDetail(id);
  const detail = query.data;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose} data-testid="admin-transaction-drawer-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="admin-transaction-drawer"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-adm-surface text-adm-text shadow-xl outline-none sm:max-w-[560px] sm:border-l sm:border-adm-border"
      >
        <div className="flex items-start justify-between gap-3 border-b border-adm-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-xs text-adm-text-2">Giao dịch</p>
            <h2 id={titleId} className="flex items-center gap-1 text-base font-semibold">
              <span className="font-mono">{shortId(id)}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng chi tiết giao dịch"
            data-testid="admin-transaction-drawer-close"
            className={`inline-flex size-11 shrink-0 items-center justify-center rounded-md text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text xl:size-9 ${FOCUS}`}
          >
            <XIcon className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" key={id}>
          {query.isLoading ? (
            <div className="p-4"><SkeletonBlock rows={5} testId="admin-transaction-drawer-loading" /></div>
          ) : query.isError || !detail ? (
            <div className="p-4"><LoadError error={query.error} what="chi tiết giao dịch" onRetry={() => query.refetch()} testId="admin-transaction-drawer-error" /></div>
          ) : (
            <>
              <section className="space-y-2 px-4 py-4 sm:px-5" aria-label="Tóm tắt giao dịch">
                <p data-testid="admin-transaction-amount" className="text-2xl font-bold tabular-nums">{formatMoneyExact(detail.transaction.amount)}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <TxnStatusPill status={detail.transaction.status} />
                  <span className="text-sm text-adm-text">{purposeLabel(detail.transaction.purpose)}</span>
                  <span className="text-sm text-adm-text-2">· {providerLabel(detail.transaction.provider)}</span>
                </div>
                {detail.transaction.activationStatus === "ACTIVATION_FAILED" && (
                  <p role="status" className="rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2 text-sm text-st-danger">
                    Đã thu tiền nhưng dịch vụ chưa được kích hoạt — cần xử lý.
                  </p>
                )}
                <div className="pt-1"><Summary t={detail.transaction} /></div>
              </section>

              <Section title="Hành trình tiền" testId="admin-transaction-journey-section">
                <Journey events={buildMoneyJourney(detail)} onOpenTransaction={onOpenTransaction} />
              </Section>

              <Section title="Bút toán" testId="admin-transaction-ledger-section">
                <LedgerTable entries={detail.ledgerEntries} paid={detail.transaction.status === "PAID"} />
              </Section>

              <Section title="Hoàn tiền liên quan" testId="admin-transaction-refunds-section">
                <RelatedRefunds detail={detail} onOpenTransaction={onOpenTransaction} />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
