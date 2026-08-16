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
  /** "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null (never declared). Callers
   * must treat a null/missing value as an explicit UNKNOWN state — never
   * silently default it to BEGINNER or INTERMEDIATE (see cycle-analysis
   * request building in training-cycle.service.ts, which maps this to the
   * literal "UNKNOWN" the AI-service prompt gates advanced-technique
   * suggestions on). */
  experienceLevel?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null;
  /** Distinguishes a competing/professional athlete from a recreational
   * ADVANCED lifter — only meaningful combined with experienceLevel ===
   * "ADVANCED" (see docs/USER_LEVEL_PERSONALIZATION_PLAN.md §0). Defaults to
   * false server-side, so this is never null/undefined in practice, but
   * still coalesced defensively here since it crosses a service boundary. */
  competesInSport?: boolean;
}

export interface InBodyEntrySnapshot {
  id: string;
  date: string;
  weight: number;
  bodyFatPct?: number | null;
  muscleMass: number;
  visceralFat?: number | null;
  bmr?: number | null;
  /** "manual" | "extracted" | "pending" — used as a rough measurement-method
   * consistency proxy by InBodyDataQualityEvaluator; user-service's
   * InBodyEntry has no dedicated device/model field to compare against. */
  status?: string | null;
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
      experienceLevel: profile.experienceLevel ?? null,
      competesInSport: profile.competesInSport === true,
    };
  } catch (error) {
    logger.warn(
      { err: (error as Error).message, userId },
      "[training-cycle] user profile fetch failed",
    );
    return null;
  }
}

export async function fetchInBodyHistory(
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
      visceralFat: e.visceralFat ?? null,
      bmr: e.bmr ?? null,
      status: e.status ?? null,
    }));
  } catch (error) {
    logger.warn(
      { err: (error as Error).message, userId },
      "[training-cycle] inbody history fetch failed",
    );
    return [];
  }
}

/** InBody entries with date inside [start, end], oldest first. */
export async function fetchInBodySeries(
  userId: string,
  start: Date,
  end: Date,
): Promise<InBodyEntrySnapshot[]> {
  const history = await fetchInBodyHistory(userId);
  return history
    .filter((e) => {
      const t = new Date(e.date).getTime();
      return t >= start.getTime() && t <= end.getTime();
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/** Single InBody entry by id — history has no by-id endpoint, so filter client-side. */
export async function fetchInBodyById(
  userId: string,
  id: string,
): Promise<InBodyEntrySnapshot | null> {
  const history = await fetchInBodyHistory(userId);
  return history.find((e) => e.id === id) ?? null;
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
