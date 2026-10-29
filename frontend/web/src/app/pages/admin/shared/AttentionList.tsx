import type { ReactNode } from "react";
import { AdminLink } from "../../../components/layout/admin/AdminLink";

/**
 * Admin redesign (Master Plan §2.4, prototype spec §7.3/§7.4) — "AttentionList": a panel of grey rounded rows
 * (title, a small detail line, a count pill on the right), each row a real link to the screen that handles it.
 *
 * Counts are counts — a row never sums money it does not own (reconciliation exceptions are counted, not added up).
 * A row whose source failed shows "—" and says so; it never shows "0" / "không có yêu cầu" for an unknown queue.
 */
export type AttentionTone = "danger" | "warning" | "neutral";

const DOT: Record<AttentionTone, string> = {
  danger: "bg-st-danger",
  warning: "bg-st-warning",
  neutral: "bg-adm-text-2",
};

export interface AttentionItem {
  key: string;
  title: string;
  /** Route the row opens. */
  to: string;
  status?: "ready" | "loading" | "error";
  /** Item count; `null`/`undefined` while loading or on error. */
  count?: number | null;
  /** Overrides the pill text (e.g. "≥100" when the source is capped). */
  countText?: string;
  /** Second line: "Cũ nhất 5 ngày · Tổng 23.500.000 ₫". */
  detail?: ReactNode;
  /** `status="error"` only. */
  errorText?: string;
  /** Dot before the title; drawn only when there is something to do (count > 0). */
  tone?: AttentionTone;
}

export interface AttentionListProps {
  title: string;
  description?: string;
  items: AttentionItem[];
  headingId: string;
  testId?: string;
  className?: string;
}

export function AttentionList({ title, description, items, headingId, testId, className = "" }: AttentionListProps) {
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={`rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card sm:p-5 ${className}`}
    >
      <h2 id={headingId} className="text-base font-bold text-adm-text">
        {title}
      </h2>
      {description && <p className="mt-0.5 text-[13px] text-adm-text-2">{description}</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((it) => {
          const status = it.status ?? "ready";
          if (status === "loading") {
            return (
              // role="status" lives on an inner div, NOT on the <li>: an <li> with its own role breaks the "list" axe rule (B3b).
              <li key={it.key} data-testid={`attention-${it.key}`} data-state="loading">
                <div role="status" aria-busy="true">
                  <span className="sr-only">Đang tải: {it.title}</span>
                  <div aria-hidden className="flex min-h-14 items-center justify-between gap-3 rounded-lg bg-adm-surface-2 px-3.5 py-3">
                    <div className="space-y-2">
                      <div className="h-3.5 w-40 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
                      <div className="h-3 w-28 animate-pulse rounded bg-adm-pill motion-reduce:animate-none" />
                    </div>
                    <div className="size-7 rounded-full bg-adm-pill" />
                  </div>
                </div>
              </li>
            );
          }
          const failed = status === "error";
          const hasWork = !failed && (it.count ?? 0) > 0;
          const pill = failed ? "—" : (it.countText ?? String(it.count ?? "—"));
          return (
            <li key={it.key} data-testid={`attention-${it.key}`} data-state={failed ? "error" : "ready"}>
              <AdminLink
                to={it.to}
                className="flex min-h-14 items-center justify-between gap-3 rounded-lg bg-adm-surface-2 px-3.5 py-3 text-adm-text no-underline transition-colors hover:bg-adm-pill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)] motion-reduce:transition-none"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {hasWork && it.tone && <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[it.tone]}`} />}
                    <span className="min-w-0 break-words">{it.title}</span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-adm-text-2">
                    {failed ? (it.errorText ?? "Không tải được — chưa biết hàng đợi này có bao nhiêu mục.") : it.detail}
                  </span>
                </span>
                <span
                  data-testid={`attention-${it.key}-count`}
                  className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full border border-adm-border bg-adm-surface px-2 text-xs font-bold tabular-nums text-adm-text"
                >
                  <span className="sr-only">Số mục: </span>
                  {pill}
                </span>
              </AdminLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
