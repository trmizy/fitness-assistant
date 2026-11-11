/**
 * Số điện thoại người dùng nhập. Cùng quy tắc với user-service/src/utils/phone.util.ts (đơn ứng tuyển PT, C1-08) và trang hồ sơ chủ
 * phòng gym trên web: chỉ chữ số cùng các ký tự + - ( ) . và khoảng trắng, dài 8-20 ký tự, "+" chỉ ở đầu, và phải có từ 8 đến 15 chữ
 * số (E.164) — nên "abc" hay "+++-----" đều bị từ chối. (Mỗi service có bản riêng: không chia sẻ code giữa các service.)
 */
const PHONE_SHAPE = /^\+?[0-9 .()-]{8,20}$/;

export const PHONE_INVALID_MESSAGE = 'Số điện thoại không hợp lệ. Chỉ nhập chữ số (có thể bắt đầu bằng +), ví dụ 0901234567 hoặc +84 901 234 567.';

export function isValidPhoneNumber(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!PHONE_SHAPE.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '').length;
  return digits >= 8 && digits <= 15;
}
