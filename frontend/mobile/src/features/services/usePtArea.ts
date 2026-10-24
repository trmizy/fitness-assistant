import { useQuery } from "@tanstack/react-query";

import { locationService } from "../../services/api";
import { composeArea, type PtRow } from "./ptDiscovery";

/**
 * The human place line for a trainer card (B18). The profile stores province/ward as numeric codes, so the
 * names come from the same lookup the application wizards use. Both lookups are cached for the session
 * (a location code never changes meaning), and the line simply shows what it can while they load or if
 * a code is unknown — it never falls back to showing the raw number.
 */
export function usePtArea(pt: Pick<PtRow, "area" | "areaCodes">): string | null {
  const province = pt.areaCodes?.province ?? null;
  const ward = pt.areaCodes?.ward ?? null;

  const provinces = useQuery({
    queryKey: ["locations", "provinces"],
    queryFn: () => locationService.getProvinces(),
    staleTime: Infinity,
    enabled: province != null,
  });
  const wards = useQuery({
    queryKey: ["locations", "wards", province],
    queryFn: () => locationService.getWards(province as number),
    staleTime: Infinity,
    enabled: province != null && ward != null,
  });

  const provinceName = province != null ? provinces.data?.find((p) => p.code === province)?.name ?? null : null;
  const wardName = ward != null ? wards.data?.find((w) => w.code === ward)?.name ?? null : null;
  return composeArea(pt, wardName, provinceName);
}
