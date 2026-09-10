import type { ElementType, ReactNode } from "react";
import { TrayIcon } from "@phosphor-icons/react";
import { cn } from "./utils";

export interface EmptyStateProps {
  icon?: ElementType;
  title: string;
  description?: string;
  action?: ReactNode;
  /** §50: "No Pending Admin Review" is a GOOD empty state — style it calmly, not as a
   * warning. Defaults to the normal (calm) look; pass "positive" explicitly for that case. */
  tone?: "neutral" | "positive";
  className?: string;
}

/**
 * GYM_MANAGEMENT master spec §50 — meaningful empty states, never a blank table. Examples
 * from the spec ("Bạn chưa có chi nhánh nào…", "Không có hồ sơ nào đang chờ duyệt.") are
 * exactly `title`/`description` here — this component only supplies the shared shell.
 */
export function EmptyState({ icon: Icon = TrayIcon, title, description, action, tone = "neutral", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 rounded-xl border border-dashed p-10",
        tone === "positive" ? "border-green-500/20 bg-green-500/5" : "border-zinc-800 bg-zinc-900/40",
        className,
      )}
    >
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full",
          tone === "positive" ? "bg-green-500/10 text-green-400" : "bg-zinc-800 text-zinc-500",
        )}
      >
        <Icon className="size-6" />
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-200">{title}</p>
        {description && <p className="text-xs text-zinc-500 mt-1 max-w-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
