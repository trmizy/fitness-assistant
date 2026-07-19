import { create } from "zustand";
import { authApi } from "../api/auth";
import { setOnAuthFailure } from "../api/client";
import { setInMemoryTokens } from "../api/tokenHolder";
import {
  clearTokens,
  getStoredUser,
  getTokens,
  setStoredUser,
  setTokens,
} from "../api/secureTokenStore";
import type { AuthUser } from "../api/types";

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  setSessionFromRegistration: (user: AuthUser, tokens: { accessToken: string; refreshToken: string }) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isBootstrapping: true,

  bootstrap: async () => {
    setOnAuthFailure(() => {
      // Refresh failed somewhere in the app (e.g. background fetch) —
      // force back to the logged-out state so expo-router redirects to
      // (auth)/login.
      set({ user: null, isAuthenticated: false });
    });

    const tokens = await getTokens();
    if (!tokens) {
      set({ isBootstrapping: false });
      return;
    }
    setInMemoryTokens(tokens);
    const user = await getStoredUser<AuthUser>();
    set({ user, isAuthenticated: Boolean(user), isBootstrapping: false });
  },

  login: async (email, password) => {
    const { user, ...tokens } = await authApi.login(email, password);
    setInMemoryTokens(tokens);
    await Promise.all([setTokens(tokens), setStoredUser(user)]);
    set({ user, isAuthenticated: true });
  },

  setSessionFromRegistration: async (user, tokens) => {
    setInMemoryTokens(tokens);
    await Promise.all([setTokens(tokens), setStoredUser(user)]);
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    const tokens = await getTokens();
    if (tokens) {
      await authApi.logout(tokens.refreshToken).catch(() => {
        // best-effort — local session is cleared regardless
      });
    }
    await clearTokens();
    setInMemoryTokens(null);
    set({ user: null, isAuthenticated: false });
  },
}));
