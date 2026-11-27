import { useQuery } from "@tanstack/react-query";
import { gymService } from "../../../services/api";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { ALL_BRANCHES, goKey } from "../scope/scopeModel";
import { normalizePlans, type PlanRow } from "./membersModel";

/** Plans of the brand, shared by the two tabs (plan names and the plan filter on Hội viên, the table on Gói). */
export function useBrandPlans(enabled: boolean) {
  const scope = useGymOwnerScope();
  const key = goKey({ userId: scope.userId, role: scope.role, brandId: scope.brandId, gymId: ALL_BRANCHES }, "plans");
  const query = useQuery<PlanRow[]>({
    queryKey: key,
    queryFn: async () => normalizePlans(await gymService.listOwnedPlans(scope.brandId!)),
    enabled: enabled && !!scope.brandId,
  });
  return { query, key };
}
