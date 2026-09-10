import { WarningCircleIcon, WifiSlashIcon, LockKeyIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "./button";
import { cn } from "./utils";

export type ErrorKind = "network" | "forbidden" | "not-found" | "server" | "generic";

const KIND_META: Record<ErrorKind, { icon: typeof WarningCircleIcon; title: string }> = {
  network: { icon: WifiSlashIcon, title: "Mất kết nối mạng" },
  forbidden: { icon: LockKeyIcon, title: "Không có quyền truy cập" },
  "not-found": { icon: WarningCircleIcon, title: "Không tìm thấy" },
  server: { icon: WarningCircleIcon, title: "Máy chủ đang gặp sự cố" },
  generic: { icon: WarningCircleIcon, title: "Đã có lỗi xảy ra" },
};

export interface ErrorStateProps {
  kind?: ErrorKind;
  /** A short, human sentence — never the raw backend exception (§52). */
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * GYM_MANAGEMENT master spec §52 — shared error UX. Note per spec: a MANAGER should almost
 * never see the `forbidden` variant, because OWNER-only features should be hidden from their
 * nav/UI entirely rather than shown-then-blocked — reach for this only for a genuine
 * unexpected 403 (e.g. a stale scoped-branch link), not as the normal MANAGER experience.
 */
export function ErrorState({ kind = "generic", message, onRetry, className }: ErrorStateProps) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <div className={cn("flex flex-col items-center justify-center text-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-10", className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
        <Icon className="size-6" />
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-200">{meta.title}</p>
        {message && <p className="text-xs text-zinc-500 mt-1 max-w-sm">{message}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <ArrowClockwiseIcon className="size-4" />
          Thử lại
        </Button>
      )}
    </div>
  );
}
