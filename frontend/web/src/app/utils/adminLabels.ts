// Nhãn tiếng Việt cho các giá trị mà gateway (`GET /admin/dashboard`, `GET /admin/users`) trả về
// bằng tiếng Anh. Chỉ đổi cách hiển thị — giá trị gốc vẫn dùng để lọc/so sánh.

const ADMIN_ROLE_VI: Record<string, string> = {
  Admin: "Quản trị viên",
  PT: "Huấn luyện viên (PT)",
  "Gym Owner": "Chủ phòng gym",
  Client: "Hội viên",
  // Tên lát cắt biểu đồ vai trò ở dashboard admin
  Clients: "Hội viên",
  Trainers: "Huấn luyện viên",
  "Gym owners": "Chủ phòng gym",
};

const ADMIN_STATUS_VI: Record<string, string> = {
  Active: "Đang hoạt động",
  Inactive: "Đã khóa",
  Pending: "Chờ duyệt",
};

export function adminRoleVi(role: string | null | undefined): string {
  if (!role) return "—";
  return ADMIN_ROLE_VI[role] ?? role;
}

export function adminStatusVi(status: string | null | undefined): string {
  if (!status) return "—";
  return ADMIN_STATUS_VI[status] ?? status;
}

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Gateway gửi ngày dạng "Oct 24" (en-US, không có năm). Đổi sang "24/10"; chuỗi không khớp
 * (đã là ISO, "—", "Never"...) được trả nguyên hoặc xử lý riêng.
 */
export function adminShortDateVi(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(value.trim());
  if (m) {
    const month = MONTH_ABBR[m[1].toLowerCase()];
    if (month) {
      const day = String(Number(m[2])).padStart(2, "0");
      const mm = String(month).padStart(2, "0");
      return m[3] ? `${day}/${mm}/${m[3]}` : `${day}/${mm}`;
    }
  }
  const t = Date.parse(value);
  if (!Number.isNaN(t) && /\d{4}-\d{2}-\d{2}/.test(value)) {
    return new Date(t).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  if (/^never$/i.test(value.trim())) return "Chưa từng";
  if (/^just now$/i.test(value.trim())) return "Vừa xong";
  const ago = /^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(value.trim());
  if (ago) {
    const unit: Record<string, string> = { second: "giây", minute: "phút", hour: "giờ", day: "ngày", week: "tuần", month: "tháng", year: "năm" };
    return `${ago[1]} ${unit[ago[2].toLowerCase()]} trước`;
  }
  return value;
}
