import { NavLink, useNavigate } from "react-router";
import { useApp } from "../../context/AppContext";
import { UserIcon as User, ShieldIcon as Shield, XIcon as X, SignOutIcon as LogOut, LightningIcon as Zap } from "@phosphor-icons/react";
import { AutoText } from "../i18n/AutoText";
import type { AppLanguage } from "../../context/SettingsContext";
import { AppLogo } from "../brand/AppLogo";
import {
  GyminiAdminIcon,
  GyminiCatalogIcon,
  GyminiChatIcon,
  GyminiCompareIcon,
  GyminiContractIcon,
  GyminiDashboardIcon,
  GyminiDiscoverIcon,
  GyminiDisputeIcon,
  GyminiGymIcon,
  GyminiInBodyIcon,
  GyminiMarketplaceIcon,
  GyminiMoneyIcon,
  GyminiNutritionIcon,
  GyminiPlanIcon,
  GyminiProfileIcon,
  GyminiScheduleIcon,
  GyminiServicesIcon,
  GyminiSettingsIcon,
  GyminiSystemIcon,
  GyminiUsersIcon,
  GyminiWalletIcon,
  GyminiWorkflowIcon,
  GyminiWorkoutIcon,
} from "../brand/GyminiLucide";

// ─── Navigation definitions ────────────────────────────────────────────────

/**
 * Full client nav — shown to pure Client accounts.
 * Several entries are merged tabbed pages (see TabbedPage) so two related
 * features share one nav slot instead of each taking a row — keeps this
 * list short enough to be usable on a mobile-width sidebar/drawer.
 */
const clientNavFull = [
  {
    label: "Dashboard",
    icon: GyminiDashboardIcon,
    to: "/client/dashboard",
    sourceLang: "en" as const,
  },
  {
    label: "InBody",
    icon: GyminiInBodyIcon,
    to: "/client/inbody",
    sourceLang: "en" as const,
  },
  { label: "Kế hoạch AI", icon: GyminiPlanIcon, to: "/client/plans" },
  { label: "Tập luyện", icon: GyminiWorkoutIcon, to: "/client/workout" },
  { label: "Dinh dưỡng", icon: GyminiNutritionIcon, to: "/client/nutrition" },
  // Product Completeness pass — Discover/Library landing (PC7) and Settings
  // Center (PC1). Kept out of the 5-slot mobile bottom nav per spec §4/§13
  // — reachable here (desktop sidebar + mobile drawer) and via the Topbar
  // user-menu / ProfilePage link-out cards instead.
  { label: "Khám phá", icon: GyminiDiscoverIcon, to: "/client/library" },
  { label: "Dịch vụ", icon: GyminiServicesIcon, to: "/client/services" },
  { label: "Trò chuyện", icon: GyminiChatIcon, to: "/client/chat" },
  { label: "Ví", icon: GyminiWalletIcon, to: "/client/wallet" },
  { label: "Hồ sơ", icon: GyminiProfileIcon, to: "/client/profile" },
  { label: "Cài đặt", icon: GyminiSettingsIcon, to: "/client/settings" },
];

/** Gym owner nav — wallet balance is shown per-gym inside GymManagePage.
 * Money-flow plan 5.1: GYM_STAFF removed — gym owners operate everything themselves now. */
const gymOwnerNav = [
  {
    label: "Dashboard",
    icon: GyminiDashboardIcon,
    to: "/gym-owner/dashboard",
    sourceLang: "en" as const,
  },
  { label: "Phòng gym của tôi", icon: GyminiGymIcon, to: "/gym-owner/gyms" },
];

// PT accounts can still use the unified client service hub for their own
// contracts, gym memberships and bookings without duplicating nav entries.
const ptClientNav = clientNavFull;

/** PT professional workspace nav */
const ptWorkspaceNav = [
  {
    label: "PT Dashboard",
    icon: GyminiDashboardIcon,
    to: "/pt/dashboard",
    sourceLang: "en" as const,
  },
  { label: "Học viên", icon: GyminiUsersIcon, to: "/pt/clients" },
  { label: "Hợp đồng", icon: GyminiContractIcon, to: "/pt/contracts" },
  { label: "Duyệt kế hoạch", icon: GyminiPlanIcon, to: "/pt/plans" },
  { label: "Lịch dạy", icon: GyminiScheduleIcon, to: "/pt/schedule" },
  {
    label: "Chat",
    icon: GyminiChatIcon,
    to: "/pt/chat",
    sourceLang: "en" as const,
  },
  { label: "Ví thu nhập", icon: GyminiWalletIcon, to: "/pt/wallet" },
  { label: "Hồ sơ PT", icon: GyminiProfileIcon, to: "/pt/profile" },
];

/** Admin nav */
const adminNav = [
  {
    label: "Dashboard",
    icon: GyminiDashboardIcon,
    to: "/admin/dashboard",
    sourceLang: "en" as const,
  },
  { label: "Người dùng", icon: GyminiUsersIcon, to: "/admin/users" },
  { label: "Quản lý PT", icon: GyminiAdminIcon, to: "/admin/pts" },
  { label: "Chợ kế hoạch", icon: GyminiMarketplaceIcon, to: "/admin/marketplace" },
  { label: "Duyệt bài tập trùng lặp", icon: GyminiCompareIcon, to: "/admin/exercise-review" },
  { label: "Ma trận chất lượng catalog", icon: GyminiCatalogIcon, to: "/admin/catalog-quality" },
  { label: "Hoàn tiền dịch vụ PT", icon: GyminiMoneyIcon, to: "/admin/pt-service-refunds" },
  { label: "Giám sát hệ thống", icon: GyminiSystemIcon, to: "/admin/system" },
  { label: "Khiếu nại buổi tập", icon: GyminiDisputeIcon, to: "/admin/disputes" },
  { label: "Yêu cầu rút tiền", icon: GyminiMoneyIcon, to: "/admin/withdrawals" },
  { label: "Phòng gym & thương hiệu", icon: GyminiGymIcon, to: "/admin/gyms" },
  {
    label: "Workflows",
    icon: GyminiWorkflowIcon,
    to: "/admin/workflows",
    sourceLang: "en" as const,
  },
  {
    label: "AI Observability",
    icon: GyminiSystemIcon,
    to: "/admin/ai-observability",
    sourceLang: "en" as const,
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  icon: React.ElementType;
  to: string;
  sourceLang?: AppLanguage;
}

function NavGroup({
  items,
  onClose,
}: {
  items: NavItem[];
  onClose: () => void;
}) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onClose}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm transition-all ${
              isActive
                ? "bg-green-500/15 text-green-400 border border-green-500/20"
                : "text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon
                weight={isActive ? "bold" : "regular"}
                className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-green-400" : ""}`}
              />
              <AutoText
                className="flex-1"
                sourceLang={item.sourceLang || "vi"}
              >
                {item.label}
              </AutoText>
              {isActive && (
                <div className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              )}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

// ─── Main Sidebar ───────────────────────────────────────────────────────────

export function Sidebar() {
  const {
    role,
    isPT,
    isAdmin,
    activeView,
    setActiveView,
    user,
    setSidebarOpen,
    logout,
  } = useApp();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    setSidebarOpen(false);
    navigate("/login");
  };

  const switchToClientView = () => {
    setActiveView("client");
    setSidebarOpen(false);
    navigate("/client/dashboard");
  };

  const switchToPTView = () => {
    setActiveView("pt");
    setSidebarOpen(false);
    navigate("/pt/dashboard");
  };

  // Determine which nav items to show
  let navItems: NavItem[];
  if (isAdmin) {
    navItems = adminNav;
  } else if (role === "gym_owner") {
    navItems = gymOwnerNav;
  } else if (isPT) {
    navItems = activeView === "pt" ? ptWorkspaceNav : ptClientNav;
  } else {
    navItems = clientNavFull;
  }

  // ── Workspace label + color for the header pill ──
  const workspaceConfig = isAdmin
    ? {
        label: "Admin Portal",
        color: "bg-violet-600",
        textColor: "text-violet-400",
        pillBg: "bg-violet-500/10",
        pillBorder: "border-violet-500/20",
        icon: Shield,
      }
    : isPT
      ? activeView === "pt"
        ? {
            label: "Trainer Workspace",
            color: "bg-green-500",
            textColor: "text-green-400",
            pillBg: "bg-green-500/10",
            pillBorder: "border-green-500/20",
            icon: Zap,
          }
        : {
            label: "Client Workspace",
            color: "bg-zinc-700",
            textColor: "text-zinc-300",
            pillBg: "bg-zinc-800",
            pillBorder: "border-zinc-700/50",
            icon: User,
          }
      : {
          label: "Trang thành viên",
          color: "bg-green-500",
          textColor: "text-green-400",
          pillBg: "bg-green-500/10",
          pillBorder: "border-green-500/20",
          icon: User,
        };

  return (
    <div className="flex flex-col h-full bg-transparent text-white border-r border-zinc-800/60">
      {/* ── Brand header ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-zinc-800/60">
        <AppLogo
          className="h-12 min-w-0"
          imgClassName="h-12 w-[132px] object-left"
        />
        <button
          className="lg:hidden text-zinc-500 hover:text-white p-1 rounded transition-colors"
          onClick={() => setSidebarOpen(false)}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* ── PT Workspace switcher (sidebar version) ── */}
      {isPT && (
        <div className="px-3 py-3 border-b border-zinc-800/60">
          {/* Account badge */}
          <div className="flex items-center gap-1.5 mb-2.5 px-1">
            <div className="w-4 h-4 bg-green-500/20 rounded flex items-center justify-center">
              <Zap className="w-2.5 h-2.5 text-green-400" />
            </div>
            <span className="text-xs text-zinc-500 font-semibold tracking-wide uppercase">
              <AutoText>Tài khoản PT</AutoText>
            </span>
          </div>

          {/* Segmented toggle */}
          <div className="flex bg-zinc-900/40 border border-zinc-700/50 rounded-xl p-1 gap-1">
            <button
              onClick={switchToClientView}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === "client"
                  ? "bg-zinc-700 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <User className="w-3 h-3" />
              <AutoText sourceLang="en">Client</AutoText>
            </button>
            <button
              onClick={switchToPTView}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === "pt"
                  ? "bg-green-500 text-black shadow-sm shadow-green-500/30"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Zap className="w-3 h-3" />
              <AutoText sourceLang="en">Trainer</AutoText>
            </button>
          </div>
        </div>
      )}

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {/* Section label */}
        {isPT && (
          <div className="px-3 mb-2">
            <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">
              <AutoText>
                {activeView === "pt" ? "Huấn luyện" : "Thể dục của tôi"}
              </AutoText>
            </span>
          </div>
        )}
        <NavGroup items={navItems} onClose={() => setSidebarOpen(false)} />
      </nav>

      {/* ── Bottom: user info + logout ── */}
      <div className="p-3 border-t border-zinc-800/60">
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-zinc-900/40 rounded-xl border border-zinc-700/50 mb-2">
          <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-xs font-bold text-black flex-shrink-0 shadow-md shadow-green-500/20">
            {user?.firstName?.[0] || user?.email?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-100 font-semibold truncate">
              {user
                ? `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
                  user.email.split("@")[0]
                : "Client"}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              <AutoText>
                {role === "client"
                  ? "Thành viên"
                  : role === "pt"
                    ? "Huấn luyện viên"
                    : role === "gym_owner"
                      ? "Chủ phòng gym"
                      : "Quản trị viên"}
              </AutoText>
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 text-zinc-500 hover:text-red-400 hover:bg-zinc-800/60 rounded-lg text-sm transition-all"
        >
          <LogOut className="w-4 h-4" />
          <AutoText>Đăng xuất</AutoText>
        </button>
      </div>
    </div>
  );
}
