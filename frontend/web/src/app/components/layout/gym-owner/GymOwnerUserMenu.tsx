/** Account menu of the Gym Owner shell: profile, theme (icon swap), sign out. Motion: 05 menu-dropdown + 09 icon-swap. */
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { MoonIcon, SignOutIcon, SunIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useApp } from "../../../context/AppContext";
import { useSettings } from "../../../context/SettingsContext";
import { ROLE_LABEL } from "../../../features/gym-owner/scope/scopeModel";
import { useGymOwnerScope } from "../../../features/gym-owner/scope/GymOwnerScopeProvider";
import { IconSwap, useDismissable, useDropdownPhase } from "./motion";

export function GymOwnerUserMenu() {
  const { user, logout } = useApp();
  const { effectiveTheme, toggleTheme } = useSettings();
  const { role } = useGymOwnerScope();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const phase = useDropdownPhase(open);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, rootRef, triggerRef);
  const name = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email.split("@")[0] : "";
  const dark = effectiveTheme === "dark";

  return (
    <div className="go-menu-anchor" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="go-icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu tài khoản"
        data-testid="go-user-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="go-avatar" aria-hidden="true">{(name[0] || "U").toUpperCase()}</span>
      </button>
      <div className={`go-usermenu ${phase.className}`} data-origin="top-right" role="menu" aria-label="Tài khoản">
        <div className="go-usermenu-head">
          <div style={{ fontWeight: 600 }}>{name}</div>
          <div className="go-bell-meta">{user?.email}</div>
          {role && <div className="go-bell-meta">{ROLE_LABEL[role]}</div>}
        </div>
        <button type="button" role="menuitem" className="go-usermenu-item" onClick={() => { setOpen(false); navigate("/gym-owner/profile"); }}>
          <UserCircleIcon aria-hidden="true" /> Hồ sơ của tôi
        </button>
        <button type="button" role="menuitem" className="go-usermenu-item" onClick={toggleTheme} data-testid="go-theme-toggle">
          <IconSwap state={dark ? "b" : "a"} a={<MoonIcon />} b={<SunIcon />} />
          {dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
        </button>
        <button
          type="button"
          role="menuitem"
          className="go-usermenu-item"
          data-danger="true"
          onClick={() => {
            setOpen(false);
            logout();
            navigate("/login");
          }}
        >
          <SignOutIcon aria-hidden="true" /> Đăng xuất
        </button>
      </div>
    </div>
  );
}
