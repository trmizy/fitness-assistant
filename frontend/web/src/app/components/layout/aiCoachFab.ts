/**
 * Where the floating AI Coach button must NOT be drawn: the screens whose own bottom controls it would sit on
 * (the chat composer - its "Gửi" and "Thử lại" - and AI Coach's own page, where the button is redundant).
 * Shared by the button itself and by AppShell (which only reserves room under the page while the button shows).
 */
const HIDDEN_ON = /^\/(?:client|pt)\/(?:chat|ai-coach)(?:\/|$)/;

export function isAiCoachFabHiddenOn(pathname: string): boolean {
  return HIDDEN_ON.test(pathname);
}

/**
 * Pixels a page's own sticky bottom bar (StickyActionBar) asks the button to rise by, so it floats above the bar
 * instead of on top of its buttons. Written as a CSS variable on <html> by the bar, read by the button.
 */
export const AI_FAB_LIFT_VAR = "--ai-fab-lift";
