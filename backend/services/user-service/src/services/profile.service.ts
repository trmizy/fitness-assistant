import axios from "axios";
import { profileRepository } from "../repositories/profile.repository";
import { ptApplicationRepository } from "../repositories/pt_application.repository";
import type { ProfileDto } from "../models/profile.models";
import { authServiceClient } from "../clients/auth-service.client";
import { toSignedProfilePhotoUrl } from "./s3-upload.service";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:3006";
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET ||
  "dev_internal_service_secret_change_in_production";

/**
 * Batch-fetch identity from auth-service for profiles missing it. Fail-safe.
 *
 * A UserProfile row here is created by whatever service touched the user first, so
 * firstName/lastName/email are frequently null even though auth-service has them. Anything
 * that shows a person to another person (contract parties, client lists) has to fill them in
 * or it ends up printing a UUID.
 */
export async function enrichProfilesWithAuthNames(
  profiles: Array<{
    userId: string;
    firstName: string | null;
    lastName: string | null;
    email?: string | null;
    [key: string]: any;
  }>,
): Promise<void> {
  const missing = profiles.filter((p) => !p.firstName && !p.lastName);
  const missingEmail = profiles.filter((p) => !p.email);
  const userIds = [
    ...new Set([...missing, ...missingEmail].map((p) => p.userId)),
  ];
  if (userIds.length === 0) return;
  try {
    const { data } = await authServiceClient.internalPost(
      "/auth/internal/users/batch",
      { userIds },
      { timeoutMs: 3000 },
    );
    const nameMap = new Map<
      string,
      {
        firstName: string | null;
        lastName: string | null;
        email: string | null;
      }
    >(
      (data?.users ?? []).map((u: any) => [
        u.id,
        {
          firstName: u.firstName ?? null,
          lastName: u.lastName ?? null,
          email: u.email ?? null,
        },
      ]),
    );
    for (const p of profiles) {
      const n = nameMap.get(p.userId);
      if (!n) continue;
      if (!p.firstName && !p.lastName) {
        p.firstName = n.firstName;
        p.lastName = n.lastName;
      }
      if (!p.email) p.email = n.email;
    }
  } catch {
    /* fail-safe: profiles returned without names */
  }
}

async function syncRoleToPT(userId: string): Promise<void> {
  await authServiceClient.internalPatch(
    `/auth/internal/users/${userId}/role`,
    { role: "PT" },
    { timeoutMs: 5000 },
  );
}

async function syncRole(
  userId: string,
  role: "PT" | "CUSTOMER",
): Promise<void> {
  await authServiceClient.internalPatch(
    `/auth/internal/users/${userId}/role`,
    { role },
    { timeoutMs: 5000 },
  );
}

/**
 * Money-flow plan 5.5 — resolved TODO. PATCH /me/become-pt is a live, authenticated route any
 * CUSTOMER can call directly, bypassing the UI — an unconditional `true` here meant anyone
 * could self-elevate to PT with zero verification, sidestepping the entire PT-application
 * review flow (submit -> admin review -> approve) that pt_application.service.ts otherwise
 * enforces before ever calling profileRepository.setIsPT. The real gate is the same one that
 * flow uses: an application on file with status APPROVED.
 */
async function canBecomePT(userId: string): Promise<boolean> {
  const application = await ptApplicationRepository.findByUserId(userId);
  return application?.status === "APPROVED";
}

export async function withSignedProfilePhoto<T extends { photoUrl?: string | null } | null>(
  profile: T,
): Promise<T> {
  if (!profile?.photoUrl) return profile;
  return {
    ...(profile as any),
    photoUrl: await toSignedProfilePhotoUrl(profile.photoUrl),
  };
}

function computeAgeFromDob(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export const profileService = {
  async getProfile(userId: string) {
    const profile = await profileRepository.findByUserId(userId);
    return { profile: await withSignedProfilePhoto(profile ?? null) };
  },

  async upsertProfile(userId: string, data: ProfileDto) {
    const payload: Record<string, any> = { ...data };
    // If dateOfBirth is provided, derive age so downstream services stay consistent
    if (data.dateOfBirth) {
      payload.dateOfBirth = new Date(data.dateOfBirth);
      payload.age = computeAgeFromDob(data.dateOfBirth);
    }
    
    // Normalize names for search
    if ((data as any).firstName !== undefined) {
      payload.firstNameNormalized = (data as any).firstName 
        ? (data as any).firstName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() 
        : null;
    }
    if ((data as any).lastName !== undefined) {
      payload.lastNameNormalized = (data as any).lastName 
        ? (data as any).lastName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() 
        : null;
    }

    const profile = await profileRepository.upsert(userId, payload);
    return { profile: await withSignedProfilePhoto(profile) };
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

    return { profile };
  },

  async toggleAcceptingClients(userId: string, isAccepting: boolean, reason?: string) {
    const profile = await profileRepository.updateAcceptingClients(userId, isAccepting, reason);
    return { profile };
  },
};
