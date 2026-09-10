import type { ReactNode } from "react";
import { cn } from "./utils";

/**
 * GYM_MANAGEMENT master spec §67 mobile guidance — "primary actions in lower third". Sticks
 * to the bottom of its scroll container (not the viewport — wrap the page's own scroll area)
 * so the primary action stays reachable with a thumb without covering content while scrolling.
 */
export function StickyActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
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
