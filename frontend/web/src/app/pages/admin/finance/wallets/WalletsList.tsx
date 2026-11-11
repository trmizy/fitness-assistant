import { useEffect, useState, type FormEvent } from "react";
import { MagnifyingGlassIcon, WalletIcon, XIcon } from "@phosphor-icons/react";
import { formatMoneyExact } from "../../adminFinanceOverview.utils";
import { formatDateTimeVi } from "../../adminReconciliation.utils";
import { OWNER_LABELS } from "../transactions/transactionsLabels";
import { FOCUS, PagerBar, WalletOwner, WalletStatusPill } from "./WalletParts";
import { WALLET_OWNER_TYPES, walletOwnerTitle } from "./walletLabels";
import { MAX_OWNER_ID_LENGTH, hasActiveFilters, pageCount, type WalletFilters } from "./walletsUrlState";
import type { WalletDto } from "./walletsTypes";

const FIELD = `min-h-11 w-full rounded-lg border border-adm-border bg-adm-surface px-3 text-sm text-adm-text xl:min-h-9 ${FOCUS}`;
const LABEL = "mb-1 block text-xs font-medium text-adm-text-2";

// ───────────────────────────────────────────────────────────────── bộ lọc ──
export function WalletFiltersBar({ filters, onChange }: { filters: WalletFilters; onChange: (patch: Partial<WalletFilters>) => void }) {
  // The owner id box is submitted (Enter / button), not live: one request per search, not per keystroke.
  const [draft, setDraft] = useState(filters.ownerId);
  useEffect(() => setDraft(filters.ownerId), [filters.ownerId]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onChange({ ownerId: draft.trim() });
  };
  const active = hasActiveFilters(filters);

  return (
    <form onSubmit={submit} role="search" aria-label="Tìm ví" data-testid="admin-wallets-filters" className="space-y-3 rounded-xl border border-adm-border bg-adm-surface p-3 shadow-adm-card sm:p-4">
      <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor="wallet-owner-type" className={LABEL}>Loại chủ ví</label>
          <select id="wallet-owner-type" value={filters.ownerType ?? ""} onChange={(e) => onChange({ ownerType: e.target.value || null })} data-testid="admin-wallets-owner-type" className={FIELD}>
            <option value="">Tất cả</option>
            {WALLET_OWNER_TYPES.map((t) => (<option key={t} value={t}>{OWNER_LABELS[t]}</option>))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="wallet-owner-id" className={LABEL}>Mã chủ ví (nhập đúng cả mã)</label>
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-adm-text-2" aria-hidden />
            <input
              id="wallet-owner-id"
              type="search"
              value={draft}
              maxLength={MAX_OWNER_ID_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Mã người dùng / PT / phòng gym, hoặc ESCROW, REVENUE"
              autoComplete="off"
              spellCheck={false}
              data-testid="admin-wallets-owner-id"
              className={`${FIELD} pl-9`}
            />
          </div>
        </div>
        <button
          type="submit"
          data-testid="admin-wallets-search"
          className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 xl:min-h-9 ${FOCUS}`}
        >
          <MagnifyingGlassIcon className="size-4" aria-hidden /> Tìm ví
        </button>
      </div>
      <p className="text-xs text-adm-text-2">Tìm khớp chính xác, không tìm theo một phần mã. Ví nền tảng: nhập ESCROW (ví giữ hộ) hoặc REVENUE (ví doanh thu).</p>
      {active && (
        <button
          type="button"
          data-testid="admin-wallets-clear"
          onClick={() => { setDraft(""); onChange({ ownerType: null, ownerId: "" }); }}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-adm-border px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 xl:min-h-9 ${FOCUS}`}
        >
          <XIcon className="size-3.5" aria-hidden /> Xoá bộ lọc
        </button>
      )}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────── bảng ──
const COLS = "xl:grid-cols-[minmax(0,1.3fr)_8rem_repeat(4,minmax(0,1fr))_9rem]";

function Balance({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 xl:block xl:text-right">
      <span className="text-xs text-adm-text-2 xl:hidden">{label}</span>
      <span className="text-sm tabular-nums text-adm-text">{formatMoneyExact(value)}</span>
    </div>
  );
}

export function WalletsTable({ rows, activeId, onOpen, dimmed }: { rows: WalletDto[]; activeId: string | null; onOpen: (id: string) => void; dimmed: boolean }) {
  return (
    <div
      role="table"
      aria-label="Danh sách ví"
      aria-busy={dimmed}
      data-testid="admin-wallets-list"
      className={`overflow-hidden rounded-xl border border-adm-border bg-adm-surface shadow-adm-card transition-opacity motion-reduce:transition-none ${dimmed ? "opacity-60" : ""}`}
    >
      <div role="row" className={`hidden gap-x-3 border-b border-adm-border bg-adm-surface-2 px-4 py-2.5 text-xs font-semibold text-adm-text-2 xl:grid ${COLS}`}>
        <div role="columnheader">Chủ ví</div>
        <div role="columnheader">Trạng thái</div>
        <div role="columnheader" className="text-right">Khả dụng</div>
        <div role="columnheader" className="text-right">Đang chờ</div>
        <div role="columnheader" className="text-right">Đang khóa</div>
        <div role="columnheader" className="text-right">Tạm giữ của PT</div>
        <div role="columnheader">Cập nhật</div>
      </div>
      <div role="rowgroup">
        {rows.map((w) => (
          <div
            key={w.id}
            role="row"
            data-testid="admin-wallets-row"
            aria-selected={activeId === w.id}
            onClick={(e) => { (e.currentTarget.querySelector("[data-open-wallet]") as HTMLElement | null)?.focus(); onOpen(w.id); }}
            className={`grid cursor-pointer grid-cols-1 gap-x-3 gap-y-1.5 border-t border-adm-border-soft px-4 py-3 first:border-t-0 hover:bg-adm-surface-2 xl:items-center ${COLS} ${activeId === w.id ? "bg-adm-surface-2" : ""}`}
          >
            <div role="cell" className="flex min-w-0 items-start justify-between gap-3 xl:block">
              <div className="min-w-0">
                <button
                  type="button"
                  data-open-wallet={w.id}
                  onClick={(e) => { e.stopPropagation(); onOpen(w.id); }}
                  aria-label={`Mở chi tiết ví ${walletOwnerTitle(w.ownerType, w.ownerId)}`}
                  className={`min-h-11 rounded-md text-left underline-offset-4 hover:underline xl:min-h-8 ${FOCUS}`}
                >
                  <WalletOwner ownerType={w.ownerType} ownerId={w.ownerId} />
                </button>
              </div>
              <div className="xl:hidden"><WalletStatusPill status={w.status} /></div>
            </div>
            <div role="cell" className="hidden xl:block"><WalletStatusPill status={w.status} /></div>
            <div role="cell"><Balance label="Khả dụng" value={w.availableBalance} /></div>
            <div role="cell"><Balance label="Đang chờ" value={w.pendingBalance} /></div>
            <div role="cell"><Balance label="Đang khóa" value={w.lockedBalance} /></div>
            <div role="cell"><Balance label="Tạm giữ của PT" value={w.holdbackBalance} /></div>
            <div role="cell" className="text-xs tabular-nums text-adm-text-2">
              <span className="xl:hidden">Cập nhật: </span>{formatDateTimeVi(w.updatedAt)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyWallets({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div data-testid="admin-wallets-empty" className="rounded-xl border border-dashed border-adm-border bg-adm-surface py-14 text-center">
      <WalletIcon className="mx-auto mb-3 size-10 text-adm-text-2" aria-hidden />
      <p className="text-sm text-adm-text">{filtered ? "Không có ví nào khớp. Kiểm tra lại loại chủ ví và mã (phải khớp chính xác)." : "Chưa có ví nào."}</p>
      {filtered && (
        <button type="button" onClick={onClear} className={`mt-3 min-h-11 rounded-md px-3 text-sm font-medium text-primary underline underline-offset-4 xl:min-h-8 ${FOCUS}`}>
          Xoá bộ lọc
        </button>
      )}
    </div>
  );
}

export function WalletsPager({ page, total, hasMore, shown, onPage }: { page: number; total: number; hasMore: boolean; shown: number; onPage: (p: number) => void }) {
  return <PagerBar label="Phân trang danh sách ví" testIdPrefix="admin-wallets" page={page} pages={pageCount(total)} total={total} noun="ví" hasMore={hasMore} shown={shown} onPage={onPage} />;
}
