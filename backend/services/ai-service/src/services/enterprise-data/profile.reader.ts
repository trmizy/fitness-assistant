import { profileExtractor } from "../../llm/profile_extractor";
import type { AgentIdentity } from "../fitness-agent-tools";
import type { UserProfile } from "../../llm/types";
import { ok, absent, type AuthoritativeRead } from "./types";

/**
 * Thin typed wrapper over profileExtractor.extract() — NOT a parallel
 * re-implementation. extract() already does the one batched, 15s-cached
 * fetch this layer wants; these functions just project a canonical typed
 * fact out of it. Reusing it means two readers called in the same turn for
 * the same user hit the SAME cache, not two HTTP requests.
 */

export async function getUserProfile(identity: AgentIdentity): Promise<AuthoritativeRead<UserProfile>> {
  const result = await profileExtractor.extract(identity.userId, identity.authorizationHeader);
  return ok(result.profile, "USER_SERVICE");
}

export async function getCurrentFitnessGoal(identity: AgentIdentity): Promise<AuthoritativeRead<NonNullable<UserProfile["goal"]>>> {
  const result = await profileExtractor.extract(identity.userId, identity.authorizationHeader);
  if (!result.profile.goal) return absent("USER_SERVICE");
  return ok(result.profile.goal, "USER_SERVICE");
}
