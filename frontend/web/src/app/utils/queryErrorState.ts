/**
 * FE2-FIX group B - an API error must read as an error (with a retry), never as "no data" / 0.
 * Extends the R1 pattern (`listDataState`, dashboardDataState.ts) to the Client/PT pages that still swallowed errors.
 * Pure helpers (no React) so they can be unit-tested with node:test.
 */
import { listDataState, type QueryLike } from "./dashboardDataState";

export interface ErrorQueryLike {
  isError: boolean;
  data: unknown;
  error?: unknown;
}

/** HTTP status of an axios-style error, if it has one. */
export function httpStatusOf(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  return typeof status === "number" ? status : undefined;
}

/** The request failed and there is nothing previously loaded to keep showing (previous data wins over a failed refetch). */
export function hasBlockingError(q: ErrorQueryLike): boolean {
  return q.isError && (q.data === undefined || q.data === null);
}

/** A list query is in the error state (same rule as `listDataState`: a failed list whose default is [] is still an error). */
export function listFailed(q: QueryLike): boolean {
  return listDataState(q) === "error";
}

/**
 * "No active cycle" is a normal answer: GET /training-cycles/active answers 404 for a user who has no cycle running.
 * Only every OTHER failure (5xx, network, 403...) is an error state.
 */
export function activeCycleFailed(q: ErrorQueryLike): boolean {
  return hasBlockingError(q) && httpStatusOf(q.error) !== 404;
}

export const QUERY_ERROR_TEXT = {
  retry: "Thử lại",
  retrying: "Đang tải lại…",
  inbodyCycle: "Không tải được chu kỳ tập luyện hiện tại. Hãy thử lại.",
  cycleHistory: "Không tải được lịch sử chu kỳ. Hãy thử lại.",
  cycleProgress: "Không tải được tiến độ chu kỳ. Hãy thử lại.",
  nutritionDay: "Không tải được kế hoạch dinh dưỡng của ngày này. Hãy thử lại.",
  ptTerms: "Không kiểm tra được trạng thái Điều khoản dành cho Huấn luyện viên. Hãy thử lại.",
  ptContracts: "Không tải được danh sách hợp đồng. Hãy thử lại.",
  ptAlerts: "Không tải được cảnh báo học viên. Hãy thử lại.",
  ptSessionsToClose: "Không tải được danh sách buổi cần chốt. Hãy thử lại.",
} as const;
