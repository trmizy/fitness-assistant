import type { ReactNode } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./table";
import { useIsMobile } from "./use-mobile";
import { cn } from "./utils";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Right-aligns and uses a tabular-numeral mono font — for money/counts (§54). */
  numeric?: boolean;
  /** Secondary columns that only add noise to the mobile card (still shown in the desktop table). */
  hideOnMobileCard?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** First column's value doubles as the mobile card's title. */
  emptyState?: ReactNode;
  className?: string;
}

/**
 * GYM_MANAGEMENT master spec §55/§67 — "card-based tables" on mobile, a real `<table>` on
 * desktop, from ONE column definition instead of maintaining two layouts by hand. Below the
 * 768px breakpoint (useIsMobile, shared with the rest of the app) every row renders as a
 * card: the first column is the title, the rest render as label/value pairs (columns marked
 * `hideOnMobileCard` are skipped — for dense desktop-only columns like raw IDs).
 */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, emptyState, className }: DataTableProps<T>) {
  const isMobile = useIsMobile();

  if (rows.length === 0 && emptyState) return <>{emptyState}</>;

  if (isMobile) {
    const [titleCol, ...restCols] = columns;
    return (
      <div className={cn("space-y-2", className)}>
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              "rounded-xl border border-zinc-800 bg-zinc-900/60 p-3",
              onRowClick && "cursor-pointer active:bg-zinc-900",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 font-semibold text-zinc-100 truncate">{titleCol.render(row)}</div>
              {onRowClick && <CaretRightIcon className="size-4 text-zinc-600 shrink-0" />}
            </div>
            <div className="mt-2 space-y-1">
              {restCols
                .filter((c) => !c.hideOnMobileCard)
                .map((c) => (
                  <div key={c.key} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">{c.header}</span>
                    <span className={cn("text-zinc-300", c.numeric && "font-mono tabular-nums")}>{c.render(row)}</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-zinc-800 overflow-x-auto", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.key} className={cn(c.numeric && "text-right", c.className)}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "cursor-pointer" : undefined}
            >
              {columns.map((c) => (
                <TableCell key={c.key} className={cn(c.numeric && "text-right font-mono tabular-nums", c.className)}>
                  {c.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
