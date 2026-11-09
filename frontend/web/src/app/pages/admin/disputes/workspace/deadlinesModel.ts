/**
 * Deadlines model for Dispute V2.1 (A37) and Gym complaints (G31, G36).
 * Pure functions and labels for read-only deadlines list.
 */
import { formatDateTime } from "./format";

export const DEADLINE_NOTE =
  "Hết hạn chỉ ghi nhận việc không phản hồi, không phán quyết chống lại bên im lặng.";

export const DEADLINE_KIND_LABEL: Record<string, string> = {
  PT_NO_SHOW_ANSWER: "PT phản hồi báo vắng",
  COLLECT_EVIDENCE: "Thu thập bằng chứng",
  AWAITING_PARTIES: "Phản hồi thông tin",
  APPEAL_WINDOW: "Thời hạn yêu cầu xem xét lại",
  STATEMENT: "Nộp lời khai",
  EVIDENCE: "Bổ sung tài liệu",
  APPEAL: "Thời hạn xem xét lại",
};

export function deadlineKindLabel(kind: string | null | undefined): string {
  if (kind && kind in DEADLINE_KIND_LABEL) {
    return DEADLINE_KIND_LABEL[kind];
  }
  return kind ?? "Thời hạn khác";
}

export const DEADLINE_PARTY_LABEL: Record<string, string> = {
  CLIENT: "Khách",
  PT: "PT",
  MEMBER: "Hội viên",
  GYM: "Phòng tập",
};

export function deadlinePartyLabel(partyRole: string | null | undefined): string {
  if (partyRole && partyRole in DEADLINE_PARTY_LABEL) {
    return DEADLINE_PARTY_LABEL[partyRole];
  }
  return partyRole ?? "Bên liên quan";
}

export const DEADLINE_STATUS_LABEL: Record<string, string> = {
  OPEN: "Đang mở",
  SATISFIED: "Đã hoàn thành",
  EXPIRED: "Đã hết hạn",
  CANCELLED: "Đã huỷ",
};

export function deadlineStatusLabel(status: string | null | undefined): string {
  if (status && status in DEADLINE_STATUS_LABEL) {
    return DEADLINE_STATUS_LABEL[status];
  }
  return status ?? "Đang theo dõi";
}

export function deadlineStatusTone(
  status: string | null | undefined,
): "info" | "success" | "danger" | "neutral" {
  switch (status) {
    case "OPEN":
      return "info";
    case "SATISFIED":
      return "success";
    case "EXPIRED":
      return "danger";
    default:
      return "neutral";
  }
}

export function deadlineDueText(
  dueAt: string | Date | null | undefined,
  paused?: boolean | null,
): string {
  if (paused || !dueAt) {
    return "Đang tạm dừng";
  }
  const str = typeof dueAt === "string" ? dueAt : dueAt.toISOString();
  return formatDateTime(str);
}

