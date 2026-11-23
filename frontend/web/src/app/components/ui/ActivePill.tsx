import { motion, useReducedMotion } from "motion/react";
import { cn } from "./utils";

/**
 * Frontend 2.0 — the "selected" surface of a segmented control / tab bar, shared by all its
 * options so it GLIDES to the newly chosen one instead of each option swapping its own
 * background. Render it inside the active option only; the option must be `relative` and its
 * label wrapped in a `relative` element (so the label paints above the pill).
 *
 * `group` must be unique among tab bars that are on screen at the same time.
 * Critically damped spring (no overshoot); instant under prefers-reduced-motion.
 */
export function ActivePill({ group, className }: { group: string; className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      layoutId={`active-pill-${group}`}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 44, mass: 0.9 }}
    />
  );
}
