import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Page scroll lock (N14T-04). The app shells scroll inside `<main>` (the body itself never scrolls), so a plain
 * `body { overflow: hidden }` would not stop the page moving behind an open dialog. Locks the body and every `<main>`,
 * ref-counted so stacked dialogs restore the original values only when the last one closes.
 */
let lockCount = 0;
let lockedStyles: { el: HTMLElement; overflow: string }[] = [];
function lockPageScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (lockCount === 0) {
    lockedStyles = [document.body, ...Array.from(document.querySelectorAll<HTMLElement>("main"))].map((el) => ({ el, overflow: el.style.overflow }));
    lockedStyles.forEach(({ el }) => { el.style.overflow = "hidden"; });
  }
  lockCount += 1;
  return () => {
    lockCount -= 1;
    if (lockCount === 0) {
      lockedStyles.forEach(({ el, overflow }) => { el.style.overflow = overflow; });
      lockedStyles = [];
    }
  };
}

/**
 * Dialog behaviour for the two hand-rolled admin overlays that are not built on `ui/dialog` (B10):
 * moves focus into the panel when it opens, traps Tab / Shift+Tab inside it, closes on Escape, locks the page scroll and gives focus
 * back to whatever opened it. The panel itself must carry `role="dialog" aria-modal="true"`, an accessible name and
 * `tabIndex={-1}`. `active` is `false` while the overlay is not rendered (the ref is then null).
 */
export function useModalA11y(ref: RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    el?.focus();
    const unlockScroll = lockPageScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((i) => i.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!el.contains(current)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (current === first || current === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      unlockScroll();
      document.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [ref, active]);
}
