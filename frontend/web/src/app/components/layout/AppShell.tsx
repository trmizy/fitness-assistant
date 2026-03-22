import { Outlet, useNavigate, useLocation } from "react-router";
import { useEffect } from "react";
import { useApp } from "../../context/AppContext";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

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
  }, [location.pathname, isPT, setActiveView]);

  if (!isAuthenticated) return null;
  return <AppShellInner />;
}

function AppShellInner() {
  const { sidebarOpen, setSidebarOpen } = useApp();

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 border-r border-zinc-800/60">
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
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-zinc-950">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
