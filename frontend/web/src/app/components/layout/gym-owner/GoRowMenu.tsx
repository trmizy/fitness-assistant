/**
 * "⋯" menu of one table row (Gym Owner workspace). The trigger is an icon button named for the row ("Thao tác với <tên>"), the menu is
 * `role=menu` with `role=menuitem` buttons, opens focused on the first item, arrows move, Escape / outside press closes and returns
 * focus to the trigger. An item only chooses an action: anything with consequences (revoke) still goes through its own confirm dialog.
 * Reuses the dropdown motion + `.go-usermenu` look of the account menu.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DotsThreeIcon } from "@phosphor-icons/react";
import { useDismissable, useDropdownPhase } from "./motion";

export interface GoRowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  testId?: string;
  /** Accessible name when it needs the row's subject ("Thu hồi quyền của Nguyễn A"); defaults to `label`. */
  ariaLabel?: string;
}

export function GoRowMenu({
  label,
  items,
  testId,
  triggerRef,
}: {
  label: string;
  items: readonly GoRowMenuItem[];
  testId?: string;
  /** Lets the owner of the row put focus back on the trigger after a dialog closes. */
  triggerRef?: (el: HTMLButtonElement | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const phase = useDropdownPhase(open);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, close, rootRef, btnRef);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className="go-menu-anchor" ref={rootRef}>
      <button
        type="button"
        ref={(el) => { btnRef.current = el; triggerRef?.(el); }}
        className="go-icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
      >
        <DotsThreeIcon aria-hidden="true" weight="bold" />
      </button>
      <div ref={menuRef} className={`go-usermenu go-rowmenu ${phase.className}`} data-origin="top-right" role="menu" aria-label={label} onKeyDown={onMenuKey}>
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className="go-usermenu-item"
            data-danger={it.danger ? "true" : undefined}
            data-testid={it.testId}
            aria-label={it.ariaLabel}
            tabIndex={open ? 0 : -1}
            onClick={() => { setOpen(false); it.onSelect(); }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
