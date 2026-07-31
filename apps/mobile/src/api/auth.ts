import { apiClient } from "./client";
import type {
  LoginResponse,
  RegisterStartResponse,
  RegisterVerifyResponse,
} from "./types";

export const authApi = {
  login(email: string, password: string) {
    return apiClient
      .post<LoginResponse>("/auth/login", { email, password })
      .then((r) => r.data);
  },

  register(email: string, password: string, firstName?: string, lastName?: string) {
    return apiClient
      .post<RegisterStartResponse>("/auth/register", { email, password, firstName, lastName })
      .then((r) => r.data);
  },

  verifyRegistration(email: string, otp: string) {
    return apiClient
      .post<RegisterVerifyResponse>("/auth/register/verify", { email, otp })
      .then((r) => r.data);
  },

  logout(refreshToken: string) {
    return apiClient.post("/auth/logout", { refreshToken }).then((r) => r.data);
  },
};
