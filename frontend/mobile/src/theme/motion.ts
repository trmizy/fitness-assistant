import { Easing, type WithSpringConfig, type WithTimingConfig } from "react-native-reanimated";

/**
 * The design's motion constants, transcribed from `D:\New Frontend\src\components\ui.tsx`, so the
 * feel ports exactly rather than approximately.
 *
 * The reference uses motion/react, whose `{ type: "spring", stiffness, damping }` is the same
 * physical model Reanimated's `withSpring` uses, with mass defaulting to 1 on both sides — so the
 * numbers carry across unchanged. `ease: [0.22, 1, 0.36, 1]` is a cubic-bezier, which
 * `Easing.bezier` takes with the same four control points.
 *
 * Do not invent new values. If a screen needs motion that is not here, it should be added here
 * with a note about which reference screen it came from.
 */

/** Press feedback, and any small "settling" movement. */
export const springPress: WithSpringConfig = { stiffness: 400, damping: 25, mass: 1 };

/** Entrance of a list item under a stagger. */
export const springEnter: WithSpringConfig = { stiffness: 320, damping: 30, mass: 1 };

/** A sheet or drawer travelling a long distance. */
export const springSheet: WithSpringConfig = { stiffness: 320, damping: 34, mass: 1 };

/** A control snapping between discrete positions: segmented indicator, swipe row. */
export const springSnap: WithSpringConfig = { stiffness: 400, damping: 34, mass: 1 };

/** The design's single easing curve for value animations (count-ups, progress sweeps). */
export const easeOutExpo = Easing.bezier(0.22, 1, 0.36, 1);

export const timingCount: WithTimingConfig = { duration: 800, easing: easeOutExpo };
export const timingProgress: WithTimingConfig = { duration: 1000, easing: easeOutExpo };

/** Scale a pressed element shrinks to. Two values, deliberately: the reference uses a slightly
 *  deeper press for buttons than for whole cards/rows. */
export const pressScale = { surface: 0.97, button: 0.96 };

/** Stagger timings, in milliseconds (the reference expresses them in seconds). */
export const stagger = { childDelay: 50, initialDelay: 50 };

/** How far a staggered item travels up as it fades in. */
export const staggerOffsetY = 12;

/** Toast lifetime before it auto-dismisses. */
export const toastDuration = 2200;

/** Swipe-to-reveal geometry: how wide the revealed action is, and how far the user must drag
 *  before releasing commits to the open position. */
export const swipe = { actionWidth: 96, commitThreshold: 48, elasticity: 0.08 };

/** How far a bottom sheet must be dragged down before release dismisses it. */
export const sheetDismissThreshold = 120;
