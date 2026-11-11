/**
 * B1-MONEY — one place that turns a failed admin request into a Vietnamese sentence (never "[object Object]",
 * never an English backend message) and says what the screen must do next.
 *
 * The three backends answer in three shapes (audit 02 §0): payment-service / gym-service
 * `{ success:false, error:{ code, message } }`, user-service `{ error:"<vi text>", code? }`; gym-service puts the
 * raw English message in `code`. `listingErrorInfo` already reads all of them.
 *
 * - `stale`     — what is on screen is out of date (already decided by someone else, state moved): the caller's lists
 *                 are re-fetched and the same POST must NOT simply be sent again.
 * - `ambiguous` — we do not know whether the write happened (network lost, timeout, 5xx): never auto-retry a POST;
 *                 the admin re-reads the state first (plan E-07).
 *
 * The pure part runs under `npx tsx --test`; `useAdminError()` is the thin React wrapper (toast + refetch).
 */
import { useCallback } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { listingErrorInfo, LISTING_ERROR_VI } from "../../../utils/listingErrors";

export type AdminErrorKind = "network" | "unauthorized" | "forbidden" | "not-found" | "conflict" | "validation" | "server" | "generic";

export interface AdminErrorView {
  message: string;
  kind: AdminErrorKind;
  status: number | null;
  code: string | null;
  /** The list on screen is wrong → re-fetch it, and do not resend the same write. */
  stale: boolean;
  /** Outcome unknown (write only) → re-read the state before doing anything else. */
  ambiguous: boolean;
}

export interface DescribeOptions {
  /** `write` = a POST/PATCH that may have changed money: network/5xx become "outcome unknown". Default `read`. */
  action?: "read" | "write";
  /** Shown for a 400 whose code is unknown. */
  fallback?: string;
  /** Extra sentence appended to a 5xx on a write (e.g. "the wallet may not have enough available balance"). */
  serverHint?: string;
}

interface CodeEntry {
  message: string;
  stale?: boolean;
  /** A server-side failure code: on a write the outcome is unknown (view.ambiguous), and `serverHint` is appended. */
  ambiguousOnWrite?: boolean;
}

/** Codes of payment-service, ai-service (personalized refund) and gym-service, by stable code or (gym) by raw message. */
export const ADMIN_ERROR_CODES: Record<string, CodeEntry> = {
  // payment-service withdrawals (P8-P10)
  NOT_FOUND: { message: "Không tìm thấy yêu cầu này (có thể đã bị xoá). Danh sách đã được tải lại.", stale: true },
  INVALID_STATUS: { message: "Yêu cầu không còn ở trạng thái này — đã được xử lý ở nơi khác. Danh sách đã được tải lại.", stale: true },
  ALREADY_PAID: { message: "Yêu cầu này đã được chi trả nên không thể thay đổi nữa. Danh sách đã được tải lại.", stale: true },
  FOUR_EYES_REQUIRED: {
    message: "Khoản rút lớn cần một quản trị viên khác với người đã duyệt xác nhận đã chi. Danh sách đã được tải lại.",
    stale: true,
  },
  REASON_REQUIRED: { message: "Cần nhập lý do." },
  BANK_REFERENCE_REQUIRED: { message: "Cần nhập mã tham chiếu chuyển khoản." },
  // payment-service G-13 — stable codes of the withdrawal write endpoints (409 wallet refusals, 500 unknown)
  INSUFFICIENT_BALANCE: { message: "Số dư khả dụng của ví không đủ — yêu cầu cần xem lại. Danh sách đã được tải lại.", stale: true },
  WALLET_NOT_ACTIVE: { message: "Ví này hiện không hoạt động nên chưa thao tác được. Danh sách đã được tải lại.", stale: true },
  INTERNAL_ERROR: {
    message: "Máy chủ gặp lỗi khi xử lý. Chưa xác nhận được kết quả — hãy tải lại trạng thái để kiểm tra trước khi thử lại.",
    ambiguousOnWrite: true,
  },
  // payment-service manual retry-activation (502): the downstream call failed, whether it took effect is unknown -> re-read first
  RETRY_FAILED: {
    message: "Chưa thử lại được khoản hoàn tiền. Hãy tải lại và kiểm tra trạng thái trước khi thử lại.",
    stale: true,
    ambiguousOnWrite: true,
  },
  // payment-service finance screens (BE-1 transactions, G-06 reconciliation runs, G-08 history, G-09/10 wallets, B8 VNPay L3)
  INVALID_QUERY: { message: "Bộ lọc không hợp lệ. Hãy đặt lại bộ lọc rồi thử lại." },
  INVALID_ID: { message: "Mã không hợp lệ. Hãy mở lại từ danh sách." },
  TRANSACTION_NOT_FOUND: { message: "Không tìm thấy giao dịch này (có thể đã bị xoá)." },
  WALLET_NOT_FOUND: { message: "Không tìm thấy ví này (có thể đã bị xoá)." },
  RECONCILIATION_RUN_TOO_SOON: { message: "Vừa chạy đối soát xong. Hãy đợi ít giây rồi chạy lại." },
  RECONCILIATION_FAILED: {
    message: "Không chạy được đối soát sổ ví. Hãy tải lại lịch sử đối soát để kiểm tra trước khi chạy lại.",
    ambiguousOnWrite: true,
  },
  RECONCILIATION_RUNS_FAILED: { message: "Không tải được lịch sử đối soát. Vui lòng thử lại sau ít phút." },
  GATEWAY_RECONCILIATION_FAILED: { message: "Không tải được đối chiếu cổng thanh toán. Vui lòng thử lại sau ít phút." },
  VNPAY_L3_FAILED: { message: "Không hỏi được VNPay lúc này. Vui lòng thử lại sau ít phút." },
  WITHDRAWAL_HISTORY_FAILED: { message: "Không tải được lịch sử rút tiền. Vui lòng thử lại sau ít phút." },
  TRANSACTIONS_LIST_FAILED: { message: "Không tải được danh sách giao dịch. Vui lòng thử lại sau ít phút." },
  TRANSACTION_DETAIL_FAILED: { message: "Không tải được chi tiết giao dịch. Vui lòng thử lại sau ít phút." },
  WALLETS_LIST_FAILED: { message: "Không tải được danh sách ví. Vui lòng thử lại sau ít phút." },
  WALLET_DETAIL_FAILED: { message: "Không tải được chi tiết ví. Vui lòng thử lại sau ít phút." },
  OBLIGATIONS_REPORT_FAILED: { message: "Không tải được báo cáo nghĩa vụ. Vui lòng thử lại sau ít phút." },
  // ai-service personalized-service refund (A3)
  PERSONALIZED_SERVICE_ADMIN_ONLY: { message: "Chỉ quản trị viên mới xử lý được hoàn tiền dịch vụ." },
  PERSONALIZED_SERVICE_ORDER_NOT_FOUND: { message: "Không tìm thấy đơn hàng này. Danh sách đã được tải lại.", stale: true },
  PERSONALIZED_SERVICE_REFUND_INVALID_STATE: {
    message: "Đơn này không còn chờ hoàn tiền (đã được xử lý ở nơi khác). Danh sách đã được tải lại.",
    stale: true,
  },
  PERSONALIZED_SERVICE_REFUND_INVALID_AMOUNT: {
    message: "Số tiền hoàn không hợp lệ hoặc vượt mức còn có thể hoàn. Số liệu mới nhất đã được tải lại.",
    stale: true,
  },
  PERSONALIZED_SERVICE_REFUND_FAILED: {
    message: "Hệ thống thanh toán chưa hoàn tất khoản hoàn này. Hãy tải lại và kiểm tra trước khi thử lại.",
    stale: true,
  },
  // gym-service membership refund (G1) — `code` carries the English message
  INVALID_REFUND_REASON: { message: "Lý do hoàn tiền không hợp lệ. Hãy chọn lại lý do." },
  "Membership not found": { message: "Không tìm thấy gói hội viên với mã này. Kiểm tra lại mã đã dán." },
  "Membership has already expired": { message: "Gói hội viên này đã hết hạn nên không hoàn tiền được." },
  "No payment on record to refund": { message: "Gói hội viên này không có giao dịch thanh toán để hoàn." },
};

const MEMBERSHIP_STATUS_VI: Record<string, string> = {
  CANCELLED: "đã huỷ",
  EXPIRED: "đã hết hạn",
  PENDING_ISSUE: "đang chờ xử lý sự cố hoàn tiền",
  PENDING: "chờ thanh toán",
  SUSPENDED: "tạm khoá",
};

const VIETNAMESE_LETTER = /[ăâđêôơưÀ-ỹ]/;

function kindOfStatus(status: number | null): AdminErrorKind {
  if (status === null) return "network";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status >= 500) return "server";
  if (status >= 400) return "validation";
  return "generic";
}

export function describeAdminError(error: unknown, opts: DescribeOptions = {}): AdminErrorView {
  const write = opts.action === "write";
  const info = listingErrorInfo(error);
  const { status, code } = info;
  const kind = kindOfStatus(status);
  const view = (message: string, extra: Partial<Pick<AdminErrorView, "stale" | "ambiguous">> = {}): AdminErrorView => ({
    message,
    kind,
    status,
    code,
    stale: false,
    ambiguous: false,
    ...extra,
  });

  // 1. Known code (or gym's English message-as-code)
  if (code) {
    const known = ADMIN_ERROR_CODES[code];
    if (known) {
      if (known.ambiguousOnWrite && write) {
        const hint = opts.serverHint ? ` ${opts.serverHint}` : "";
        return view(`${known.message}${hint}`, { ambiguous: true });
      }
      return view(known.message, { stale: !!known.stale });
    }
    const cannotRefund = /^Cannot refund a membership in (\w+) status$/.exec(code);
    if (cannotRefund) {
      const st = MEMBERSHIP_STATUS_VI[cannotRefund[1]];
      return view(`Chỉ hoàn tiền được cho gói hội viên đang hoạt động. Gói này ${st ?? `ở trạng thái ${cannotRefund[1]}`}.`);
    }
    if (LISTING_ERROR_VI[code]) return view(LISTING_ERROR_VI[code]);
  }

  // 2. By HTTP status
  if (status === null) {
    // No response at all: the request may or may not have reached the server.
    return write
      ? view("Chưa xác nhận được kết quả — thao tác có thể đã được ghi. Hãy tải lại trạng thái để kiểm tra trước khi làm lại.", { ambiguous: true })
      : view("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  }
  if (status === 401) return view("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.");
  if (status === 403) return view("Tài khoản của bạn không có quyền thực hiện thao tác này.");
  if (status === 404) return view("Không tìm thấy nội dung này (có thể đã bị xoá).", { stale: true });
  if (status === 429) return view("Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.");
  if (status === 409) {
    const own = info.serverMessage && VIETNAMESE_LETTER.test(info.serverMessage) ? info.serverMessage : null;
    return view(own ?? "Dữ liệu đã thay đổi hoặc yêu cầu đã được người khác xử lý. Danh sách đã được tải lại.", { stale: true });
  }
  if (status >= 500) {
    const hint = opts.serverHint ? ` ${opts.serverHint}` : "";
    return write
      ? view(`Máy chủ gặp lỗi khi xử lý. Chưa xác nhận được kết quả — hãy tải lại trạng thái để kiểm tra trước khi thử lại.${hint}`, { ambiguous: true })
      : view("Máy chủ đang gặp sự cố. Vui lòng thử lại sau ít phút.");
  }
  // 400 and other 4xx: the server's own sentence if it is Vietnamese, else our fallback.
  if (info.serverMessage && VIETNAMESE_LETTER.test(info.serverMessage)) return view(info.serverMessage);
  return view(opts.fallback ?? "Thông tin gửi lên không hợp lệ. Hãy kiểm tra lại rồi thử lại.");
}

/** For `ui/ErrorState`'s `kind`. */
export function errorStateKind(view: AdminErrorView): "network" | "forbidden" | "not-found" | "server" | "generic" {
  switch (view.kind) {
    case "network":
      return "network";
    case "forbidden":
    case "unauthorized":
      return "forbidden";
    case "not-found":
      return "not-found";
    case "server":
      return "server";
    default:
      return "generic";
  }
}

export interface ReportOptions extends DescribeOptions {
  /** Query keys to re-fetch when the error means the screen is stale or the outcome is unknown. */
  invalidate?: QueryKey[];
  /**
   * `false` = shown inline only (inside a dialog). `"stale"` = inline, plus a toast when the screen is stale: the
   * re-fetch usually removes the row (and the dialog living in it), so the message must outlive it.
   */
  toast?: boolean | "stale";
}

/**
 * `report(error, …)`: toast the Vietnamese message and, for a 409 / "already decided" / unknown outcome,
 * re-fetch the given lists so the screen shows the truth right after. Returns the described error.
 */
export function useAdminError() {
  const queryClient = useQueryClient();
  const report = useCallback(
    (error: unknown, opts: ReportOptions = {}): AdminErrorView => {
      const view = describeAdminError(error, opts);
      if (opts.toast === undefined || opts.toast === true || (opts.toast === "stale" && view.stale)) toast.error(view.message);
      if (view.stale || view.ambiguous) {
        for (const queryKey of opts.invalidate ?? []) void queryClient.invalidateQueries({ queryKey });
      }
      return view;
    },
    [queryClient],
  );
  return { describe: describeAdminError, report };
}
