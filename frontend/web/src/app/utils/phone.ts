/**
 * Số điện thoại người dùng nhập — CÙNG quy tắc với gym-service/src/utils/phone.util.ts (server vẫn là cổng thật):
 * chỉ chữ số cùng các ký tự + - ( ) . và khoảng trắng, dài 8-20 ký tự, "+" chỉ ở đầu, và có từ 8 đến 15 chữ số.
 * Dùng để báo lỗi ngay trong form thay vì đợi server từ chối ở bước lưu nháp.
 */
const PHONE_SHAPE = /^\+?[0-9 .()-]{8,20}$/;

export const PHONE_INVALID_MESSAGE = "Số điện thoại chưa hợp lệ — chỉ nhập chữ số, ví dụ 0901 234 567 hoặc +84 901 234 567.";

export function isValidPhoneNumber(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!PHONE_SHAPE.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 15;
}
