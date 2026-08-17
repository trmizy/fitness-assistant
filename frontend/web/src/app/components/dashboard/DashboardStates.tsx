import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";

/** Row-shaped placeholder for a list that's still loading — matches the real row's height. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-full bg-zinc-800" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 animate-pulse rounded bg-zinc-800" />
        <div className="h-3 w-20 animate-pulse rounded bg-zinc-800/70" />
      </div>
      <div className="h-5 w-16 animate-pulse rounded-full bg-zinc-800" />
    </div>
  );
}

/** Block-shaped placeholder for a chart that's still loading — matches the ResponsiveContainer height used everywhere on these dashboards. */
export function SkeletonChart() {
  return (
    <div className="h-[140px] animate-pulse rounded-lg bg-gradient-to-r from-zinc-800/40 via-zinc-800/80 to-zinc-800/40 bg-[length:200%_100%]" />
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint: string;
}

/** Beautifully-composed nothing: an icon, what's missing, and how to fix it. */
export function EmptyState({ icon: Icon, title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <Icon className="mb-3 h-8 w-8 text-zinc-700" />
      <div className="text-sm font-semibold text-zinc-400">{title}</div>
      <div className="mt-1 max-w-[220px] text-xs text-zinc-600">{hint}</div>
    </div>
  );
}

/** Inline error, not a silent blank panel. */
export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <AlertTriangle className="mb-3 h-8 w-8 text-red-500/70" />
      <div className="text-sm font-semibold text-red-400">Không tải được dữ liệu</div>
      <div className="mt-1 max-w-[220px] text-xs text-zinc-600">{message}</div>
    </div>
  );
}
