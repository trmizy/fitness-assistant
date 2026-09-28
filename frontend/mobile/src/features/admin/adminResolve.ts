/**
 * AD-04 "Xử lý" — phần thuần của bốn hàng việc có tiền hoặc khiếu nại dính vào. Nguồn hành vi: web
 * `AdminDisputes`, `PTServiceRefunds`, `AdminComplaintsPage` và form "hoàn tiền ngoại lệ" trên
 * `AdminDashboard`; hình dạng dữ liệu thật đọc 28/9.
 *
 * 1. Tranh chấp buổi tập — `POST /admin/sessions/:id/resolve` với 3 kết luận, bắt buộc ghi căn cứ.
 * 2. Hoàn tiền đơn dịch vụ 1-1 — tiền đã chuyển thẳng vào ví PT (không giữ tạm), nên quản trị viên
 *    tự quyết số tiền, trong trần `refundableCeiling` máy chủ tính; ghi chú bắt buộc (vào audit).
 * 3. Khiếu nại phòng gym — OPEN → IN_PROGRESS → RESOLVED, phản hồi gửi đối tác; xử lý xong là hết.
 * 4. Hoàn tiền gói hội viên ngoại lệ — chưa có danh sách để chọn (GAP-2), nên nhập mã gói như web.
 */
import { money } from "../wallet/wallet";

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "info";

function list<T>(raw: unknown): T[] {
  const d = (raw as any)?.data ?? raw;
  return (Array.isArray(d) ? d : []).filter((x: any) => x?.id) as T[];
}

// ── 1. Tranh chấp buổi tập ────────────────────────────────────────────────────────────────────

export type DisputeRuling = "COMPLETED" | "PT_NO_SHOW_CONFIRMED" | "CANCELLED";

export const DISPUTE_TYPE_LABEL: Record<string, string> = {
  DELIVERY_DISPUTE: "Khách phản đối báo cáo hoàn thành",
  PT_NO_SHOW_CLAIM: "Khách báo PT vắng — PT phản đối",
  CLIENT_NO_SHOW_CLAIM: "PT báo khách vắng — khách phản đối",
};

/** Hệ quả tiền của từng kết luận — nói trước khi người phân xử bấm, vì không đảo ngược được. */
export const RULINGS: { value: DisputeRuling; label: string; consequence: string; tone: StatusTone }[] = [
  { value: "COMPLETED", label: "Buổi tập đã diễn ra", consequence: "Trừ một buổi của khách, PT được trả tiền buổi này.", tone: "info" },
  {
    value: "PT_NO_SHOW_CONFIRMED",
    label: "Xác nhận PT vắng mặt",
    consequence: "Bồi thường khách bằng tiền, KHÔNG trừ buổi — giống như PT tự nhận vắng.",
    tone: "warning",
  },
  { value: "CANCELLED", label: "Buổi tập không diễn ra", consequence: "Không trừ buổi, không ai được trả tiền buổi này.", tone: "danger" },
];

export type DisputedSession = Record<string, any> & { id: string };
export const disputeRows = (raw: unknown) => list<DisputedSession>(raw);

export function rulingNoteError(note: string): string | null {
  if (!note.trim()) return "Ghi rõ căn cứ phân xử — cả hai bên sẽ thấy.";
  if (note.trim().length < 10) return "Căn cứ quá ngắn.";
  return null;
}

// ── 2. Hoàn tiền đơn dịch vụ 1-1 ──────────────────────────────────────────────────────────────

export type RefundOrder = Record<string, any> & { id: string };
export const refundRows = (raw: unknown) => list<RefundOrder>(raw);

export type RefundCalc = {
  totalPaid: number;
  alreadyRefunded: number;
  refundableCeiling: number;
  milestones: { intakeSubmitted: boolean; draftDelivered: boolean; accepted: boolean };
};

export function refundCalc(raw: unknown): RefundCalc | null {
  const d = (raw as any)?.data ?? raw;
  if (!d || typeof d !== "object") return null;
  const m = d.milestones ?? {};
  return {
    totalPaid: money(d.totalPaid),
    alreadyRefunded: money(d.alreadyRefunded),
    refundableCeiling: money(d.refundableCeiling),
    milestones: { intakeSubmitted: !!m.intakeSubmitted, draftDelivered: !!m.draftDelivered, accepted: !!m.accepted },
  };
}

/** Số tiền hoàn: số nguyên dương, không vượt trần máy chủ tính. */
export function refundAmountError(raw: string, ceiling: number): string | null {
  const n = Number(String(raw).replace(/[^\d]/g, ""));
  if (!raw.trim() || !Number.isFinite(n) || n <= 0) return "Nhập số tiền hoàn.";
  if (n > ceiling) return `Tối đa ${ceiling.toLocaleString("vi-VN")} ₫.`;
  return null;
}

export function refundNoteError(note: string): string | null {
  return note.trim().length >= 5 ? null : "Ghi chú quyết định là bắt buộc (lưu vào nhật ký).";
}

// ── 3. Khiếu nại phòng gym ────────────────────────────────────────────────────────────────────

export const COMPLAINT_ISSUE_LABEL: Record<string, string> = {
  CLEANLINESS: "Vệ sinh",
  STAFF_BEHAVIOR: "Thái độ nhân viên",
  EQUIPMENT_CONDITION: "Thiết bị hư hỏng",
  FALSE_ADVERTISING: "Quảng cáo sai sự thật",
  BILLING: "Tính phí sai",
  SAFETY: "An toàn",
  OTHER: "Khác",
};

export const COMPLAINT_SOURCE_LABEL: Record<string, string> = {
  SELF_DETECTED: "Quản trị viên tự phát hiện",
  MEMBER_REPORT: "Hội viên báo cáo",
  PT_REPORT: "Huấn luyện viên phản ánh",
  PARTNER_DISCLOSED: "Đối tác tự khai báo",
};

export const COMPLAINT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  OPEN: { label: "Mới", tone: "info" },
  IN_PROGRESS: { label: "Đang xử lý", tone: "warning" },
  RESOLVED: { label: "Đã xử lý", tone: "success" },
};

export const COMPLAINT_FILTERS: { value: string; label: string }[] = [
  { value: "OPEN", label: "Mới" },
  { value: "IN_PROGRESS", label: "Đang xử lý" },
  { value: "RESOLVED", label: "Đã xử lý" },
  { value: "ALL", label: "Tất cả" },
];

export type Complaint = Record<string, any> & { id: string; status: string };
export const complaintRows = (raw: unknown) => list<Complaint>(raw);

/** Chuyển trạng thái hợp lệ — một chiều, xử lý xong là điểm cuối (không phúc thẩm). */
export function complaintNextSteps(status: string): { value: "IN_PROGRESS" | "RESOLVED"; label: string }[] {
  if (status === "OPEN") return [{ value: "IN_PROGRESS", label: "Nhận xử lý" }, { value: "RESOLVED", label: "Đánh dấu đã xử lý" }];
  if (status === "IN_PROGRESS") return [{ value: "RESOLVED", label: "Đánh dấu đã xử lý" }];
  return [];
}

export function complaintResponseError(next: string, response: string): string | null {
  if (next === "RESOLVED" && response.trim().length < 10) return "Ghi phản hồi cho đối tác trước khi đóng khiếu nại.";
  return null;
}

// ── 4. Hoàn tiền gói hội viên ngoại lệ ─────────────────────────────────────────────────────────

export const MEMBERSHIP_REFUND_REASONS: { value: "GYM_VIOLATION_SUSPENDED" | "GYM_CLOSED" | "TRANSACTION_ERROR"; label: string }[] = [
  { value: "GYM_VIOLATION_SUSPENDED", label: "Phòng tập vi phạm và bị khoá" },
  { value: "GYM_CLOSED", label: "Phòng tập ngừng hoạt động / đóng cửa" },
  { value: "TRANSACTION_ERROR", label: "Lỗi giao dịch" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function membershipIdError(id: string): string | null {
  if (!id.trim()) return "Nhập mã gói hội viên.";
  if (!UUID_RE.test(id.trim())) return "Mã gói phải có dạng UUID (36 ký tự).";
  return null;
}
