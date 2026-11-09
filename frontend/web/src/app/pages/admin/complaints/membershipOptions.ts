/**
 * INT-15 - the reporter's memberships at the complaint's gym, as the open-case form shows them (a pick-list instead of a typed id).
 * `GET /admin/complaints/:complaintId/membership-options` (gym-service). Pure helpers only: labels and the option builder.
 * The server decides money later; a non-refundable membership stays selectable and is only labelled.
 */
import { formatMoneyString } from "../adminFinanceOverview.utils";
import { formatDateSafe } from "./gymFormat";

export type MembershipNotRefundableReason = "STATUS_NOT_REFUNDABLE" | "NO_PAYMENT" | "PAYOUT_ALREADY_RELEASED";

export interface MembershipOption {
  membershipId: string;
  planName: string;
  status: string;
  startDate: string;
  endDate: string;
  /** decimal string, e.g. "300000.00" */
  price: string;
  refundable: boolean;
  reasonNotRefundable?: MembershipNotRefundableReason | string;
}

export const MEMBERSHIP_OPTION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Đang hoạt động",
  EXPIRED: "Đã hết hạn",
  CANCELLED: "Đã huỷ",
  PENDING_PAYMENT: "Chờ thanh toán",
  PENDING_ISSUE: "Có vấn đề thanh toán",
};

export const MEMBERSHIP_NOT_REFUNDABLE_LABEL: Record<string, string> = {
  STATUS_NOT_REFUNDABLE: "trạng thái gói không hoàn được",
  NO_PAYMENT: "chưa có thanh toán",
  PAYOUT_ALREADY_RELEASED: "tiền đã nhả cho phòng tập",
};

const has = (map: Record<string, string>, key: string | null | undefined) => !!key && Object.prototype.hasOwnProperty.call(map, key);

export const membershipOptionStatusLabel = (s: string | null | undefined): string => (has(MEMBERSHIP_OPTION_STATUS_LABEL, s) ? MEMBERSHIP_OPTION_STATUS_LABEL[s as string] : "Trạng thái khác");
export const membershipNotRefundableLabel = (r: string | null | undefined): string => (has(MEMBERSHIP_NOT_REFUNDABLE_LABEL, r) ? MEMBERSHIP_NOT_REFUNDABLE_LABEL[r as string] : "chưa rõ lý do");

/** "<plan> · <status> · <dd/mm/yyyy>–<dd/mm/yyyy> · <price>" plus " · không hoàn được: <reason>" when the membership can not be refunded. */
export function membershipOptionLabel(o: MembershipOption): string {
  const base = [o.planName || "Gói hội viên", membershipOptionStatusLabel(o.status), `${formatDateSafe(o.startDate)}–${formatDateSafe(o.endDate)}`, formatMoneyString(o.price)].join(" · ");
  return o.refundable === false ? `${base} · không hoàn được: ${membershipNotRefundableLabel(o.reasonNotRefundable)}` : base;
}

export const MEMBERSHIP_PICK_PLACEHOLDER = "-- Chọn gói của người khiếu nại --";
export const MEMBERSHIP_LOADING_TEXT = "Đang tải các gói của người khiếu nại…";
export const MEMBERSHIP_EMPTY_TEXT = "Người khiếu nại không có gói nào tại phòng tập này.";
export const MEMBERSHIP_MANUAL_LABEL = "Nhập mã gói thủ công";

export const membershipSelectOptions = (items: MembershipOption[]): Array<{ value: string; label: string }> =>
  items.filter((o) => o && typeof o.membershipId === "string" && o.membershipId).map((o) => ({ value: o.membershipId, label: membershipOptionLabel(o) }));
