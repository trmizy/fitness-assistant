import { ArrowClockwiseIcon, CaretLeftIcon, CaretRightIcon, LockKeyIcon, WarningCircleIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { describeAdminError } from "../../shared/useAdminError";
import { Pill } from "../../shared/b9bPill";
import { isMalformedResponse } from "../transactions/transactionsApi";
import { FOCUS, ShortIdCopy } from "../transactions/TransactionParts";
import { walletOwnerTitle, walletStatusLabel, walletStatusTone } from "./walletLabels";

export { FOCUS };

export function WalletStatusPill({ status }: { status: string }) {
  return <Pill tone={walletStatusTone(status)}>{walletStatusLabel(status)}</Pill>;
}

/**
 * "Who owns this wallet": the owner's role + the short owner id with a copy button. A platform wallet is named by what it
 * is for ("Ví giữ hộ …") and its internal id (ESCROW / REVENUE) is never printed as if it were a user id.
 */
export function WalletOwner({ ownerType, ownerId }: { ownerType: string; ownerId: string }) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium text-adm-text" data-testid="admin-wallet-owner-title">{walletOwnerTitle(ownerType, ownerId)}</div>
      {ownerType !== "PLATFORM" && (
        <div className="text-xs text-adm-text-2">
          <ShortIdCopy id={ownerId} label="mã chủ ví" />
        </div>
      )}
    </div>
  );
}

/**
 * Load-failure block. A failed or unreadable read is NEVER shown as an empty list or a zero: the sentence says the
 * figures are unknown, and there is a retry.
 */
export function WalletLoadError({ error, what, onRetry, testId }: { error: unknown; what: string; onRetry: () => void; testId: string }) {
  const view = describeAdminError(error, { action: "read" });
  const forbidden = view.kind === "forbidden" || view.kind === "unauthorized";
  const malformed = isMalformedResponse(error);
  const notFound = view.kind === "not-found";
  const Icon = forbidden ? LockKeyIcon : view.kind === "network" ? WifiSlashIcon : WarningCircleIcon;
  const title = forbidden ? "Không có quyền xem" : notFound ? "Không tìm thấy ví" : view.kind === "network" ? "Mất kết nối mạng" : `Không tải được ${what}`;
  const message = forbidden
    ? "Tài khoản này không có quyền xem dữ liệu ví."
    : malformed
      ? `Máy chủ trả về ${what} không đọc được. Chưa biết số dư — đây không phải “ví trống”.`
      : notFound
        ? "Không tìm thấy ví với mã này (mã sai hoặc đã bị xoá)."
        : `${view.message} Chưa biết số dư — đây không phải “ví trống”.`;
  return (
    <div data-testid={testId} role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-st-danger-border bg-st-danger-bg px-6 py-10 text-center">
      <Icon className="size-8 text-st-danger" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-st-danger">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-adm-text">{message}</p>
      </div>
      {!forbidden && !notFound && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="min-h-11 xl:min-h-8">
          <ArrowClockwiseIcon aria-hidden /> Thử lại
        </Button>
      )}
    </div>
  );
}

/** Page X / Y pager shared by the wallet list and the drawer's entries. */
export function PagerBar({
  label,
  testIdPrefix,
  page,
  pages,
  total,
  noun,
  hasMore,
  shown,
  onPage,
}: {
  label: string;
  testIdPrefix: string;
  page: number;
  pages: number;
  total: number;
  noun: string;
  hasMore: boolean;
  shown: number;
  onPage: (p: number) => void;
}) {
  const btn = `inline-flex min-h-11 items-center gap-1 rounded-lg border border-adm-border bg-adm-surface px-3 text-sm font-medium text-adm-text hover:bg-adm-surface-2 disabled:cursor-not-allowed disabled:opacity-50 xl:min-h-9 ${FOCUS}`;
  return (
    <nav aria-label={label} data-testid={`${testIdPrefix}-pager`} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-adm-text-2" aria-live="polite">
        Trang <span className="tabular-nums text-adm-text">{page}</span> / <span className="tabular-nums">{pages}</span> · <span className="tabular-nums">{total.toLocaleString("vi-VN")}</span> {noun}
        {shown > 0 && <> · đang hiện {shown}</>}
      </p>
      <div className="flex gap-2">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid={`${testIdPrefix}-prev`}>
          <CaretLeftIcon className="size-4" aria-hidden /> Trang trước
        </button>
        <button type="button" className={btn} disabled={!hasMore} onClick={() => onPage(page + 1)} data-testid={`${testIdPrefix}-next`}>
          Trang sau <CaretRightIcon className="size-4" aria-hidden />
        </button>
      </div>
    </nav>
  );
}
