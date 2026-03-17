import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export const registerStartSchema = registerSchema;

export const registerVerifySchema = z.object({
  email: z.string().email(),
  otp: z.string().min(6).max(6),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const refreshSchema = z.object({
  refreshToken: z.string(),
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type RegisterStartDto = z.infer<typeof registerStartSchema>;
export type RegisterVerifyDto = z.infer<typeof registerVerifySchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
