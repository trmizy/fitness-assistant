import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AppProvider } from "./context/AppContext";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";

// Client pages
import { ClientDashboard } from "./pages/client/ClientDashboard";
import { InBodyModule } from "./pages/client/InBodyModule";
import { AIPlansPage } from "./pages/client/AIPlansPage";
import { ContractPage } from "./pages/client/ContractPage";
import { ChatPage } from "./pages/client/ChatPage";
import { BookingPage } from "./pages/client/BookingPage";
import { WorkoutLogPage } from "./pages/client/WorkoutLogPage";
import { NutritionPage } from "./pages/client/NutritionPage";
import { PTDiscoveryPage } from "./pages/client/PTDiscoveryPage";
import { AICoachPage } from "./pages/client/AICoachPage";
import { ProfilePage } from "./pages/client/ProfilePage";
import { PTApplicationPage } from "./pages/client/PTApplicationPage";

// PT pages
import { PTDashboard } from "./pages/pt/PTDashboard";
import { PTClientList } from "./pages/pt/PTClientList";
import { PTClientDetail } from "./pages/pt/PTClientDetail";
import { PlanReviewPage } from "./pages/pt/PlanReviewPage";
import { PTSchedulePage } from "./pages/pt/PTSchedulePage";
import { PTProfilePage } from "./pages/pt/PTProfilePage";

// Admin pages
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { UserManagement } from "./pages/admin/UserManagement";
import { PTManagement } from "./pages/admin/PTManagement";
import { SystemMonitoring } from "./pages/admin/SystemMonitoring";

import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Avoid repeated retries for auth/client-side errors that only slow initial render.
      retry: (failureCount, error: any) => {
        const status = error?.response?.status;
        if (typeof status === "number" && status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

/** Root layout — provides AppContext to the entire router tree */
function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <Toaster position="top-center" expand={false} richColors />
        <Outlet />
      </AppProvider>
    </QueryClientProvider>
  );
}

export const router = createBrowserRouter([
  {
    // Root wraps everything so AppProvider is always in context
    path: "/",
    Component: Root,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="/login" replace /> },
      { path: "login",    Component: LoginPage    },
      { path: "register", Component: RegisterPage },

      // ── Client workspace ────────────────────────────────────────────────
      {
        path: "client",
        Component: AppShell,
        children: [
          { index: true, element: <Navigate to="/client/dashboard" replace /> },
          { path: "dashboard", Component: ClientDashboard },
          { path: "inbody",    Component: InBodyModule    },
          { path: "plans",     Component: AIPlansPage     },
          { path: "contracts", Component: ContractPage    },
          { path: "chat",      Component: ChatPage        },
          { path: "booking",   Component: BookingPage     },
          { path: "workout",   Component: WorkoutLogPage  },
          { path: "nutrition", Component: NutritionPage   },
          { path: "coaches",   Component: PTDiscoveryPage },
          { path: "ai-coach",  Component: AICoachPage     },
          { path: "profile",   Component: ProfilePage     },
          { path: "pt-application", Component: PTApplicationPage  },
        ],
      },

      // ── PT workspace ─────────────────────────────────────────────────────
      {
        path: "pt",
        Component: AppShell,
        children: [
          { index: true, element: <Navigate to="/pt/dashboard" replace /> },
          { path: "dashboard",   Component: PTDashboard    },
          { path: "clients",     Component: PTClientList   },
          { path: "clients/:id", Component: PTClientDetail },
          { path: "plans",       Component: PlanReviewPage },
          { path: "schedule",    Component: PTSchedulePage },
          { path: "profile",     Component: PTProfilePage  },
          { path: "chat",        Component: ChatPage       },
        ],
      },

      // ── Admin workspace ──────────────────────────────────────────────────
      {
        path: "admin",
        Component: AppShell,
        children: [
          { index: true, element: <Navigate to="/admin/dashboard" replace /> },
          { path: "dashboard", Component: AdminDashboard   },
          { path: "users",     Component: UserManagement   },
          { path: "pts",       Component: PTManagement     },
          { path: "system",    Component: SystemMonitoring },
        ],
      },
    ],
  },
]);