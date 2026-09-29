/**
 * Phase 14.1 — the pure half of paying at a gateway (web: components/payment/PaymentMethodDialog.tsx,
 * pages/client/PaymentResultPage.tsx, services/paymentGateway.ts).
 *
 * The rule every function here serves: the gateway's return trip is a TRANSPORT, never a verdict.
 * `?status=success` on the deep link is text anyone can produce; the only thing that says money
 * moved is `POST /me/payments/:id/sync`, which asks the gateway itself.
 */

export interface PaymentMethod {
  provider: string;
  label: string;
  description: string;
  configured: boolean;
  unavailableReason: string | null;
}

export interface PaymentMethods {
  methods: PaymentMethod[];
  defaultProvider: string | null;
}

/** `GET /me/payments/methods` — server-decided list; a gateway without credentials stays visible, greyed. */
export function normalizeMethods(raw: unknown): PaymentMethods {
  const data = (raw ?? {}) as { methods?: unknown; defaultProvider?: unknown };
  const methods = Array.isArray(data.methods)
    ? data.methods
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
        .filter((m) => typeof m.provider === "string" && m.provider.length > 0)
        .map((m) => ({
          provider: String(m.provider),
          label: typeof m.label === "string" && m.label ? m.label : String(m.provider),
          description: typeof m.description === "string" ? m.description : "",
          configured: m.configured === true,
          unavailableReason: typeof m.unavailableReason === "string" ? m.unavailableReason : null,
        }))
    : [];
  const suggested = typeof data.defaultProvider === "string" ? data.defaultProvider : null;
  // Never pre-select a gateway the server itself says cannot take money.
  const defaultProvider =
    suggested && methods.some((m) => m.provider === suggested && m.configured) ? suggested : null;
  return { methods, defaultProvider };
}

/** Two-letter marks drawn in place of logos (web's BADGE table, same colours). */
export const PROVIDER_BADGE: Record<string, { text: string; background: string }> = {
  VNPAY: { text: "VN", background: "#0a4f9e" },
  ZALOPAY: { text: "ZP", background: "#0068ff" },
  MOMO: { text: "M", background: "#a50064" },
};

export interface CheckoutStart {
  redirectUrl: string | null;
  transactionId: string | null;
  failureReason: string | null;
  /** The server settled it on the spot (no gateway hop) — still confirmed by sync on the result screen. */
  alreadyPaid: boolean;
}

/**
 * The four checkout calls carry the payment either as `payment` (contract, marketplace, paying a
 * pending membership) or `data.payment` (buying a membership, which the service returns raw).
 */
export function readCheckout(raw: unknown): CheckoutStart {
  const root = (raw ?? {}) as Record<string, any>;
  const payment = root.payment ?? root.data?.payment ?? {};
  const redirectUrl =
    typeof payment.redirectUrl === "string" && payment.redirectUrl
      ? payment.redirectUrl
      : typeof payment.qrCodeUrl === "string" && payment.qrCodeUrl
        ? payment.qrCodeUrl
        : null;
  return {
    redirectUrl,
    transactionId: typeof payment.transactionId === "string" ? payment.transactionId : null,
    failureReason: typeof payment.failureReason === "string" ? payment.failureReason : null,
    alreadyPaid: payment.status === "PAID",
  };
}

/** Where payment-service sends the payer back when the checkout started in the app. */
export const PAYMENT_RETURN_PREFIX = "fitnessassistant://client/payments/result";

/** The app's own result route for a transaction — also what the deep link resolves to. */
export function resultHref(transactionId: string | null): string {
  return transactionId
    ? `/client/payments/result?txnId=${encodeURIComponent(transactionId)}`
    : "/client/payments/result";
}

/**
 * Reads `txnId` off the return deep link. Only ever used to know WHICH transaction to ask the
 * server about — the `status` next to it is deliberately ignored.
 */
export function txnIdFromReturnUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /[?&]txnId=([^&#]+)/.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export type ResultPhase = "checking" | "paid" | "pending" | "failed" | "error";

/** The server's transaction status → what the result screen shows. Anything unknown is "pending". */
export function phaseFromSync(raw: unknown): ResultPhase {
  const status = (raw as { status?: unknown } | null)?.status;
  if (status === "PAID") return "paid";
  if (status === "FAILED" || status === "CANCELLED") return "failed";
  return "pending";
}

/** Where the thing just paid for lives in the app. */
export function destinationFor(raw: unknown): { href: string; label: string } {
  const data = (raw ?? {}) as { relatedEntityType?: unknown; relatedEntityId?: unknown };
  switch (data.relatedEntityType) {
    case "GYM_MEMBERSHIP":
      return { href: "/client/services?tab=memberships", label: "Xem gói hội viên" };
    case "PT_CONTRACT":
      return { href: "/client/services?tab=contracts", label: "Xem hợp đồng" };
    case "PERSONALIZED_SERVICE_PURCHASE":
      return typeof data.relatedEntityId === "string" && data.relatedEntityId
        ? { href: `/client/plans/orders/${data.relatedEntityId}`, label: "Xem đơn dịch vụ" }
        : { href: "/client/plans", label: "Về Kế hoạch" };
    default:
      return { href: "/client/dashboard", label: "Về trang chủ" };
  }
}

/** Server error body → one Vietnamese line; never a raw code or stack. */
export function checkoutErrorMessage(error: unknown): string {
  const body = (error as { response?: { data?: any } } | null)?.response?.data;
  const code = typeof body?.error === "string" ? body.error : body?.error?.code ?? body?.code;
  const message = typeof body?.message === "string" ? body.message : body?.error?.message;
  if (code === "PROVIDER_NOT_CONFIGURED" || code === "PAYMENT_PROVIDER_UNAVAILABLE") {
    return "Cổng thanh toán này đang tạm ngưng — chọn cổng khác.";
  }
  if (code === "ALREADY_HAS_PENDING_MEMBERSHIP") {
    return "Bạn đã có một gói chờ thanh toán tại phòng gym này — thanh toán nó ở tab Hội viên.";
  }
  if (code === "ALREADY_HAS_OPEN_MEMBERSHIP") return "Bạn đang có gói còn hiệu lực tại phòng gym này.";
  if (typeof message === "string" && /[À-ỹ]/.test(message)) return message;
  if (typeof code === "string" && /[À-ỹ]/.test(code)) return code;
  if (!body) return "Không kết nối được máy chủ — kiểm tra mạng rồi thử lại.";
  return "Không tạo được giao dịch — thử lại hoặc chọn cổng khác.";
}
