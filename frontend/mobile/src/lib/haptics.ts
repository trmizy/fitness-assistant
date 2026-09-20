import * as Haptics from "expo-haptics";

/**
 * Every haptic the design system fires, named by INTENT rather than by strength — so the mapping
 * to a platform effect can be tuned in one place, and a screen never has to reason about
 * "medium vs heavy".
 *
 * The web reference has no haptics at all (a browser cannot), so this is native-only polish the
 * migration plan asks for from Phase 3 onward rather than something ported.
 *
 * All of these are fire-and-forget: a device with no haptic motor, or one where the user has
 * turned vibration off, rejects the promise, and a failed buzz must never break the interaction
 * that triggered it.
 */

function fire(run: () => Promise<void>): void {
  void run().catch(() => {
    // No motor, or haptics disabled by the user — nothing to do.
  });
}

export const haptics = {
  /** A button, card or row was pressed. The most common one by far. */
  tap: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),

  /** A control moved to a new discrete position: a segmented tab, a stepper, a picker. */
  selection: () => fire(() => Haptics.selectionAsync()),

  /** A gesture crossed the threshold that commits it — a sheet about to dismiss, a row about to
   *  reveal its action. Fires at the moment the outcome becomes inevitable, not on release. */
  threshold: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),

  /** Something the user asked for completed. */
  success: () =>
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),

  /** Something needs attention but is not an error (a limit reached, a pending state). */
  warning: () =>
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),

  /** An action failed. */
  error: () =>
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
