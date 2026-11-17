/**
 * N15C-05 / N15C-11 — whether a branch can currently hand out / accept check-in QR, and the Vietnamese sentence for
 * when it cannot. Mirrors gym-service `isGymAcceptingCheckin`: APPROVED or admin-SUSPENDED, and only while the branch
 * is operationally OPEN. The date is the owner's EXPECTED reopening (display only - nobody reopens automatically).
 */
export interface BranchCheckinInput {
  status?: string | null;
  operationalStatus?: string | null;
  expectedReopenAt?: string | null;
}

export function isBranchAcceptingCheckin(b: BranchCheckinInput | null | undefined): boolean {
  if (!b || !b.status) return true; // unknown yet -> let the server decide
  return (b.status === "APPROVED" || b.status === "SUSPENDED") && (b.operationalStatus ?? "OPEN") === "OPEN";
}

/** "20 tháng 11, 2026" */
export function formatViDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", { day: "numeric", month: "long", year: "numeric" });
}

/** Sentence shown instead of the QR while the branch is closed. */
export function checkinClosedMessage(b: BranchCheckinInput | null | undefined, reopenAtFromServer?: string | null): string {
  const reopenAt = reopenAtFromServer || b?.expectedReopenAt || null;
  if (b?.operationalStatus === "PERMANENTLY_CLOSED") return "Chi nhánh đã đóng cửa vĩnh viễn nên không có mã QR check-in.";
  if (b?.operationalStatus === "TEMPORARILY_CLOSED" || reopenAtFromServer) {
    return reopenAt
      ? `Chi nhánh đang tạm đóng cửa, dự kiến mở lại ngày ${formatViDate(reopenAt)}. Mã QR check-in sẽ xuất hiện ở đây khi chi nhánh mở lại.`
      : "Chi nhánh đang tạm đóng cửa. Mã QR check-in sẽ xuất hiện ở đây khi chi nhánh mở lại.";
  }
  return "Chi nhánh chưa hoạt động nên chưa có mã QR check-in.";
}

/** Member-side scan refusal (GYM_NOT_ACTIVE), with the reopen date when the owner gave one. */
export function memberScanClosedMessage(expectedReopenAt?: string | null): string {
  return expectedReopenAt
    ? `Phòng gym đang tạm đóng cửa, dự kiến mở lại ngày ${formatViDate(expectedReopenAt)}. Bạn quay lại check-in khi phòng gym mở cửa nhé.`
    : "Phòng gym hiện đang đóng cửa hoặc chưa hoạt động nên chưa nhận check-in.";
}
