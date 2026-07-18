/**
 * Fetches profile/InBody data from user-service for training-cycle snapshots.
 * Called server-to-server (no end-user token available inside the request handler
 * chain for this internal lookup), so it uses the shared internal service secret —
 * same pattern as ai-service's worker-user-context.ts.
 */
import axios from "axios";
import { logger } from "@gym-coach/shared";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ||
  (process.env.NODE_ENV === "production"
    ? "http://user-service:3004"
    : "http://localhost:3004");

function userServiceHeaders() {
  return {
    "x-service-secret": process.env.INTERNAL_SERVICE_SECRET || "",
  };
}

export interface UserProfileSnapshot {
  goal?: string | null;
  targetWeight?: number | null;
  currentWeight?: number | null;
}

export interface InBodyEntrySnapshot {
  id: string;
  date: string;
  weight: number;
  bodyFatPct?: number | null;
  muscleMass: number;
}

export async function fetchUserProfile(
  userId: string,
): Promise<UserProfileSnapshot | null> {
  try {
    const res = await axios.get(
      `${USER_SERVICE_URL}/internal/profile/${encodeURIComponent(userId)}`,
      { headers: userServiceHeaders(), timeout: 5000 },
    );
    const profile = res.data?.profile ?? res.data ?? null;
    if (!profile) return null;
    return {
      goal: profile.goal ?? null,
      targetWeight: profile.targetWeight ?? null,
      currentWeight: profile.currentWeight ?? null,
    };
  } catch (error) {
    logger.warn(
      { err: (error as Error).message, userId },
      "[training-cycle] user profile fetch failed",
    );
    return null;
  }
}

async function fetchInBodyHistory(
  userId: string,
): Promise<InBodyEntrySnapshot[]> {
  try {
    const res = await axios.get(
      `${USER_SERVICE_URL}/internal/inbody/${encodeURIComponent(userId)}`,
      { headers: userServiceHeaders(), timeout: 5000 },
    );
    const raw: any[] = Array.isArray(res.data) ? res.data : [];
    return raw.map((e) => ({
      id: e.id,
      date: e.date ?? e.dateOnly,
      weight: e.weight,
      bodyFatPct: e.bodyFatPct ?? null,
      muscleMass: e.muscleMass,
    }));
  } catch (error) {
    logger.warn(
      { err: (error as Error).message, userId },
      "[training-cycle] inbody history fetch failed",
    );
    return [];
  }
}

/** Latest InBody entry with date <= cutoff (history endpoint has no date filter, so filter client-side). */
export async function fetchLatestInBodyOnOrBefore(
  userId: string,
  cutoff: Date,
): Promise<InBodyEntrySnapshot | null> {
  const history = await fetchInBodyHistory(userId);
  const eligible = history
    .filter((e) => new Date(e.date).getTime() <= cutoff.getTime())
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return eligible[0] ?? null;
}
