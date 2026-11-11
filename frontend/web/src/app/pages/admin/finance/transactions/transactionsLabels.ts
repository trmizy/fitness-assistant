/**
 * B7 — Vietnamese labels for the finance transactions screen. Every label function has a NEUTRAL fallback
 * ("Khác" / "Chưa rõ"): a value the UI does not know yet is never printed as a raw enum.
 * Reuses the maps that already exist in the admin finance code (bucket, obligation status) so one concept keeps one wording.
 */
import { BUCKET_LABEL, OBLIGATION_STATUS_LABEL } from "../../adminReconciliation.utils";

export type StatusTone = "success" | "pending" | "danger" | "warning" | "info" | "neutral";

const pick = (map: Record<string, string>, key: string | null | undefined, fallback: string): string =>
  key && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;

export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Chờ thanh toán",
  PROCESSING: "Đang xử lý",
  PAID: "Đã thanh toán",
  FAILED: "Thất bại",
  CANCELLED: "Đã huỷ",
  REFUNDED: "Đã hoàn tiền",
};
export const statusLabel = (s: string | null | undefined) => pick(STATUS_LABEL, s, "Chưa rõ");

const STATUS_TONE: Record<string, StatusTone> = {
  PENDING: "pending",
  PROCESSING: "info",
  PAID: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "warning",
};
export const statusTone = (s: string | null | undefined): StatusTone =>
  s && Object.prototype.hasOwnProperty.call(STATUS_TONE, s) ? STATUS_TONE[s] : "neutral";

export const PROVIDER_LABELS: Record<string, string> = {
  MOCK: "Giả lập",
  VNPAY: "VNPay",
  MOMO: "MoMo",
  ZALOPAY: "ZaloPay",
  PAYOS: "PayOS",
  STRIPE: "Stripe",
  MANUAL_BANK_TRANSFER: "Chuyển khoản thủ công",
};
export const providerLabel = (p: string | null | undefined) => pick(PROVIDER_LABELS, p, "Khác");

export const PURPOSE_LABELS: Record<string, string> = {
  GYM_MEMBERSHIP: "Gói hội viên phòng gym",
  PT_CONTRACT: "Hợp đồng PT",
  GYM_PT_COMBO: "Gói phòng gym kèm PT",
  WALLET_TOPUP: "Nạp ví",
  REFUND: "Hoàn tiền",
  TRAINING_PACKAGE_PURCHASE: "Mua gói tập",
  PERSONALIZED_SERVICE_PURCHASE: "Dịch vụ cá nhân hoá",
  WITHDRAWAL: "Rút tiền",
};
export const purposeLabel = (p: string | null | undefined) => pick(PURPOSE_LABELS, p, "Khác");

export const ACTIVATION_LABELS: Record<string, string> = {
  NOT_APPLICABLE: "Không áp dụng",
  PENDING: "Chờ kích hoạt",
  ACTIVATED: "Đã kích hoạt",
  ACTIVATION_FAILED: "Kích hoạt thất bại",
};
export const activationLabel = (a: string | null | undefined) => pick(ACTIVATION_LABELS, a, "Chưa rõ");

export const OWNER_LABELS: Record<string, string> = { CLIENT: "Khách hàng", PT: "Huấn luyện viên", GYM: "Phòng gym", PLATFORM: "Nền tảng" };
export const ownerLabel = (o: string | null | undefined) => pick(OWNER_LABELS, o, "Khác");

export const ENTRY_TYPE_LABELS: Record<string, string> = { DEBIT: "Nợ (trừ)", CREDIT: "Có (cộng)" };
export const entryTypeLabel = (e: string | null | undefined) => pick(ENTRY_TYPE_LABELS, e, "Khác");

export const bucketLabel = (b: string | null | undefined) => pick(BUCKET_LABEL, b, "Khác");

export const LEDGER_OPERATION_LABELS: Record<string, string> = {
  RELEASE_SESSION: "Giải phóng tiền một buổi tập",
  NO_SHOW: "Xử lý PT vắng mặt",
  LATE_ARRIVAL: "Xử lý PT đến muộn",
  TERMINATE: "Kết thúc hợp đồng",
  RESOLVE_UNRESOLVED: "Giải quyết buổi tập đang bị giữ",
};
export const ledgerOperationLabel = (k: string | null | undefined) => pick(LEDGER_OPERATION_LABELS, k, "Thao tác sổ cái");

export const COMMISSION_STATUS_LABELS: Record<string, string> = { PENDING: "Chờ chốt", SETTLED: "Đã chốt", CANCELLED: "Đã huỷ" };
export const commissionStatusLabel = (s: string | null | undefined) => pick(COMMISSION_STATUS_LABELS, s, "Chưa rõ");

export const OBLIGATION_KIND_LABELS: Record<string, string> = {
  NO_SHOW: "PT vắng mặt — chưa đền đủ",
  LATE_ARRIVAL: "PT đến muộn — chưa đền đủ",
  REFUND_SHORT: "Hoàn tiền còn thiếu",
  OVER_RELEASED: "Đã giải phóng vượt mức",
  APPEAL_AWARD: "Khoản phải trả sau khiếu nại",
};
export const obligationKindLabel = (k: string | null | undefined) => pick(OBLIGATION_KIND_LABELS, k, "Nghĩa vụ khác");
export const obligationStatusLabel = (s: string | null | undefined) => pick(OBLIGATION_STATUS_LABEL, s, "Chưa rõ");

export const HOLDBACK_KIND_LABELS: Record<string, string> = {
  OPEN_OBLIGATION: "Còn nghĩa vụ chưa trả",
  UNSECURED_DISPUTE: "Tranh chấp buổi tập chưa đủ tiền bù",
  UNCOMPUTABLE: "Chưa tính được mức bù",
};
export const holdbackKindLabel = (k: string | null | undefined) => pick(HOLDBACK_KIND_LABELS, k, "Lý do khác");

export const HOLDBACK_STATUS_LABELS: Record<string, string> = {
  OPEN: "Đang giữ lại",
  SETTLED_VERIFIED: "Đã xử lý — có xác minh",
  SETTLED_PARTIAL: "Đã xử lý một phần",
  NOT_VERIFIED: "Không xác minh được",
  RELEASED_AUTO: "Đã tự giải phóng",
};
export const holdbackStatusLabel = (s: string | null | undefined) => pick(HOLDBACK_STATUS_LABELS, s, "Chưa rõ");
