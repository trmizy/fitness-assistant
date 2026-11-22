/**
 * GymOwnerSidebar - role-aware navigation (gymOwnerNav.ts). Three presentations share this one component:
 *  - full (232px, >= 1280 unless collapsed), rail (64px, 1024-1279 or collapsed; tooltips on hover/focus), sheet (< 1024).
 * No count badges: no navigation entry has a real count source in G0 (06 section 3 forbids made-up badges).
 */
import { useLocation, useNavigate } from "react-router";
import {
  CaretDoubleLeftIcon,
  CaretDoubleRightIcon,
  HouseIcon,
  NotePencilIcon,
  QrCodeIcon,
  StorefrontIcon,
  TagIcon,
  UserCircleIcon,
  UsersIcon,
  UsersThreeIcon,
  WalletIcon,
  WarningIcon,
  HandshakeIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useApp } from "../../../context/AppContext";
import { useGymOwnerScope } from "../../../features/gym-owner/scope/GymOwnerScopeProvider";
import { ROLE_LABEL } from "../../../features/gym-owner/scope/scopeModel";
import { activeNavIdForPath, navFor, type GoIconKey } from "./gymOwnerNav";
import { IconSwap, useRailTooltip } from "./motion";

const ICONS: Record<GoIconKey, Icon> = {
  today: HouseIcon,
  desk: QrCodeIcon,
  plans: TagIcon,
  members: UsersThreeIcon,
  branches: StorefrontIcon,
  listings: NotePencilIcon,
  pt: HandshakeIcon,
  finance: WalletIcon,
  cases: WarningIcon,
  staff: UsersIcon,
  profile: UserCircleIcon,
};

/**
 * Router link as a plain anchor: keeps middle/ctrl-click, copy-link and a real href. (react-router's own <Link> hits the
 * repo-wide duplicate @types/react typing error TS2786, which would raise the tsc baseline.)
 */
function GoLink({ to, onNavigate, children, ...rest }: { to: string; onNavigate?: () => void; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const navigate = useNavigate();
  return (
    <a
      {...rest}
      href={to}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
        onNavigate?.();
      }}
    >
      {children}
    </a>
  );
}

export function GymOwnerSidebar({
  rail = false,
  canToggleRail = false,
  onToggleRail,
  onNavigate,
  inDrawer = false,
}: {
  rail?: boolean;
  canToggleRail?: boolean;
  onToggleRail?: () => void;
  onNavigate?: () => void;
  inDrawer?: boolean;
}) {
  const { pathname } = useLocation();
  const { user } = useApp();
  const { role, status } = useGymOwnerScope();
  const groups = navFor(role);
  const activeId = activeNavIdForPath(pathname);
  const tip = useRailTooltip(rail && !inDrawer);
  const name = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email.split("@")[0] : "";

  return (
    <div className="go-sidebar-inner t-tt-group" ref={tip.groupRef as React.RefObject<HTMLDivElement>} {...tip.groupHandlers} style={{ position: "relative" }}>
      <div className="go-sidebar-head">
        <GoLink to={role ? (groups[0]?.items[0]?.to ?? "/gym-owner/profile") : "/gym-owner"} className="go-brand" onNavigate={onNavigate} aria-label="Gymini, về trang chủ">
          <span className="go-brand-mark" aria-hidden="true">G</span>
          {!rail && <span>Gymini</span>}
        </GoLink>
        {canToggleRail && !rail && <span style={{ flex: 1 }} />}
        {canToggleRail && (
          <button
            type="button"
            className="go-icon-btn"
            onClick={onToggleRail}
            aria-label={rail ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
            aria-pressed={rail}
            data-tooltip={rail ? "Mở rộng thanh bên" : undefined}
            data-testid="go-rail-toggle"
          >
            <IconSwap state={rail ? "b" : "a"} a={<CaretDoubleLeftIcon />} b={<CaretDoubleRightIcon />} />
          </button>
        )}
      </div>

      <nav className="go-nav" aria-label="Điều hướng phòng tập" data-testid="go-nav">
        {status === "loading" && (
          <div aria-hidden="true" style={{ display: "grid", gap: "var(--go-s2)", padding: "var(--go-s2)" }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="go-skel-bar" style={{ height: 32 }} />
            ))}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.id} className="go-nav-group">
            <div className="go-nav-group-label" id={`go-nav-${g.id}`}>{g.label}</div>
            <ul className="go-nav-list" aria-labelledby={`go-nav-${g.id}`}>
              {g.items.map((item) => {
                const NavIcon = ICONS[item.icon];
                return (
                  <li key={item.id}>
                    <GoLink
                      to={item.to}
                      className="go-nav-link"
                      aria-current={activeId === item.id ? "page" : undefined}
                      data-tooltip={rail && !inDrawer ? item.label : undefined}
                      data-testid={`go-nav-${item.id}`}
                      onNavigate={onNavigate}
                    >
                      <NavIcon className="go-nav-icon" aria-hidden="true" />
                      <span className="go-nav-label">{item.label}</span>
                    </GoLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="go-sidebar-foot">
        <span className="go-avatar" aria-hidden="true">{(name[0] || "U").toUpperCase()}</span>
        <div className="go-sidebar-foot-text">
          <div className="go-sidebar-foot-name">{name}</div>
          <div className="go-sidebar-foot-role">{role ? ROLE_LABEL[role] : ""}</div>
        </div>
      </div>

      {/* One bubble for the whole rail (17 tooltip): geometry is written by useRailTooltip. */}
      {!inDrawer && <span ref={tip.tipRef} className="t-tt" role="tooltip" aria-hidden="true" data-show="false" />}
    </div>
  );
}
