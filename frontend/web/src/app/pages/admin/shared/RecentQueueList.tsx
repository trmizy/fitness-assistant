import type { ReactNode } from "react";
import { AdminLink } from "../../../components/layout/admin/AdminLink";

/**
 * Admin redesign (Master Plan §2.1 / §5, prototype spec §7.3) — "RecentQueueList": the newest item of each work queue,
 * one row per queue (kind pill, bold title, small caption, relative time on the right, hairline separators).
 *
 * It is NOT an activity feed: every row is "the newest item inside that queue's own bounded result" and the panel says so
 * at the bottom (`sourceNote`, mandatory). A queue that could not be read is named in `failedQueues` — it never
 * silently vanishes and an empty panel is only shown when every queue was read and all were empty (G-23).
 */
export interface RecentQueueItem {
  key: string;
  /** Queue name as a small pill: "Rút tiền", "Chi nhánh"… */
  kind: string;
  title: string;
  caption: string;
  /** ms epoch of the item's queue-entry time; the row shows its relative text + absolute time as a tooltip. */
  at: number;
  /** Relative text already formatted by the caller ("35 phút trước"). */
  agoText: string;
  /** Absolute time already formatted by the caller (tooltip + `<time>`). */
  absoluteText: string;
  to: string;
}

export interface RecentQueueListProps {
  title: string;
  description?: string;
  headingId: string;
  items: RecentQueueItem[];
  /** Mandatory: where the rows come from and what they are not. */
  sourceNote: ReactNode;
  /** Queues still loading (rows of the others already show). */
  loadingCount?: number;
  /** Names of queues that failed — said out loud, never hidden. */
  failedQueues?: string[];
  /** Every queue was read OK and none has an item. */
  allEmpty?: boolean;
  testId?: string;
  className?: string;
}

export function RecentQueueList({ title, description, headingId, items, sourceNote, loadingCount = 0, failedQueues = [], allEmpty = false, testId, className = "" }: RecentQueueListProps) {
  const noData = items.length === 0;
  return (
    <section aria-labelledby={headingId} data-testid={testId} className={`rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card sm:p-5 ${className}`}>
      <h2 id={headingId} className="text-base font-bold text-adm-text">
        {title}
      </h2>
      {description && <p className="mt-0.5 text-[13px] text-adm-text-2">{description}</p>}

      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-adm-border-soft">
          {items.map((it) => (
            <li key={it.key} data-testid={`recent-${it.key}`}>
              <AdminLink
                to={it.to}
                className="flex min-h-14 items-start gap-3 py-3 text-adm-text no-underline hover:bg-adm-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--adm-focus)] sm:items-center"
              >
                <span className="mt-0.5 inline-flex w-[84px] shrink-0 justify-center rounded-full bg-adm-surface-2 px-2 py-1 text-center text-[11px] font-semibold leading-tight text-adm-text sm:mt-0">{it.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold">{it.title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-adm-text-2">{it.caption}</span>
                </span>
                <time dateTime={new Date(it.at).toISOString()} title={it.absoluteText} className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-adm-text-2">
                  {it.agoText}
                </time>
              </AdminLink>
            </li>
          ))}
        </ul>
      )}

      {loadingCount > 0 && (
        <div role="status" aria-busy="true" data-testid={testId ? `${testId}-loading` : undefined} className="mt-3 space-y-2">
          <span className="sr-only">Đang tải các hàng đợi</span>
          {Array.from({ length: noData ? Math.min(loadingCount, 5) : 1 }).map((_, i) => (
            <div key={i} aria-hidden className="h-12 animate-pulse rounded-lg bg-adm-surface-2 motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {allEmpty && loadingCount === 0 && failedQueues.length === 0 && noData && (
        <p data-testid={testId ? `${testId}-empty` : undefined} className="mt-3 rounded-lg bg-adm-surface-2 px-3.5 py-6 text-center text-sm text-adm-text-2">
          Không có mục nào đang chờ trong các hàng đợi đã đọc.
        </p>
      )}

      {failedQueues.length > 0 && (
        <p data-testid={testId ? `${testId}-failed` : undefined} role="status" className="mt-3 rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2 text-xs text-st-warning">
          {noData ? "Không đọc được: " : "Chưa đọc được hàng đợi: "}
          {failedQueues.join(", ")}. Mục mới của các hàng đợi này chưa hiện — không có nghĩa là hàng đợi trống.
        </p>
      )}

      <p data-testid={testId ? `${testId}-source` : undefined} className="mt-3 text-xs leading-relaxed text-adm-text-2">
        {sourceNote}
      </p>
    </section>
  );
}
