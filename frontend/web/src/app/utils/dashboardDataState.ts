/**
 * Frontend 2.0 R1 — one honest state per dashboard data block. A failed request must never read as
 * "no data": the old dashboard turned a 500 from GET /inbody into "Chưa có kết quả InBody. Tải phiếu
 * lên…", inviting a duplicate upload. A response that is not a list is treated as an error too.
 *
 * Previously loaded data wins over a later failed refetch (React Query keeps it in `data`), so a
 * transient error does not blank numbers the user already saw.
 */
export type DataState = "loading" | "error" | "empty" | "ready";

export interface QueryLike {
  isPending: boolean;
  isError: boolean;
  data: unknown;
}

export function listDataState(q: QueryLike): DataState {
  if (Array.isArray(q.data) && q.data.length > 0) return "ready";
  if (q.isError) return "error";
  if (q.isPending) return "loading";
  if (q.data === undefined || q.data === null) return "loading";
  if (!Array.isArray(q.data)) return "error"; // unexpected shape is not "empty"
  return "empty";
}

export const DASHBOARD_ERROR_TEXT = {
  body: "Không tải được chỉ số cơ thể. Dữ liệu InBody của bạn vẫn được giữ nguyên — hãy thử lại.",
  workouts: "Không tải được lịch sử tập luyện. Hãy thử lại.",
  retry: "Thử lại",
  retrying: "Đang tải lại…",
} as const;
