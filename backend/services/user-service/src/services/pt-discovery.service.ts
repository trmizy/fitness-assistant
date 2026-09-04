import axios from "axios";
import { logger } from "@gym-coach/shared";
import { availabilityService } from "./availability.service";
import { prisma } from "../repositories/profile.repository";

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

/**
 * Gyms the viewer currently holds a live membership at.
 *
 * Fail-soft: discovery must still work when gym-service is unreachable. The cost of guessing
 * wrong here is a missing badge, not a wrong badge — so an empty set on error is safe, unlike
 * the contract-rate lookup where a wrong answer would misallocate money.
 */
async function viewerGymIds(viewerUserId?: string): Promise<Set<string>> {
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

/** The viewer's own province/ward, used for the weaker two ranking tiers. */
async function viewerLocation(viewerUserId?: string) {
  if (!viewerUserId) return null;
  // Read the whole row rather than a select list: the residence columns live on the PT
  // application in some deployments and on the profile in others, and a select that names a
  // column the generated client does not know about is a compile error, not a null.
  const p: any = await prisma.userProfile.findUnique({ where: { userId: viewerUserId } });
  if (!p) return null;
  return {
    residenceProvinceCode: p.residenceProvinceCode ?? null,
    residenceWardCode: p.residenceWardCode ?? null,
  };
}

function reasonFor(
  pt: any,
  gymIds: Set<string>,
  viewer: { residenceProvinceCode: number | null; residenceWardCode: number | null } | null,
): MatchReason {
  const locations: any[] = pt.trainingLocations ?? [];
  if (gymIds.size > 0 && locations.some((l) => l.gymId && gymIds.has(l.gymId))) {
    return "SAME_GYM";
  }
  if (viewer?.residenceWardCode != null && locations.some((l) => l.wardCode === viewer.residenceWardCode)) {
    return "SAME_WARD";
  }
  if (viewer?.residenceProvinceCode != null && locations.some((l) => l.provinceCode === viewer.residenceProvinceCode)) {
    return "SAME_PROVINCE";
  }
  return null;
}

const TIER: Record<string, number> = { SAME_GYM: 0, SAME_WARD: 1, SAME_PROVINCE: 2 };
const tierOf = (r: MatchReason) => (r ? TIER[r] : 3);

/**
 * Attach both fields, and apply the VĐ6 ranking when the caller did not ask for a specific
 * order. A trainer who has switched off new clients always sinks to the bottom regardless of
 * tier — they are still worth reading about, just not worth ranking first.
 */
export async function enrichForDiscovery(
  profiles: any[],
  viewerUserId?: string,
  applyRanking = true,
): Promise<any[]> {
  if (profiles.length === 0) return profiles;

  const ptIds = profiles.map((p) => p.userId);
  const [slots, gymIds, viewer] = await Promise.all([
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
    viewerGymIds(viewerUserId),
    viewerLocation(viewerUserId),
  ]);

  const out = profiles.map((p) => ({
    ...p,
    // Always present, never undefined: the UI branches on the number, and an absent field
    // would silently read as "no warning needed".
    availableSlotsNext28Days: Number((slots as any).get?.(p.userId) ?? (slots as any)[p.userId] ?? 0),
    matchReason: reasonFor(p, gymIds, viewer),
  }));

  if (!applyRanking) return out;

  return out.sort((a, b) => {
    const accepting = (x: any) => (x.isAcceptingClients === false ? 1 : 0);
    if (accepting(a) !== accepting(b)) return accepting(a) - accepting(b);
    const t = tierOf(a.matchReason) - tierOf(b.matchReason);
    if (t !== 0) return t;
    // Within a tier: better rated first, unrated last — "no rating yet", not "worst".
    const ra = a.avgRating ?? -1;
    const rb = b.avgRating ?? -1;
    return rb - ra;
  });
}
