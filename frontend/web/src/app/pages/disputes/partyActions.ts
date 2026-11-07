import type { ActionVerdict, PartyActionName, PartyCaseDetail } from "../admin/disputes/disputeCaseTypes";
import { VIETNAMESE_LINE } from "../admin/disputes/actions/actionModel";

/** The names the server lists as allowed for a party viewer, or null when the answer has no list. */
export function partyAllowedSet(detail: Pick<PartyCaseDetail, "allowedActions">): Set<string> | null {
  return Array.isArray(detail.allowedActions)
    ? new Set(detail.allowedActions.filter((x): x is string => typeof x === "string"))
    : null;
}

export const hasPartyServerActions = (detail: Pick<PartyCaseDetail, "allowedActions">) =>
  partyAllowedSet(detail) !== null;

/** Returns true iff the action name is in the server's `allowedActions` array. */
export function partyAllowed(detail: Pick<PartyCaseDetail, "allowedActions">, name: PartyActionName): boolean {
  return partyAllowedSet(detail)?.has(name) ?? false;
}

/** `actions[name]` (allowed, stable code, Vietnamese message, options) or undefined. */
export function partyVerdictOf(
  detail: Pick<PartyCaseDetail, "actions">,
  name: PartyActionName,
): ActionVerdict | undefined {
  const v = detail.actions?.[name];
  return v && typeof v === "object" ? v : undefined;
}

/** Returns true only when `partyAllowed(detail, name)` AND `verdict.options` is an array that includes `id`. */
export function partyAllowedFor(
  detail: Pick<PartyCaseDetail, "allowedActions" | "actions">,
  name: PartyActionName,
  id: string,
): boolean {
  if (!partyAllowed(detail, name)) return false;
  const opts = partyVerdictOf(detail, name)?.options;
  return Array.isArray(opts) ? opts.includes(id) : false;
}

/** The Vietnamese message the server gave for a refused party action, only when it really is Vietnamese. */
export function partyRefusal(detail: Pick<PartyCaseDetail, "actions">, name: PartyActionName): string | null {
  const m = partyVerdictOf(detail, name)?.message;
  return typeof m === "string" && VIETNAMESE_LINE.test(m) ? m : null;
}

