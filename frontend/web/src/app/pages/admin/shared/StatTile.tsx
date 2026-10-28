import type { ElementType, ReactNode } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";

/**
 * Admin redesign (Master Plan §2.4 / prototype spec §7.1) — "StatTile": a KPI card with a muted label, a large
 * tabular number, a small note and a tinted icon tile on the right. Colours are semantic tokens (`--st-*`,
 * `--adm-*`), never one-off hex. It deliberately has NO count-up / hover-lift animation (money must not animate)
 * and NEVER shows "0" for something that is loading, failed or unknown — `status` makes that a state, not a value.
 *
 * Not built on `components/ui/KpiCard`: that card is hard-wired to zinc/green/amber colours, a mono font, a
 * lift-on-hover animation and a translucent chip with a known light-theme contrast problem, and three other
 * dashboards depend on it as-is.
 */
export type StatTone = "info" | "neutral" | "success" | "danger" | "warning" | "pending";

const ICON_TONE: Record<StatTone, string> = {
  info: "bg-st-info-bg text-st-info",
  neutral: "bg-st-neutral-bg text-st-neutral",
  success: "bg-st-success-bg text-st-success",
  danger: "bg-st-danger-bg text-st-danger",
  warning: "bg-st-warning-bg text-st-warning",
  pending: "bg-st-pending-bg text-st-pending",
};

export type StatStatus = "ready" | "loading" | "error";

export interface StatTileProps {
  label: string;
  /** Already-formatted text ("590.800.000 ₫"). Ignored while loading / on error (shows "—"). */
  value?: string | null;
  note?: ReactNode;
  icon: ElementType;
  tone?: StatTone;
  status?: StatStatus;
  /** One sentence for `status="error"`: what failed, and that it does NOT mean the amount is 0. */
  errorText?: string;
  onRetry?: () => void;
  /** Slightly faded: the numbers are an older copy (stale / refreshing). */
  dimmed?: boolean;
  /** Red border — the figure itself is a problem (e.g. ledger drift). */
  danger?: boolean;
  /** `sm` for values that are text (a timestamp), not an amount. */
  valueSize?: "lg" | "sm";
  testId?: string;
  className?: string;
}

export function StatTile({
  label,
  value,
  note,
  icon: Icon,
  tone = "neutral",
  status = "ready",
  errorText,
  onRetry,
  dimmed,
  danger,
  valueSize = "lg",
  testId,
  className = "",
}: StatTileProps) {
  const frame = `min-h-[116px] min-w-0 rounded-xl border bg-adm-surface p-4 shadow-adm-card ${
    danger && status === "ready" ? "border-st-danger-border" : "border-adm-border"
  } ${className}`;

  if (status === "loading") {
    return (
      <div data-testid={testId} data-state="loading" role="status" aria-busy="true" className={frame}>
        <span className="sr-only">Đang tải: {label}</span>
        <div aria-hidden className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="h-3.5 w-28 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
            <div className="h-8 w-40 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
            <div className="h-3 w-32 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
          </div>
          <div className="size-10 shrink-0 rounded-[10px] bg-adm-pill" />
        </div>
      </div>
    );
  }

  const failed = status === "error";
  return (
    <div
      data-testid={testId}
      data-state={failed ? "error" : "ready"}
      role="group"
      aria-label={failed ? `${label} — không tải được` : undefined}
      className={`${frame}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-snug text-adm-text-2">{label}</div>
          <div
            data-testid={testId ? `${testId}-value` : undefined}
            className={`mt-1 break-words font-bold leading-tight tabular-nums text-adm-text transition-opacity motion-reduce:transition-none ${dimmed && !failed ? "opacity-70" : ""} ${
              valueSize === "sm" ? "text-lg" : "text-2xl sm:text-[28px]"
            }`}
          >
            {failed ? "—" : (value ?? "—")}
          </div>
          {failed ? (
            <div className="mt-1.5 text-xs leading-snug text-adm-text-2">
              {errorText ?? "Không tải được. Chưa biết số liệu — đây không phải số bằng không."}
            </div>
          ) : note ? (
            <div className="mt-1.5 text-xs leading-snug text-adm-text-2">{note}</div>
          ) : null}
          {failed && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text hover:bg-adm-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)] lg:min-h-9"
            >
              <ArrowClockwiseIcon className="size-3.5" aria-hidden /> Thử lại
            </button>
          )}
        </div>
        <span
          aria-hidden
          className={`flex size-10 shrink-0 items-center justify-center rounded-[10px] ${failed ? ICON_TONE.neutral : ICON_TONE[tone]}`}
        >
          <Icon className="size-5" />
        </span>
      </div>
    </div>
  );
}
