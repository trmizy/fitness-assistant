import { SessionMode } from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";
import { profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { trainingLocationRepository } from "../repositories/training_location.repository";
import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import { assertPtAcceptsNewBusiness, PtRestrictionError } from "./pt-restriction.service";
import {
  evaluateMembershipForContract,
  toGymContractEligibility,
  type GymContractEligibility,
} from "./contract-gym-membership.service";

/**
 * Phase 3 / P3.4 - `GET /contracts/gym-options?ptUserId=&packageId=` : which branches the caller
 * (the client, taken from the verified identity) could pick when asking this trainer for this
 * package, plus FACTS about each. READ-ONLY:
 *
 *   - Membership (D67, P3.3): each branch carries `eligibility` = the verdict of the SAME function
 *     `requestContract` uses (contract-gym-membership.service.ts) - the UI never computes it. A branch
 *     the client cannot request through is still listed, with the reason, so the UI can invite them to
 *     buy / extend a plan. It still enforces nothing else that is open (docs/PHASE_3_PLAN.md section 8):
 *     not "an OFFLINE package must have a gym" (8.4). An empty list does not say the client may not
 *     book without a gym.
 *   - It re-implements none of the branch rules. The candidate list is gym-service's own
 *     `listAcceptedGymsForPt`, and every candidate is then confirmed through
 *     `getActiveCollaboration` - the very call `requestContract` / `acceptContract` /
 *     `pay` use - so a branch is only ever offered here if `requestContract` would resolve a rate
 *     table for it (closed branch, locked partner, terminating or missing agreement: excluded).
 *   - The trainer-side rules come from the existing guards: `assertPtAcceptsNewBusiness` (account
 *     restriction / suspension / ban), `isAcceptingClients`, and `findActiveByPair`, exactly the
 *     three refusals `requestContract` makes before it reaches the gym. A restriction on someone
 *     else's contract is a CONTRACT-scope row and never matches here (decision D38).
 *
 * Revenue-split rates are deliberately NOT returned (plan P3.4: "khong lo ty le chia doanh thu cho
 * Client"). The referral code of the trainer is returned as a plain fact so the UI can carry it
 * into a membership purchase; it is never stored on the contract.
 */

export const GYM_OPTIONS_PT_NOT_ACCEPTING_CLIENTS = "PT_NOT_ACCEPTING_CLIENTS";
export const GYM_OPTIONS_ACTIVE_CONTRACT_EXISTS = "ACTIVE_CONTRACT_EXISTS";

/** Why `gyms` is empty without the trainer simply having no usable branch. */
export type GymOptionsGymsReason =
  | "ONLINE_PACKAGE" //   online sessions are never tied to a branch (requestContract refuses a gymId)
  | "REQUEST_BLOCKED" //  `requestBlockedReason` says why a request would be refused before any branch matters
  | "NO_GYM_AGREEMENT" // the trainer has no branch a new contract can go through right now
  | null;

export interface GymOption {
  gymId: string;
  name: string;
  city: string | null;
  brandId: string | null;
  /** The trainer lists this branch among their own training locations (plan ordering rule). */
  isPtTrainingLocation: boolean;
  membership: {
    /** Active membership at the brand of this branch (valid at every branch of the brand). */
    hasActiveMembership: boolean;
    membershipId: string | null;
    planName: string | null;
    endDate: string | null;
    /** The membership was bought at THIS branch (plan ordering rule), not just at another branch of the brand. */
    purchasedHere: boolean;
  };
  /** Backend verdict: may this client send a request for this package through this branch (P3.3). */
  eligibility: GymContractEligibility;
}

export interface GymOptionsResult {
  ptUserId: string;
  packageId: string;
  sessionMode: SessionMode | null;
  pt: {
    /** The trainer's own referral code (UserProfile.referralCode), for the membership purchase step. Null if none. */
    referralCode: string | null;
  };
  /** Null when `requestContract` would get past its trainer-side checks; else the code of the first refusal. */
  requestBlockedReason: string | null;
  gymsReason: GymOptionsGymsReason;
  gyms: GymOption[];
}

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const unavailable = () =>
  err("Không thể xác nhận thoả thuận hợp tác với phòng gym lúc này, vui lòng thử lại", 503);

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const contractGymOptionsService = {
  async getGymOptions(clientUserId: string, query: { ptUserId?: unknown; packageId?: unknown }): Promise<GymOptionsResult> {
    const { ptUserId, packageId } = query;
    if (typeof ptUserId !== "string" || !ptUserId || typeof packageId !== "string" || !packageId) {
      throw err("Thiếu ptUserId hoặc packageId", 400);
    }

    // Same package gate as requestContract (same repository, same answers).
    const pkg = await ptServicePackageRepository.findById(packageId);
    if (!pkg) throw err("Gói dịch vụ không tồn tại", 404);
    if (!pkg.isActive || pkg.archivedAt) throw err("Gói dịch vụ này đã ngừng bán", 422);
    if (pkg.ptUserId !== ptUserId) throw err("Gói dịch vụ không thuộc PT này", 400);

    const ptProfile = await profileRepository.findByUserId(ptUserId);
    if (!ptProfile || !ptProfile.isPT) throw err("PT không tồn tại hoặc chưa được duyệt", 404);

    const base = {
      ptUserId,
      packageId,
      sessionMode: pkg.sessionMode ?? null,
      pt: { referralCode: (ptProfile as any).referralCode ?? null },
    };

    // Trainer-side refusals, in requestContract's order, each from the existing check.
    let requestBlockedReason: string | null = null;
    try {
      await assertPtAcceptsNewBusiness(ptUserId, "REQUEST_CONTRACT");
    } catch (e) {
      if (!(e instanceof PtRestrictionError)) throw e;
      requestBlockedReason = e.code;
    }
    if (!requestBlockedReason && !(ptProfile as any).isAcceptingClients) {
      requestBlockedReason = GYM_OPTIONS_PT_NOT_ACCEPTING_CLIENTS;
    }
    if (!requestBlockedReason && (await contractRepository.findActiveByPair(ptUserId, clientUserId))) {
      requestBlockedReason = GYM_OPTIONS_ACTIVE_CONTRACT_EXISTS;
    }
    if (requestBlockedReason) {
      return { ...base, requestBlockedReason, gymsReason: "REQUEST_BLOCKED", gyms: [] };
    }
    if (pkg.sessionMode === SessionMode.ONLINE) {
      return { ...base, requestBlockedReason: null, gymsReason: "ONLINE_PACKAGE", gyms: [] };
    }

    try {
      const now = new Date();
      const candidates = await gymClient.listAcceptedGymsForPt(ptUserId);
      const trainingGymIds = new Set(
        (await trainingLocationRepository.findByPtUserId(ptUserId))
          .filter((l: any) => l.isActive && l.gymId)
          .map((l: any) => l.gymId as string),
      );

      const resolved = await mapLimited(candidates, 4, async (c): Promise<GymOption | null> => {
        const gymId = c.gym.id;
        // The accept-time / pay-time check, per branch: no rate table now -> request would refuse -> not offered.
        const collab = await gymClient.getActiveCollaboration(gymId, ptUserId);
        if (!collab) return null;
        const lookup = await gymClient.getClientMembershipAtGym(clientUserId, gymId);
        if (!lookup) return null; // gym-service no longer knows the branch
        const m = lookup.hasActiveMembership ? lookup.membership : null;
        const eligibility = toGymContractEligibility(
          evaluateMembershipForContract({
            lookup,
            gymId,
            brandId: collab.brandId,
            validityDays: pkg.validityDays,
            now,
          }),
        );
        return {
          gymId,
          name: c.gym.name,
          city: c.gym.city ?? null,
          brandId: collab.brandId ?? lookup.brandId ?? null,
          isPtTrainingLocation: trainingGymIds.has(gymId),
          membership: {
            hasActiveMembership: !!m,
            membershipId: m?.membershipId ?? null,
            planName: m?.planName ?? null,
            endDate: m?.endDate ?? null,
            purchasedHere: !!m && m.purchaseGymId === gymId,
          },
          eligibility,
        };
      });

      const gyms = resolved.filter((g): g is GymOption => g !== null);
      // Plan P3.4 ordering: the trainer's own training locations first, then the branch the client
      // bought the membership at, then name (id as the final tiebreaker). No other preference.
      gyms.sort(
        (a, b) =>
          Number(b.isPtTrainingLocation) - Number(a.isPtTrainingLocation) ||
          Number(b.membership.purchasedHere) - Number(a.membership.purchasedHere) ||
          a.name.localeCompare(b.name) ||
          (a.gymId < b.gymId ? -1 : a.gymId > b.gymId ? 1 : 0),
      );
      return {
        ...base,
        requestBlockedReason: null,
        gymsReason: gyms.length === 0 ? "NO_GYM_AGREEMENT" : null,
        gyms,
      };
    } catch (e) {
      if (e instanceof GymServiceUnavailableError) throw unavailable();
      throw e;
    }
  },
};
