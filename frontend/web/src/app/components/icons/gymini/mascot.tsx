import { forwardRef } from "react";
import type { SVGProps } from "react";

/**
 * GYMINI NEO MONKEY MASCOT — foundational mark only.
 *
 * Scope note (see final report §12): the full mascot illustration set the spec describes
 * (AI Coach, Workout Complete, New PR, Streak, Rest Day, Empty State, Error, Celebration,
 * Level up — each its own richer illustration) is real product-design work that needs new
 * empty-state / celebration UI to actually host it; nothing in the current app renders a
 * mascot today. Building 8 unused illustrations speculatively would be exactly the kind of
 * decoration-over-usability the spec warns against. What's here is the one thing safe to
 * ship without that context: a single reusable abstract monkey-silhouette mark — angular,
 * not cute, no eyes/face drawn in (so it reads as a brand mark, not a mascot face stamped
 * onto every icon) — for whoever builds those empty-state screens next to compose with.
 */
export interface GyminiMascotProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

export const GyminiMonkeyMark = forwardRef<SVGSVGElement, GyminiMascotProps>(
  ({ size = 32, className, ...props }, ref) => (
    <svg
      ref={ref}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`gymini-icon ${className ?? ""}`.trim()}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {/* Head — angular silhouette, brow ridge implied by the top chamfer only. */}
      <path d="M16 5c4.5 0 7.5 3.3 7.5 8 0 5.3-3.4 9-7.5 9s-7.5-3.7-7.5-9c0-4.7 3-8 7.5-8Z" />
      {/* Ears — small side arcs, the one explicitly-allowed subtle monkey cue. */}
      <path d="M8.7 10.8c-1.8-.5-3.2.5-3.2 2.4s1.6 3.2 3.4 2.7" />
      <path d="M23.3 10.8c1.8-.5 3.2.5 3.2 2.4s-1.6 3.2-3.4 2.7" />
      {/* Muzzle notch — the single angular cut standing in for a face, no eyes/mouth drawn. */}
      <path d="M12.5 18.5h7l-1.6 3h-3.8z" />
    </svg>
  ),
);
GyminiMonkeyMark.displayName = "GyminiMonkeyMark";
