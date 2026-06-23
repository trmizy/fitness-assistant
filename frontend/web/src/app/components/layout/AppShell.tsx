import { Outlet, useNavigate, useLocation } from "react-router";
import { useEffect } from "react";
import { useApp } from "../../context/AppContext";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CallOverlay } from "../call/CallOverlay";
import bgGym from "../../../assets/bg-gym.jpg";

export function AppShell() {
  const { isAuthenticated, isPT, setActiveView } = useApp();
  const navigate  = useNavigate();
  const location  = useLocation();

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
  }, [location, isPT, setActiveView]);

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

  return (
    <div 
      className="flex h-screen overflow-hidden bg-cover bg-center bg-no-repeat relative"
      style={{ backgroundImage: `url(${bgGym})` }}
    >
      <div className="absolute inset-0 bg-black/40 pointer-events-none z-0"></div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 border-r border-zinc-800/60 z-10 bg-zinc-950/40 backdrop-blur-md">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <button
            type="button"
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-72 flex-shrink-0 flex flex-col shadow-2xl z-10">
            <Sidebar />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden z-10">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-transparent relative z-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
