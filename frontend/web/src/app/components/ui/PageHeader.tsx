import type { ReactNode } from "react";
import { cn } from "./utils";

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Right-aligned slot on desktop; wraps below the title on mobile (§53: no overflow). */
  actions?: ReactNode;
  className?: string;
}

/**
 * GYM_MANAGEMENT master spec §55 — shared page-title block. Every redesigned Admin/Gym Owner
 * screen should open with exactly this, instead of a one-off `<h1>` + ad-hoc button row.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-zinc-100 truncate">{title}</h1>
        {description && <p className="text-sm text-zinc-500 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
