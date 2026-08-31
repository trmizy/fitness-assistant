import { useEffect, useRef } from "react";

/**
 * Registry of things the hardware Back button should close before it navigates anywhere.
 *
 * Most overlays in this app are hand-rolled (`fixed inset-0` + a `useState` flag) rather
 * than a library component, so there is nothing generic to detect them by and no Escape
 * handling to piggyback on. Each one that wants Back to close it registers here with a
 * single hook call.
 *
 * A stack, not a set: overlays nest (a confirm dialog on top of a modal), and Back must
 * close the TOP one only — the one the user is actually looking at.
 */

type Dismiss = () => void;

const stack: { id: symbol; dismiss: Dismiss }[] = [];

/** Closes the topmost registered overlay. Returns false when there was nothing to close. */
export function dismissTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  try {
    top.dismiss();
  } catch (err) {
    console.error("[useBackDismissible] dismiss failed", err);
  }
  return true;
}

export function hasOpenOverlay(): boolean {
  return stack.length > 0;
}

/**
 * Registers an overlay while it is open, so the Android Back button closes it instead of
 * navigating away.
 *
 * ```tsx
 * const [open, setOpen] = useState(false);
 * useBackDismissible(open, () => setOpen(false));
 * ```
 *
 * `onDismiss` is read through a ref, so an inline arrow function does not churn the
 * registration on every render.
 */
export function useBackDismissible(isOpen: boolean, onDismiss: Dismiss): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!isOpen) return;
    const entry = { id: Symbol("overlay"), dismiss: () => dismissRef.current() };
    stack.push(entry);
    return () => {
      const i = stack.findIndex((e) => e.id === entry.id);
      if (i !== -1) stack.splice(i, 1);
    };
  }, [isOpen]);
}
