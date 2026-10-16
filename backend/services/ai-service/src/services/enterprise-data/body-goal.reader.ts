import axios from "axios";
import type { AgentIdentity } from "../fitness-agent-tools";
import { ok, absent, errorRead, type AuthoritativeRead, type BodyGoalStateWindow } from "./types";

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === "production" ? "http://fitness-service:3002" : "http://localhost:3002");

const QUALITIES = new Set(["SUFFICIENT", "PARTIAL", "INSUFFICIENT_HISTORY", "NO_DATA", "STALE"]);

/** Structural guard — a malformed upstream body is an error, never "no body data". */
function isBodyGoalState(v: any): v is BodyGoalStateWindow {
  return (
    v != null && typeof v === "object" && typeof v.lookbackDays === "number" &&
    v.body && QUALITIES.has(v.body.dataQuality) && v.body.observations && typeof v.body.observations.totalOnRecord === "number" &&
    v.body.trends && v.body.trends.weight &&
    v.goal && v.goal.currentTarget && v.goal.gap && v.goal.trajectory && v.goal.trajectory.onTrack && v.goal.roadmap &&
    QUALITIES.has(v.goal.dataQuality)
  );
}

/**
 * Typed read of fitness-service's observed body state + goal gap/trajectory
 * (GET /stats/body-goal-state). Identity = caller's Authorization header only.
 * 0 LLM calls.
 *   ok     → a state (may itself say body NO_DATA / goal NO_TARGET)
 *   absent → upstream 404
 *   error  → transport/HTTP (incl. 502 when user-service was unreachable)/shape failure — never "no measurements"
 */
export async function getBodyGoalState(
  identity: AgentIdentity,
  range: { lookbackDays?: number } = {},
): Promise<AuthoritativeRead<BodyGoalStateWindow>> {
  try {
    const res = await axios.get(`${FITNESS_SERVICE_URL}/stats/body-goal-state`, {
      headers: identity.authorizationHeader ? { Authorization: identity.authorizationHeader } : undefined,
      params: range.lookbackDays != null ? { lookbackDays: range.lookbackDays } : undefined,
      timeout: 5000,
    });
    if (!isBodyGoalState(res.data)) return errorRead("FITNESS_SERVICE", "Malformed body/goal state response");
    return ok(res.data, "FITNESS_SERVICE");
  } catch (err: any) {
    if (err?.response?.status === 404) return absent("FITNESS_SERVICE");
    return errorRead("FITNESS_SERVICE", err?.message ?? "Failed to read /stats/body-goal-state");
  }
}
