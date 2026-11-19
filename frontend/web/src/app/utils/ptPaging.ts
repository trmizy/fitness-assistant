/**
 * Cursor & legacy offset paging helpers for PT & Gym discovery.
 * Keeps `nextPtPage` / `mergePtPages` compatible while adding `nextCursorParam` / `mergeUniquePages`.
 */
export const PT_PAGE_SIZE = 30;
export const DISCOVERY_PAGE_SIZE = 20;

export function nextPtPage(lastPage: { pts?: unknown[] } | undefined, loadedPages: number): number | undefined {
  const count = Array.isArray(lastPage?.pts) ? lastPage!.pts!.length : 0;
  return count >= PT_PAGE_SIZE ? loadedPages + 1 : undefined;
}

/** Cursor-based page parameter extractor for `POST /profile/pts/search`, `POST /gyms/search`, `GET /gyms/brand-options`. */
export function nextCursorParam(lastPage: { hasMore?: boolean; nextCursor?: string | null } | undefined): string | undefined {
  if (!lastPage || lastPage.hasMore !== true) return undefined;
  return typeof lastPage.nextCursor === "string" && lastPage.nextCursor.length > 0 ? lastPage.nextCursor : undefined;
}

/** Merges cursor pages generically while deduplicating by primary entity key (`userId` / `id` / `brandId`). */
export function mergeUniquePages<Page, Item>(
  pages: Page[] | undefined,
  getItems: (page: Page) => Item[] | undefined,
  getKey: (item: Item) => string,
): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const page of pages ?? []) {
    for (const item of getItems(page) ?? []) {
      const key = getKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/** Gộp các trang, bỏ trùng userId (dữ liệu đổi giữa hai lần tải có thể làm một PT lặp lại ở trang sau). */
export function mergePtPages<T extends { userId: string }>(pages: Array<{ pts?: T[] }> | undefined): T[] {
  return mergeUniquePages(pages, (p) => p.pts, (pt) => pt.userId);
}
