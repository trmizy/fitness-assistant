import type { ReactNode } from "react";

export type PillTone = "success" | "pending" | "danger" | "warning" | "info" | "neutral";

const TONE: Record<PillTone, string> = {
  success: "border-st-success-border bg-st-success-bg text-st-success",
  pending: "border-st-pending-border bg-st-pending-bg text-st-pending",
  danger: "border-st-danger-border bg-st-danger-bg text-st-danger",
  warning: "border-st-warning-border bg-st-warning-bg text-st-warning",
  info: "border-st-info-border bg-st-info-bg text-st-info",
  neutral: "border-st-neutral-border bg-st-neutral-bg text-st-neutral",
};

/** B9b — generic status/role pill on the admin status tokens (`--st-*`), AA contrast in both themes. Text always carries the meaning. */
export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>{children}</span>;
}
