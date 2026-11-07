import { useLayoutEffect, useRef } from "react";

/**
 * B9a — focus return for dialogs that are mounted only while open (`{open && <Dialog open>}`).
 * Radix gives focus back to its own `Dialog.Trigger`; these dialogs have none, so focus would
 * fall to <body> after Esc/close. This remembers the element focused when the dialog mounted
 * (or, if that element is gone — e.g. a menu item that closed with the menu — the element
 * matching `fallbackSelector`) and restores it on close.
 */
export function useReturnFocus(fallbackSelector?: string) {
  const prev = useRef<HTMLElement | null>(typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null);
  return {
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      const el = prev.current;
      if (el && el.isConnected && el !== document.body) el.focus();
      else if (fallbackSelector) (document.querySelector(fallbackSelector) as HTMLElement | null)?.focus();
    },
  };
}

/**
 * Same goal for always-mounted controlled dialogs (`ConfirmDialog open={...}`): they have no
 * Trigger either, so closing drops focus on <body>. Remembers the element that was focused when
 * `open` flipped to true and restores it after the dialog closes (if it is still in the page).
 */
export function useRestoreFocus(open: boolean) {
  const prev = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      prev.current = document.activeElement as HTMLElement | null;
    } else if (!open && wasOpen.current) {
      const el = prev.current;
      window.setTimeout(() => {
        if (el && el.isConnected && el !== document.body) el.focus();
      }, 60);
    }
    wasOpen.current = open;
  }, [open]);
}
