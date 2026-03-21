import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { User } from "../types";
import { authService } from "../services/api";

export type UserRole = "client" | "pt" | "admin";
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuth]  = useState(() => !!localStorage.getItem("accessToken"));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView]   = useState<WorkspaceView>("client");
  const [user, setUser]               = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem("user");
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const role: UserRole = user?.role === "ADMIN" ? "admin" : (user?.isPT || user?.role === "PT" ? "pt" : "client");
  const isPT    = role === "pt";
  const isAdmin = role === "admin";

  // Set default view based on role when user changes
  useEffect(() => {
    if (user) {
      setActiveView(user.isPT || user.role === "PT" ? "pt" : "client");
    }
  }, [user]);

  const login = async (email: string, password: string) => {
    try {
      const res = await authService.login(email, password);
      if (res.success && res.user) {
        localStorage.setItem("user", JSON.stringify(res.user));
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

  const logout = () => {
    authService.logout(); // Clears localStorage and redirects to /login in the old code
    // But since we want to handle it here too:
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    setIsAuth(false);
    setUser(null);
    setActiveView("client");
  };

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      localStorage.setItem("user", JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <AppContext.Provider value={{
      user, role, isPT, isAdmin,
      activeView, setActiveView,
      isAuthenticated, login, logout,
      setUser,
      sidebarOpen, setSidebarOpen,
      updateUser
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
