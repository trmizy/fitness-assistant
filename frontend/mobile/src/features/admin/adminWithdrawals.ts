/**
 * AD-06 "Rút tiền" — phần thuần. Luật lấy thẳng từ `payment-service/withdrawal.service.ts`
 * (đọc 28/9), không suy từ giao diện:
 * - `approve`: chỉ từ PENDING → APPROVED, và là bước **giữ chỗ tuỳ chọn** (khoá số tiền lại).
 * - `mark-paid`: từ PENDING **hoặc** APPROVED → PAID; bắt buộc mã tham chiếu ngân hàng; đây là bước
 *   DUY NHẤT thực sự trừ tiền khỏi ví, và chỉ ghi nhận một chuyển khoản admin ĐÃ làm bên ngoài.
 * - `reject`: từ PENDING hoặc APPROVED (APPROVED thì nhả khoản giữ chỗ); bắt buộc lý do.
 * Hàng chờ `GET /admin/payments/withdrawals` chỉ trả PENDING + APPROVED.
 */
import { money } from "../wallet/wallet";

export type OwnerType = "PT" | "GYM" | "CLIENT";

export type AdminWithdrawal = {
  id: string;
  ownerType: OwnerType | string;
  ownerId: string;
  amount: string | number;
  status: string;
  payoutInfo?: string | null;
  createdAt?: string | null;
  reviewedAt?: string | null;
};

export const OWNER_TYPE_LABEL: Record<string, string> = {
  PT: "Huấn luyện viên",
  GYM: "Phòng gym",
  CLIENT: "Khách hàng",
};

export function withdrawalRows(raw: unknown): AdminWithdrawal[] {
  const list = Array.isArray(raw) ? raw : ((raw as any)?.data ?? (raw as any)?.items ?? []);
  return (Array.isArray(list) ? list : []).filter((r: any) => r?.id);
}

/** Cũ nhất lên đầu: người chờ tiền lâu nhất được xử lý trước. */
export function sortOldestFirst(rows: AdminWithdrawal[]): AdminWithdrawal[] {
  const t = (r: AdminWithdrawal) => new Date(r.createdAt ?? 0).getTime() || 0;
  return [...rows].sort((a, b) => t(a) - t(b));
}

export function canApprove(r: AdminWithdrawal): boolean {
  return r.status === "PENDING";
}

export function canMarkPaid(r: AdminWithdrawal): boolean {
  return r.status === "PENDING" || r.status === "APPROVED";
}

export function canReject(r: AdminWithdrawal): boolean {
  return r.status === "PENDING" || r.status === "APPROVED";
}

export function queueTotal(rows: AdminWithdrawal[]): number {
  return rows.reduce((s, r) => s + money(r.amount), 0);
}

export function bankReferenceError(v: string): string | null {
  if (!v.trim()) return "Nhập mã tham chiếu của giao dịch chuyển khoản.";
  if (v.trim().length < 4) return "Mã tham chiếu quá ngắn — dán đúng mã ngân hàng trả về.";
  return null;
}

export function rejectReasonError(v: string): string | null {
  if (!v.trim()) return "Nhập lý do — người rút tiền sẽ đọc câu này.";
  if (v.trim().length < 5) return "Lý do quá ngắn để người rút tiền hiểu.";
  return null;
}

/**
 * Tên người rút. Gateway `/admin/users` cho tên + email của PT/khách theo `id` tài khoản; phòng gym
 * rút bằng `ownerId` là id chi nhánh nên tra ở bản đồ tên chi nhánh. Không tra được thì nói rõ là
 * mã rút gọn — không bao giờ để trống.
 */
export function ownerDisplay(
  r: AdminWithdrawal,
  users: Map<string, { name?: string; email?: string }>,
  gyms: Map<string, string> = new Map(),
): { title: string; subtitle: string } {
  const kind = OWNER_TYPE_LABEL[r.ownerType] ?? String(r.ownerType);
  if (r.ownerType === "GYM") {
    const g = gyms.get(r.ownerId);
    return g ? { title: g, subtitle: kind } : { title: `${kind} ${r.ownerId.slice(0, 8)}`, subtitle: "Chưa tra được tên" };
  }
  const u = users.get(r.ownerId);
  if (u && (u.name || u.email)) {
    return { title: u.name || u.email || "", subtitle: [kind, u.name ? u.email : ""].filter(Boolean).join(" · ") };
  }
  return { title: `${kind} ${r.ownerId.slice(0, 8)}`, subtitle: "Chưa tra được tên" };
}

export function userDirectory(raw: unknown): Map<string, { name?: string; email?: string }> {
  const d = (raw as any)?.data ?? raw;
  const list = Array.isArray(d) ? d : (d?.users ?? []);
  const map = new Map<string, { name?: string; email?: string }>();
  for (const u of Array.isArray(list) ? list : []) {
    if (u?.id) map.set(String(u.id), { name: u.name ?? undefined, email: u.email ?? undefined });
  }
  return map;
}

/**
 * `payoutInfo` là chuỗi người rút tự khai lúc tạo yêu cầu ("0123456789-Vietcombank-PT"). Không tách
 * ra các ô riêng: định dạng không cố định giữa ví PT/khách/gym, đoán sai còn tệ hơn in nguyên văn.
 */
export function payoutText(r: AdminWithdrawal): string {
  return String(r.payoutInfo ?? "").trim() || "Chưa có thông tin nhận tiền";
}
