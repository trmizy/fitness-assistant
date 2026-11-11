import axios from "axios";
import type { AgentIdentity } from "../fitness-agent-tools";
import { ok, absent, errorRead, type AuthoritativeRead, type TrainingAnalyticsWindow } from "./types";

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === "production" ? "http://fitness-service:3002" : "http://localhost:3002");

export interface TrainingAnalyticsRange {
  /** Rolling window length; fitness-service bounds it (7..90). Default 28 server-side. */
  days?: number;
}

const QUALITIES = new Set(["SUFFICIENT", "PARTIAL", "INSUFFICIENT_HISTORY", "NO_DATA", "STALE"]);

/** Minimal structural guard — a malformed upstream body must surface as an error,
 * never be passed on as "no data". */
function isTrainingAnalyticsWindow(v: any): v is TrainingAnalyticsWindow {
  return (
    v != null &&
    typeof v === "object" &&
    v.period && typeof v.period.days === "number" &&
    v.adherence && (v.adherence.state === "NO_SCHEDULE" || v.adherence.state === "MEASURED") &&
    v.frequency && v.volume && v.progression && Array.isArray(v.progression.exercises) &&
    Array.isArray(v.signals) &&
    QUALITIES.has(v.dataQuality)
  );
}

/**
 * Typed read of fitness-service's rolling-window training analytics
 * (GET /stats/training-window). Identity is the caller's authenticated
 * Authorization header — fitness-service derives the user from it; no userId
 * is ever sent as a parameter. 0 LLM calls.
 *
 *   ok     → a window (which may itself say dataQuality NO_DATA / adherence NO_SCHEDULE)
 *   absent → upstream 404 (endpoint/user unknown)
 *   error  → any transport/HTTP/shape failure — never converted to "no data"
 */
export async function getTrainingAnalytics(
  identity: AgentIdentity,
  range: TrainingAnalyticsRange = {},
): Promise<AuthoritativeRead<TrainingAnalyticsWindow>> {
  try {
    const res = await axios.get(`${FITNESS_SERVICE_URL}/stats/training-window`, {
      headers: identity.authorizationHeader ? { Authorization: identity.authorizationHeader } : undefined,
      params: range.days != null ? { days: range.days } : undefined,
      timeout: 3500,
    });
    if (!isTrainingAnalyticsWindow(res.data)) {
      return errorRead("FITNESS_SERVICE", "Malformed training analytics response");
    }
    return ok(res.data, "FITNESS_SERVICE");
  } catch (err: any) {
    if (err?.response?.status === 404) return absent("FITNESS_SERVICE");
    return errorRead("FITNESS_SERVICE", err?.message ?? "Failed to read /stats/training-window");
  }
}
