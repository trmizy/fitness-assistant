/**
 * Agreement model for Dispute V2.1 (A41-A44, B7).
 * Pure functions, labels, and validation for mutual agreement workflow.
 */
import type { AgreementOutcome, AgreementStatus, CaseStatus } from "../disputeCaseTypes";

export const AGREEMENT_OUTCOMES: AgreementOutcome[] = [
  "COMPLETED",
  "CANCELLED",
  "PT_NO_SHOW_CONFIRMED",
];

export const AGREEMENT_OUTCOME_LABEL: Record<AgreementOutcome, string> = {
  COMPLETED: "Buổi tập được tính là đã hoàn thành",
  CANCELLED: "Buổi tập huỷ, không trừ buổi",
  PT_NO_SHOW_CONFIRMED: "Xác nhận huấn luyện viên vắng mặt",
};

export function agreementOutcomeLabel(outcome: string | null | undefined): string {
  if (outcome && outcome in AGREEMENT_OUTCOME_LABEL) {
    return AGREEMENT_OUTCOME_LABEL[outcome as AgreementOutcome];
  }
  return "Phương án khác";
}

export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  PROPOSED: "Đang chờ hai bên xác nhận",
  AGREED: "Cả hai bên đã xác nhận",
  WITHDRAWN: "Đã rút phương án",
  USED: "Đã ghi nhận kết luận",
};

export function agreementStatusLabel(status: string | null | undefined): string {
  if (status && status in AGREEMENT_STATUS_LABEL) {
    return AGREEMENT_STATUS_LABEL[status as AgreementStatus];
  }
  return "Chưa rõ trạng thái";
}

export function agreementStatusTone(
  status: string | null | undefined,
): "pending" | "success" | "neutral" | "info" {
  switch (status) {
    case "PROPOSED":
      return "pending";
    case "AGREED":
      return "success";
    case "USED":
      return "info";
    default:
      return "neutral";
  }
}

export const PROPOSE_AGREEMENT_CONFIRM =
  "Đề xuất phương án thoả thuận chung cho hai bên. Hai bên cần cùng xác nhận trước khi có thể ghi nhận kết luận. Thao tác này không tự thực thi và không chuyển tiền.";

export const PARTY_CONFIRM_AGREEMENT_NOTE =
  "Xác nhận thoả thuận không tự thực thi và không phải phán quyết.";

export const WITHDRAW_AGREEMENT_CONFIRM =
  "Rút phương án thoả thuận chung. Sau khi rút, các bên không thể xác nhận phương án này nữa.";

export const RECORD_FINDING_AGREEMENT_CONFIRM =
  "Ghi nhận kết luận hồ sơ theo phương án thoả thuận đã được hai bên đồng ý. Sau bước này, hồ sơ chuyển sang bước chờ lập đề xuất duyệt bốn mắt. Không có tiền nào chuyển.";

export function canProposeAgreement(
  caseStatus?: CaseStatus | string | null,
  investigatorId?: string | null,
  currentUserId?: string | null,
): boolean {
  if (!caseStatus || !investigatorId || !currentUserId) return false;
  if (investigatorId !== currentUserId) return false;
  return ["COLLECTING", "AWAITING_PARTIES", "ASSESSING"].includes(caseStatus);
}

export function canWithdrawAgreement(
  agreementStatus?: AgreementStatus | string | null,
  investigatorId?: string | null,
  currentUserId?: string | null,
): boolean {
  if (!agreementStatus || !investigatorId || !currentUserId) return false;
  if (investigatorId !== currentUserId) return false;
  return agreementStatus === "PROPOSED" || agreementStatus === "AGREED";
}

export function canRecordAgreementFinding(
  agreementStatus?: AgreementStatus | string | null,
  caseStatus?: CaseStatus | string | null,
  investigatorId?: string | null,
  currentUserId?: string | null,
): boolean {
  if (!agreementStatus || !caseStatus || !investigatorId || !currentUserId) return false;
  if (investigatorId !== currentUserId) return false;
  return agreementStatus === "AGREED" && caseStatus === "ASSESSING";
}

export function validateAgreementProposal(
  outcome?: string | null,
  note?: string | null,
): { ok: boolean; error?: string } {
  if (!outcome || !AGREEMENT_OUTCOMES.includes(outcome as AgreementOutcome)) {
    return { ok: false, error: "Vui lòng chọn kết quả thoả thuận hợp lệ." };
  }
  const trimmed = (note ?? "").trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    return { ok: false, error: "Ghi chú thoả thuận là bắt buộc (từ 1 đến 2000 ký tự)." };
  }
  return { ok: true };
}

