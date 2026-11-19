/**
 * G-09 / G-10 — Vietnamese wording of the wallet explorer. Shared with the transactions drawer (one wording for the
 * platform wallets). Every function has a NEUTRAL fallback ("Khác" / "Chưa rõ"): a value the UI does not know yet is never
 * printed as a raw enum.
 */
import { PURPOSE_LABELS, ownerLabel } from "../transactions/transactionsLabels";

/**
 * Platform wallets use fixed internal owner ids (payment-service wallet.service: ESCROW / REVENUE). The id is never shown
 * as if it were a user id; the admin sees what the wallet is FOR.
 */
export const PLATFORM_WALLET_LABEL: Record<string, string> = {
  ESCROW: "Ví giữ hộ (tiền chưa chi cho đối tác)",
  REVENUE: "Ví doanh thu nền tảng",
};

/** Label of a platform wallet owner id, with a neutral fallback for an id the app does not know. */
export const platformWalletLabel = (ownerId: string | null | undefined): string =>
  ownerId && Object.prototype.hasOwnProperty.call(PLATFORM_WALLET_LABEL, ownerId) ? PLATFORM_WALLET_LABEL[ownerId] : "Ví nội bộ";

const pick = (map: Record<string, string>, key: string | null | undefined, fallback: string): string =>
  key && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;

/** Who owns the wallet, in words: "Ví doanh thu nền tảng" for a platform wallet, else the owner's role ("Khách hàng"). */
export function walletOwnerTitle(ownerType: string | null | undefined, ownerId: string | null | undefined): string {
  return ownerType === "PLATFORM" ? platformWalletLabel(ownerId) : ownerLabel(ownerType);
}

export const WALLET_STATUS_LABELS: Record<string, string> = { ACTIVE: "Đang hoạt động", FROZEN: "Bị đóng băng", CLOSED: "Đã đóng" };
export const walletStatusLabel = (s: string | null | undefined) => pick(WALLET_STATUS_LABELS, s, "Chưa rõ");
export const walletStatusTone = (s: string | null | undefined): "success" | "warning" | "neutral" =>
  s === "ACTIVE" ? "success" : s === "FROZEN" ? "warning" : "neutral";

/**
 * G-10 `kind` of a ledger entry = which business flow produced it (derived server-side from the linked transaction's
 * purpose; a refund row is always "REFUND"). Same wording as the transaction "purpose" labels.
 */
export const ENTRY_KIND_LABELS: Record<string, string> = { ...PURPOSE_LABELS, OTHER: "Khác" };
export const entryKindLabel = (k: string | null | undefined) => pick(ENTRY_KIND_LABELS, k, "Khác");

/** The kinds the server documents (G-10). */
export const WALLET_ENTRY_KINDS = [
  "GYM_MEMBERSHIP",
  "PT_CONTRACT",
  "GYM_PT_COMBO",
  "WALLET_TOPUP",
  "REFUND",
  "TRAINING_PACKAGE_PURCHASE",
  "PERSONALIZED_SERVICE_PURCHASE",
  "WITHDRAWAL",
  "OTHER",
] as const;

export const WALLET_OWNER_TYPES = ["CLIENT", "PT", "GYM", "PLATFORM"] as const;
export type WalletOwnerType = (typeof WALLET_OWNER_TYPES)[number];
