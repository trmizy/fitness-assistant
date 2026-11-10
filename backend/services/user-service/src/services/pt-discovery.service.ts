import axios from "axios";
import { logger } from "@gym-coach/shared";
import { availabilityService } from "./availability.service";

/**
 * The two fields the PT-discovery UI needs beyond the profile itself:
 *
 *   availableSlotsNext28Days — Phase 1 layer 2, so the buy dialog can warn when a package
 *                              has more sessions than the trainer has open slots.
 *   matchReason              — Phase 2 VĐ6, so the list can badge "Cùng phòng tập của bạn".
 *
 * Both are computed for the WHOLE page in one pass. Doing either per trainer would put the
 * query count on a line with the page size, which the task calls out explicitly — twenty
 * trainers must not mean twenty-one round trips.
 */

const GYM_SERVICE_URL = process.env.GYM_SERVICE_URL || "http://gym-service:3006";
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET ||
  "dev_internal_service_secret_change_in_production";

export type MatchReason = "SAME_GYM" | "SAME_WARD" | "SAME_PROVINCE" | null;

export interface ViewerArea {
  areaProvince?: number;
  areaWard?: number;
}

/**
 * Gyms the viewer currently holds a live membership at.
 *
 * Fail-soft: discovery must still work when gym-service is unreachable. The cost of guessing
 * wrong here is a missing badge, not a wrong badge — so an empty set on error is safe, unlike
 * the contract-rate lookup where a wrong answer would misallocate money.
 */
export async function viewerGymIds(viewerUserId?: string): Promise<Set<string>> {
  if (!viewerUserId) return new Set();
  try {
    const { data } = await axios.get(
      `${GYM_SERVICE_URL}/internal/clients/${viewerUserId}/active-gyms`,
      { headers: { "x-service-secret": INTERNAL_SERVICE_SECRET }, timeout: 3000 },
    );
    const ids: string[] = data?.data?.gymIds ?? data?.gymIds ?? [];
    return new Set(ids);
  } catch (e) {
    logger.warn(
      { message: (e as Error).message },
      "[PTDiscovery] không lấy được phòng gym của khách — bỏ qua nhãn cùng phòng tập",
    );
    return new Set();
  }
}

/** The viewer's selected province/ward from query parameters, used for matchReason badges. */
function viewerLocation(area?: ViewerArea): { areaProvince: number | null; areaWard: number | null } | null {
  if (area?.areaProvince === undefined && area?.areaWard === undefined) return null;
  return {
    areaProvince: area.areaProvince ?? null,
    areaWard: area.areaWard ?? null,
  };
}

function reasonFor(
  pt: any,
  gymIds: Set<string>,
  viewer: { areaProvince: number | null; areaWard: number | null } | null,
): MatchReason {
  const locations: any[] = pt.trainingLocations ?? [];
  if (gymIds.size > 0 && locations.some((l) => l.gymId && gymIds.has(l.gymId))) {
    return "SAME_GYM";
  }
  if (
    viewer?.areaWard != null &&
    locations.some(
      (l) =>
        l.wardCode === viewer.areaWard &&
        (viewer.areaProvince == null || l.provinceCode === viewer.areaProvince),
    )
  ) {
    return "SAME_WARD";
  }
  if (viewer?.areaProvince != null && locations.some((l) => l.provinceCode === viewer.areaProvince)) {
    return "SAME_PROVINCE";
  }
  return null;
}

/**
 * Attach availableSlotsNext28Days and matchReason for the current page without altering
 * the global SQL ordering. Accepts pre-fetched viewerGymIds so gym-service is queried at most once.
 */
export async function enrichForDiscovery(
  profiles: any[],
  viewerUserId?: string,
  viewerArea?: ViewerArea,
  prefetchedGymIds?: Set<string>,
): Promise<any[]> {
  if (profiles.length === 0) return profiles;

  const ptIds = profiles.map((p) => p.userId);
  const viewer = viewerLocation(viewerArea);
  const [slots, gymIds] = await Promise.all([
    availabilityService
      .countAvailableSlotsForPTs(
        ptIds,
        new Date(),
        new Date(Date.now() + availabilityService.SLOT_LOOKAHEAD_DAYS * 86_400_000),
        60,
      )
      .catch((e) => {
        logger.warn({ message: (e as Error).message }, "[PTDiscovery] đếm slot thất bại");
        return new Map<string, number>();
      }),
    prefetchedGymIds !== undefined ? Promise.resolve(prefetchedGymIds) : viewerGymIds(viewerUserId),
  ]);

  return profiles.map((p) => ({
    ...p,
    // Always present, never undefined: the UI branches on the number, and an absent field
    // would silently read as "no warning needed".
    availableSlotsNext28Days: Number((slots as any).get?.(p.userId) ?? (slots as any)[p.userId] ?? 0),
    matchReason: reasonFor(p, gymIds, viewer),
  }));
}
