import type { ReactNode } from "react";
import { cn } from "./utils";

export interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * GYM_MANAGEMENT master spec §55 — a titled group of form fields (one section of the
 * multi-section "Create Partner Record" form: representative / business / partnership /
 * documents / communication-log). Fields with labels are the caller's responsibility (use
 * the existing `Label`/`Input` primitives) — this only supplies the grouping shell.
 */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <fieldset className={cn("space-y-3 rounded-xl border border-zinc-800 p-4", className)}>
      <legend className="px-1 text-sm font-semibold text-zinc-200">{title}</legend>
      {description && <p className="text-xs text-zinc-500 -mt-2">{description}</p>}
      <div className="space-y-3">{children}</div>
    </fieldset>
  );
}
