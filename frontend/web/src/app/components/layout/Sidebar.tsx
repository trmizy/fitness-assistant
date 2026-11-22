import { NavLink, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { UserIcon as User, ShieldIcon as Shield, XIcon as X, SignOutIcon as LogOut, LightningIcon as Zap } from "@phosphor-icons/react";
import { AutoText } from "../i18n/AutoText";
import { PARTNER_ROLE_CHIP_LABEL, canUseFeature, hasPartnerPermission, normalizePartnerRole, type StaffFeature } from "../../utils/gymStaffRole";
import { usePendingCheckinExceptionCount } from "../../hooks/usePendingCheckinExceptionCount";
import type { AppLanguage } from "../../context/SettingsContext";
import { AppLogo } from "../brand/AppLogo";
import { UserAvatar } from "./UserAvatar";
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
  GyminiWorkoutIcon,
} from "../brand/GyminiLucide";
import { fullName } from "../../utils/fullName";

// ─── Navigation definitions ────────────────────────────────────────────────

/**
 * Full client nav — shown to pure Client accounts.
 * Several entries are merged tabbed pages (see TabbedPage) so two related
 * features share one nav slot instead of each taking a row — keeps this
 * list short enough to be usable on a mobile-width sidebar/drawer.
 */
const clientNavFull = [
  {
    label: "Tổng quan",
    icon: GyminiDashboardIcon,
    to: "/client/dashboard",
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
  { label: "Khiếu nại của tôi", icon: GyminiDisputeIcon, to: "/disputes" },
  { label: "Khiếu nại phòng gym", icon: GyminiDisputeIcon, to: "/complaint-cases" },
  { label: "Hồ sơ", icon: GyminiProfileIcon, to: "/client/profile" },
  { label: "Cài đặt", icon: GyminiSettingsIcon, to: "/client/settings" },
];

/**
 * Gym owner nav — wallet balance is shown per-gym inside GymManagePage. Shared verbatim by
 * OWNER and MANAGER logins (GYM_PARTNER_IDENTITY_MODEL.md — MANAGER is a permission inside
 * one partner, not a system role; both log in as GYM_OWNER, see the same routes, and the
 * difference is enforced here client-side plus by `requirePartnerOwner`/`requireGymScope`
 * server-side). GYM_MANAGEMENT master spec §61 acceptance check: "manager does NOT see
 * Wallet, Managers, or Brand anywhere in navigation" — "Người quản lý" (invite/revoke
 * managers) and "Quản lý cộng tác" (fully OWNER-gated, no partial MANAGER view unlike plans)
 * are filtered out below for a MANAGER account. There is no separate "Wallet" or "Brand" nav
 * item to filter here — both live inside other owner pages, which hide their own
 * OWNER-only sections themselves.
 */
const gymOwnerNavFull: NavItem[] = [
  {
    label: "Tổng quan",
    icon: GyminiDashboardIcon,
    to: "/gym-owner/dashboard",
  },
  { label: "Phòng gym của tôi", icon: GyminiGymIcon, to: "/gym-owner/gyms" },
  // Item 6: duyệt ngoại lệ check-in nằm ở Quầy lễ tân (chủ + quản lý) — trước đây chỉ vào được bằng URL. Huy hiệu = số yêu cầu đang chờ duyệt.
  { label: "Quầy lễ tân", icon: GyminiGymIcon, to: "/gym-owner/front-desk", feature: "frontDesk" },
  { label: "Quản lý gói", icon: GyminiMoneyIcon, to: "/gym-owner/plans" },
  // Item 6: Tài chính (ví, rút tiền, hoa hồng PT) — chỉ chủ sở hữu trong nhóm chủ/quản lý (canUseFeature "finance" = OWNER, ACCOUNTANT).
  { label: "Tài chính", icon: GyminiMoneyIcon, to: "/gym-owner/finance", feature: "finance" },
  { label: "Tin đăng & tiện ích", icon: GyminiGymIcon, to: "/gym-owner/listings", ownerOnly: true },
  { label: "Quản lý cộng tác", icon: GyminiContractIcon, to: "/gym-owner/collaborations", ownerOnly: true },
  // ND-07: chủ và quản lý (đúng chi nhánh được giao) cùng giải trình hồ sơ khiếu nại — không ownerOnly.
  { label: "Khiếu nại phòng gym", icon: GyminiDisputeIcon, to: "/gym-owner/complaint-cases" },
  { label: "Nhân sự", icon: GyminiUsersIcon, to: "/gym-owner/managers", ownerOnly: true },
];

/**
 * D15 — lễ tân và kế toán là hai vai trò hẹp: mỗi vai trò chỉ một trang chủ riêng (Quầy lễ tân / Tài chính),
 * không có Dashboard, Quản lý gói, Cộng tác hay Nhân sự. Danh sách này chỉ để ẩn menu; quyền thật do gym-service.
 */
const receptionistNav = [{ label: "Quầy lễ tân", icon: GyminiGymIcon, to: "/gym-owner/front-desk" }];
const accountantNav = [{ label: "Tài chính", icon: GyminiMoneyIcon, to: "/gym-owner/finance" }];

// PT accounts can still use the unified client service hub for their own
// contracts, gym memberships and bookings without duplicating nav entries.
const ptClientNav = clientNavFull;

/** PT professional workspace nav */
const ptWorkspaceNav = [
  {
    label: "Tổng quan PT",
    icon: GyminiDashboardIcon,
    to: "/pt/dashboard",
  },
  { label: "Học viên", icon: GyminiUsersIcon, to: "/pt/clients" },
  { label: "Hợp đồng", icon: GyminiContractIcon, to: "/pt/contracts" },
  { label: "Khiếu nại của tôi", icon: GyminiDisputeIcon, to: "/disputes" },
  { label: "Duyệt kế hoạch", icon: GyminiPlanIcon, to: "/pt/plans" },
  { label: "Lịch dạy", icon: GyminiScheduleIcon, to: "/pt/schedule" },
  {
    label: "Trò chuyện",
    icon: GyminiChatIcon,
    to: "/pt/chat",
  },
  { label: "Ví thu nhập", icon: GyminiWalletIcon, to: "/pt/wallet" },
  { label: "Hồ sơ PT", icon: GyminiProfileIcon, to: "/pt/profile" },
  { label: "Tin đăng", icon: GyminiCatalogIcon, to: "/pt/listing" },
];

/** Admin nav */
const adminNav = [
  {
    label: "Tổng quan",
    icon: GyminiDashboardIcon,
    to: "/admin/dashboard",
  },
  { label: "Người dùng", icon: GyminiUsersIcon, to: "/admin/users" },
  { label: "Quản lý PT", icon: GyminiAdminIcon, to: "/admin/pts" },
  { label: "Chợ kế hoạch", icon: GyminiMarketplaceIcon, to: "/admin/marketplace" },
  { label: "Duyệt bài tập trùng lặp", icon: GyminiCompareIcon, to: "/admin/exercise-review" },
  { label: "Ma trận chất lượng catalog", icon: GyminiCatalogIcon, to: "/admin/catalog-quality" },
  { label: "Tài chính", icon: GyminiMoneyIcon, to: "/admin/finance" },
  { label: "Giám sát hệ thống", icon: GyminiSystemIcon, to: "/admin/system" },
  { label: "Khiếu nại buổi tập", icon: GyminiDisputeIcon, to: "/admin/disputes" },
  // GYM_MANAGEMENT master spec §62 IA — "Overview / Partners / Branches / …", explicitly no
  // top-level "Brands" (brand info lives inside a partner's own BRAND tab instead).
  // Membership Oversight / Complaints / Notifications / a global cross-partner Audit Logs
  // view are NOT added here yet — their backing pages don't exist as standalone screens (the
  // first two land with Phase 5's complaints/violations work; audit history today is only
  // reachable per-partner, inside AdminPartnersPage's own tab). Adding a nav item with
  // nowhere real to go would be exactly the "hide missing functionality behind mock data"
  // the spec explicitly forbids.
  { label: "Tổng quan Gym", icon: GyminiDashboardIcon, to: "/admin/gym-management" },
  { label: "Chi nhánh", icon: GyminiGymIcon, to: "/admin/gyms" },
  { label: "Đối tác", icon: GyminiContractIcon, to: "/admin/partners" },
  // Listing Management D1 - separate from PT management and partners: what the public sees of a trainer / branch.
  { label: "Tin đăng & tiện ích", icon: GyminiCatalogIcon, to: "/admin/listings" },
  // Phase 5 — "Khiếu nại/Vi phạm", the nav item Phase 3 deliberately left out until this
  // screen existed (GYM_MANAGEMENT_API_GAPS.md). Reuses GyminiDisputeIcon (already used for
  // session disputes below) — same underlying concept, different domain.
  { label: "Khiếu nại", icon: GyminiDisputeIcon, to: "/admin/complaints" },
  {
    label: "Giám sát AI",
    icon: GyminiSystemIcon,
    to: "/admin/ai-observability",
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  icon: React.ElementType;
  to: string;
  sourceLang?: AppLanguage;
  /** GYM_MANAGEMENT master spec §61 — hidden from a MANAGER account's nav entirely. */
  ownerOnly?: boolean;
  /** Item 6: the entry is shown only to a role that may use this page (same table RequireStaffFeature enforces — never a link a role cannot open). */
  feature?: StaffFeature;
  /** Item 6: small count badge (e.g. pending check-in exceptions); hidden when 0. */
  badge?: number;
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
              {item.badge != null && item.badge > 0 && (
                <span
                  data-testid="nav-badge"
                  aria-label={`${item.badge} yêu cầu đang chờ`}
                  className="min-w-5 h-5 px-1.5 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center"
                >
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
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

  // GYM_MANAGEMENT master spec §61 — same query key AppShell's onboarding gate already
  // fetches (["partner-onboarding-status"]), so this is a cache read, not an extra request.
  // Only gym-owner-role logins ever reach the gate that populates it; other roles just get
  // an unused, never-fetched query (enabled: false) rather than a real network call.
  const partnerRoleQuery = useQuery({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
    enabled: role === "gym_owner",
  });
  const partnerRole = partnerRoleQuery.data?.role as string | undefined;
  // N15C-01: nhãn dưới tên = vai trò THẬT trong đối tác (cùng nguồn với chip ở trang hồ sơ), không mặc định "Chủ phòng gym".
  const normalizedPartnerRole = normalizePartnerRole(partnerRole);
  const partnerRoleLabel = normalizedPartnerRole ? PARTNER_ROLE_CHIP_LABEL[normalizedPartnerRole] : "Đối tác";
  // Chưa biết vai trò (đang tải / lỗi) → không hiện menu nào thay vì mặc định menu của chủ (fail-closed).
  const canApproveExceptions = hasPartnerPermission(partnerRole, partnerRoleQuery.data?.permissions, "checkin.exception.approve");
  const pendingExceptions = usePendingCheckinExceptionCount(role === "gym_owner" && canApproveExceptions);
  const withBadges = (items: NavItem[]): NavItem[] =>
    items.map((item) => (item.to === "/gym-owner/front-desk" && pendingExceptions > 0 ? { ...item, badge: pendingExceptions } : item));
  const gymOwnerNav: NavItem[] =
    partnerRole === "OWNER"
      ? withBadges(gymOwnerNavFull.filter((item) => !item.feature || canUseFeature("OWNER", item.feature)))
      : partnerRole === "MANAGER"
        ? withBadges(gymOwnerNavFull.filter((item) => !item.ownerOnly && (!item.feature || canUseFeature("MANAGER", item.feature))))
        : partnerRole === "RECEPTIONIST"
          ? receptionistNav
          : partnerRole === "ACCOUNTANT"
            ? accountantNav
            : [];

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
        label: "Cổng quản trị",
        color: "bg-violet-600",
        textColor: "text-violet-400",
        pillBg: "bg-violet-500/10",
        pillBorder: "border-violet-500/20",
        icon: Shield,
      }
    : isPT
      ? activeView === "pt"
        ? {
            label: "Không gian huấn luyện",
            color: "bg-green-500",
            textColor: "text-green-400",
            pillBg: "bg-green-500/10",
            pillBorder: "border-green-500/20",
            icon: Zap,
          }
        : {
            label: "Không gian thành viên",
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
          type="button"
          aria-label="Đóng menu"
          className="lg:hidden inline-flex min-h-10 min-w-10 items-center justify-center text-zinc-500 hover:text-white rounded-lg transition-colors"
          onClick={() => setSidebarOpen(false)}
        >
          <X className="w-5 h-5" aria-hidden="true" />
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
              className={`flex-1 flex min-h-10 items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === "client"
                  ? "bg-zinc-700 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <User className="w-3 h-3" />
              <AutoText>Thành viên</AutoText>
            </button>
            <button
              onClick={switchToPTView}
              className={`flex-1 flex min-h-10 items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === "pt"
                  ? "bg-green-500 text-black shadow-sm shadow-green-500/30"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Zap className="w-3 h-3" />
              <AutoText>Huấn luyện viên</AutoText>
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
          <UserAvatar
            className="w-8 h-8 shadow-md shadow-green-500/20"
            fallbackClassName="bg-green-500 text-xs font-bold text-black"
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-zinc-100 font-semibold truncate">
              {user
                ? fullName(user) ||
                  user.email.split("@")[0]
                : "Thành viên"}
            </div>
            <div className="text-xs text-zinc-500 truncate">
              <AutoText>
                {role === "client"
                  ? "Thành viên"
                  : role === "pt"
                    ? "Huấn luyện viên"
                    : role === "gym_owner"
                      ? partnerRoleLabel
                      : "Quản trị viên"}
              </AutoText>
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full min-h-10 px-3 py-2 text-zinc-500 hover:text-red-400 hover:bg-zinc-800/60 rounded-lg text-sm transition-all"
        >
          <LogOut className="w-4 h-4" />
          <AutoText>Đăng xuất</AutoText>
        </button>
      </div>
    </div>
  );
}
