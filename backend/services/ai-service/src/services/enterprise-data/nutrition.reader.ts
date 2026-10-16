import axios from "axios";
import { profileExtractor } from "../../llm/profile_extractor";
import type { AgentIdentity } from "../fitness-agent-tools";
import { ok, absent, errorRead, type AuthoritativeRead, type NutritionGoalFacts, type NutritionProgramSummary } from "./types";

const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL ||
  (process.env.NODE_ENV === "production" ? "http://fitness-service:3002" : "http://localhost:3002");

function authHeaders(authorizationHeader?: string): Record<string, string> | undefined {
  if (!authorizationHeader) return undefined;
  return { Authorization: authorizationHeader };
}

/** A real stored row has an id; fitness-service returns an id-less DEFAULT placeholder when none exists
 * (nutrition.service.ts::getGoal -> findGoalByUserId ?? DEFAULT_NUTRITION_GOAL). Macro fields must also be
 * real positive numbers — the same guard profile_extractor.ts already applies for its own derivation. */
function isRealGoalRow(raw: any): raw is { id: string; calories: number; protein: number; carbs: number; fat: number; status?: string } {
  return (
    raw &&
    typeof raw.id === "string" &&
    [raw.calories, raw.protein, raw.carbs, raw.fat].every((n: unknown) => typeof n === "number" && Number.isFinite(n) && (n as number) > 0)
  );
}

/** The currently ACTIVE goal only — the authoritative answer to "what is my nutrition target right now?"
 * A DEFAULT/non-ACTIVE placeholder must never be reported as the user's real target (Phase 3 Batch 1's
 * named correctness fix — see docs/ai-product/phase3-batch1-context-foundation.md). Routed through
 * profileExtractor.extract() so this reuses its existing 15s cache instead of a second HTTP call. */
export async function getActiveNutritionGoal(identity: AgentIdentity): Promise<AuthoritativeRead<NutritionGoalFacts>> {
  const result = await profileExtractor.extract(identity.userId, identity.authorizationHeader);
  if (result.nutritionGoalFetchFailed) return errorRead("FITNESS_SERVICE", "Failed to read /nutrition/goals");
  if (!result.profile.nutritionGoal) return absent("FITNESS_SERVICE");
  return ok(result.profile.nutritionGoal, "FITNESS_SERVICE");
}

/** Routed through profileExtractor.extract() — reuses its compacted currentNutritionProgram shape and
 * its existing 15s cache, same pattern as workout.reader.ts::getCurrentWorkoutProgram. */
export async function getCurrentNutritionProgram(identity: AgentIdentity): Promise<AuthoritativeRead<NutritionProgramSummary>> {
  const result = await profileExtractor.extract(identity.userId, identity.authorizationHeader);
  if (!result.currentNutritionProgram) return absent("FITNESS_SERVICE");
  return ok(result.currentNutritionProgram as NutritionProgramSummary, "FITNESS_SERVICE");
}

/** The last real goal saved, regardless of ACTIVE status — "even if since superseded." Not wired to any
 * caller this batch (none currently needs this distinct semantic); exists so the three nutrition-goal
 * operations are each unambiguous, per the Phase 3 Batch 1 brief. Direct call (not profileExtractor-routed)
 * since it needs the raw row, not the ACTIVE-filtered projection. */
export async function getLatestNutritionGoal(identity: AgentIdentity): Promise<AuthoritativeRead<NutritionGoalFacts>> {
  try {
    const res = await axios.get(`${FITNESS_SERVICE_URL}/nutrition/goals`, {
      headers: authHeaders(identity.authorizationHeader), timeout: 3000,
    });
    const raw = (res.data as any)?.data ?? res.data;
    if (!isRealGoalRow(raw)) return absent("FITNESS_SERVICE");
    return ok({ calories: raw.calories, protein: raw.protein, carbs: raw.carbs, fat: raw.fat }, "FITNESS_SERVICE");
  } catch (err: any) {
    return errorRead("FITNESS_SERVICE", err?.message ?? "Failed to read /nutrition/goals");
  }
}

/** Full goal history — fitness-service's own GET /nutrition/goals/history (nutrition.routes.ts, previously
 * unused by any ai-service caller). */
export async function getNutritionGoals(identity: AgentIdentity): Promise<AuthoritativeRead<NutritionGoalFacts[]>> {
  try {
    const res = await axios.get(`${FITNESS_SERVICE_URL}/nutrition/goals/history`, {
      headers: authHeaders(identity.authorizationHeader), timeout: 3000,
    });
    const raw = (res.data as any)?.data ?? res.data;
    const rows = Array.isArray(raw) ? raw : [];
    const goals = rows.filter(isRealGoalRow).map((r: any) => ({ calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat }));
    if (!goals.length) return absent("FITNESS_SERVICE");
    return ok(goals, "FITNESS_SERVICE");
  } catch (err: any) {
    return errorRead("FITNESS_SERVICE", err?.message ?? "Failed to read /nutrition/goals/history");
  }
}
