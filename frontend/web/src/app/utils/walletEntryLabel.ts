/**
 * Plain-Vietnamese label for one wallet-history row.
 *
 * payment-service adds a derived `category` to every row of /me/wallet/transactions and /me/pt-wallet/transactions
 * (services/wallet-entry-category.ts). The row's raw `description` is an internal English ledger string that carries ids
 * and enum names ("PERSONALIZED_SERVICE_PURCHASE <uuid> — refund (contract could not be activated)") and is never shown.
 * An unknown category falls back to a neutral direction label; an answer from a backend that predates `category` falls
 * back to the same product-aware reading of the description. Keep this table in step with the mobile copy
 * (frontend/mobile/src/features/wallet/wallet.ts).
 */

export const WALLET_ENTRY_LABEL: Record<string, string> = {
  REFUND_UNACTIVATED_PERSONALIZED_SERVICE: "Hoàn tiền dịch vụ cá nhân hóa (đơn đã hủy trước khi thanh toán xong)",
  REFUND_UNACTIVATED_MEMBERSHIP: "Hoàn tiền gói hội viên (gói đã hủy trước khi thanh toán xong)",
  REFUND_UNACTIVATED_PT_CONTRACT: "Hoàn tiền hợp đồng PT (hợp đồng đã hủy trước khi thanh toán xong)",
  REFUND_UNACTIVATED_OTHER: "Hoàn tiền (đơn đã hủy trước khi thanh toán xong)",
  REFUND_PT_CONTRACT: "Hoàn tiền hợp đồng PT",
  REFUND_PT_SESSION_NOT_DELIVERED: "Hoàn tiền buổi PT chưa diễn ra",
  REFUND_MEMBERSHIP: "Hoàn tiền gói hội viên",
  REFUND_PERSONALIZED_SERVICE: "Hoàn tiền dịch vụ cá nhân hóa",
  REFUND_OTHER: "Hoàn tiền",
  COMPENSATION_PT_NO_SHOW: "Hoàn tiền buổi PT vắng",
  COMPENSATION_PT_LATE_ARRIVAL: "Bồi thường PT đến muộn",
  COMPENSATION_PT_FAULT: "Bồi thường do PT không thực hiện hợp đồng",
  TOPUP: "Nạp tiền vào ví",
  WITHDRAWAL_LOCKED: "Rút tiền: đã giữ chờ chuyển khoản",
  WITHDRAWAL_RESTORED: "Rút tiền bị từ chối: tiền trả về ví",
  WITHDRAWAL_PAID: "Rút tiền: đã chuyển khoản",
  EARNING_HELD: "Thu nhập hợp đồng đang được giữ",
  EARNING_RELEASED: "Thu nhập đã nhận",
  EARNING_MOVED_TO_AVAILABLE: "Chuyển thu nhập sang số dư khả dụng",
  PT_CHARGE_NO_SHOW: "Trừ phí PT vắng mặt buổi tập",
  PT_CHARGE_LATE_ARRIVAL: "Trừ phí PT đến muộn",
  HOLDBACK_KEPT: "Tạm giữ một phần thu nhập hợp đồng (của bạn, chưa rút được)",
  HOLDBACK_RELEASED: "Trả lại khoản tạm giữ vào số dư",
  HOLDBACK_USED_FOR_COMPENSATION: "Dùng khoản tạm giữ để bồi thường khách của hợp đồng này"
  CLAWBACK: "Thu hồi thu nhập đã nhận",
  REFERRAL_COMMISSION: "Hoa hồng giới thiệu",
  REFERRAL_CLAWBACK: "Thu hồi hoa hồng giới thiệu",
  DEBT_WITHHELD: "Trừ vào khoản đang nợ",
  PENDING_REVERSED: "Hoàn lại khoản đang giữ (thanh toán đã hoàn)",
  OTHER_CREDIT: "Tiền vào ví",
  OTHER_DEBIT: "Tiền ra khỏi ví",
};

export interface WalletEntryLike {
  category?: string | null;
  description?: string | null;
  entryType?: string | null;
}

const directionLabel = (entryType: string | null | undefined) =>
  entryType === "DEBIT" ? WALLET_ENTRY_LABEL.OTHER_DEBIT : WALLET_ENTRY_LABEL.OTHER_CREDIT;

/** Reads an old-backend description (no `category`) the way the server would. Never returns the raw text. */
function labelFromDescription(description: string, entryType: string | null | undefined): string {
  const d = description.toLowerCase();
  const credit = entryType !== "DEBIT";
  const product = /personalized/.test(d)
    ? "service"
    : /^(gym_membership|membership)\b/.test(d)
      ? "membership"
      : /^(pt_contract|contract)\b/.test(d)
        ? "contract"
        : null;
  if (credit && /compensation for a missed session|no[-_ ]?show/.test(d)) return WALLET_ENTRY_LABEL.COMPENSATION_PT_NO_SHOW;
  if (credit && /late arrival|late-arrival/.test(d)) return WALLET_ENTRY_LABEL.COMPENSATION_PT_LATE_ARRIVAL;
  if (/withdrawal/.test(d)) {
    if (/rejected/.test(d)) return WALLET_ENTRY_LABEL.WITHDRAWAL_RESTORED;
    if (/paid/.test(d)) return WALLET_ENTRY_LABEL.WITHDRAWAL_PAID;
    return WALLET_ENTRY_LABEL.WITHDRAWAL_LOCKED;
  }
  if (credit && /refund/.test(d)) {
    const unactivated = /could not be activated/.test(d);
    if (product === "service") return WALLET_ENTRY_LABEL[unactivated ? "REFUND_UNACTIVATED_PERSONALIZED_SERVICE" : "REFUND_PERSONALIZED_SERVICE"];
    if (product === "membership") return WALLET_ENTRY_LABEL[unactivated ? "REFUND_UNACTIVATED_MEMBERSHIP" : "REFUND_MEMBERSHIP"];
    if (product === "contract") return WALLET_ENTRY_LABEL[unactivated ? "REFUND_UNACTIVATED_PT_CONTRACT" : "REFUND_PT_CONTRACT"];
    return WALLET_ENTRY_LABEL.REFUND_OTHER;
  }
  return directionLabel(entryType);
}

export function walletEntryLabel(entry: WalletEntryLike): string {
  const byCategory = entry.category ? WALLET_ENTRY_LABEL[entry.category] : undefined;
  if (byCategory) return byCategory;
  if (entry.category) return directionLabel(entry.entryType); // a category this build does not know yet
  return entry.description ? labelFromDescription(entry.description, entry.entryType) : directionLabel(entry.entryType);
}
