import { Skeleton } from "./skeleton";
import { cn } from "./utils";

/**
 * GYM_MANAGEMENT master spec §51 — "never blank page → spinner → content; prefer shell +
 * skeleton content + real content", with skeletons that approximately match the final
 * layout. `variant` picks the rough shape; pass your own children instead for a bespoke one.
 *
 * Not the same component as `components/layout/PageSkeleton` (the route-chunk Suspense
 * fallback, prop-less by design) — this one is for an in-page data-loading state with a
 * shape that roughly matches what's about to render. Same name, different job, disambiguated
 * by import path — do not merge them.
 */
export function PageSkeleton({
  variant = "list",
  rows = 4,
  className,
}: {
  variant?: "list" | "detail" | "kpiRow";
  rows?: number;
  className?: string;
}) {
  if (variant === "kpiRow") {
    return (
      <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div className={cn("space-y-4", className)}>
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}
