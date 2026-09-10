import type { ReactNode } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { cn } from "./utils";

export interface EntityCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** A StatusBadge, RoleChip, etc. */
  badge?: ReactNode;
  /** Label/value pairs shown below the title — e.g. branch count, member count. */
  meta?: { label: string; value: ReactNode }[];
  onClick?: () => void;
  actions?: ReactNode;
  className?: string;
}

/**
 * GYM_MANAGEMENT master spec §55 — "EntityCard", for a grid/list of items OUTSIDE a table
 * (a partner card, a branch card). For a table that turns into cards on mobile, use
 * `DataTable` instead — its mobile rendering already covers the "MobileEntityCard" case
 * for tabular data from one column definition, so this component stays for the
 * non-tabular case rather than duplicating that logic.
 */
export function EntityCard({ title, subtitle, badge, meta, onClick, actions, className }: EntityCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors",
        onClick && "cursor-pointer hover:border-zinc-700 hover:bg-zinc-900 active:bg-zinc-800/60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-zinc-100 truncate">{title}</h4>
            {badge}
          </div>
          {subtitle && <p className="text-sm text-zinc-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
        {onClick && !actions && <CaretRightIcon className="size-4 text-zinc-600 shrink-0 mt-1" />}
        {actions}
      </div>
      {meta && meta.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-800 pt-3">
          {meta.map((m, i) => (
            <div key={i} className="text-xs">
              <span className="text-zinc-500">{m.label}: </span>
              <span className="text-zinc-300 font-mono tabular-nums">{m.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
