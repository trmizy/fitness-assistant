import axios from 'axios';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3004';

/**
 * Returns true if either userA or userB is a PT.
 *
 * TODO (Phase 2): Enforce stricter rules — e.g., require an active PT-Client contract.
 * This would involve a Contract model: Contract { ptId, clientId, status: ACTIVE | EXPIRED }
 * and checking that a valid contract exists between the two parties.
 */
export async function canUsersChat(
  userAId: string,
  userBId: string,
  authToken: string,
): Promise<boolean> {
  try {
    const { data } = await axios.get(
      `${USER_SERVICE_URL}/profile/pts`,
      { headers: { Authorization: `Bearer ${authToken}` }, timeout: 3000 },
    );

    const ptIds: string[] = (data.pts ?? []).map((p: any) => p.userId);
    return ptIds.includes(userAId) || ptIds.includes(userBId);
  } catch {
    // If user-service is down, be permissive so chat doesn't fully break
    return true;
  }
}

/**
 * Whether the current user is allowed to initiate a conversation with targetUserId.
 * Currently delegates to canUsersChat.
 */
export async function canCreateDirectChat(
  requestingUserId: string,
  targetUserId: string,
  authToken: string,
): Promise<boolean> {
  return canUsersChat(requestingUserId, targetUserId, authToken);
}
