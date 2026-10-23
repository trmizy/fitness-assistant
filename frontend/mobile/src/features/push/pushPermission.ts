/**
 * When may the app show the system "allow notifications" dialog?
 *
 * Pure decision, kept out of PushManager so it can be unit-tested without React Native. The dialog is
 * asked for at most once per install (the OS permission is per install too), and never on top of a
 * screen the user is in the middle of — a cold start from the payment-return deep link used to stack
 * it on the payment result.
 */

export type PushPermissionDecision =
  | "register" // already granted — just register the FCM token, no dialog
  | "prompt" // ask now
  | "defer" // may ask, but not on this screen — try again on a later one
  | "skip"; // never ask (declined/blocked, or already asked once)

export type PushPermissionInput = {
  granted: boolean;
  canAskAgain: boolean;
  /** The dialog was already shown once on this install (persisted flag). */
  askedBefore: boolean;
  /** Current expo-router pathname. */
  pathname: string;
  /** The app was cold-started by a deep link and the user has not left the landing screen yet. */
  onDeepLinkLanding: boolean;
};

/** Screens where a system dialog would cover something the user is waiting on. */
const NO_PROMPT_PREFIXES = ["/client/payments"];

export function isPromptBlockedRoute(pathname: string): boolean {
  if (pathname === "" || pathname === "/") return true; // splash / role redirect still running
  return NO_PROMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function decidePushPermission(input: PushPermissionInput): PushPermissionDecision {
  if (input.granted) return "register";
  if (!input.canAskAgain || input.askedBefore) return "skip";
  if (input.onDeepLinkLanding || isPromptBlockedRoute(input.pathname)) return "defer";
  return "prompt";
}

export const PUSH_ASKED_KEY = "push.permissionAsked";
