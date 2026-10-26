/** Phân trang danh sách PT. GET /profile/pts chỉ trả `{ pts }` (không có total/hasMore), mặc định 50 dòng/trang,
 *  nên còn trang kế khi trang vừa tải đầy `PT_PAGE_SIZE`. */
export const PT_PAGE_SIZE = 30;

export function nextPtPage(lastPage: { pts?: unknown[] } | undefined, loadedPages: number): number | undefined {
  const count = Array.isArray(lastPage?.pts) ? lastPage!.pts!.length : 0;
  return count >= PT_PAGE_SIZE ? loadedPages + 1 : undefined;
}

/** Gộp các trang, bỏ trùng userId (dữ liệu đổi giữa hai lần tải có thể làm một PT lặp lại ở trang sau). */
export function mergePtPages<T extends { userId: string }>(pages: Array<{ pts?: T[] }> | undefined): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages ?? []) {
    for (const pt of page.pts ?? []) {
      if (seen.has(pt.userId)) continue;
      seen.add(pt.userId);
      out.push(pt);
    }
  }
  return out;
}
