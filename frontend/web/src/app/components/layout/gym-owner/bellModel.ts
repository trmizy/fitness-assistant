/**
 * Where a bell notification opens in the Gym Owner workspace (G5). Pure, no React.
 * The two notices added with the Gym Owner handoff point at generic pages (the branch page for a withdrawal decision, the front desk
 * for a check-in exception); in this workspace they open the screen that actually shows the thing:
 *  - WITHDRAWAL_APPROVED | WITHDRAWAL_PAID | WITHDRAWAL_REJECTED of a BRANCH wallet (`link` = /gym-owner/gyms/<gymId>, entityId = the
 *    withdrawal request id) -> Tài chính, tab Lệnh rút of that branch, with the request's drawer open;
 *  - GYM_CHECKIN_EXCEPTION_REQUESTED (`link` = /gym-owner/front-desk?gymId=<gymId>) -> the Ngoại lệ tab of that branch;
 *  - a gym complaint case -> its case page. Anything else keeps the link the server sent.
 */
export interface BellNotice {
  eventType?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  link?: string | null;
}

const BRANCH_LINK = /^\/gym-owner\/gyms\/([^/?#]+)\/?$/;
const WITHDRAWAL_EVENTS = new Set(["WITHDRAWAL_APPROVED", "WITHDRAWAL_PAID", "WITHDRAWAL_REJECTED"]);

export function bellTarget(n: BellNotice): string | null {
  if (n.entityType === "GYM_COMPLAINT_CASE" && n.entityId) return `/gym-owner/complaint-cases/${encodeURIComponent(n.entityId)}`;
  const link = n.link || null;
  if (n.eventType && WITHDRAWAL_EVENTS.has(n.eventType) && link) {
    const m = BRANCH_LINK.exec(link);
    if (m) {
      const sp = new URLSearchParams({ gymId: decodeURIComponent(m[1]), tab: "withdrawals" });
      if (n.entityId) sp.set("withdrawal", n.entityId);
      return `/gym-owner/finance?${sp.toString()}`;
    }
  }
  if (n.eventType === "GYM_CHECKIN_EXCEPTION_REQUESTED" && link) {
    const [path, query = ""] = link.split("?");
    if (path === "/gym-owner/front-desk") {
      const sp = new URLSearchParams(query);
      if (!sp.has("tab")) sp.set("tab", "exceptions");
      return `${path}?${sp.toString()}`;
    }
  }
  return link;
}
