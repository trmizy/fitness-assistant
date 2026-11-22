/**
 * GymOwnerShell - shell for `/gym-owner/*` when VITE_GYM_OWNER_V2 is on (batch G0). With the flag off, routes.tsx keeps
 * rendering AppShell and none of this file runs.
 *
 * Gate order is unchanged from AppShell: login redirect -> partner onboarding wizard -> (inside) scope + permission frame ->
 * RequireStaffFeature per page (still in routes.tsx). Role enforcement stays in RequireRole / RequireApprovedPartner /
 * RequireStaffFeature and in gym-service; nothing here widens access.
 *
 * Pages inside are the EXISTING pages. They do not read the scope yet (later batches adopt it page by page), so the
 * strip's branch choice is context + canonical URL only in G0.
 */
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useOutlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ListIcon, XIcon } from "@phosphor-icons/react";
import { useApp } from "../../../context/AppContext";
import { useSettings } from "../../../context/SettingsContext";
import { useNativeBackNavigation } from "../../../hooks/useNativeBackNavigation";
import { useNativeStatusBar } from "../../../hooks/useNativeStatusBar";
import { gymService } from "../../../services/api";
import { CallOverlay } from "../../call/CallOverlay";
import { PartnerOnboardingWizard } from "../../auth/PartnerOnboardingWizard";
import { PageSkeleton } from "../PageSkeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../../ui/sheet";
import { GymOwnerScopeProvider, useGymOwnerScope } from "../../../features/gym-owner/scope/GymOwnerScopeProvider";
import { ScopeStateFrame } from "../../../features/gym-owner/scope/PermissionGate";
import { classifyApiError, suspensionMode } from "../../../features/gym-owner/scope/scopeModel";
import { pageTitleForPath } from "./gymOwnerNav";
import { GymOwnerSidebar } from "./GymOwnerSidebar";
import { ScopeStrip } from "./ScopeStrip";
import { GymOwnerBell } from "./GymOwnerBell";
import { GymOwnerUserMenu } from "./GymOwnerUserMenu";
import { BannerStack, ContentFrame, type BannerItem } from "./GoFrames";
import { IconSwap, useMediaQuery } from "./motion";
import "../../../../styles/gym-owner.css";

const COLLAPSE_KEY = "gymini.gymOwner.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function GymOwnerShell() {
  const { isAuthenticated, role } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  // Same partner-onboarding gate AppShell applies (same query key, so it is a cache read on the second render).
  const onboardingQuery = useQuery({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
    enabled: isAuthenticated && role === "gym_owner",
    staleTime: 60_000,
  });

  // Session expired / logged out: back to login, remembering where the user was (AppContext already cleared the cache).
  useEffect(() => {
    if (!isAuthenticated) navigate("/login", { state: { from: location.pathname + location.search } });
  }, [isAuthenticated, navigate, location.pathname, location.search]);

  useNativeBackNavigation();
  useNativeStatusBar();

  if (!isAuthenticated) return null;
  if (role === "gym_owner" && onboardingQuery.data && onboardingQuery.data.completed === false) {
    return <PartnerOnboardingWizard onComplete={() => onboardingQuery.refetch()} />;
  }
  return (
    <>
      <CallOverlay />
      <GymOwnerScopeProvider>
        <GymOwnerShellInner />
      </GymOwnerScopeProvider>
    </>
  );
}

function GymOwnerShellInner() {
  const { sidebarOpen, setSidebarOpen } = useApp();
  const { registerDefaultTheme } = useSettings();
  const { pathname } = useLocation();
  const scope = useGymOwnerScope();
  // `as ReactNode`: this tree resolves two @types/react copies, so router element types do not match (same as AdminShell).
  const outlet = useOutlet() as React.ReactNode;
  const mainRef = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const narrow = useMediaQuery("(min-width: 1024px) and (max-width: 1279px)");
  const rail = narrow || collapsed;

  // Workspace default is light; an explicit theme choice (ThemeToggle / Settings) always wins - see SettingsContext.
  useLayoutEffect(() => registerDefaultTheme("light"), [registerDefaultTheme]);
  // Tokens live under [data-workspace="gym-owner"]; <html> carries the attribute too so portals (sheet, toasts) inherit them.
  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-workspace", "gym-owner");
    return () => document.documentElement.removeAttribute("data-workspace");
  }, []);

  const title = pageTitleForPath(pathname);
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} - Gymini Phòng tập`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  useEffect(() => {
    setSidebarOpen(false);
    mainRef.current?.scrollTo?.({ top: 0 });
  }, [pathname, setSidebarOpen]);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setSidebarOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [setSidebarOpen]);

  const toggleRail = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* storage blocked: preference lasts for this tab only */
      }
      return next;
    });
  }, []);

  const mode = suspensionMode(scope.role);
  const lockedBySuspension = scope.suspended && (mode === "lock" || !scope.role);
  const branchScreen = scope.scopeKind === "branch" || scope.scopeKind === "brand-or-branch";
  const errorKind = classifyApiError(scope.error);

  const banners: BannerItem[] = useMemo(() => {
    const list: BannerItem[] = [];
    if (scope.suspended && mode === "banner") {
      list.push({ id: "suspended", tone: "risk", text: "Đối tác đang bị đình chỉ. Một số chức năng tài chính bị khoá, bạn vẫn làm việc bình thường ở các phần còn lại." });
    }
    if (scope.stale) {
      const at = new Date(scope.stale.since).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      list.push({ id: "stale", tone: "warn", text: `Danh sách chi nhánh có thể đã cũ, lần cập nhật gần nhất lúc ${at}.`, action: { label: "Tải lại", onClick: scope.retry } });
    }
    if (scope.resolution === "out-of-scope" && !branchScreen) {
      list.push({ id: "out-of-scope", tone: "info", text: "Liên kết có chi nhánh không thuộc phạm vi của bạn. Màn này áp dụng cho cả thương hiệu nên vẫn hiển thị bình thường." });
    }
    return list;
  }, [scope.suspended, mode, scope.stale, scope.retry, scope.resolution, branchScreen]);

  let body: React.ReactNode = null;
  let frameLoading = false;
  if (scope.status === "loading") {
    frameLoading = true;
  } else if (lockedBySuspension) {
    body = <ScopeStateFrame kind="suspended" onRetry={scope.retry} />;
  } else if (scope.status === "error") {
    body = <ScopeStateFrame kind={errorKind === "forbidden" ? "forbidden" : "error"} onRetry={scope.retry} />;
  } else if (scope.resolution === "out-of-scope" && branchScreen) {
    body = <ScopeStateFrame kind="out-of-scope" />;
  } else {
    frameLoading = scope.scopeChanging;
    body = (
      <div className="go-page" data-enter="true" key={`${pathname}|${scope.pageKey}`} data-testid="go-page">
        <Suspense fallback={<PageSkeleton />}>
          {outlet}
        </Suspense>
      </div>
    );
  }

  return (
    <div className="go-shell" data-workspace="gym-owner" data-testid="go-shell" data-rail={rail ? "true" : "false"}>
      <a
        href="#go-main"
        className="go-skip"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Bỏ qua tới nội dung chính
      </a>

      <aside className="go-sidebar" data-rail={rail ? "true" : "false"} aria-label="Thanh bên phòng tập">
        <GymOwnerSidebar rail={rail} canToggleRail={!narrow} onToggleRail={toggleRail} />
      </aside>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          data-workspace="gym-owner"
          data-testid="go-drawer"
          className="w-[288px] max-w-[85vw] gap-0 border-[var(--go-line)] bg-[var(--go-surface)] p-0 sm:max-w-[288px] lg:hidden"
        >
          <SheetTitle className="sr-only">Menu phòng tập</SheetTitle>
          <SheetDescription className="sr-only">Điều hướng giữa các khu vực của phòng tập.</SheetDescription>
          <GymOwnerSidebar inDrawer onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="go-main-col">
        <header className="go-header">
          <button
            type="button"
            className="go-icon-btn go-menu-btn"
            aria-label={sidebarOpen ? "Đóng menu" : "Mở menu"}
            aria-expanded={sidebarOpen}
            aria-haspopup="dialog"
            data-testid="go-menu-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <IconSwap state={sidebarOpen ? "b" : "a"} a={<ListIcon />} b={<XIcon />} />
          </button>
          {/* G1 redline: the page owns its visible h1 ("Hôm nay, Chủ nhật 22/11", the branch name ...), so the top bar no longer repeats it;
              the text stays for assistive tech and tests. The bar keeps the menu button, the bell and the user menu. */}
          <div className="go-header-spacer" />
          <span className="sr-only" data-testid="go-page-title">{title}</span>
          <GymOwnerBell />
          <GymOwnerUserMenu />
        </header>
        <ScopeStrip />
        <BannerStack items={banners} />
        <main id="go-main" ref={mainRef} tabIndex={-1} className="go-main">
          <ContentFrame loading={frameLoading}>{body}</ContentFrame>
        </main>
      </div>
    </div>
  );
}
