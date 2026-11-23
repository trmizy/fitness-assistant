/**
 * Đối tác PT (batch G4), `/gym-owner/collaborations`, behind VITE_GYM_OWNER_V2 (routes.tsx). One entry, three screens by role:
 *  - OWNER        : agreements of the brand (`AgreementsView`), scope = brand ("Áp dụng toàn thương hiệu").
 *  - MANAGER      : "PT check-in tại chi nhánh" (`CheckinsView`), scope = branch. Never calls `/owner/collaborations`.
 *  - ACCOUNTANT   : "Hoa hồng PT" (`CommissionView`), scope = brand or one branch.
 *  - RECEPTIONIST : no such entry (the route guard bounces to the desk; this page also answers "forbidden" if reached).
 * Hiding a screen never replaces the server check: every request still handles 403.
 */
import { ScopeStateFrame } from "../scope/PermissionGate";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { AgreementsView } from "./AgreementsView";
import { CheckinsView } from "./CheckinsView";
import { CommissionView } from "./CommissionView";
import { partnersViewFor } from "./partnersModel";

export function PartnersPage() {
  const scope = useGymOwnerScope();
  const view = partnersViewFor(scope.can);
  if (view === "agreements") return <AgreementsView />;
  if (view === "checkins") return <CheckinsView />;
  if (view === "commission") return <CommissionView />;
  return <ScopeStateFrame kind="forbidden" />;
}
