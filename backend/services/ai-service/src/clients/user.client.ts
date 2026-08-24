/**
 * Minimal user-profile fetch for marketplace personalization
 * (marketplace.service.ts's "recommended" sort) — same
 * x-service-secret + GET /internal/profile/:userId pattern already used by
 * worker-user-context.ts, factored out here since that file fetches a much
 * heavier bundle (InBody, workouts, nutrition) this call site doesn't need.
 */
import axios from "axios";
import { logger } from "@gym-coach/shared";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  (process.env.NODE_ENV === "production" ? "http://user-service:3004" : "http://localhost:3004");

function userServiceHeaders() {
  return { "x-service-secret": process.env.INTERNAL_SERVICE_SECRET || "" };
}

export interface UserGoalLevelSnapshot {
  goal?: string | null;
  experienceLevel?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null;
}

export interface PtMarketplaceEligibility {
  userId: string;
  isApprovedPt: boolean;
  isPT: boolean;
  ptApplicationStatus: string | null;
  approvedAt?: string | null;
  displayName?: string | null;
  mainSpecialties?: string[];
  yearsOfExperience?: string | null;
  professionalBio?: string | null;
}

export async function fetchUserGoalAndLevel(userId: string): Promise<UserGoalLevelSnapshot | null> {
  try {
    const res = await axios.get(`${USER_SERVICE_URL}/internal/profile/${encodeURIComponent(userId)}`, {
      headers: userServiceHeaders(),
      timeout: 5000,
    });
    const profile = res.data?.profile ?? res.data ?? null;
    if (!profile) return null;
    return { goal: profile.goal ?? null, experienceLevel: profile.experienceLevel ?? null };
  } catch (error) {
    logger.debug({ err: (error as Error).message, userId }, "[marketplace] user profile fetch failed");
    return null;
  }
}

export async function fetchPtMarketplaceEligibility(userId: string): Promise<PtMarketplaceEligibility | null> {
  try {
    const res = await axios.get(
      `${USER_SERVICE_URL}/internal/pt-marketplace-eligibility/${encodeURIComponent(userId)}`,
      {
        headers: userServiceHeaders(),
        timeout: 5000,
      },
    );
    return {
      userId,
      isApprovedPt: res.data?.isApprovedPt === true,
      isPT: res.data?.isPT === true,
      ptApplicationStatus: res.data?.ptApplicationStatus ?? null,
      approvedAt: res.data?.approvedAt ?? null,
      displayName: res.data?.displayName ?? null,
      mainSpecialties: Array.isArray(res.data?.mainSpecialties) ? res.data.mainSpecialties : [],
      yearsOfExperience: res.data?.yearsOfExperience ?? null,
      professionalBio: res.data?.professionalBio ?? null,
    };
  } catch (error) {
    logger.warn({ err: (error as Error).message, userId }, "[marketplace] PT eligibility fetch failed");
    return null;
  }
}

/**
 * Creates the ACTIVE Contract (ContractSource.MARKETPLACE) that a
 * Personalized PT Service order's Intake submission requires — the single
 * event that turns on the entire existing PT-client authorization surface
 * (coach.service.ts's getClientSummary/generatePlanDraft/createAndAssignPlan,
 * computeChatEligibility) for this buyer/seller pair. See
 * contractService.createMarketplaceContract's doc comment (user-service).
 */
export async function createMarketplaceContract(params: {
  ptUserId: string;
  clientUserId: string;
  packageName: string;
  description?: string;
  price: number;
  paymentTransactionId?: string;
}): Promise<string> {
  const res = await axios.post(
    `${USER_SERVICE_URL}/internal/contracts/marketplace`,
    params,
    { headers: userServiceHeaders(), timeout: 10000 },
  );
  return res.data.contractId as string;
}
