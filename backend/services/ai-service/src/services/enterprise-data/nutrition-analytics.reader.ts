import axios from "axios";
import type { AgentIdentity } from "../fitness-agent-tools";
import { ok, absent, errorRead, type AuthoritativeRead, type NutritionAnalyticsWindow } from "./types";

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === "production" ? "http://fitness-service:3002" : "http://localhost:3002");

const QUALITIES = new Set(["SUFFICIENT", "PARTIAL", "INSUFFICIENT_HISTORY", "NO_DATA", "STALE"]);
const ADH_STATES = new Set(["MEASURED", "NOT_AVAILABLE_NO_TARGET", "NOT_AVAILABLE_NO_ACTUAL"]);

/** Structural guard: a malformed upstream body must be an error, never "no data". */
function isNutritionAnalyticsWindow(v: any): v is NutritionAnalyticsWindow {
  return (
    v != null && typeof v === "object" &&
    v.period && typeof v.period.days === "number" &&
    v.activeTarget && (v.activeTarget.state === "ACTIVE_TARGET" || v.activeTarget.state === "NO_ACTIVE_TARGET") &&
    v.actual && Array.isArray(v.actual.days) && v.actual.summary && typeof v.actual.summary.loggedDays === "number" &&
    v.adherence && ADH_STATES.has(v.adherence.state) &&
    QUALITIES.has(v.dataQuality)
  );
}

/**
 * Typed read of fitness-service's normalized nutrition target-vs-actual window
 * (GET /nutrition/analytics/window). Identity is the caller's Authorization
 * header only (no userId parameter). 0 LLM calls.
 *   ok     → a window (which may itself say dataQuality NO_DATA / STALE, activeTarget NO_ACTIVE_TARGET)
 *   absent → upstream 404
 *   error  → transport/HTTP/shape failure — never converted to "no logs"
 */
export async function getNutritionAnalytics(
  identity: AgentIdentity,
  range: { days?: number } = {},
): Promise<AuthoritativeRead<NutritionAnalyticsWindow>> {
  try {
    const res = await axios.get(`${FITNESS_SERVICE_URL}/nutrition/analytics/window`, {
      headers: identity.authorizationHeader ? { Authorization: identity.authorizationHeader } : undefined,
      params: range.days != null ? { days: range.days } : undefined,
      timeout: 3500,
    });
    if (!isNutritionAnalyticsWindow(res.data)) return errorRead("FITNESS_SERVICE", "Malformed nutrition analytics response");
    return ok(res.data, "FITNESS_SERVICE");
  } catch (err: any) {
    if (err?.response?.status === 404) return absent("FITNESS_SERVICE");
    return errorRead("FITNESS_SERVICE", err?.message ?? "Failed to read /nutrition/analytics/window");
  }
}
