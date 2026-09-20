import { z } from "zod";

// Cùng chính sách với đăng ký thường (registerSchema) — tối thiểu 8 ký tự, có chữ hoa, chữ thường
// và số — để một tài khoản đối tác không yếu hơn tài khoản khách hàng.
const PASSWORD_COMPLEXITY = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

export const partnerApplicationStartSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

export const partnerApplicationVerifySchema = z.object({
  token: z.string().trim().min(20).max(200),
});

export const partnerApplicationSetPasswordSchema = z.object({
  setupToken: z.string().trim().min(20).max(200),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(PASSWORD_COMPLEXITY, "Mật khẩu cần có chữ hoa, chữ thường và số"),
});

export type PartnerApplicationSetPasswordDto = z.infer<typeof partnerApplicationSetPasswordSchema>;
