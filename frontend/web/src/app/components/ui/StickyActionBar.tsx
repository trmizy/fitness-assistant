import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./utils";
import { AI_FAB_LIFT_VAR } from "../layout/aiCoachFab";

/**
 * GYM_MANAGEMENT master spec §67 mobile guidance — "primary actions in lower third". Sticks
 * to the bottom of its scroll container (not the viewport — wrap the page's own scroll area)
 * so the primary action stays reachable with a thumb without covering content while scrolling.
 */
export function StickyActionBar({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // While this bar is stuck to the bottom (below sm), the floating AI Coach button rises by the bar's height
  // so it floats above the bar instead of covering its right-hand button.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => {
      const sticky = getComputedStyle(el).position === "sticky";
      root.style.setProperty(AI_FAB_LIFT_VAR, sticky ? `${Math.round(el.getBoundingClientRect().height)}px` : "0px");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty(AI_FAB_LIFT_VAR);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "sticky bottom-0 left-0 right-0 -mx-4 mt-4 flex items-center gap-2 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur",
        "sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
