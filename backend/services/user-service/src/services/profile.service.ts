import axios from "axios";
import { profileRepository } from "../repositories/profile.repository";
import { availabilityService } from "./availability.service";
import type { ProfileDto } from "../models/profile.models";

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:3001";
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:3006";
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET ||
  "dev_internal_service_secret_change_in_production";

/** Batch-fetch names from auth-service for profiles with missing firstName/lastName. Fail-safe. */
export async function enrichProfilesWithAuthNames(
  profiles: Array<{
    userId: string;
    firstName: string | null;
    lastName: string | null;
    [key: string]: any;
  }>,
): Promise<void> {
  const missing = profiles.filter((p) => !p.firstName && !p.lastName);
  if (missing.length === 0) return;
  try {
    const { data } = await axios.post(
      `${AUTH_SERVICE_URL}/auth/internal/users/batch`,
      { userIds: missing.map((p) => p.userId) },
      {
        headers: { "x-service-secret": INTERNAL_SERVICE_SECRET },
        timeout: 3000,
      },
    );
    const nameMap = new Map<
      string,
      { firstName: string | null; lastName: string | null }
    >(
      (data?.users ?? []).map((u: any) => [
        u.id,
        { firstName: u.firstName ?? null, lastName: u.lastName ?? null },
      ]),
    );
    for (const p of profiles) {
      if (!p.firstName && !p.lastName) {
        const n = nameMap.get(p.userId);
        if (n) {
          p.firstName = n.firstName;
          p.lastName = n.lastName;
        }
      }
    }
  } catch {
    /* fail-safe: profiles returned without names */
  }
}

async function syncRoleToPT(userId: string): Promise<void> {
  await axios.patch(
    `${AUTH_SERVICE_URL}/auth/internal/users/${userId}/role`,
    { role: "PT" },
    {
      headers: { "x-service-secret": INTERNAL_SERVICE_SECRET },
      timeout: 5000,
    },
  );
}

async function syncRole(
  userId: string,
  role: "PT" | "CUSTOMER",
): Promise<void> {
  await axios.patch(
    `${AUTH_SERVICE_URL}/auth/internal/users/${userId}/role`,
    { role },
    {
      headers: { "x-service-secret": INTERNAL_SERVICE_SECRET },
      timeout: 5000,
    },
  );
}

/**
 * TODO (Phase 2): Replace with real checks — e.g. certificate uploaded,
 * admin approval, ptApplicationStatus === 'APPROVED', etc.
 */
async function canBecomePT(_userId: string): Promise<boolean> {
  return true;
}

export const profileService = {
  async getProfile(userId: string) {
    const profile = await profileRepository.findByUserId(userId);
    return { profile: profile ?? null };
  },

  async upsertProfile(userId: string, data: ProfileDto) {
    const profile = await profileRepository.upsert(userId, data);
    return { profile };
  },

  async becomePT(userId: string, currentRole: string) {
    if (currentRole === "PT") {
      throw new Error("User is already a PT");
    }
    if (currentRole !== "CUSTOMER" && currentRole !== "ADMIN") {
      throw new Error("Current role is not allowed to become PT");
    }

    const allowed = await canBecomePT(userId);
    if (!allowed) {
      throw new Error("PT application not allowed at this time");
    }

    await syncRoleToPT(userId);
    const profile = await profileRepository.setIsPT(userId, true);
    return { profile };
  },

  async deleteProfile(userId: string) {
    await profileRepository.deleteByUserId(userId);
    // BR-34B: cascade delete AI conversations (fire-and-forget — profile deletion is not blocked)
    axios
      .delete(`${AI_SERVICE_URL}/internal/users/${userId}`, {
        headers: { "x-service-secret": INTERNAL_SERVICE_SECRET },
        timeout: 5000,
      })
      .catch(() => {});
    return { message: "Profile deleted successfully" };
  },

  async adminSetPTStatus(userId: string, isPT: boolean) {
    const targetRole: "PT" | "CUSTOMER" = isPT ? "PT" : "CUSTOMER";
    await syncRole(userId, targetRole);
    const profile = await profileRepository.setIsPTByUserId(userId, isPT);

    // If becoming PT, seed initial availability from application
    if (isPT) {
      await availabilityService.seedInitialAvailability(userId);
    }

    return { profile };
  },
};
