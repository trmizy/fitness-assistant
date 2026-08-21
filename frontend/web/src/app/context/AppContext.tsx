import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Preferences } from "@capacitor/preferences";
import { User } from "../types";
import { authService } from "../services/api";
import { clearPendingAiState } from "../stores/pendingAiTasks";

export type UserRole = "client" | "pt" | "gym_owner" | "gym_staff" | "admin";
export type WorkspaceView = "client" | "pt";

interface AppContextType {
  user: User | null;
  role: UserRole;
  isPT: boolean;
  isAdmin: boolean;
  activeView: WorkspaceView;
  setActiveView: (view: WorkspaceView) => void;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  setUser: (user: User | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  updateUser: (updates: Partial<User>) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

function hasUsableToken(token: string | null): token is string {
  return !!token && token !== "null" && token !== "undefined";
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAuthenticated, setIsAuth] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("client");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    async function loadAuth() {
      try {
        const [tokenRes, userRes] = await Promise.all([
          Preferences.get({ key: "accessToken" }),
          Preferences.get({ key: "user" })
        ]);
        if (hasUsableToken(tokenRes.value)) {
          setIsAuth(true);
          if (userRes.value) {
            setUser(JSON.parse(userRes.value));
          }
        }
      } catch (err) {
        console.error("Failed to load auth state", err);
      } finally {
        setIsInitializing(false);
      }
    }
    loadAuth();
  }, []);

  const role: UserRole =
    user?.role === "ADMIN"
      ? "admin"
      : user?.role === "GYM_OWNER"
        ? "gym_owner"
        : user?.role === "GYM_STAFF"
          ? "gym_staff"
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
    } catch (err) {
      console.error("Login failed:", err);
      return false;
    }
  };

  const logout = async () => {
    if (user?.id) {
      clearPendingAiState(user.id);
    }
    queryClient.clear();
    await authService.logout(); // Clears Preferences and redirects to /login
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
