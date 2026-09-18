import { getChatEligibility } from "../clients/user-service.client";

// Historical naming inconsistency: chat-service was configured with INTERNAL_API_SECRET
// while user/auth services use INTERNAL_SERVICE_SECRET. Accept either so the policy
// query works without forcing a docker-compose change.
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || process.env.INTERNAL_API_SECRET || "";

/**
 * BR-29 (loosened): chat is allowed when either
 *   (a) a contract relationship exists between the two users, or
 *   (b) the conversation is from CUSTOMER → APPROVED PT (pre-contract discovery).
 *
 * The decision is computed in user-service via /internal/chat-eligibility and
 * protected by x-service-secret so that public clients cannot probe relationships.
 */
export async function canUsersChat(
  userAId: string,
  userBId: string,
  _authToken?: string,
): Promise<boolean> {
  try {
    const data = await getChatEligibility({
      fromUserId: userAId,
      toUserId: userBId,
      internalSecret: INTERNAL_SERVICE_SECRET,
    });
    return data?.allowed === true;
  } catch {
    return false;
  }
}

/**
 * Whether the current user is allowed to initiate a conversation with targetUserId.
 * Delegates to canUsersChat with the requesting user as `fromUserId` (direction matters
 * for the APPROVED_PT_DISCOVERY rule — only CUSTOMER → PT, not PT → CUSTOMER cold).
 */
export async function canCreateDirectChat(
  requestingUserId: string,
  targetUserId: string,
  authToken?: string,
): Promise<boolean> {
  return canUsersChat(requestingUserId, targetUserId, authToken);
}
