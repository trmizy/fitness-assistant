import axios from "axios";
import { profileExtractor } from "../../llm/profile_extractor";
import type { AgentIdentity } from "../fitness-agent-tools";
import { ok, absent, errorRead, type AuthoritativeRead, type WorkoutProgramSummary } from "./types";

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === "production" ? "http://fitness-service:3002" : "http://localhost:3002");

function authHeaders(authorizationHeader?: string): Record<string, string> | undefined {
  if (!authorizationHeader) return undefined;
  return { Authorization: authorizationHeader };
}

/** Routed through profileExtractor.extract() — reuses its compacted currentWorkoutProgram shape and its
 * existing 15s cache, so a caller that needs this in the same turn profileExtractor already ran for
 * (e.g. the chat orchestrator) gets a cache hit, not a second GET /workouts/programs/current. */
export async function getCurrentWorkoutProgram(identity: AgentIdentity): Promise<AuthoritativeRead<WorkoutProgramSummary>> {
  const result = await profileExtractor.extract(identity.userId, identity.authorizationHeader);
  if (!result.currentWorkoutProgram) return absent("FITNESS_SERVICE");
  return ok(result.currentWorkoutProgram as WorkoutProgramSummary, "FITNESS_SERVICE");
}

export interface ScheduleRange { startDate?: string; endDate?: string }

/** Typed version of the GET /workouts/schedules call workout_schedule_context.ts::fetchSchedules and
 * fitness-agent-tools.ts::getTodaySchedule each make independently today. Direct call (not
 * profileExtractor-routed) — profileExtractor doesn't fetch date-ranged schedules. */
export async function getWorkoutSchedule(identity: AgentIdentity, range: ScheduleRange = {}): Promise<AuthoritativeRead<Record<string, unknown>[]>> {
  try {
    const params: Record<string, string> = {};
    if (range.startDate) params.startDate = range.startDate;
    if (range.endDate) params.endDate = range.endDate;
    const res = await axios.get(`${FITNESS_SERVICE_URL}/workouts/schedules`, {
      headers: authHeaders(identity.authorizationHeader), params, timeout: 3500,
    });
    const data = (res.data as any)?.data ?? res.data;
    const rows = Array.isArray(data) ? data : Array.isArray(data?.schedules) ? data.schedules : [];
    if (!rows.length) return absent("FITNESS_SERVICE");
    return ok(rows, "FITNESS_SERVICE");
  } catch (err: any) {
    return errorRead("FITNESS_SERVICE", err?.message ?? "Failed to read /workouts/schedules");
  }
}

/** Typed version of the GET /workouts?limit=N call both profile_extractor.ts (limit 20) and
 * workout_schedule_context.ts::fetchRecentLogs (limit 10) make independently today. Direct call — the
 * limit varies per caller, which profileExtractor.extract()'s own fixed limit=20 batch call can't serve. */
export async function getRecentWorkoutHistory(identity: AgentIdentity, limit = 20): Promise<AuthoritativeRead<Record<string, unknown>[]>> {
  try {
    const res = await axios.get(`${FITNESS_SERVICE_URL}/workouts`, {
      headers: authHeaders(identity.authorizationHeader), params: { limit }, timeout: 3500,
    });
    const data = (res.data as any)?.data ?? res.data;
    const rows = Array.isArray(data) ? data : Array.isArray(data?.workouts) ? data.workouts : [];
    if (!rows.length) return absent("FITNESS_SERVICE");
    return ok(rows, "FITNESS_SERVICE");
  } catch (err: any) {
    return errorRead("FITNESS_SERVICE", err?.message ?? "Failed to read /workouts");
  }
}
