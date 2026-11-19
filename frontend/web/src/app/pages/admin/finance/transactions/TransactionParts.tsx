import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowClockwiseIcon, CheckIcon, CopyIcon, LockKeyIcon, WarningCircleIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { Button } from "../../../../components/ui/button";
import { describeAdminError } from "../../shared/useAdminError";
import { Pill } from "../../shared/b9bPill";
import { isMalformedResponse } from "./transactionsApi";
import { shortId } from "./moneyJourney";
import { statusLabel, statusTone } from "./transactionsLabels";

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

/** Status pill: text + colour (never colour alone), Vietnamese label with a neutral fallback. */
export function TxnStatusPill({ status }: { status: string }) {
  return <Pill tone={statusTone(status)}>{statusLabel(status)}</Pill>;
}

/**
 * First 8 characters of an id + a copy button (the full id is never printed in a list — admins quote and paste it).
 * `label` names WHAT is copied for assistive tech ("Sao chép mã giao dịch").
 */
export function ShortIdCopy({ id, label = "mã" }: { id: string | null | undefined; label?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  if (!id) return <span className="text-adm-text-2">—</span>;
  const copy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setState("ok");
    } catch {
      setState("fail");
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 2000);
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="font-mono text-xs tabular-nums text-adm-text" title="Mã rút gọn — bấm biểu tượng bên cạnh để sao chép mã đầy đủ">{shortId(id)}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Sao chép ${label} đầy đủ`}
        className={`inline-flex size-11 shrink-0 items-center justify-center rounded-md text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text xl:size-7 ${FOCUS}`}
      >
        {state === "ok" ? <CheckIcon className="size-3.5 text-st-success" aria-hidden /> : <CopyIcon className="size-3.5" aria-hidden />}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "ok" ? "Đã sao chép" : state === "fail" ? "Chưa sao chép được" : ""}
      </span>
      {state === "fail" && <span className="text-[11px] text-st-danger">Chưa sao chép được</span>}
    </span>
  );
}

export function SkeletonBlock({ rows = 4, testId }: { rows?: number; testId: string }) {
  const bar = "animate-pulse rounded-md bg-adm-pill motion-reduce:animate-none";
  return (
    <div role="status" aria-busy="true" aria-label="Đang tải" data-testid={testId} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`${bar} h-14`} />
      ))}
      <span className="sr-only">Đang tải…</span>
    </div>
  );
}

/**
 * Load-failure block. A failed or unreadable read is NEVER shown as an empty list or a zero: the sentence says the
 * figures are unknown, and there is a retry.
 */
export function LoadError({ error, what, onRetry, testId }: { error: unknown; what: string; onRetry: () => void; testId: string }) {
  const view = describeAdminError(error, { action: "read" });
  const forbidden = view.kind === "forbidden" || view.kind === "unauthorized";
  const malformed = isMalformedResponse(error);
  const notFound = view.kind === "not-found";
  const Icon = forbidden ? LockKeyIcon : view.kind === "network" ? WifiSlashIcon : WarningCircleIcon;
  const title = forbidden
    ? "Không có quyền xem"
    : notFound
      ? "Không tìm thấy"
      : view.kind === "network"
        ? "Mất kết nối mạng"
        : `Không tải được ${what}`;
  const message = forbidden
    ? "Tài khoản này không có quyền xem dữ liệu giao dịch."
    : malformed
      ? `Máy chủ trả về ${what} không đọc được. Chưa biết dữ liệu — đây không phải “không có giao dịch”.`
      : notFound
        ? "Không tìm thấy giao dịch với mã này (mã sai hoặc đã bị xoá)."
        : `${view.message} Chưa biết dữ liệu — đây không phải “không có giao dịch”.`;
  return (
    <div data-testid={testId} role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-st-danger-border bg-st-danger-bg px-6 py-10 text-center">
      <Icon className="size-8 text-st-danger" aria-hidden />
      <div>
        <p className="text-sm font-semibold text-st-danger">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-adm-text">{message}</p>
      </div>
      {!forbidden && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="min-h-11 xl:min-h-8">
          <ArrowClockwiseIcon aria-hidden /> Thử lại
        </Button>
      )}
    </div>
  );
}

export function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="space-y-3 border-t border-adm-border-soft px-4 py-4 first:border-t-0 sm:px-5">
      <h3 className="text-sm font-semibold text-adm-text">{title}</h3>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="shrink-0 text-xs text-adm-text-2 sm:w-36">{label}</dt>
      <dd className="min-w-0 text-sm text-adm-text">{children}</dd>
    </div>
  );
}
