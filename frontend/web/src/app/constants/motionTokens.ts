// JS mirror of gymini-motion.css for Motion (motion/react) props. Keep the two in sync:
// CSS is the source of truth for durations; these are seconds for Motion.
export const dur = {
  micro: 0.08,
  quick: 0.15,
  fast: 0.25,
  medium: 0.35,
  slow: 0.4,
  emphasis: 0.5,
  route: 0.18,
  ops: 0.12,
} as const;

export const ease = {
  smoothOut: [0.22, 1, 0.36, 1] as const,
  route: [0.22, 0.61, 0.36, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};

/** Spring used ONLY for shared-layout indicators (nav pill, tab pill). Critically damped: no bounce. */
export const indicatorSpring = { type: "spring", stiffness: 520, damping: 44, mass: 0.9 } as const;

export type MotionTier = "marketing" | "product" | "ops";
