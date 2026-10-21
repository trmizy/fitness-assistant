/**
 * D15b — phần thuần (không React) của quầy lễ tân: "khách hôm nay" và "PT đã check-in hôm nay".
 *
 * Server (gym-service, staff-views.ts) đã chỉ trả tên hiển thị + giờ. Hàm `normalize*` ở đây cố ý chỉ GIỮ các trường đó:
 * dù một ngày nào đó server lỡ gửi thêm (id, SĐT, e-mail…) thì giao diện cũng không có chỗ để hiện chúng.
 */

export interface FrontDeskClient {
  displayName: string;
  checkedInAt: string | null;
  bookedAt: string | null;
}

export interface TodayPt {
  id: string;
  ptName: string;
  firstScanAt: string | null;
}

export interface FrontDeskToday {
  localDate: string | null;
  bookingsAvailable: boolean;
  clients: FrontDeskClient[];
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function normalizeFrontDeskToday(raw: unknown): FrontDeskToday {
  const d = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(d.clients) ? d.clients : [];
  return {
    localDate: text(d.localDate),
    bookingsAvailable: d.bookingsAvailable !== false,
    clients: list.map((c) => {
      const r = (c ?? {}) as Record<string, unknown>;
      return { displayName: text(r.displayName) ?? "Hội viên", checkedInAt: text(r.checkedInAt), bookedAt: text(r.bookedAt) };
    }),
  };
}

export function normalizeTodayPts(raw: unknown): TodayPt[] {
  const d = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(d.pts) ? d.pts : [];
  return list.map((p, i) => {
    const r = (p ?? {}) as Record<string, unknown>;
    return { id: text(r.id) ?? `pt-${i}`, ptName: text(r.ptName) ?? "Huấn luyện viên", firstScanAt: text(r.firstScanAt) };
  });
}

/** "09:15" theo giờ Việt Nam (không phụ thuộc múi giờ máy). */
export function clockLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh", hour12: false });
}

export type PresenceKind = "CHECKED_IN" | "BOOKED";

/** Một khách có thể vừa có lịch vừa đã check-in: check-in thắng (đã có mặt). */
export function presenceOf(c: FrontDeskClient): { kind: PresenceKind; label: string } {
  if (c.checkedInAt) return { kind: "CHECKED_IN", label: `Đã vào ${clockLabel(c.checkedInAt)}`.trim() };
  return { kind: "BOOKED", label: `Có lịch ${clockLabel(c.bookedAt)}`.trim() };
}

/** Lọc theo tên (không phân biệt hoa thường). Không có ô tìm theo mã khách vì lễ tân không thấy mã. */
export function filterByName<T extends { displayName: string }>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.displayName.toLowerCase().includes(q)) : [...rows];
}
