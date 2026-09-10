import type { ReactNode } from "react";
import { cn } from "./utils";

export interface DetailSectionProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * GYM_MANAGEMENT master spec §55 — a titled block of read-only info inside a detail page
 * (e.g. one card within the Partner Detail's OVERVIEW tab). Not a form — see FormSection for
 * the editable counterpart.
 */
export function DetailSection({ title, actions, children, className }: DetailSectionProps) {
  return (
    <section className={cn("rounded-xl border border-zinc-800 bg-zinc-900/40", className)}>
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A label/value row inside a DetailSection — the common case, kept out of every call site. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200 text-right">{value}</span>
    </div>
  );
}
