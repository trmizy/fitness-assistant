/**
 * Pure functions for Decision Replacement (A33-A36, G33-G35).
 * Logic separated from React for unit testability under tsx --test.
 */
import type { ReplacementItem, ReplacementStatus } from "../disputeCaseTypes";

export const PROPOSE_REPLACEMENT_CONFIRM =
  "Đề xuất thay quyết định đã duyệt. Chưa có gì thay đổi cho tới khi một quản trị viên khác duyệt. Không có tiền nào chuyển.";

export const APPROVE_REPLACEMENT_CONFIRM =
  "Sau khi duyệt, hồ sơ quay về bước đã có kết luận để lập đề xuất và duyệt quyết định mới theo bốn mắt. Quyết định cũ không bị xoá. Không có tiền nào chuyển.";

export const REJECT_REPLACEMENT_CONFIRM = "Quyết định cũ giữ nguyên và vẫn thực thi được.";

export const REPLACEMENT_STATUS_LABEL: Record<ReplacementStatus, string> = {
  PENDING: "Đang chờ duyệt",
  APPROVED: "Đã duyệt thay",
  REJECTED: "Đã bác",
};

export function replacementStatusLabel(status: string | null | undefined): string {
  if (status && status in REPLACEMENT_STATUS_LABEL) {
    return REPLACEMENT_STATUS_LABEL[status as ReplacementStatus];
  }
  return "Chưa rõ trạng thái";
}

export function replacementStatusTone(status: string | null | undefined): "pending" | "success" | "danger" | "neutral" {
  switch (status) {
    case "PENDING":
      return "pending";
    case "APPROVED":
      return "success";
    case "REJECTED":
      return "danger";
    default:
      return "neutral";
  }
}

export function validateReplacementReason(reason: string): { ok: boolean; message?: string } {
  const trimmed = reason.trim();
  if (trimmed.length < 1) {
    return { ok: false, message: "Vui lòng nhập lý do đề xuất (tối thiểu 1 ký tự)." };
  }
  if (trimmed.length > 2000) {
    return { ok: false, message: "Lý do không được vượt quá 2000 ký tự." };
  }
  return { ok: true };
}

export const REPLACEMENT_EXEC_EFFECT_NOTE = "Quyết định đã được thực thi nên không thể thay.";

export function isProposer(item: Pick<ReplacementItem, "proposedBy">, currentUserId?: string | null): boolean {
  if (!currentUserId) return false;
  return item.proposedBy === currentUserId;
}
