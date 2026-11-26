/*
 * NIGHT GLASS desktop rail (design prototype, branch frontend2/night-glass).
 *
 * Client/PT workspace only, lg+ only (the mobile drawer keeps the full labelled Sidebar). Same nav lists, same
 * routes, same logout handler as Sidebar — only the presentation changes.
 *
 * Accessibility model:
 * - every control is icon-only, so its accessible name is aria-label (translated like the rest of the nav);
 *   the active route keeps NavLink's aria-current="page"; the PT switch uses aria-pressed.
 * - the glass bubble is a VISUAL twin of that name (aria-hidden): mouse hover (fine pointers only, never touch)
 *   or keyboard focus (:focus-visible) shows it; Esc hides it; moving onto the bubble keeps it (WCAG 1.4.13).
 * - one fixed-position bubble for the whole rail, portalled to <body>, so neither the scrolling nav nor the rail's
 *   backdrop-filter (a containing block for fixed children) can clip or offset it; it moves with transform
 *   only (no layout shift), 160 ms opacity + 4 px slide, opacity only under reduced motion.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useNavigate } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { SignOutIcon } from "@phosphor-icons/react";
import { useApp } from "../../context/AppContext";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";
import type { AppLanguage } from "../../context/SettingsContext";
import { UserAvatar } from "./UserAvatar";
import { AppLogo } from "../brand/AppLogo";
import { clientNavFull, ptWorkspaceNav } from "./Sidebar";

type Tip = { label: string; x: number; y: number } | null;
type ShowTip = (el: HTMLElement, label: string, via: "pointer" | "focus") => void;

/** Secondary destinations sit under a divider so the primary journey reads first (same items, same order). */
const SECONDARY = new Set(["/client/wallet", "/client/profile", "/client/settings", "/pt/wallet", "/pt/profile", "/pt/listing"]);

function useRailLabel(label: string, sourceLang?: AppLanguage) {
  return useAutoTranslate(label, sourceLang || "vi").text;
}

function RailLink({ item, pillId, show, hide }: { item: { label: string; icon: React.ElementType; to: string; sourceLang?: AppLanguage }; pillId: string; show: ShowTip; hide: () => void }) {
  const reduce = useReducedMotion();
  const name = useRailLabel(item.label, item.sourceLang);
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      aria-label={name}
      className="ng-item"
      onPointerEnter={(e) => e.pointerType === "mouse" && show(e.currentTarget, name, "pointer")}
      onPointerLeave={hide}
      onFocus={(e) => show(e.currentTarget, name, "focus")}
      onBlur={hide}
      onClick={hide}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId={pillId}
              aria-hidden="true"
              className="ng-pill"
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 44, mass: 0.9 }}
            />
          )}
          <Icon weight={isActive ? "fill" : "regular"} aria-hidden="true" />
        </>
      )}
    </NavLink>
  );
}

function RailButton({ label, onClick, pressed, show, hide, children }: { label: string; onClick: () => void; pressed?: boolean; show: ShowTip; hide: () => void; children: React.ReactNode }) {
  const name = useRailLabel(label);
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={pressed}
      className="ng-item"
      onClick={() => { hide(); onClick(); }}
      onPointerEnter={(e) => e.pointerType === "mouse" && show(e.currentTarget, name, "pointer")}
      onPointerLeave={hide}
      onFocus={(e) => show(e.currentTarget, name, "focus")}
      onBlur={hide}
    >
      {pressed && <span aria-hidden="true" className="ng-pill" />}
      {children}
    </button>
  );
}

export function NightGlassRail() {
  const { isPT, activeView, logout, setSidebarOpen, user } = useApp();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const pillId = `ng-pill-${useId()}`;
  const railRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const items = isPT && activeView === "pt" ? ptWorkspaceNav : clientNavFull;
  const primary = items.filter((i) => !SECONDARY.has(i.to));
  const secondary = items.filter((i) => SECONDARY.has(i.to));

  const show = useCallback<ShowTip>((el, label, via) => {
    // A mouse click also focuses the link; only keyboard focus should raise the bubble (no sticky tip after a click).
    if (via === "focus" && !el.matches(":focus-visible")) return;
    window.clearTimeout(hideTimer.current);
    const r = el.getBoundingClientRect();
    const rail = railRef.current?.getBoundingClientRect();
    setTip({ label, x: (rail?.right ?? r.right) + 10, y: r.top + r.height / 2 - 16 });
  }, []);
  // Short grace period so the pointer can cross the 10 px gap onto the bubble (hoverable), or slide to the next icon
  // without the bubble flickering out and back in.
  const hide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setTip(null), 90);
  }, []);
  const keep = () => window.clearTimeout(hideTimer.current);

  useEffect(() => {
    if (!tip) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTip(null); };
    const onScroll = () => setTip(null);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onScroll); };
  }, [tip]);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const handleLogout = () => {
    logout();
    setSidebarOpen(false);
    navigate("/login");
  };
  const displayName = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email.split("@")[0] : "Thành viên";

  return (
    <div ref={railRef} className="ng-glass flex h-full w-[68px] flex-col items-center gap-2 rounded-[26px] py-3" data-testid="night-glass-rail">
      {/* The OFFICIAL logo (mascot + wordmark, square asset), whole: contained, never cropped or redrawn. */}
      <AppLogo className="h-[52px] w-[52px] flex-shrink-0 justify-center" imgClassName="gymini-brand-logo h-[52px] w-[52px]" />

      {/* PT workspace switch is not repeated here: the desktop Topbar already shows it (md+); the mobile drawer keeps its own. */}

      <nav aria-label="Điều hướng chính" className="ng-scroll flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-3 py-1" onScroll={() => setTip(null)}>
        {primary.map((item) => <RailLink key={item.to} item={item} pillId={pillId} show={show} hide={hide} />)}
        {secondary.length > 0 && <span aria-hidden="true" className="ng-divider my-1.5 flex-shrink-0" />}
        {secondary.map((item) => <RailLink key={item.to} item={item} pillId={pillId} show={show} hide={hide} />)}
      </nav>

      <span aria-hidden="true" className="ng-divider flex-shrink-0" />
      <span role="img" aria-label={`Đang đăng nhập: ${displayName}`} className="flex h-11 w-11 items-center justify-center">
        <UserAvatar className="h-8 w-8 ring-1 ring-[var(--ob-nav-line)]" fallbackClassName="bg-[var(--ob-elevated)] text-xs font-bold text-[var(--ob-text)]" />
      </span>
      <RailButton label="Đăng xuất" onClick={handleLogout} show={show} hide={hide}>
        <SignOutIcon aria-hidden="true" />
      </RailButton>

      {/* Portalled: the rail's backdrop-filter makes it the containing block of any position:fixed child. */}
      {createPortal(<AnimatePresence>
        {tip && (
          <motion.div
            key="ng-tip"
            aria-hidden="true"
            className="ng-tip"
            style={{ left: tip.x, top: 0 }}
            initial={{ opacity: 0, x: reduce ? 0 : -4, y: tip.y }}
            animate={{ opacity: 1, x: 0, y: tip.y }}
            exit={{ opacity: 0, x: reduce ? 0 : -4 }}
            transition={reduce ? { duration: 0.12 } : { opacity: { duration: 0.16 }, x: { duration: 0.16, ease: [0.22, 1, 0.36, 1] }, y: { type: "spring", stiffness: 600, damping: 46 } }}
            onPointerEnter={keep}
            onPointerLeave={hide}
            data-testid="night-glass-tip"
          >
            {tip.label}
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}
