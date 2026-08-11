import { Outlet, useNavigate, useLocation } from "react-router";
import { useEffect } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "../../context/AppContext";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { BottomNav } from "./BottomNav";
import { CallOverlay } from "../call/CallOverlay";
import bgGym from "../../../assets/bg-gym.jpg";

export function AppShell() {
  const { isAuthenticated, isPT, setActiveView } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) navigate("/login");
  }, [isAuthenticated, navigate]);

  // Sync activeView from URL so back/forward navigation stays consistent
  useEffect(() => {
    if (!isPT) return;
    if (location.pathname.startsWith("/pt")) {
      setActiveView("pt");
    } else if (location.pathname.startsWith("/client")) {
      setActiveView("client");
    }
  }, [location.pathname, isPT, setActiveView]);

  // Handle hardware back button for Android
  useEffect(() => {
    const backButtonListener = CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      // If we are at the root dashboard of either view, exit app
      if (location.pathname === "/client/dashboard" || location.pathname === "/pt/dashboard") {
        CapacitorApp.exitApp();
      } else {
        // Otherwise, navigate back in history
        navigate(-1);
      }
    });
    return () => {
      backButtonListener.then((listener) => listener.remove());
    };
  }, [location.pathname, navigate]);

  if (!isAuthenticated) return null;
  return (
    <>
      <CallOverlay />
      <AppShellInner />
    </>
  );
}

function AppShellInner() {
  const { sidebarOpen, setSidebarOpen } = useApp();
  const location = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const isChatView =
    location.pathname.includes("/chat") && searchParams.has("conversationId");

  return (
    <div
      className="flex h-screen overflow-hidden bg-cover bg-center bg-no-repeat relative"
      style={{ backgroundImage: `url(${bgGym})` }}
    >
      <div className="absolute inset-0 app-theme-overlay pointer-events-none z-0"></div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 border-r border-zinc-800/60 z-10 bg-zinc-950/40 backdrop-blur-md">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-72 flex-shrink-0 flex flex-col shadow-2xl z-10">
            <Sidebar />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden z-10 relative">
        <Topbar />
        <main
          className={`flex-1 overflow-y-auto bg-transparent relative z-10 overflow-x-hidden ${
            isChatView ? "" : "pb-16 lg:pb-0"
          }`}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ clipPath: "circle(0% at 100% 50%)", opacity: 0 }}
              animate={{ clipPath: "circle(150% at 50% 50%)", opacity: 1 }}
              exit={{ clipPath: "circle(0% at 0% 50%)", opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
        
        {!isChatView && <BottomNav />}
      </div>
    </div>
  );
}
