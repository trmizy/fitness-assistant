/**
 * Tab-screen options for a route that lives under a workspace's Tabs layout but must not get a tab.
 *
 * `href: null` removes the BUTTON only; the bar itself still renders under the screen. Routes that
 * are gates (e.g. `client/onboarding`) must not show tabs into parts of the app the user is not set
 * up for, so those also hide the bar.
 */
export function hiddenRouteOptions(name: string, fullScreenRoutes: readonly string[]) {
  return fullScreenRoutes.includes(name)
    ? { href: null, tabBarStyle: { display: "none" as const } }
    : { href: null };
}
