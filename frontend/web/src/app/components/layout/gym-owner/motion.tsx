/**
 * React ports of the transitions.dev snippets used by the Gym Owner shell (CSS lives in src/styles/gym-owner.css).
 * Every helper reads its timing from the workspace CSS tokens (never an ad-hoc number) and is interruptible: a new
 * state clears the pending timer and the CSS transition simply retargets, so rapid switching never queues animations.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** Reads a `--token: 250ms` custom property from <html> (the shell sets data-workspace there) as milliseconds. */
export function readCssMs(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : n;
}

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState<boolean>(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * 05 menu-dropdown state machine: closed -> open -> closing -> closed. The panel stays mounted (hidden via the snippet's
 * visibility rule) so the open transition always runs; `.is-closing` is removed after --dropdown-close-dur.
 */
export function useDropdownPhase(open: boolean): { className: string } {
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(open);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (open) {
      setClosing(false);
    } else if (wasOpen.current) {
      setClosing(true);
      timer.current = setTimeout(() => setClosing(false), readCssMs("--dropdown-close-dur", 150));
    }
    wasOpen.current = open;
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open]);
  // Derived synchronously from `open` so the first paint after opening already carries .is-open (the transition runs).
  return { className: `t-dropdown${open ? " is-open" : closing ? " is-closing" : ""}` };
}

/** Closes on outside pointer-down and on Escape (returning focus to the trigger). */
export function useDismissable(open: boolean, onClose: () => void, rootRef: RefObject<HTMLElement | null>, triggerRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        triggerRef?.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, rootRef, triggerRef]);
}

/**
 * 34 text-swap-soft: the old text blurs out while the new one blurs in, in place; the width eases so neighbours glide.
 * The element's text is managed imperatively (as in the snippet), so there are no React children.
 */
export function TextSoft({ value, className = "", align }: { value: string; className?: string; align?: "start" | "end" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (current.current === null) {
      current.current = value;
      el.textContent = value;
      return;
    }
    const prev = current.current;
    if (prev === value) return;
    current.current = value;
    if (timer.current) clearTimeout(timer.current);

    const out = document.createElement("span");
    out.className = "t-text-soft-old";
    out.setAttribute("aria-hidden", "true");
    out.textContent = prev;
    const inn = document.createElement("span");
    inn.className = "t-text-soft-new";
    inn.textContent = value;

    const w0 = el.getBoundingClientRect().width;
    el.classList.remove("is-swapping");
    el.replaceChildren(out, inn);
    const w1 = inn.getBoundingClientRect().width;
    el.style.width = `${w0}px`;
    void el.offsetWidth; // force reflow so every transition runs
    el.classList.add("is-swapping");
    el.style.width = `${w1}px`;

    const total = Math.max(readCssMs("--text-soft-dur", 250), readCssMs("--text-soft-resize-dur", 250)) + readCssMs("--duration-stagger", 40);
    timer.current = setTimeout(() => {
      el.classList.remove("is-swapping");
      el.style.removeProperty("width");
      el.textContent = value;
    }, total);
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return <span ref={ref} className={`t-text-soft ${className}`} style={align === "end" ? ({ "--text-soft-align": "end" } as React.CSSProperties) : undefined} />;
}

/** 09 icon-swap: two icons share one cell and cross-fade with blur + scale. */
export function IconSwap({ state, a, b, className = "" }: { state: "a" | "b"; a: ReactNode; b: ReactNode; className?: string }) {
  return (
    <span className={`t-icon-swap ${className}`} data-state={state} aria-hidden="true">
      <span className="t-icon" data-icon="a">{a}</span>
      <span className="t-icon" data-icon="b">{b}</span>
    </span>
  );
}

/** 03 notification-badge: only for REAL counts (callers must pass a counted source, never a placeholder). */
export function CountBadge({ count }: { count: number }) {
  const shown = count > 99 ? "99+" : String(count);
  // Keep the last non-zero number while the badge pops out, so it does not flash "0".
  const last = useRef(shown);
  if (count > 0) last.current = shown;
  return (
    <span className="t-badge" data-open={count > 0 ? "true" : "false"} aria-hidden="true">
      <span className="t-badge-dot">{last.current}</span>
    </span>
  );
}

/**
 * 17 tooltip for the icon rail: one bubble shared by every `[data-tooltip]` trigger inside the group; it fades/scales in
 * after a short delay and, while visible, travels vertically to the next trigger instead of popping a second bubble.
 */
export function useRailTooltip(enabled: boolean) {
  const groupRef = useRef<HTMLElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  const hide = useCallback(() => {
    const tip = tipRef.current;
    if (!tip) return;
    tip.setAttribute("data-show", "false");
    tip.setAttribute("aria-hidden", "true");
  }, []);

  const place = useCallback(
    (trigger: HTMLElement) => {
      const tip = tipRef.current;
      const group = groupRef.current;
      if (!enabled || !tip || !group) return;
      const showing = tip.getAttribute("data-show") === "true";
      const label = trigger.getAttribute("data-tooltip") ?? "";
      tip.textContent = label; // imperative on purpose (as in the snippet): the bubble has no React children
      const g = group.getBoundingClientRect();
      const r = trigger.getBoundingClientRect();
      const y = r.top - g.top + r.height / 2 - tip.offsetHeight / 2;
      if (!showing) {
        // Snap the geometry while hidden so only the appear plays.
        tip.style.transition = "none";
        tip.style.setProperty("--tt-y", `${y}px`);
        void tip.offsetWidth;
        tip.style.transition = "";
      } else {
        tip.style.setProperty("--tt-y", `${y}px`);
      }
      tip.setAttribute("data-show", "true");
      tip.setAttribute("aria-hidden", "false");
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) hide();
  }, [enabled, hide]);

  const groupHandlers = {
    onPointerOver: (e: React.PointerEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");
      if (t) place(t);
    },
    onFocusCapture: (e: React.FocusEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tooltip]");
      if (t) place(t);
    },
    onPointerLeave: hide,
    onBlurCapture: hide,
  };
  return { groupRef, tipRef, groupHandlers };
}

const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 04 text-states-swap: the old text exits up with blur, the new one enters from below (three phases, as in the snippet).
 * Used for the "Tải lại" / "Đang tải" label. A new value while a swap is pending restarts the timer, so the last value always wins.
 */
export function TextStates({ value, className = "" }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (shown.current === null) {
      shown.current = value;
      el.textContent = value;
      return;
    }
    if (shown.current === value) return;
    shown.current = value;
    if (timer.current) clearTimeout(timer.current);
    if (prefersReducedMotion()) {
      el.textContent = value;
      return;
    }
    el.classList.add("is-exit");
    timer.current = setTimeout(() => {
      el.textContent = value;
      el.classList.remove("is-exit");
      el.classList.add("is-enter-start");
      void el.offsetHeight; // reflow so the entry transitions
      el.classList.remove("is-enter-start");
    }, readCssMs("--text-swap-dur", 150));
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return <span ref={ref} className={`t-text-swap ${className}`} />;
}

/**
 * 36 number-subtle-change: only the digits that changed cross-fade in place. For counts of tasks/exceptions ONLY - never money.
 * The text is managed imperatively (as in the snippet); the accessible value is `aria-label`.
 */
export function SubtleNumber({ value, className = "" }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const str = String(value);
    el.setAttribute("aria-label", str);
    if (prev.current === null || prev.current === value || prefersReducedMotion()) {
      prev.current = value;
      el.classList.remove("is-animating");
      el.textContent = str;
      return;
    }
    const before = String(prev.current);
    const same = before.length === str.length;
    el.style.setProperty("--subtle-dir", value >= prev.current ? "1" : "-1");
    el.classList.remove("is-animating");
    el.replaceChildren();
    [...str].forEach((ch, i) => {
      if (same && before[i] === ch) {
        el.append(ch);
        return;
      }
      const slot = document.createElement("span");
      slot.className = "t-subtle-slot";
      if (same) {
        const old = document.createElement("span");
        old.className = "t-subtle-old";
        old.setAttribute("aria-hidden", "true");
        old.textContent = before[i];
        slot.appendChild(old);
      }
      const fresh = document.createElement("span");
      fresh.className = "t-subtle-new";
      fresh.textContent = ch;
      slot.appendChild(fresh);
      el.appendChild(slot);
    });
    prev.current = value;
    void el.offsetHeight;
    el.classList.add("is-animating");
  }, [value]);
  return <span ref={ref} className={`t-subtle-number ${className}`} />;
}

/**
 * 10 success-check: appears ONLY when told to (callers set `show` after a real 2xx answer, never optimistically).
 * Fade + rotate + blur + Y-bob + stroke draw, all from the CSS tokens of the workspace. Reduced motion: shown at once.
 */
export function SuccessCheck({ show, size = 20, className = "" }: { show: boolean; size?: number; className?: string }) {
  const wrap = useRef<HTMLSpanElement>(null);
  const path = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const p = path.current;
    if (!p) return;
    const len = Math.ceil(p.getTotalLength?.() ?? 24) + 1;
    p.style.strokeDasharray = String(len);
    p.style.strokeDashoffset = String(len);
  }, []);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    el.setAttribute("data-state", "out");
    if (show) {
      void el.offsetWidth; // restart the keyframes from a clean baseline
      el.setAttribute("data-state", "in");
    }
  }, [show]);
  return (
    <span ref={wrap} className={`t-success-check ${className}`} data-state="out" aria-hidden="true" data-testid="go-success-check">
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path ref={path} d="M5 12.5l4.5 4.5L19 7" />
      </svg>
    </span>
  );
}

/**
 * 12 error-state-shake: `shake()` replays the percussive shake on the element (restart = remove, reflow, add). The caller owns
 * the message (role="alert") and the error border; typing clears them. Reduced motion is handled in CSS.
 */
export function useShake<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shake = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("is-shaking");
    void el.offsetWidth;
    el.classList.add("is-shaking");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => el.classList.remove("is-shaking"), readCssMs("--shake-dur-a", 80) * 2 + readCssMs("--shake-dur-b", 60) * 2 + 20);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { ref, shake };
}
