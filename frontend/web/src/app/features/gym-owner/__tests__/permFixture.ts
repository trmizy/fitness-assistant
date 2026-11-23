/**
 * TEST FIXTURE: the permissions[] a server of the Gym Owner handoff sends per role (GET /owner/onboarding/status), copied from
 * `backend/services/gym-service/src/services/partner-permissions.ts` (GRANTS). Used only to build `can` predicates in unit tests;
 * `permissionsParity` in g5Model.test.ts reads the backend file and fails if this table ever drifts from it.
 */
import { makeCan, type CanFn, type PartnerPermission, type PartnerRole } from "../../../utils/gymStaffRole";

const OWNER_ONLY: PartnerPermission[] = ["staff.manage", "brand.write", "branch.write", "branch.status.permanent", "plan.write", "collaboration.manage", "finance.withdraw", "listing.manage"];
const SHARED: PartnerPermission[] = [
  "branch.view", "brand.view", "plan.view", "membership.full", "membership.sales", "checkin.qr", "checkin.list", "ptCheckin.list", "ptCheckin.today",
  "frontDesk.clients", "member.search", "checkin.assisted", "checkin.exception.request", "checkin.exception.approve", "branch.status.temporary",
  "finance.wallet.view", "finance.withdrawals.view", "finance.export", "finance.ptCommission.view",
];

export const GRANTS: Record<PartnerRole, PartnerPermission[]> = {
  OWNER: [...OWNER_ONLY, ...SHARED],
  MANAGER: ["branch.view", "brand.view", "plan.view", "membership.full", "checkin.qr", "checkin.list", "ptCheckin.list", "ptCheckin.today", "frontDesk.clients", "member.search", "checkin.assisted", "checkin.exception.request", "checkin.exception.approve", "branch.status.temporary"],
  RECEPTIONIST: ["branch.view", "checkin.qr", "checkin.list", "ptCheckin.today", "frontDesk.clients", "member.search", "checkin.assisted", "checkin.exception.request"],
  ACCOUNTANT: ["branch.view", "brand.view", "plan.view", "membership.sales", "finance.wallet.view", "finance.withdrawals.view", "finance.export", "finance.ptCommission.view"],
};

export const permsFor = (role: PartnerRole | undefined): PartnerPermission[] => (role ? GRANTS[role] : []);

/** `can` of an account with this role and the permissions the server would send for it. `undefined` = still loading / unknown (nothing granted). */
export const canOf = (role: PartnerRole | undefined): CanFn => makeCan(role, role ? GRANTS[role] : undefined);
