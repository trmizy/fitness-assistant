import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CaretLeftIcon, CaretRightIcon, MagnifyingGlassIcon, MoneyIcon, XIcon } from "@phosphor-icons/react";
import { formatMoneyExact } from "../../adminFinanceOverview.utils";
import { formatDateTimeVi } from "../../adminReconciliation.utils";
import { FOCUS, ShortIdCopy, TxnStatusPill } from "./TransactionParts";
import { providerLabel, purposeLabel, PROVIDER_LABELS, PURPOSE_LABELS, STATUS_LABEL } from "./transactionsLabels";
import { PAYMENT_PROVIDERS, PAYMENT_PURPOSES, PAYMENT_STATUSES, type TxnSummary } from "./transactionsTypes";
import { MAX_Q_LENGTH, hasActiveFilters, pageCount, type TransactionFilters } from "./transactionsUrlState";

const FIELD = `min-h-11 w-full rounded-lg border border-adm-border bg-adm-surface px-3 text-sm text-adm-text xl:min-h-9 ${FOCUS}`;
const LABEL = "mb-1 block text-xs font-medium text-adm-text-2";

// ───────────────────────────────────────────────────────────────── bộ lọc ──
export function TransactionFiltersBar({ filters, onChange }: { filters: TransactionFilters; onChange: (patch: Partial<TransactionFilters>) => void }) {
  // The search box is submitted (Enter / button), not live: one request per search, not per keystroke.
  const [draft, setDraft] = useState(filters.q);
  useEffect(() => setDraft(filters.q), [filters.q]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onChange({ q: draft.trim() });
  };
  const active = hasActiveFilters(filters);

  return (
    <form onSubmit={submit} role="search" aria-label="Lọc giao dịch" data-testid="admin-transactions-filters" className="space-y-3 rounded-xl border border-adm-border bg-adm-surface p-3 shadow-adm-card sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="txn-q" className={LABEL}>Tìm đúng mã</label>
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-adm-text-2" aria-hidden />
            <input
              id="txn-q"
              type="search"
              value={draft}
              maxLength={MAX_Q_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Mã giao dịch, mã cổng, người trả, hợp đồng, hội viên, phòng gym hoặc PT"
              data-testid="admin-transactions-q"
              className={`${FIELD} pl-9`}
            />
          </div>
          <p className="mt-1 text-[11px] text-adm-text-2">Chỉ khớp chính xác toàn bộ mã (dán mã đầy đủ), không tìm theo một phần.</p>
        </div>
        <button type="submit" className={`min-h-11 rounded-lg bg-adm-text px-4 text-sm font-semibold text-adm-bg xl:min-h-9 ${FOCUS}`}>
          Tìm
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div>
          <label htmlFor="txn-status" className={LABEL}>Trạng thái</label>
          <select id="txn-status" value={filters.status ?? ""} onChange={(e) => onChange({ status: e.target.value || null })} data-testid="admin-transactions-status" className={FIELD}>
            <option value="">Tất cả</option>
            {PAYMENT_STATUSES.map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="txn-provider" className={LABEL}>Cổng thanh toán</label>
          <select id="txn-provider" value={filters.provider ?? ""} onChange={(e) => onChange({ provider: e.target.value || null })} data-testid="admin-transactions-provider" className={FIELD}>
            <option value="">Tất cả</option>
            {PAYMENT_PROVIDERS.map((p) => (<option key={p} value={p}>{PROVIDER_LABELS[p]}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="txn-purpose" className={LABEL}>Loại giao dịch</label>
          <select id="txn-purpose" value={filters.purpose ?? ""} onChange={(e) => onChange({ purpose: e.target.value || null })} data-testid="admin-transactions-purpose" className={FIELD}>
            <option value="">Tất cả</option>
            {PAYMENT_PURPOSES.map((p) => (<option key={p} value={p}>{PURPOSE_LABELS[p]}</option>))}
          </select>
        </div>
        <div>
          <label htmlFor="txn-from" className={LABEL}>Từ ngày</label>
          <input id="txn-from" type="date" value={filters.from ?? ""} max={filters.to ?? undefined} onChange={(e) => onChange({ from: e.target.value || null })} data-testid="admin-transactions-from" className={FIELD} />
        </div>
        <div>
          <label htmlFor="txn-to" className={LABEL}>Đến hết ngày</label>
          <input id="txn-to" type="date" value={filters.to ?? ""} min={filters.from ?? undefined} onChange={(e) => onChange({ to: e.target.value || null })} data-testid="admin-transactions-to" className={FIELD} />
        </div>
      </div>

      {active && (
        <button
          type="button"
          data-testid="admin-transactions-clear"
          onClick={() => { setDraft(""); onChange({ q: "", status: null, provider: null, purpose: null, from: null, to: null }); }}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-adm-border px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 xl:min-h-9 ${FOCUS}`}
        >
          <XIcon className="size-3.5" aria-hidden /> Xoá bộ lọc
        </button>
      )}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────── bảng ──
/** What the row relates to: the contract, the membership, or the original of a refund. Short id only. */
export function relatedOf(t: TxnSummary): { label: string; id: string; copyLabel: string }[] {
  const out: { label: string; id: string; copyLabel: string }[] = [];
  if (t.ptContractId) out.push({ label: "Hợp đồng PT", id: t.ptContractId, copyLabel: "mã hợp đồng" });
  if (t.membershipId) out.push({ label: "Hội viên", id: t.membershipId, copyLabel: "mã gói hội viên" });
  if (t.refundOfTransactionId) out.push({ label: "Hoàn cho", id: t.refundOfTransactionId, copyLabel: "mã giao dịch gốc" });
  return out;
}

function Related({ t }: { t: TxnSummary }) {
  const rel = relatedOf(t);
  if (rel.length === 0) return <span className="text-adm-text-2">—</span>;
  return (
    <div className="space-y-0.5">
      {rel.map((r) => (
        <div key={r.label} className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="shrink-0 text-adm-text-2">{r.label}</span>
          <ShortIdCopy id={r.id} label={r.copyLabel} />
        </div>
      ))}
    </div>
  );
}

const COLS = "xl:grid-cols-[9rem_minmax(0,1.3fr)_8.5rem_7rem_9rem_minmax(0,1fr)_minmax(0,1.2fr)]";

function OpenButton({ t, onOpen, children }: { t: TxnSummary; onOpen: (id: string) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-open-txn={t.id}
      onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}
      aria-label={`Mở chi tiết giao dịch ${purposeLabel(t.purpose)} ${formatMoneyExact(t.amount)}`}
      className={`min-h-11 rounded-md text-left text-sm text-adm-text underline-offset-4 hover:underline xl:min-h-8 ${FOCUS}`}
    >
      {children}
    </button>
  );
}

export function TransactionsTable({ rows, activeId, onOpen, dimmed }: { rows: TxnSummary[]; activeId: string | null; onOpen: (id: string) => void; dimmed: boolean }) {
  return (
    <div
      role="table"
      aria-label="Danh sách giao dịch"
      aria-busy={dimmed}
      data-testid="admin-transactions-list"
      className={`overflow-hidden rounded-xl border border-adm-border bg-adm-surface shadow-adm-card transition-opacity motion-reduce:transition-none ${dimmed ? "opacity-60" : ""}`}
    >
      <div role="row" className={`hidden gap-x-3 border-b border-adm-border bg-adm-surface-2 px-4 py-2.5 text-xs font-semibold text-adm-text-2 xl:grid ${COLS}`}>
        <div role="columnheader">Thời gian</div>
        <div role="columnheader">Loại giao dịch</div>
        <div role="columnheader">Trạng thái</div>
        <div role="columnheader">Cổng</div>
        <div role="columnheader" className="text-right">Số tiền</div>
        <div role="columnheader">Người trả</div>
        <div role="columnheader">Liên quan</div>
      </div>
      <div role="rowgroup">
        {rows.map((t) => (
          <div
            key={t.id}
            role="row"
            data-testid="admin-transactions-row"
            aria-selected={activeId === t.id}
            onClick={(e) => { (e.currentTarget.querySelector("[data-open-txn]") as HTMLElement | null)?.focus(); onOpen(t.id); }}
            className={`grid cursor-pointer grid-cols-1 gap-x-3 gap-y-2 border-t border-adm-border-soft px-4 py-3 first:border-t-0 hover:bg-adm-surface-2 xl:items-center ${COLS} ${activeId === t.id ? "bg-adm-surface-2" : ""}`}
          >
            <div role="cell" className="flex items-start justify-between gap-3 xl:block">
              <OpenButton t={t} onOpen={onOpen}><span className="tabular-nums">{formatDateTimeVi(t.createdAt)}</span></OpenButton>
              {/* Phone: status + amount sit on the first line, like a card header. */}
              <div className="flex flex-col items-end gap-1 xl:hidden">
                <span className="text-sm font-semibold tabular-nums text-adm-text">{formatMoneyExact(t.amount)}</span>
                <TxnStatusPill status={t.status} />
              </div>
            </div>
            <div role="cell" className="min-w-0 text-sm text-adm-text">
              <span className="xl:hidden text-xs text-adm-text-2">Loại: </span>{purposeLabel(t.purpose)}
            </div>
            <div role="cell" className="hidden xl:block"><TxnStatusPill status={t.status} /></div>
            <div role="cell" className="text-sm text-adm-text">
              <span className="xl:hidden text-xs text-adm-text-2">Cổng: </span>{providerLabel(t.provider)}
            </div>
            <div role="cell" className="hidden text-right text-sm font-semibold tabular-nums text-adm-text xl:block">{formatMoneyExact(t.amount)}</div>
            <div role="cell" className="flex min-w-0 items-center gap-1.5 text-xs">
              <span className="text-adm-text-2 xl:hidden">Người trả</span>
              <ShortIdCopy id={t.payerId} label="mã người trả" />
            </div>
            <div role="cell" className="min-w-0"><Related t={t} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyList({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div data-testid="admin-transactions-empty" className="rounded-xl border border-dashed border-adm-border bg-adm-surface py-14 text-center">
      <MoneyIcon className="mx-auto mb-3 size-10 text-adm-text-2" aria-hidden />
      <p className="text-sm text-adm-text">{filtered ? "Không có giao dịch nào khớp bộ lọc hiện tại." : "Chưa có giao dịch nào."}</p>
      {filtered && (
        <button type="button" onClick={onClear} className={`mt-3 min-h-11 rounded-md px-3 text-sm font-medium text-primary underline underline-offset-4 xl:min-h-8 ${FOCUS}`}>
          Xoá bộ lọc
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────── phân trang ──
export function Pager({ page, total, hasMore, shown, onPage }: { page: number; total: number; hasMore: boolean; shown: number; onPage: (p: number) => void }) {
  const pages = pageCount(total);
  const btn = `inline-flex min-h-11 items-center gap-1 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 disabled:cursor-not-allowed disabled:opacity-50 xl:min-h-9 ${FOCUS}`;
  return (
    <nav aria-label="Phân trang giao dịch" data-testid="admin-transactions-pager" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-adm-text-2" aria-live="polite">
        Trang <span className="tabular-nums text-adm-text">{page}</span> / <span className="tabular-nums">{pages}</span> · <span className="tabular-nums">{total.toLocaleString("vi-VN")}</span> giao dịch
        {shown > 0 && <> · đang hiện {shown}</>}
      </p>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="admin-transactions-prev">
          <CaretLeftIcon className="size-4" aria-hidden /> Trang trước
        </button>
        <button type="button" className={btn} disabled={!hasMore} onClick={() => onPage(page + 1)} data-testid="admin-transactions-next">
          Trang sau <CaretRightIcon className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
