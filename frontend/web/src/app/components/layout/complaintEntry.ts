/**
 * Where a client/PT account files and follows complaints. These two destinations used to be rows in the sidebar
 * (clientNavFull / ptWorkspaceNav); they now sit behind one "Khiếu nại" button in the Topbar, so the sidebar,
 * the desktop rail and the mobile drawer stay a short list of the main journey.
 *
 * Pure data + helpers (no React) so the rules are unit-testable. The routes themselves are unchanged
 * (routes.tsx: /disputes and /complaint-cases, RequireRole client|pt).
 */

export interface ComplaintDestination {
  /** "Khiếu nại của tôi" = session disputes the account is a party of; "Khiếu nại phòng gym" = gym complaint cases. */
  key: "disputes" | "gym-cases";
  label: string;
  to: string;
}

export const DISPUTES_DESTINATION: ComplaintDestination = { key: "disputes", label: "Khiếu nại của tôi", to: "/disputes" };
export const GYM_CASES_DESTINATION: ComplaintDestination = { key: "gym-cases", label: "Khiếu nại phòng gym", to: "/complaint-cases" };

/** Every complaint destination a client/PT account can reach (used by the Ctrl+K palette, which was never mode-scoped for these). */
export const ALL_COMPLAINT_DESTINATIONS: readonly ComplaintDestination[] = [DISPUTES_DESTINATION, GYM_CASES_DESTINATION];

/**
 * Destinations offered by the header button for the current identity/mode. Same sets the sidebar used to list:
 * - client, or a PT in member mode (activeView "client"): both;
 * - a PT in coach mode (activeView "pt"): only "Khiếu nại của tôi" (the PT workspace nav never listed gym cases);
 * - gym owner / admin: none (they have their own complaint surfaces — never touched here).
 */
export function complaintDestinationsFor(role: string, activeView: "client" | "pt"): ComplaintDestination[] {
  if (role === "client") return [DISPUTES_DESTINATION, GYM_CASES_DESTINATION];
  if (role === "pt") return activeView === "pt" ? [DISPUTES_DESTINATION] : [DISPUTES_DESTINATION, GYM_CASES_DESTINATION];
  return [];
}

/** True when `pathname` is the destination's route or one of its children (/disputes/:caseId), on a segment boundary. */
export function isOnDestination(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** The header button is active while the current page is any of the destinations it offers. */
export function isComplaintPath(pathname: string, destinations: readonly ComplaintDestination[]): boolean {
  return destinations.some((d) => isOnDestination(pathname, d.to));
}
