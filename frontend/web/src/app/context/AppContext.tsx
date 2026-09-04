import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Preferences } from "@capacitor/preferences";
import { App as CapacitorApp } from "@capacitor/app";
import { User } from "../types";
import { authService } from "../services/api";
import { bootstrapSession, ensureFreshAccessToken } from "../services/session";
import { onSessionExpired } from "../services/sessionEvents";
import { clearPendingAiState } from "../stores/pendingAiTasks";

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
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  updateUser: (updates: Partial<User>) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAuthenticated, setIsAuth] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("client");
  const [user, setUser] = useState<User | null>(null);

  // Restore the session BEFORE the router renders anything. Nothing below this point
  // sees a half-known auth state, which is what used to flash the login screen on
  // every cold start (see services/session.ts for the full reasoning).
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

  // services/api.ts sits outside the React tree, so when it decides a session is over it
  // emits instead of assigning window.location (which would reload the whole app). Here,
  // inside the tree, that becomes a plain router navigation.
  useEffect(() => {
    return onSessionExpired(() => {
      setIsAuth(false);
      setUser(null);
      setActiveView("client");
      queryClient.clear();
      navigate("/login", { replace: true });
    });
  }, [navigate, queryClient]);

  // Deep links (fitnessassistant://...) — currently unused by the payment flow, which works
  // off the browser tab closing, but wired up so an external return lands in the right screen
  // without reloading the app.
  //
  // SECURITY: whatever the link says is treated as a ROUTE, never as a fact. A link claiming
  // "?success=true" proves nothing — anyone can open one. The result screen it lands on always
  // asks the server (POST /me/payments/:id/sync) and only shows success if the server agrees.
  useEffect(() => {
    const listener = CapacitorApp.addListener("appUrlOpen", ({ url }) => {
      try {
        const parsed = new URL(url);
        // With a custom scheme, the first path segment is parsed as the HOST:
        // "fitnessassistant://client/payments/result" gives host "client" and pathname
        // "/payments/result". Dropping the host would navigate to "/payments/result",
        // which is not a route — the segment has to be put back.
        const host = parsed.host ? `/${parsed.host}` : "";
        const target = `${host}${parsed.pathname}${parsed.search}` || "/";
        navigate(target.startsWith("/") ? target : `/${target}`, { replace: true });
      } catch {
        // A malformed link is not worth acting on at all.
      }
    });
    return () => {
      void listener.then((l) => l.remove());
    };
  }, [navigate]);

  // An app resumed after hours in the background must not wait for its first request to
  // fail before noticing the access token died. Refresh up front, on the way back in.
  useEffect(() => {
    const listener = CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive || !isAuthenticated) return;
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
    return () => {
      void listener.then((l) => l.remove());
    };
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

  // Set default view based on role ONLY on first load (not on every user change).
  // AppShell syncs activeView from the actual URL path after that, so it is the
  // authoritative source. Re-running this effect on every user change caused the
  // view to reset back to "pt" even when the PT was browsing the client workspace.
  const viewInitializedRef = useRef(false);
  useEffect(() => {
    if (user && !viewInitializedRef.current) {
      viewInitializedRef.current = true;
      const path = window.location.pathname;
      // For PT users, use the current URL to determine the right default view
      if (user.isPT || user.role === "PT") {
        setActiveView(path.startsWith("/client") ? "client" : "pt");
      } else {
        setActiveView("client");
      }
    }
  }, [user]);

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
      // Only a real 401 (wrong email/password) collapses to `false` — LoginPage shows its
      // "Email hoặc mật khẩu không đúng" message for that. Anything else (429 rate-limit,
      // network failure, 5xx) gets rethrown so LoginPage can tell the user what actually
      // happened instead of falsely blaming their credentials (found during mobile QA: a
      // rate-limited PT login showed the exact same "wrong password" message as a real one).
      if (err?.response?.status === 401) return false;
      throw err;
    }
  };

  const logout = async () => {
    if (user?.id) {
      clearPendingAiState(user.id);
    }
    queryClient.clear();
    // Revokes the refresh token server-side, clears Preferences, then emits
    // "session expired" — the listener above turns that into a router navigation.
    await authService.logout();
    setIsAuth(false);
    setUser(null);
    setActiveView("client");
  };

  const updateUser = useCallback(async (updates: Partial<User>) => {
    if (!user) return;
    const next = { ...user, ...updates };
    setUser(next);
    await Preferences.set({ key: "user", value: JSON.stringify(next) });
  }, [user]);

  if (isInitializing) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
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
        sidebarOpen,
        setSidebarOpen,
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
