import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useOutlet } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useApp } from "../../../context/AppContext";
import { useSettings } from "../../../context/SettingsContext";
import { useNativeBackNavigation } from "../../../hooks/useNativeBackNavigation";
import { useNativeStatusBar } from "../../../hooks/useNativeStatusBar";
import { PageSkeleton } from "../PageSkeleton";
import { ForceChangePasswordScreen } from "../../auth/ForceChangePasswordScreen";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../../ui/sheet";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopbar } from "./AdminTopbar";
import { getAdminPageTitle } from "./adminNav";
import "./adminA11y.css";

const COLLAPSE_STORAGE_KEY = "gymini.admin.sidebarCollapsed";
const DESKTOP_QUERY = "(min-width: 1024px)";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Icon-rail preference, remembered per browser. Storage may be blocked — never required. */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed());
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

/**
 * Shell for `/admin/*` ONLY — client / PT / gym-owner keep `AppShell` untouched.
 *
 * Keeps the same gates `AppShell` applies to every authenticated page (login redirect, forced
 * password change, Android back handling, status bar) but renders none of the AI-coach button,
 * AI panel or call overlay, and no background photo. Role enforcement stays in `RequireRole`
 * (the route wrapper) + the backend; nothing here widens access.
 */
export function AdminShell() {
  const { isAuthenticated, user } = useApp();
  const { registerDefaultTheme } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();

  // Admin is light-first: only when the user has never chosen a theme (an explicit choice
  // from the theme switch / Settings still wins — see SettingsContext).
  useLayoutEffect(() => registerDefaultTheme("light"), [registerDefaultTheme]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login", { state: { from: location.pathname + location.search } });
    }
  }, [isAuthenticated, navigate, location.pathname, location.search]);

  useNativeBackNavigation();
  useNativeStatusBar();

  if (!isAuthenticated) return null;
  if (user?.mustChangePassword) return <ForceChangePasswordScreen />;
  return <AdminShellInner />;
}

function AdminShellInner() {
  const { sidebarOpen, setSidebarOpen } = useApp();
  const { pathname } = useLocation();
  const reducedMotion = useReducedMotion();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // `as ReactNode`: this tree resolves two @types/react copies, so router element types do not match.
  const outlet = useOutlet() as ReactNode;

  // Marks <html> while the admin shell is mounted: scopes the reduced-motion rule in adminA11y.css to admin (portals included).
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-admin-shell", "");
    return () => document.documentElement.removeAttribute("data-admin-shell");
  }, []);

  // Descriptive title per page (also announced to assistive tech on navigation).
  useEffect(() => {
    const previous = document.title;
    document.title = `${getAdminPageTitle(pathname)} · Gymini Quản trị`;
    return () => {
      document.title = previous;
    };
  }, [pathname]);

  // The drawer must not outlive a navigation (back/forward, notification link) or a resize to desktop.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, setSidebarOpen]);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setSidebarOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [setSidebarOpen]);

  const closeDrawer = useCallback(() => setSidebarOpen(false), [setSidebarOpen]);

  // Tab changes inside Tài chính are separate routes now, but the shell should not re-fade the
  // whole finance layout (header + tab strip) when only the tab changes.
  const transitionKey = pathname.startsWith("/admin/finance") ? "/admin/finance" : pathname;

  return (
    <div className="flex h-dvh overflow-hidden bg-adm-bg text-adm-text">
      <a
        href="#admin-main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-adm-surface focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-adm-text focus:shadow-adm-pop focus:outline-2 focus:outline-[var(--adm-focus)]"
      >
        Bỏ qua tới nội dung chính
      </a>

      {/* Desktop sidebar / icon rail */}
      <aside
        aria-label="Thanh bên quản trị"
        data-collapsed={collapsed ? "true" : "false"}
        className={`hidden shrink-0 border-r border-adm-border bg-adm-surface transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block ${
          collapsed ? "w-16" : "w-[248px]"
        }`}
      >
        <AdminSidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>

      {/* Mobile drawer: Radix dialog = focus trap, Esc, aria-modal, inert background */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          data-testid="admin-drawer"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            menuButtonRef.current?.focus();
          }}
          className="w-[288px] max-w-[85vw] gap-0 border-adm-border bg-adm-surface p-0 data-[state=closed]:duration-200 data-[state=open]:duration-200 motion-reduce:transition-none motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none sm:max-w-[288px] lg:hidden"
        >
          <SheetTitle className="sr-only">Menu quản trị</SheetTitle>
          <SheetDescription className="sr-only">Điều hướng giữa các khu vực quản trị.</SheetDescription>
          <AdminSidebar inDrawer onNavigate={closeDrawer} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AdminTopbar menuButtonRef={menuButtonRef} menuOpen={sidebarOpen} onOpenMenu={() => setSidebarOpen(true)} />
        <main
          id="admin-main"
          ref={mainRef}
          tabIndex={-1}
          className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden outline-none"
        >
          <AnimatePresence mode="sync" initial={false}>
            <motion.div
              key={transitionKey}
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.16, ease: [0.2, 0, 0, 1] }}
              // Same box contract as AppShell: flex-1 gives full-height pages a definite height;
              // w-full/min-w-0 on each page root stops a nowrap row from widening it past the viewport.
              className="flex min-h-0 min-w-0 flex-1 flex-col [&>*]:w-full [&>*]:min-w-0"
            >
              <Suspense fallback={<PageSkeleton />}>
                {outlet}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
