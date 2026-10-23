/**
 * D15 — xuất CSV cho KẾ TOÁN (quyền finance.export). Chỉ biến đổi dữ liệu MÀ SERVER ĐÃ TRẢ cho vai trò này
 * (doanh số không có clientId, rút tiền đã che số tài khoản) — không có nguồn dữ liệu thứ hai, nên xuất file
 * không thể lộ nhiều hơn màn hình.
 */

export type SalesRow = {
  id: string;
  gymId: string;
  planId: string;
  status: string;
  priceAtPurchase: string | number;
  paymentTxnId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  createdAt?: string | null;
};

export type WithdrawalRow = {
  id: string;
  amount: string | number;
  status: string;
  bankReference?: string | null;
  payoutInfo?: string | null;
  createdAt?: string | null;
  paidAt?: string | null;
};

/** Chống CSV injection (=, +, -, @ đầu ô) + đúng RFC 4180 cho dấu phẩy / nháy kép / xuống dòng. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function salesCsv(rows: SalesRow[], names: { gym: (id: string) => string; plan: (id: string) => string }): string {
  return toCsv(
    ["Mã thẻ", "Chi nhánh", "Gói", "Trạng thái", "Giá (VND)", "Mã giao dịch", "Bắt đầu", "Kết thúc", "Ngày tạo"],
    rows.map((r) => [r.id, names.gym(r.gymId), names.plan(r.planId), r.status, Number(r.priceAtPurchase), r.paymentTxnId ?? "", r.startDate ?? "", r.endDate ?? "", r.createdAt ?? ""]),
  );
}

export function withdrawalsCsv(rows: (WithdrawalRow & { gymName?: string })[]): string {
  return toCsv(
    ["Mã yêu cầu", "Chi nhánh", "Số tiền (VND)", "Trạng thái", "Mã tham chiếu", "Thông tin nhận tiền (đã che)", "Ngày tạo", "Ngày chi"],
    rows.map((r) => [r.id, r.gymName ?? "", Number(r.amount), r.status, r.bankReference ?? "", r.payoutInfo ?? "", r.createdAt ?? "", r.paidAt ?? ""]),
  );
}

/** Doanh số ghi nhận = thẻ đã thanh toán (đang dùng + đã hết hạn). Chờ thanh toán / đã huỷ không tính. */
export function recognizedSales(rows: SalesRow[]): { total: number; count: number } {
  const paid = rows.filter((r) => r.status === "ACTIVE" || r.status === "EXPIRED");
  return { total: paid.reduce((sum, r) => sum + Number(r.priceAtPurchase || 0), 0), count: paid.length };
}
