import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { env } from "../config/env";
import { getAccessToken, getRefreshToken, setInMemoryTokens } from "./tokenHolder";
import { clearTokens, setTokens } from "./secureTokenStore";
import type { ApiErrorBody, RefreshResponse } from "./types";

// Requests to these paths never trigger the refresh flow, mirroring the
// web app's guard (frontend/web/src/app/services/api.ts) — otherwise a
// failed login attempt would recurse into refresh-then-retry.
const AUTH_PATHS_EXCLUDED_FROM_REFRESH = ["/auth/login", "/auth/register", "/auth/refresh"];

export const apiClient = axios.create({
  baseURL: env.apiUrl,
  timeout: 20000,
});

// Separate instance for the refresh call itself, so it never re-enters
// the response interceptor below (avoids infinite recursion on 401).
const refreshClient = axios.create({
  baseURL: env.apiUrl,
  timeout: 20000,
});

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type AuthFailureHandler = () => void;
let onAuthFailure: AuthFailureHandler | null = null;

// authStore registers this on bootstrap — keeps client.ts decoupled from
// the store to avoid a circular import (store configures client, not the
// other way around).
export function setOnAuthFailure(handler: AuthFailureHandler) {
  onAuthFailure = handler;
}

// Single-flight refresh dedupe: concurrent 401s from multiple screens
// mounting in parallel share one POST /auth/refresh call.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const currentRefreshToken = getRefreshToken();
    if (!currentRefreshToken) return null;
    try {
      const { data } = await refreshClient.post<RefreshResponse>("/auth/refresh", {
        refreshToken: currentRefreshToken,
      });
      setInMemoryTokens(data);
      await setTokens(data);
      return data.accessToken;
    } catch {
      return null;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

interface RetryableConfig extends AxiosRequestConfig {
  _retry?: boolean;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const { config, response } = error;
    const original = config as RetryableConfig | undefined;

    const isTokenIssue =
      response?.status === 401 &&
      (response.data?.error?.code === "UNAUTHORIZED" ||
        /token|unauthorized/i.test(response.data?.error?.message ?? ""));

    const excluded = AUTH_PATHS_EXCLUDED_FROM_REFRESH.some((p) => original?.url?.includes(p));

    if (!original || !isTokenIssue || excluded || original._retry) {
      return Promise.reject(error);
    }

    original._retry = true;
    const newAccessToken = await refreshAccessToken();

    if (!newAccessToken) {
      await clearTokens();
      setInMemoryTokens(null);
      onAuthFailure?.();
      return Promise.reject(error);
    }

    original.headers = { ...original.headers, Authorization: `Bearer ${newAccessToken}` };
    return apiClient(original);
  },
);

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined;
    return body?.error?.message ?? fallback;
  }
  return fallback;
}
