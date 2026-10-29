import type { ElementType } from "react";
import type { StatTone } from "../shared/StatTile";

/**
 * "Hôm nay" compact stat (prototype spec §7.3 row 2): icon tile on the left, a number, a one-line label. Like `StatTile`
 * it can be loading or failed — then the number is "—" and the reason is spoken, never "0".
 */
const ICON_TONE: Record<StatTone, string> = {
  info: "bg-st-info-bg text-st-info",
  neutral: "bg-st-neutral-bg text-st-neutral",
  success: "bg-st-success-bg text-st-success",
  danger: "bg-st-danger-bg text-st-danger",
  warning: "bg-st-warning-bg text-st-warning",
  pending: "bg-st-pending-bg text-st-pending",
};

export interface CompactStatProps {
  label: string;
  value: string | null;
  icon: ElementType;
  tone?: StatTone;
  status: "loading" | "error" | "ready";
  errorText?: string;
  dimmed?: boolean;
  testId: string;
}

export function CompactStat({ label, value, icon: Icon, tone = "neutral", status, errorText, dimmed, testId }: CompactStatProps) {
  const frame = "flex min-h-[76px] min-w-0 items-center gap-3 rounded-xl border border-adm-border bg-adm-surface px-4 py-3 shadow-adm-card";
  if (status === "loading") {
    return (
      <div data-testid={testId} data-state="loading" role="status" aria-busy="true" className={frame}>
        <span className="sr-only">Đang tải: {label}</span>
        <span aria-hidden className="size-10 shrink-0 rounded-[10px] bg-adm-pill" />
        <div aria-hidden className="min-w-0 flex-1 space-y-2">
          <div className="h-5 w-16 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
          <div className="h-3 w-28 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
        </div>
      </div>
    );
  }
  const failed = status === "error";
  return (
    <div data-testid={testId} data-state={failed ? "error" : "ready"} role="group" aria-label={failed ? `${label} — không tải được` : undefined} className={frame}>
      <span aria-hidden className={`flex size-10 shrink-0 items-center justify-center rounded-[10px] ${failed ? ICON_TONE.neutral : ICON_TONE[tone]}`}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div data-testid={`${testId}-value`} className={`text-[22px] font-bold leading-tight tabular-nums text-adm-text ${dimmed && !failed ? "opacity-70" : ""}`}>
          {failed ? "—" : (value ?? "—")}
        </div>
        <div className="text-[13px] leading-snug text-adm-text-2">{label}</div>
        {failed && <div className="mt-0.5 text-xs leading-snug text-adm-text-2">{errorText ?? "Không tải được. Chưa biết số liệu — không phải số bằng không."}</div>}
      </div>
    </div>
  );
}
