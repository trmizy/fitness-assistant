// Types hand-written từ apps/mobile/API_MAP.md — @gym-coach/shared không
// phải nguồn type đầy đủ cho response API (xem DECISIONS.md). Không tự
// động sync với backend, cập nhật thủ công khi API đổi.

export type UserRole = "CUSTOMER" | "PT" | "ADMIN" | "GYM_OWNER" | "GYM_STAFF";

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export interface RegisterStartResponse {
  message: string;
  email: string;
  expiresInMinutes: number;
  devOtp?: string;
}

export interface RegisterVerifyResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
