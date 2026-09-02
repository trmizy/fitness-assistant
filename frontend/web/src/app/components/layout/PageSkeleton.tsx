import { Skeleton } from "../ui/skeleton";

/**
 * Vòng 4 / Phase D2 — the Suspense fallback shown while a lazy-loaded route chunk is still
 * downloading. Deliberately generic (no page-specific layout) since it has to work as the
 * fallback for every route; a bare `lazy()` with no fallback at all would just replace "big
 * bundle lag" with a blank flash per page, which reads worse than the lag it was meant to fix.
 */
export function PageSkeleton() {
  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4" aria-busy="true" aria-label="Đang tải trang">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}
