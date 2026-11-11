/**
 * user-service stores preferredTrainingDays as 0..6 (0 = Chủ nhật); the agent uses 1..7 (7 = Chủ nhật). A raw 0 used to make
 * AgentPreferencesSchema throw (HTTP 500) for any PT / program / workout chat request from a user who picked Chủ nhật
 * (found by the full chat verification, user with preferredTrainingDays [0,2,4]).
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { AgentPreferencesSchema } from "@gym-coach/shared";
import { profileExtractor } from "../llm/profile_extractor";
import { fitnessAgentTools } from "../services/fitness-agent-tools";

test("getUserFitnessContext maps Chủ nhật (0) to 7 so the agent's own preference schema accepts it", async () => {
  const origRequest = axios.request; const origExtract = profileExtractor.extract;
  try {
    axios.request = (async () => ({ data: { goal: "MUSCLE_GAIN", experience: "INTERMEDIATE", days: [0, 2, 4, 2], sessionMinutes: 60, budgetVnd: null, reviewRequired: false, injuries: [], equipment: [] } })) as any;
    profileExtractor.extract = (async () => ({ profile: { userId: "u", training: { availableEquipment: [], injuries: [], preferredTrainingDays: [] } }, inBodyHistory: [], workoutHistory: [], nutritionHistory: [] })) as any;
    const ctx = await fitnessAgentTools.getUserFitnessContext({ userId: "u", authorizationHeader: "Bearer t" } as any);
    assert.deepEqual(ctx.profile.days, [2, 4, 7]);
    assert.doesNotThrow(() => AgentPreferencesSchema.parse({ goal: "MUSCLE_GAIN", days: ctx.profile.days, sessionMinutes: 60, budgetVnd: 3_000_000 }));
    // control: the raw shape is exactly what used to blow up
    assert.throws(() => AgentPreferencesSchema.parse({ goal: "MUSCLE_GAIN", days: [0, 2, 4], sessionMinutes: 60, budgetVnd: 3_000_000 }));
  } finally { axios.request = origRequest; profileExtractor.extract = origExtract; }
});
