import { useLocation, useNavigate } from "react-router";
import {
  BarbellIcon,
  CaretDownIcon,
  MoonIcon,
  SidebarSimpleIcon,
  SignOutIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useApp } from "../../../context/AppContext";
import { useSettings } from "../../../context/SettingsContext";
import { AutoText } from "../../i18n/AutoText";
import { LanguageSwitcher } from "../../settings/LanguageSwitcher";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { AdminLink } from "./AdminLink";
import { ADMIN_NAV, findActiveNavItem, formatBadge, type AdminNavItem } from "./adminNav";
import { ADMIN_NAV_ICONS } from "./adminNavIcons";
import { useAdminNavBadges } from "./useAdminNavBadges";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-focus)]";

const NAV_ITEM_BASE =
  "relative flex w-full items-center gap-2.5 rounded-[10px] px-2.5 min-h-11 lg:min-h-[38px] text-left text-sm font-medium no-underline transition-[background-color,color] duration-150 motion-reduce:transition-none";

interface AdminSidebarProps {
  /** Icon rail (desktop only). The drawer is never collapsed. */
  collapsed?: boolean;
  /** Called after a navigation click — closes the mobile drawer. */
  onNavigate?: () => void;
  /** Present on desktop only: toggles the icon rail. */
  onToggleCollapse?: () => void;
  /** The mobile drawer also needs the language switcher (the topbar hides it below md). */
  inDrawer?: boolean;
}

function displayName(user: { firstName?: string; lastName?: string; email?: string } | null | undefined): string {
  if (!user) return "Quản trị viên";
  const full = `${user.firstName || ""} ${user.lastName || ""}`.trim();
  return full || user.email?.split("@")[0] || "Quản trị viên";
}

function initials(user: { firstName?: string; email?: string } | null | undefined): string {
  return (user?.firstName?.[0] || user?.email?.[0] || "A").toUpperCase();
}

function NavBadge({ count, collapsed }: { count: number; collapsed: boolean }) {
  return (
    <span
      className={
        collapsed
          ? "absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-adm-badge-bg px-1 text-[10px] font-bold leading-none text-adm-badge-fg tabular-nums"
          : "ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-adm-badge-bg px-1.5 text-[11px] font-bold leading-none text-adm-badge-fg tabular-nums"
      }
    >
      <span aria-hidden="true">{formatBadge(count)}</span>
      <span className="sr-only">{`, ${count} việc chờ xử lý`}</span>
    </span>
  );
}

function NavLinkItem({
  item,
  active,
  collapsed,
  badge,
  onNavigate,
}: {
  item: AdminNavItem;
  active: boolean;
  collapsed: boolean;
  badge: number | null;
  onNavigate?: () => void;
}) {
  const Icon = ADMIN_NAV_ICONS[item.iconKey];
  return (
    <AdminLink
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      data-testid={`admin-nav-${item.id}`}
      className={`${NAV_ITEM_BASE} ${FOCUS_RING} ${
        active
          ? "bg-adm-pill font-bold text-adm-text"
          : "text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text"
      } ${collapsed ? "justify-center px-0" : ""}`}
    >
      <Icon size={18} weight={active ? "bold" : "regular"} className="shrink-0" aria-hidden />
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <AutoText className="min-w-0 flex-1 truncate">{item.label}</AutoText>
      )}
      {badge !== null && <NavBadge count={badge} collapsed={collapsed} />}
    </AdminLink>
  );
}

/**
 * Sidebar content shared by the desktop rail and the mobile drawer (Master Plan §2.4 / spec 7.2):
 * logo tile + "Gymini · Quản trị", 5 grouped sections with grey uppercase labels, active item =
 * grey pill (no left bar), count badges, independent nav scroll, theme switch + user card at the
 * bottom. Badge counts never block navigation: a failing badge query simply shows no badge.
 */
export function AdminSidebar({ collapsed = false, onNavigate, onToggleCollapse, inDrawer = false }: AdminSidebarProps) {
  const { user, logout, setSidebarOpen } = useApp();
  const { effectiveTheme, toggleTheme } = useSettings();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const badges = useAdminNavBadges();
  const activeId = findActiveNavItem(pathname)?.item.id ?? null;
  const isDark = effectiveTheme === "dark";

  const handleLogout = () => {
    logout();
    setSidebarOpen(false);
    navigate("/login");
  };

  const name = displayName(user);

  return (
    <div className="flex h-full min-h-0 flex-col bg-adm-surface text-adm-text">
      {/* Brand */}
      <div className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-adm-border ${collapsed ? "justify-center px-0" : "px-4"}`}>
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-primary text-primary-foreground" aria-hidden="true">
          <BarbellIcon size={18} weight="bold" />
        </span>
        {!collapsed && <span className="truncate text-base font-bold tracking-tight">Gymini · Quản trị</span>}
      </div>

      {/* Navigation — scrolls on its own so the footer stays reachable on short screens */}
      <nav aria-label="Điều hướng quản trị" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-3 pt-2">
        {ADMIN_NAV.map((group, index) => (
          <div key={group.id} className={index === 0 ? "" : "mt-3.5"}>
            {group.title &&
              (collapsed ? (
                <div className="mx-3 mb-2 mt-1.5 h-px bg-adm-border-soft" aria-hidden="true" />
              ) : (
                <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase leading-snug tracking-wider text-adm-text-2">
                  <AutoText>{group.title}</AutoText>
                </div>
              ))}
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {group.items.map((item) => (
                <li key={item.id}>
                  <NavLinkItem
                    item={item}
                    active={item.id === activeId}
                    collapsed={collapsed}
                    badge={item.badge ? badges[item.badge] : null}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer: theme switch, language (drawer only), user card, collapse */}
      <div className="flex shrink-0 flex-col gap-0.5 border-t border-adm-border px-2.5 py-2">
        <button
          type="button"
          onClick={toggleTheme}
          title={collapsed ? "Đổi giao diện" : undefined}
          aria-label={isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
          data-testid="admin-theme-toggle"
          className={`${NAV_ITEM_BASE} ${FOCUS_RING} text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text ${collapsed ? "justify-center px-0" : ""}`}
        >
          {isDark ? <SunIcon size={18} aria-hidden /> : <MoonIcon size={18} aria-hidden />}
          {!collapsed && <AutoText className="flex-1 truncate">Đổi giao diện</AutoText>}
        </button>

        {inDrawer && (
          <div className="px-1 py-1.5 md:hidden [&_label]:has-[:focus-visible]:outline-2 [&_label]:has-[:focus-visible]:outline-offset-2 [&_label]:has-[:focus-visible]:outline-[var(--adm-focus)] [&_label]:min-h-11 [&_select]:min-h-9">
            <LanguageSwitcher />
          </div>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Tài khoản: ${name}`}
              data-testid="admin-user-card"
              className={`mt-1 flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left transition-colors hover:bg-adm-surface-2 motion-reduce:transition-none ${FOCUS_RING} ${collapsed ? "justify-center" : ""}`}
            >
              <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-adm-pill text-xs font-bold text-adm-text" aria-hidden="true">
                {initials(user)}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-semibold text-adm-text">{name}</span>
                    <span className="block truncate text-[11.5px] text-adm-text-2">{user?.email}</span>
                  </span>
                  <CaretDownIcon size={16} className="shrink-0 text-adm-text-2" aria-hidden />
                </>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-60 border-adm-border bg-adm-surface p-1.5 text-adm-text shadow-adm-pop"
          >
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="truncate text-xs text-adm-text-2">{user?.email}</p>
              <p className="mt-0.5 text-xs text-adm-text-2">
                <AutoText>Quản trị viên</AutoText>
              </p>
            </div>
            <div className="my-1 h-px bg-adm-border-soft" />
            <button
              type="button"
              onClick={handleLogout}
              data-testid="admin-logout"
              className={`flex w-full min-h-11 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-st-danger transition-colors hover:bg-st-danger-bg motion-reduce:transition-none lg:min-h-9 ${FOCUS_RING}`}
            >
              <SignOutIcon size={16} aria-hidden />
              <AutoText>Đăng xuất</AutoText>
            </button>
          </PopoverContent>
        </Popover>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
            title={collapsed ? "Mở rộng thanh bên" : undefined}
            data-testid="admin-sidebar-collapse"
            className={`${NAV_ITEM_BASE} ${FOCUS_RING} text-adm-text-2 hover:bg-adm-surface-2 hover:text-adm-text ${collapsed ? "justify-center px-0" : ""}`}
          >
            <SidebarSimpleIcon size={18} aria-hidden />
            {!collapsed && <AutoText className="flex-1 truncate">Thu gọn thanh bên</AutoText>}
          </button>
        )}
      </div>
    </div>
  );
}
