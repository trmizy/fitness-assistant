/**
 * Small pieces shared by the Gym Owner charts: range switch, tooltip, delta chip, skeleton, table fallback, horizontal bars.
 * Colours come only from the workspace tokens (--go-*) so light and dark follow the theme.
 */
import type { ReactNode } from "react";
import { MinusIcon, TrendDownIcon, TrendUpIcon } from "@phosphor-icons/react";
import type { PeriodComparison } from "./chartsModel";

/** Segmented single-choice switch (the same `go-seg` buttons as the Hội viên filter). */
export function RangeSwitch<T extends string | number>({ label, value, options, onChange, testId }: { label: string; value: T; options: { value: T; text: string }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="go-seg go-chart-seg" role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} data-value={String(o.value)}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** "↗ +12% so với 30 ngày trước": an icon AND a sign, so the direction never depends on colour. */
export function DeltaChip({ comparison, text }: { comparison: PeriodComparison; text: string }) {
  const dir = comparison.kind === "change" ? comparison.direction : "none";
  const Icon = dir === "up" ? TrendUpIcon : dir === "down" ? TrendDownIcon : MinusIcon;
  return (
    <span className="go-chart-delta" data-dir={dir} data-testid="go-chart-delta">
      <Icon aria-hidden="true" width={16} height={16} />
      <span>{text}</span>
    </span>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="go-chart-skel" aria-hidden="true" style={{ height }} data-testid="go-chart-skeleton">
      <span className="go-skel-bar" style={{ width: "30%" }} />
      <span className="go-skel-bar" data-size="block" style={{ height: height - 48 }} />
    </div>
  );
}

/** A state that is not a chart: failed / partial / nothing to show. */
export function ChartState({ tone, title, text, onRetry, testId }: { tone?: "risk"; title: string; text?: string; onRetry?: () => void; testId?: string }) {
  return (
    <div className="go-chart-state" data-tone={tone} role={tone === "risk" ? "alert" : undefined} data-testid={testId}>
      <div>
        <strong>{title}</strong>
        {text && <span>{text}</span>}
      </div>
      {onRetry && (
        <button type="button" className="go-btn go-btn-sm" onClick={onRetry}>
          Thử lại
        </button>
      )}
    </div>
  );
}

/** The plain-text twin of a chart: a native <details> table (keyboard and screen-reader friendly, no script). */
export function ChartTable({ caption, head, rows, summary = "Xem bảng số liệu", textCols = [] }: { caption: string; head: string[]; rows: ReactNode[][]; summary?: string; /** Indexes of columns that hold words (left-aligned); the others are numbers. */ textCols?: number[] }) {
  return (
    <details className="go-chart-details">
      <summary>{summary}</summary>
      <div className="go-chart-table-wrap" tabIndex={0} role="region" aria-label={caption}>
        <table className="go-chart-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={h} scope="col" className={i > 0 && !textCols.includes(i) ? "go-num" : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j} className={textCols.includes(j) ? undefined : "go-num"}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export interface HBarRow {
  key: string;
  name: ReactNode;
  value: number;
  /** The words next to the bar: the exact figure. */
  valueText: string;
  /** Second line (counts, change). */
  sub?: ReactNode;
}

/** Horizontal bars as a list: the name and the exact figure are text on every row, the bar is only the picture. */
export function HBarList({ rows, ariaLabel, testId }: { rows: HBarRow[]; ariaLabel: string; testId?: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <ul className="go-hbar-list" aria-label={ariaLabel} data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key} className="go-hbar-row" data-testid="go-hbar-row">
          <div className="go-hbar-top">
            <span className="go-hbar-name">{r.name}</span>
            <span className="go-hbar-val">{r.valueText}</span>
          </div>
          <div className="go-hbar-track" aria-hidden="true">
            <span className="go-hbar-fill" style={{ width: max > 0 && r.value > 0 ? `max(2px, ${(r.value / max) * 100}%)` : "0" }} />
          </div>
          {r.sub && <div className="go-hbar-sub">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

/** Recharts tooltip body in workspace tokens. */
export function ChartTip({ active, title, lines }: { active?: boolean; title: string; lines: string[] }) {
  if (!active) return null;
  return (
    <div className="go-chart-tip">
      <strong>{title}</strong>
      {lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

/** Shared recharts text/axis styling (tokens, not colours). */
export const AXIS_TICK = { fill: "var(--go-ink-3)", fontSize: 11 } as const;
export const AXIS_LINE = { stroke: "var(--go-line-strong)" } as const;
export const GRID_STROKE = "var(--go-line)";
