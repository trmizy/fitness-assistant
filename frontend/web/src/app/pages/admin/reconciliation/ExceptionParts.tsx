import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { CaretDownIcon, CaretRightIcon, CheckCircleIcon, ClockIcon, InfoIcon, WarningIcon } from "@phosphor-icons/react";
import { GROUP_BY_TEST_ID, LEVEL_EXPLAIN, type ExceptionTone, type ReconLevel } from "./reconciliationView";

/**
 * Building blocks of the "Ngoại lệ" chip: a collapsible exception group (header = title · level/source · severity ·
 * count), the table/card list inside, and the shared state chips. Colours are the B2 tokens (`--adm-*`, `--st-*`) so the
 * light and dark themes both work; severity is always text + icon, never colour alone. Read-only — no action here.
 */

export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

// ───────────────────────────────────────────────────── mở / thu gọn tất cả ──
export interface ExpandControl {
  /** Bumps on every "Mở hết" / "Thu gọn hết" click so a group that was toggled by hand still follows. */
  epoch: number;
  mode: "default" | "all" | "none";
}
export const ExpandContext = createContext<ExpandControl>({ epoch: 0, mode: "default" });

// ───────────────────────────────────────────────────────────── bảng / thẻ ──
export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  right?: boolean;
}

/** Bảng từ `sm` trở lên; thẻ xếp dọc (nhãn: giá trị) ở màn hình hẹp 360–412px, không cuộn ngang trang. */
export function Rows<T>({ rows, columns, rowKey }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string }) {
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-adm-border bg-adm-surface-2 text-left text-adm-text-2">
              {columns.map((c) => (
                <th key={c.header} scope="col" className={`px-2 py-2 font-semibold ${c.right ? "text-right" : ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="border-b border-adm-border-soft align-top text-adm-text last:border-0">
                {columns.map((c) => (
                  <td key={c.header} className={`px-2 py-2 ${c.right ? "text-right tabular-nums" : ""}`}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 sm:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="space-y-1 rounded-lg border border-adm-border bg-adm-surface-2 p-2.5 text-xs">
            {columns.map((c, i) => (
              <div key={c.header} className={i === 0 ? "font-semibold text-adm-text" : "flex justify-between gap-3"}>
                {i === 0 ? (
                  c.cell(r)
                ) : (
                  <>
                    <span className="shrink-0 text-adm-text-2">{c.header}</span>
                    <span className="min-w-0 break-words text-right text-adm-text">{c.cell(r)}</span>
                  </>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

// ─────────────────────────────────────────────────────────── viên nhỏ ──
const PILL = "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold";

/** "L1 · P13" — level of the figure and where it comes from. The title attribute spells it out. */
export function LevelBadge({ level, source }: { level: ReconLevel; source: string }) {
  const tone = level === "L1" ? "border-st-info-border bg-st-info-bg text-st-info" : "border-st-pending-border bg-st-pending-bg text-st-pending";
  return (
    <span data-testid="recon-level-badge" title={`${level} — ${LEVEL_EXPLAIN[level]}`} className={`${PILL} font-mono ${tone}`}>
      {level} · {source}
    </span>
  );
}

function SeverityPill({ active, tone }: { active: boolean; tone: ExceptionTone }) {
  if (!active)
    return (
      <span className={`${PILL} border-st-success-border bg-st-success-bg text-st-success`}>
        <CheckCircleIcon className="size-3.5" aria-hidden /> Không có
      </span>
    );
  if (tone === "critical")
    return (
      <span className={`${PILL} border-st-danger-border bg-st-danger-bg text-st-danger`}>
        <WarningIcon className="size-3.5" aria-hidden /> Cần xem ngay
      </span>
    );
  if (tone === "watch")
    return (
      <span className={`${PILL} border-st-warning-border bg-st-warning-bg text-st-warning`}>
        <ClockIcon className="size-3.5" aria-hidden /> Theo dõi
      </span>
    );
  return (
    <span className={`${PILL} border-st-neutral-border bg-st-neutral-bg text-st-neutral`}>
      <InfoIcon className="size-3.5" aria-hidden /> Thông tin
    </span>
  );
}

// ─────────────────────────────────────────────────────────── một nhóm ──
export function Block({
  testId,
  title,
  hint,
  count,
  tone,
  truncated,
  emptyText,
  children,
}: {
  testId: string;
  title: string;
  hint?: string;
  count: number;
  /** critical: đỏ khi count>0 · watch: vàng khi count>0 · neutral: thông tin, không phải cảnh báo */
  tone: ExceptionTone;
  truncated?: boolean;
  emptyText: string;
  children?: ReactNode;
}) {
  const def = GROUP_BY_TEST_ID[testId];
  const active = count > 0;
  const bodyId = useId();
  const ctrl = useContext(ExpandContext);
  // Groups that need eyes now start open; the rest start closed (their count + severity are on the header).
  const [open, setOpen] = useState(active && tone === "critical");
  useEffect(() => {
    if (ctrl.mode === "all") setOpen(true);
    else if (ctrl.mode === "none") setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the explicit click (epoch) should re-apply the mode
  }, [ctrl.epoch]);

  const headerInner = (
    <>
      {active && (open ? <CaretDownIcon className="mt-0.5 size-4 shrink-0 text-adm-text-2" aria-hidden /> : <CaretRightIcon className="mt-0.5 size-4 shrink-0 text-adm-text-2" aria-hidden />)}
      <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-adm-text">{title}</span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {def && <LevelBadge level={def.level} source={def.source} />}
        <SeverityPill active={active} tone={tone} />
        {active && truncated && (
          <span data-testid={`${testId}-truncated`} className={`${PILL} border-st-warning-border bg-st-warning-bg text-st-warning`}>
            <WarningIcon className="size-3.5" aria-hidden /> Chưa hiện hết
          </span>
        )}
        <span className="min-w-[3.5rem] text-right text-xs text-adm-text-2">
          <span data-testid={`${testId}-count`} className="text-sm font-bold tabular-nums text-adm-text">
            {count}
          </span>{" "}
          mục
        </span>
      </span>
    </>
  );

  return (
    <section data-testid={testId} data-open={active && open ? "true" : "false"} className="rounded-xl border border-adm-border bg-adm-surface shadow-adm-card">
      <h4 className="m-0">
        {active ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((v) => !v)}
            className={`flex min-h-12 w-full flex-wrap items-start gap-x-2 gap-y-1.5 rounded-xl px-4 py-3 text-left transition-colors hover:bg-adm-surface-2 motion-reduce:transition-none sm:flex-nowrap ${FOCUS}`}
          >
            {headerInner}
          </button>
        ) : (
          <div className="flex min-h-12 w-full flex-wrap items-start gap-x-2 gap-y-1.5 px-4 py-3 sm:flex-nowrap">{headerInner}</div>
        )}
      </h4>
      {active ? (
        <div id={bodyId} hidden={!open} className="space-y-2 border-t border-adm-border-soft px-4 pb-4 pt-3">
          {open && (
            <>
              {hint && <p className="text-[11px] leading-relaxed text-adm-text-2">{hint}</p>}
              {children}
              {truncated && <p className="text-[11px] text-st-warning">Chỉ hiện các mục đầu tiên; còn nhiều mục khác chưa hiển thị.</p>}
            </>
          )}
        </div>
      ) : (
        <p data-testid={`${testId}-empty`} className="flex items-center gap-1.5 px-4 pb-3 text-xs text-adm-text-2">
          <CheckCircleIcon className="size-3.5 shrink-0 text-st-success" aria-hidden /> {emptyText}
        </p>
      )}
    </section>
  );
}

export function GroupTitle({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-adm-text-2">{children}</h3>;
}

export function LoadError({ what, onRetry, testId }: { what: string; onRetry: () => void; testId?: string }) {
  return (
    <div data-testid={testId} role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-st-warning-border bg-st-warning-bg p-3">
      <p className="flex items-start gap-1.5 text-xs font-medium text-st-warning">
        <WarningIcon className="mt-px size-4 shrink-0" aria-hidden />
        <span>Không tải được {what}. Chưa biết có mục nào hay không — đây không phải “không có mục”.</span>
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={`inline-flex min-h-11 shrink-0 items-center rounded-lg border border-adm-border bg-adm-surface px-3 text-xs font-semibold text-adm-text hover:bg-adm-surface-2 lg:min-h-9 ${FOCUS}`}
      >
        Thử lại
      </button>
    </div>
  );
}
