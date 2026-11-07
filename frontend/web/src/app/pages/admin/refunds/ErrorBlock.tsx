import { ArrowClockwiseIcon, LockKeyIcon, WarningCircleIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { Button } from "../../../components/ui/button";
import type { AdminErrorView } from "../shared/useAdminError";

/**
 * Error panel of "Tài chính › Hoàn tiền" in the admin tokens (the shared `ui/ErrorState` is hard-wired to zinc and
 * has a light-theme contrast problem). A failed load is ALWAYS this, never an empty state.
 */
export function ErrorBlock({
  view,
  message,
  onRetry,
  testId,
  className = "py-10",
}: {
  view: AdminErrorView;
  message: string;
  onRetry?: () => void;
  testId: string;
  className?: string;
}) {
  const forbidden = view.kind === "forbidden" || view.kind === "unauthorized";
  const Icon = forbidden ? LockKeyIcon : view.kind === "network" ? WifiSlashIcon : WarningCircleIcon;
  const title = forbidden
    ? "Không có quyền xem"
    : view.kind === "network"
      ? "Mất kết nối mạng"
      : view.kind === "server"
        ? "Máy chủ đang gặp sự cố"
        : "Không tải được dữ liệu";
  return (
    <div
      data-testid={testId}
      className={`flex flex-col items-center gap-3 rounded-xl border border-st-danger-border bg-st-danger-bg px-6 text-center ${className}`}
    >
      <Icon className="size-8 text-st-danger" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-st-danger">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-adm-text">{forbidden ? "Tài khoản này không có quyền xem dữ liệu này." : message}</p>
      </div>
      {onRetry && !forbidden && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="min-h-11 xl:min-h-8">
          <ArrowClockwiseIcon aria-hidden /> Thử lại
        </Button>
      )}
    </div>
  );
}
