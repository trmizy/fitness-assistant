import { Outlet, useNavigate, useLocation } from "react-router";
import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useApp } from "../../context/AppContext";
import { useNativeBackNavigation } from "../../hooks/useNativeBackNavigation";
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

  // Android hardware Back — overlays, then history, then the role's home, then a
  // double-press to exit. See the hook for why the previous inline version quit the app
  // from ordinary screens.
  useNativeBackNavigation();

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
          {/*
            Only the content area animates. The topbar, bottom nav and sidebar live outside
            this box and stay put, which is what makes a transition read as "app changed
            screen" rather than "page reloaded".

            Deliberately transform + opacity only, and deliberately short:

            - clip-path was the old effect. It is not hardware-accelerated in the Android
              WebView, so every navigation repainted a growing circular mask on the CPU —
              the single most expensive thing on the screen during the moment the user is
              already waiting for new content.
            - mode="wait" made it worse than the cost alone: the outgoing page had to finish
              its exit animation BEFORE the new one began rendering, so the two 0.4s halves
              were serialised into a visible stall between tap and content. mode="sync" with
              no exit animation lets the new screen start immediately.
            - 180ms sits inside the 160–220ms band that reads as responsive; 400ms reads as
              waiting.

            initial={false} suppresses the animation on the very first mount, so app startup
            paints the first screen immediately instead of fading it in.
          */}
          <AnimatePresence mode="sync" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
              // min-h-full (not h-full): fills the viewport on short pages so full-height
              // children (e.g. the chat layout) still work, while letting tall pages grow to
              // their real height.
              className="min-h-full"
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
