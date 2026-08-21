import { NavLink, useNavigate } from "react-router";
import { useApp } from "../../context/AppContext";
import {
  LayoutDashboard,
  Activity,
  Brain,
  FileText,
  MessageSquare,
  Calendar,
  Dumbbell,
  Utensils,
  Users,
  Search,
  User,
  Shield,
  UserCheck,
  Monitor,
  X,
  LogOut,
  ClipboardList,
  Zap,
  Workflow,
  Wallet,
  Store,
  Banknote,
  GitCompare,
} from "lucide-react";
import { AutoText } from "../i18n/AutoText";
import type { AppLanguage } from "../../context/SettingsContext";

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
    icon: LayoutDashboard,
    to: "/client/dashboard",
    sourceLang: "en" as const,
  },
  {
    label: "InBody",
    icon: Activity,
    to: "/client/inbody",
    sourceLang: "en" as const,
  },
  { label: "Kế hoạch AI", icon: Brain, to: "/client/plans" },
  { label: "Tập luyện", icon: Dumbbell, to: "/client/workout" },
  { label: "Dinh dưỡng", icon: Utensils, to: "/client/nutrition" },
  { label: "Dịch vụ", icon: Search, to: "/client/services" },
  { label: "Trò chuyện", icon: MessageSquare, to: "/client/chat" },
  { label: "Ví", icon: Wallet, to: "/client/wallet" },
  { label: "Hồ sơ", icon: User, to: "/client/profile" },
];

/** Gym owner / staff nav — wallet balance is shown per-gym inside GymManagePage */
const gymOwnerNav = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    to: "/gym-owner/dashboard",
    sourceLang: "en" as const,
  },
  { label: "Phòng gym của tôi", icon: Dumbbell, to: "/gym-owner/gyms" },
];

// PT accounts can still use the unified client service hub for their own
// contracts, gym memberships and bookings without duplicating nav entries.
const ptClientNav = clientNavFull;

/** PT professional workspace nav */
const ptWorkspaceNav = [
  {
    label: "PT Dashboard",
    icon: LayoutDashboard,
    to: "/pt/dashboard",
    sourceLang: "en" as const,
  },
  { label: "Học viên", icon: Users, to: "/pt/clients" },
  { label: "Hợp đồng", icon: FileText, to: "/pt/contracts" },
  { label: "Duyệt kế hoạch", icon: ClipboardList, to: "/pt/plans" },
  { label: "Lịch dạy", icon: Calendar, to: "/pt/schedule" },
  {
    label: "Chat",
    icon: MessageSquare,
    to: "/pt/chat",
    sourceLang: "en" as const,
  },
  { label: "Ví thu nhập", icon: Wallet, to: "/pt/wallet" },
  { label: "Hồ sơ PT", icon: User, to: "/pt/profile" },
];

/** Admin nav */
const adminNav = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    to: "/admin/dashboard",
    sourceLang: "en" as const,
  },
  { label: "Người dùng", icon: Users, to: "/admin/users" },
  { label: "Quản lý PT", icon: UserCheck, to: "/admin/pts" },
  { label: "Chợ kế hoạch", icon: Store, to: "/admin/marketplace" },
  { label: "Duyệt bài tập trùng lặp", icon: GitCompare, to: "/admin/exercise-review" },
  { label: "Hoàn tiền dịch vụ PT", icon: Banknote, to: "/admin/pt-service-refunds" },
  { label: "Giám sát hệ thống", icon: Monitor, to: "/admin/system" },
  {
    label: "Workflows",
    icon: Workflow,
    to: "/admin/workflows",
    sourceLang: "en" as const,
  },
  {
    label: "AI Observability",
    icon: Brain,
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
  } else if (role === "gym_owner" || role === "gym_staff") {
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
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-green-500/30">
            <Dumbbell className="w-4 h-4 text-black" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight tracking-tight">
              FITNESS AI
            </div>
            <div className="text-zinc-500 text-xs">AI Gym Coach</div>
          </div>
        </div>
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
                      : role === "gym_staff"
                        ? "Nhân viên gym"
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
