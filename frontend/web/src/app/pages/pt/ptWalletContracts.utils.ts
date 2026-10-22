/**
 * FH-9 - "Tiền theo từng hợp đồng" của PT: phần thuần (kiểu dữ liệu, nhãn, câu giải thích).
 *
 * Nguồn: GET /me/pt-wallet/contracts của payment-service (suy ra từ sổ cái, chỉ đọc). Quy tắc hiển thị:
 *  - chỉ có MỘT khoản tiền thật của mỗi hợp đồng là khoản khách đã trả (nằm trong ký quỹ của nền tảng); các con số ở đây là
 *    PHẦN CỦA PT trên khoản đó, theo thứ tự thành tiền thật: chưa kiếm -> đã kiếm -> (tạm giữ) -> số dư khả dụng;
 *  - tiền tạm giữ là tiền ĐÃ KIẾM của PT, chưa rút được, KHÔNG phải phí và KHÔNG phải doanh thu của nền tảng;
 *  - thời điểm trả lại phụ thuộc vào hợp đồng kết thúc và đối soát xong, nên KHÔNG bao giờ hiện một ngày cố định.
 * Không hiện mã nội bộ / tên enum cho người dùng.
 */

export type HoldbackReleaseState = "NO_HOLDBACK" | "RUNNING" | "WAITING_RECONCILIATION" | "RELEASED";

export interface PtWalletContractRow {
  contractId: string | null;
  transactionId: string;
  paidAt: string | null;
  contractValue: string;
  expectedIncome: string;
  holdbackTarget: string;
  pending: string;
  earned: string;
  held: string;
  availableFromContract: string;
  compensationPaid: string;
  release: {
    state: HoldbackReleaseState;
    ended: boolean;
    heldDueToDispute: boolean;
    undecidedSessions: number;
    openObligations: string;
  };
}

export interface PtWalletContractsView {
  generatedAt: string;
  wallet: { available: string; pending: string; held: string; locked: string };
  contracts: PtWalletContractRow[];
  totals: { held: string; heldDueToDispute: string; contractsHolding: number };
}

/** Câu cố định theo yêu cầu của chủ sở hữu. Không kèm ngày. */
export const HOLDBACK_RELEASE_CONDITION = "Sẽ trả lại khi hợp đồng kết thúc và đối soát hoàn tất";

export const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Câu giải thích khoản tạm giữ của MỘT hợp đồng, hoặc null nếu hợp đồng không có tạm giữ. */
export function holdbackNote(row: PtWalletContractRow): string | null {
  const held = num(row.held);
  const target = num(row.holdbackTarget);
  switch (row.release.state) {
    case "NO_HOLDBACK":
      return null;
    case "RUNNING":
      if (held > 0) return HOLDBACK_RELEASE_CONDITION;
      return target > 0 ? `Một phần thu nhập của các buổi đầu sẽ được tạm giữ. ${HOLDBACK_RELEASE_CONDITION}` : null;
    case "WAITING_RECONCILIATION": {
      const reasons: string[] = [];
      if (row.release.undecidedSessions > 0) reasons.push(`${row.release.undecidedSessions} buổi chưa được chốt`);
      if (num(row.release.openObligations) > 0) reasons.push("một khoản của chính hợp đồng này chưa được xử lý xong");
      return reasons.length > 0
        ? `Hợp đồng đã kết thúc. Khoản tạm giữ còn lại được giữ vì ${reasons.join(" và ")}; sẽ trả lại ngay khi xử lý xong.`
        : "Hợp đồng đã kết thúc. Khoản tạm giữ còn lại sẽ được trả lại sau khi đối soát hoàn tất.";
    }
    case "RELEASED":
      return held > 0 ? null : "Khoản tạm giữ đã được trả lại vào số dư của bạn.";
    default:
      return null;
  }
}

/** Nhãn ngắn của trạng thái tạm giữ (chỉ khi cần nhấn mạnh). */
export function holdbackBadge(row: PtWalletContractRow): { label: string; tone: "info" | "warn" | "ok" } | null {
  if (row.release.heldDueToDispute) return { label: "Tạm giữ do tranh chấp / đối soát", tone: "warn" };
  if (num(row.held) > 0) return { label: "Đang tạm giữ", tone: "info" };
  if (row.release.state === "RELEASED" && row.release.ended) return { label: "Đã trả lại", tone: "ok" };
  return null;
}

/** Phần đã kiếm trên thu nhập dự kiến, 0..100 (cho thanh tiến độ). */
export function earnedPercent(row: PtWalletContractRow): number {
  const expected = num(row.expectedIncome);
  if (expected <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((num(row.earned) / expected) * 100)));
}

/** Tên hợp đồng cho người dùng: tên gói nếu biết, nếu không thì "Hợp đồng" + 6 ký tự cuối của mã (mã dùng để phân biệt, không phải nội dung). */
export function contractTitle(row: PtWalletContractRow, packageName?: string | null): string {
  if (packageName) return packageName;
  const tail = (row.contractId ?? row.transactionId).slice(-6);
  return `Hợp đồng …${tail}`;
}
