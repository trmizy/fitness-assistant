import { useQuery } from "@tanstack/react-query";

import { profileService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { unitPreferencesFromProfile, type UnitPreferences } from "./unitPreferences";

/**
 * The signed-in account's display units, read from the same ["profile", userId] query the profile screens
 * use (one cache entry, one source of truth: UserProfile). Falls back to metric / kcal while loading.
 */
export function useUnitPreferences(): UnitPreferences {
  const { user } = useApp();
  const { data } = useQuery({
    queryKey: ["profile", user?.id ?? "guest"],
    queryFn: async () => (await profileService.getProfile())?.profile ?? null,
    enabled: !!user?.id,
  });
  return unitPreferencesFromProfile(data as { unitSystem?: unknown; energyUnit?: unknown } | null | undefined);
}
