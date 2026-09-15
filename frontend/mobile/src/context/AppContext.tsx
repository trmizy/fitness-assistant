import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import { usePathname } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";

import { Preferences } from "../services/storage";
import { User } from "../types";
import { authService } from "../services/api";
import { bootstrapSession, ensureFreshAccessToken } from "../services/session";
import { onSessionExpired } from "../services/sessionEvents";
import { darkColors } from "../theme/colors";

// Money-flow plan 5.1: "gym_staff" removed — see the `role` assignment below.
export type UserRole = "client" | "pt" | "gym_owner" | "admin";
export type WorkspaceView = "client" | "pt";

interface AppContextType {
  user: User | null;
  role: UserRole;
  isPT: boolean;
  isAdmin: boolean;
  activeView: WorkspaceView;
  setActiveView: (view: WorkspaceView) => void;
  isAuthenticated: boolean;
  // Resolves `false` only for a real wrong-email/password (401). Any other failure — rate
  // limit, network, server error — rejects instead, so the caller can show what actually
  // happened rather than a blanket "wrong password".
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  setUser: (user: User | null) => void;
  updateUser: (updates: Partial<User>) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAuthenticated, setIsAuth] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("client");
  const [user, setUser] = useState<User | null>(null);

  // `sidebarOpen` from web is deliberately not ported: it drove a desktop sidebar that has no
  // counterpart in the mobile design (tab bar + sheets instead).

  // Restore the session BEFORE anything renders. Nothing below this point sees a half-known
  // auth state, which is what used to flash the login screen on every cold start on web
  // (see services/session.ts for the full reasoning).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await bootstrapSession();
      if (cancelled) return;
      if (result.status === "authenticated") {
        setUser(result.user);
        setIsAuth(true);
      } else {
        setUser(null);
        setIsAuth(false);
      }
      setIsInitializing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // services/api.ts sits outside the React tree, so when it decides a session is over it emits
  // instead of navigating. Clearing the auth state here is the half that works today; the
  // matching "send them to the login screen" navigation arrives in Phase 4, which is what
  // creates the (auth) route group and the role guards that read this state.
  useEffect(() => {
    return onSessionExpired(() => {
      setIsAuth(false);
      setUser(null);
      setActiveView("client");
      queryClient.clear();
    });
  }, [queryClient]);

  // An app resumed after hours in the background must not wait for its first request to fail
  // before noticing the access token died. Refresh up front, on the way back in. Web used
  // Capacitor's appStateChange; RN's own AppState is the direct equivalent.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !isAuthenticated) return;
      void (async () => {
        const stillValid = await ensureFreshAccessToken();
        // Only false when the server actively rejected the refresh token — an unreachable
        // server returns true, so a bad connection never logs anyone out.
        if (!stillValid) {
          setIsAuth(false);
          setUser(null);
        }
      })();
    });
    return () => subscription.remove();
  }, [isAuthenticated]);

  // Money-flow plan 5.1: GYM_STAFF removed — gym owners operate everything themselves now.
  const role: UserRole =
    user?.role === "ADMIN"
      ? "admin"
      : user?.role === "GYM_OWNER"
        ? "gym_owner"
        : user?.isPT || user?.role === "PT"
          ? "pt"
          : "client";
  const isPT = role === "pt";
  const isAdmin = role === "admin";

  // Set the default view from the role ONLY on first load, not on every user change: on web,
  // re-running this reset a PT back to the "pt" view even while they were browsing the client
  // workspace. After this, the route layout owns activeView.
  const viewInitializedRef = useRef(false);
  useEffect(() => {
    if (user && !viewInitializedRef.current) {
      viewInitializedRef.current = true;
      if (user.isPT || user.role === "PT") {
        setActiveView(pathname.startsWith("/client") ? "client" : "pt");
      } else {
        setActiveView("client");
      }
    }
  }, [user, pathname]);

  const login = async (email: string, password: string) => {
    try {
      const res = await authService.login(email, password);
      if (res.success && res.user) {
        queryClient.clear();
        await Preferences.set({ key: "user", value: JSON.stringify(res.user) });
        setUser(res.user);
        setIsAuth(true);
        return true;
      }
      return false;
    } catch (err: any) {
      console.error("Login failed:", err);
      // Only a real 401 (wrong email/password) collapses to `false`. Anything else (429
      // rate-limit, network failure, 5xx) is rethrown so the caller can say what actually
      // happened instead of falsely blaming the credentials — found during web's mobile QA,
      // where a rate-limited PT login showed the same "wrong password" message as a real one.
      if (err?.response?.status === 401) return false;
      throw err;
    }
  };

  const logout = async () => {
    // Web also cleared its pending-AI-task store here; that store belongs to the AI Coach
    // screens and arrives with them in Phase 8.
    queryClient.clear();
    // Revokes the refresh token server-side, clears local storage, then emits "session expired".
    await authService.logout();
    setIsAuth(false);
    setUser(null);
    setActiveView("client");
  };

  const updateUser = useCallback(
    async (updates: Partial<User>) => {
      if (!user) return;
      const next = { ...user, ...updates };
      setUser(next);
      await Preferences.set({ key: "user", value: JSON.stringify(next) });
    },
    [user],
  );

  if (isInitializing) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: darkColors.background,
        }}
      >
        <ActivityIndicator size="large" color={darkColors.primary} />
      </View>
    );
  }

  return (
    <AppContext.Provider
      value={{
        user,
        role,
        isPT,
        isAdmin,
        activeView,
        setActiveView,
        isAuthenticated,
        login,
        logout,
        setUser,
        updateUser,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
